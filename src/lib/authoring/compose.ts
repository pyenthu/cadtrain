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
  type ComponentResult,
} from '$lib/components/builder';
import type { AuthoredComponent, AuthoredPart, AuthoredOp } from './schema';

/**
 * Build geometry from an authored spec.
 *
 * Throws if:
 *   - a part references an unknown primitive id
 *   - an op references an unknown input id
 *   - the spec has zero parts
 */
export async function buildAuthored(spec: AuthoredComponent): Promise<ComponentResult> {
  await initManifold();

  if (spec.parts.length === 0) {
    throw new Error('AuthoredComponent has no parts');
  }

  // Stage 1: build each part as a raw manifold, apply its transform.
  // Map from local id → manifold. Shared by parts and op outputs since
  // op ids can be referenced by later ops as if they were parts.
  const pool: Record<string, any> = {};

  for (const part of spec.parts) {
    if (pool[part.id] !== undefined) {
      throw new Error(`Duplicate part id: ${part.id}`);
    }
    let m = buildPrimitiveManifold(part.prim, part.params);
    m = applyTransform(m, part.transform);
    pool[part.id] = m;
  }

  // Stage 2: apply CSG operations in order. Each op's output goes back
  // into the pool under its `out` id so later ops can reference it.
  let lastOut: string | null = null;

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
    lastOut = op.out;
  }

  // Final manifold: whichever op ran last, else union of all parts.
  let finalManifold: any;
  if (lastOut !== null) {
    finalManifold = pool[lastOut];
  } else {
    finalManifold = pool[spec.parts[0].id];
    for (let i = 1; i < spec.parts.length; i++) {
      finalManifold = finalManifold.add(pool[spec.parts[i].id]);
    }
  }

  const maxOD = estimateMaxOD(spec.parts);
  return finalizeManifold(finalManifold, maxOD);
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
