/**
 * Composition interpreter — turns an AuthoredComponent spec into a
 * ManifoldCAD result that ComponentScene can render.
 *
 * The spec is a JSON recipe: a list of parts (primitives + transforms)
 * and a list of CSG operations (union/subtract/intersect) that reference
 * earlier parts or ops by id. The final result is whichever op was
 * declared last, or — if no ops — the union of all parts.
 *
 * This is the ONLY interpreter for authored specs. It's pure TS: no eval,
 * no dynamic imports, no sandboxing needed because it can't execute
 * anything that isn't in the fixed primitive builder map.
 */

import {
  buildPrimitiveManifold,
  finalizeManifold,
  initManifold,
  setCircularSegmentMode,
  type ComponentResult,
} from '$lib/components/builder';
import type { AuthoredComponent, AuthoredPart, AuthoredOp } from './schema';

/**
 * Per-part result for the multi-mesh render path. Each part is finalized
 * independently — mobile-safe because we never hold a giant union of all
 * parts in WASM heap at once. Bottom-sub uses the same multi-mesh shape.
 */
export interface AuthoredPartResult {
  /** Local id from the spec (p0, p1, ...) */
  id: string;
  /** Primitive id (hollow_cylinder, packer_element, ...) */
  prim: string;
  full: any;        // THREE.BufferGeometry
  cutVC: any;       // THREE.BufferGeometry (with vertex colors for cutaway)
}

export interface AuthoredResult {
  /** Per-part finalized geometry. Render each as a separate <T.Mesh>. */
  parts: AuthoredPartResult[];
  /** Total wall-clock build time in ms (sum of per-part finalize calls). */
  ms: number;
}

/**
 * Build geometry from an authored spec.
 *
 * Throws if:
 *   - a part references an unknown primitive id
 *   - an op references an unknown input id
 *   - the spec has zero parts
 *
 * Uses the lower-segment "compose" mode (64 sides per cylinder vs 192
 * default) since multi-part assemblies CSG-union 8-12 cylinders together
 * and the resulting manifold OOMs mobile WebKit at higher segment counts.
 * Restored on completion (try/finally) so subsequent single-primitive
 * renders go back to crisp 192.
 */
export async function buildAuthored(spec: AuthoredComponent): Promise<AuthoredResult> {
  await initManifold();

  if (spec.parts.length === 0) {
    throw new Error('AuthoredComponent has no parts');
  }

  // Multi-mesh build path (mirrors bottom-sub): each part finalized
  // independently, no giant union. Mobile-safe because peak WASM heap is
  // bounded by the single largest part rather than the union of all parts.
  // CSG ops (subtract / intersect) STILL fuse their inputs into one manifold —
  // those are intentional fuses (e.g. port holes through a sub) and are
  // typically 2-3 inputs, well within heap budget.
  //
  // Compose mode = 96 segments (vs 192 default). Halves triangle count
  // across the assembly with negligible visual difference at typical view
  // distances. The runtime cost (Edges pass + per-frame render) drops
  // proportionally — important for mobile interaction smoothness.
  setCircularSegmentMode('compose');
  try {
  const t0 = Date.now();
  const maxOD = estimateMaxOD(spec.parts);

  // Stage 1: build each part's transformed manifold. Pool also carries op
  // outputs for chained CSG.
  //
  // Primitive cache: many real assemblies repeat the same (prim, params) —
  // a packer has two slips and two cones with identical params. The slips
  // builder alone runs ~40 internal CSG ops (sectors + 12 grooves), so
  // building it twice doubles the wall-clock cost. Cache by JSON-key so
  // the second occurrence reuses the pre-transform manifold and only pays
  // for its own transform (cheap). Hit rate on Opus assemblies: ~30-50%.
  const primCache = new Map<string, any>();
  function getPrimitive(prim: string, params: Record<string, number>): any {
    const key = `${prim}::${JSON.stringify(params)}`;
    let m = primCache.get(key);
    if (m === undefined) {
      m = buildPrimitiveManifold(prim, params);
      primCache.set(key, m);
    }
    return m;
  }

  const pool: Record<string, any> = {};
  for (const part of spec.parts) {
    if (pool[part.id] !== undefined) {
      throw new Error(`Duplicate part id: ${part.id}`);
    }
    const base = getPrimitive(part.prim, part.params);
    pool[part.id] = applyTransform(base, part.transform);
  }

  // Stage 2: apply explicit CSG ops. Each op REPLACES its inputs in the
  // render set — the resulting fused manifold becomes a single part. Track
  // which spec.parts ids got consumed so we don't render them twice.
  const consumed = new Set<string>();
  const opResults: { id: string; prim: string; manifold: any }[] = [];

  for (const op of spec.ops) {
    if (pool[op.out] !== undefined) {
      throw new Error(`Op out id collides with existing id: ${op.out}`);
    }
    if (op.inputs.length < 2) {
      throw new Error(`Op ${op.out} needs at least 2 inputs (got ${op.inputs.length})`);
    }
    let result = resolve(pool, op.inputs[0], op.out);
    for (let i = 1; i < op.inputs.length; i++) {
      const next = resolve(pool, op.inputs[i], op.out);
      result = applyCsg(result, next, op.op);
    }
    pool[op.out] = result;
    for (const inp of op.inputs) consumed.add(inp);
    opResults.push({ id: op.out, prim: 'op', manifold: result });
  }

  // Stage 3: assemble the render list. Two modes:
  //
  // FUSED (default — mirrors bottom-sub):
  //   Union all unconsumed parts + op outputs into ONE manifold, finalize
  //   once → one mesh, one finalize, one getMesh, one cutBox subtract.
  //   Same speed profile as bottom-sub (which fuses housing parts the same
  //   way). Works at 96 segments because peak heap is bounded by the
  //   fused-manifold size during the union (~16k tris for a 10-part packer
  //   = well within mobile budget).
  //
  // MULTI (fallback if FUSED OOMs on a specific assembly):
  //   Each part finalized + rendered separately. Mobile-safe by guarantee
  //   but ~3x more per-frame work. Toggle via spec.tags including 'no-fuse'
  //   or by calling buildAuthored(spec, { fuse: false }).
  const fuseAll = !spec.tags?.includes('no-fuse');
  const partResults: AuthoredPartResult[] = [];

  if (fuseAll) {
    // Collect every renderable manifold (transformed parts + op outputs)
    // and union them. Bottom-sub does this on housing's 5+ cylinders.
    const renderables: any[] = [];
    for (const part of spec.parts) {
      if (consumed.has(part.id)) continue;
      renderables.push(pool[part.id]);
    }
    for (const op of opResults) renderables.push(op.manifold);

    if (renderables.length === 0) {
      // Should be impossible — caught by the parts.length check above
      throw new Error('No renderable manifolds');
    }

    let fused = renderables[0];
    for (let i = 1; i < renderables.length; i++) {
      fused = fused.add(renderables[i]);
    }

    // skipCenter=false: the fused manifold gets centered to world origin.
    // Each part kept its tz-transform during the union (no per-part center),
    // so internal positioning is preserved — we just re-anchor the whole
    // assembly's centroid at (0,0,0) so OrbitControls rotates around the
    // middle of the object, not around an off-center pivot. Bottom-sub
    // never had this issue because its hand-coded transforms are already
    // symmetric around origin; Opus's aren't.
    const fin = finalizeManifold(fused, maxOD, false);
    partResults.push({ id: 'fused', prim: 'fused', full: fin.full, cutVC: fin.cutVC });
  } else {
    for (const part of spec.parts) {
      if (consumed.has(part.id)) continue;
      const fin = finalizeManifold(pool[part.id], maxOD, true);
      partResults.push({ id: part.id, prim: part.prim, full: fin.full, cutVC: fin.cutVC });
    }
    for (const op of opResults) {
      const fin = finalizeManifold(op.manifold, maxOD, true);
      partResults.push({ id: op.id, prim: op.prim, full: fin.full, cutVC: fin.cutVC });
    }
  }

  return { parts: partResults, ms: Date.now() - t0 };
  } finally {
    setCircularSegmentMode('default');
  }
}

/**
 * Backwards-compat shim. The Phase-3 author/library code expected a single
 * fused ComponentResult. The multi-mesh refactor returns AuthoredResult.
 * Anything still calling the old shape gets the FIRST part only — usable
 * for thumbnail/pHash but missing the rest. Update callers to AuthoredResult.
 */
export async function buildAuthoredFused(spec: AuthoredComponent): Promise<ComponentResult> {
  const r = await buildAuthored(spec);
  if (r.parts.length === 0) throw new Error('No parts produced');
  const p = r.parts[0];
  return { full: p.full, cutVC: p.cutVC, manifold: null };
}

function resolve(pool: Record<string, any>, id: string, forOp: string): any {
  const m = pool[id];
  if (m === undefined) {
    throw new Error(`Op ${forOp} references unknown input id: ${id}`);
  }
  return m;
}

function applyCsg(a: any, b: any, op: AuthoredOp['op']): any {
  switch (op) {
    case 'union':     return a.add(b);
    case 'subtract':  return a.subtract(b);
    case 'intersect': return a.intersect(b);
  }
}

function applyTransform(m: any, t: AuthoredPart['transform']): any {
  if (!t) return m;
  const rx = t.rx ?? 0, ry = t.ry ?? 0, rz = t.rz ?? 0;
  if (rx || ry || rz) m = m.rotate([rx, ry, rz]);
  const tx = t.tx ?? 0, ty = t.ty ?? 0, tz = t.tz ?? 0;
  if (tx || ty || tz) m = m.translate([tx, ty, tz]);
  return m;
}

/**
 * Rough max-OD estimate for the cutaway classifier in finalizeManifold.
 * Peeks at each part's params for common OD-ish keys. Not exact — the
 * cutaway only uses it as a size hint for the red/grey vertex coloring.
 */
function estimateMaxOD(parts: AuthoredPart[]): number {
  let max = 3;
  for (const p of parts) {
    const candidates = [
      p.params.od, p.params.odTop, p.params.odBottom,
      p.params.odLarge, p.params.slipOD, p.params.odCompressed,
      p.params.bodyOD, p.params.pinOD,
    ];
    for (const v of candidates) {
      if (typeof v === 'number' && v > max) max = v;
    }
  }
  return max;
}
