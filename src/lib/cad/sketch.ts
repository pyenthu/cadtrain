/**
 * Sketch engine (plan M.1, docs/plans/profile-sketcher.md).
 *
 * A `sketch` is an ordered list of operators that compile DETERMINISTICALLY
 * to the `(r,z)` point list `r_revolve` / `r_extrude` already consume — so
 * the bake pipeline is untouched. `compileSketch` is the bridge: ops in,
 * sampled `(r,z)` out, via Maker.js (Microsoft, MIT).
 *
 * Server-safe: no Svelte / DOM. Validated end-to-end by scripts/spike_makerjs.ts
 * and tests/sketch.test.ts (ops → Maker.js → sampled points → bakes).
 *
 * First-cut op set (M.1): `line`, `spline`, `fillet`, `chamfer`. The `arcTo`,
 * `offset`, `mirror` ops land in M.1b / M.4.
 */
import makerjs from 'makerjs';

export type SketchOp =
  /** Straight segment to (r,z). The FIRST op is the start point (moveTo). */
  | { op: 'line'; r: number; z: number }
  /** Bézier curve to (r,z); `ctrl` = 1 or 2 control points (quad/cubic).
   *  Omit ctrl for an auto smooth curve through the points. */
  | { op: 'spline'; r: number; z: number; ctrl?: [number, number][] }
  /** Round the corner at the vertex this op FOLLOWS (the most recent point). */
  | { op: 'fillet'; radius: number }
  /** Bevel the corner at the most recent point by `dist` along each edge. */
  | { op: 'chamfer'; dist: number };

type Pt = [number, number];

/** A resolved vertex: the anchor point + the edge type that REACHES it +
 *  an optional corner modifier applied AT it. */
interface Vert {
  pt: Pt;
  edge: 'line' | 'spline';
  ctrl?: Pt[];
  corner?: { kind: 'fillet'; radius: number } | { kind: 'chamfer'; dist: number };
}

/** Parse the flat op list into vertices (point ops) with corner mods
 *  (fillet/chamfer) attached to the preceding vertex. */
function toVerts(ops: SketchOp[]): Vert[] {
  const verts: Vert[] = [];
  for (const op of ops) {
    if (op.op === 'line' || op.op === 'spline') {
      verts.push({ pt: [op.r, op.z], edge: op.op, ctrl: op.op === 'spline' ? op.ctrl : undefined });
    } else if (op.op === 'fillet' && verts.length) {
      verts[verts.length - 1].corner = { kind: 'fillet', radius: op.radius };
    } else if (op.op === 'chamfer' && verts.length) {
      verts[verts.length - 1].corner = { kind: 'chamfer', dist: op.dist };
    }
  }
  return verts;
}

const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
const scale = (a: Pt, s: number): Pt => [a[0] * s, a[1] * s];
const len = (a: Pt): number => Math.hypot(a[0], a[1]);
const norm = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };

/** Chamfer a corner geometrically: replace the vertex with two points,
 *  pulled back `dist` along each incident edge. Pure math (no Maker.js). */
function chamferCorner(prev: Pt, corner: Pt, next: Pt, dist: number): [Pt, Pt] {
  const inDir = norm(sub(prev, corner));   // from corner toward prev
  const outDir = norm(sub(next, corner));  // from corner toward next
  const d = Math.min(dist, len(sub(prev, corner)) * 0.49, len(sub(next, corner)) * 0.49);
  return [add(corner, scale(inDir, d)), add(corner, scale(outDir, d))];
}

/**
 * Compile a sketch to a closed `(r,z)` point list ready for r_revolve /
 * r_extrude. `segments` controls the sampling density of curved sections.
 */
export function compileSketch(ops: SketchOp[], segments = 64): Pt[] {
  const verts = toVerts(ops);
  if (verts.length < 2) return verts.map((v) => v.pt);

  // ── 1. Apply CHAMFERS at the point level (each splits a vertex in two) ──
  const chamfered: { pt: Pt; edge: 'line' | 'spline'; ctrl?: Pt[]; fillet?: number }[] = [];
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    if (v.corner?.kind === 'chamfer') {
      const prev = verts[(i - 1 + verts.length) % verts.length].pt;
      const next = verts[(i + 1) % verts.length].pt;
      const [a, b] = chamferCorner(prev, v.pt, next, v.corner.dist);
      chamfered.push({ pt: a, edge: v.edge, ctrl: v.ctrl });
      chamfered.push({ pt: b, edge: 'line' });
    } else {
      chamfered.push({ pt: v.pt, edge: v.edge, ctrl: v.ctrl, fillet: v.corner?.kind === 'fillet' ? v.corner.radius : undefined });
    }
  }

  // ── 2. Build a Maker.js model — lines + Bézier curves, named in order ──
  const pathsObj: Record<string, any> = {};
  const modelsObj: Record<string, any> = {};
  const n = chamfered.length;
  for (let i = 0; i < n; i++) {
    const a = chamfered[i].pt;
    const b = chamfered[(i + 1) % n].pt;
    const target = chamfered[(i + 1) % n];
    if (target.edge === 'spline') {
      const ctrl = (target.ctrl && target.ctrl.length)
        ? [a, ...target.ctrl, b]
        : [a, add(a, scale(sub(b, a), 0.33)), add(a, scale(sub(b, a), 0.66)), b];
      modelsObj[`s${i}`] = new makerjs.models.BezierCurve(ctrl as any);
    } else {
      pathsObj[`e${i}`] = new makerjs.paths.Line(a, b);
    }
  }
  const model: any = { paths: pathsObj, models: modelsObj };

  // ── 3. Apply FILLETS via chain.fillet (per-radius when corners differ) ──
  // First cut: if any vertex requests a fillet, round all such corners with
  // the (smallest requested) radius via chain.fillet. Per-corner radii is an
  // M.3 refinement.
  const filletR = chamfered.filter((c) => c.fillet != null).map((c) => c.fillet!);
  if (filletR.length) {
    try {
      const chain = makerjs.model.findSingleChain(model);
      if (chain) {
        const f = makerjs.chain.fillet(chain, Math.min(...filletR));
        if (f) model.models = { ...(model.models || {}), __fillets: f };
      }
    } catch { /* leave unfilleted on failure */ }
  }

  // ── 4. SAMPLE the chain → evenly-spaced (r,z) ──────────────────────────
  return sampleModel(model, segments);
}

/** Walk the model's single chain into ~`segments` evenly-spaced points. */
export function sampleModel(model: any, segments: number): Pt[] {
  const chain = makerjs.model.findSingleChain(model);
  if (!chain) {
    // Fallback: collect raw path endpoints in order.
    const pts: Pt[] = [];
    makerjs.model.walk(model, { onPath: (wp: any) => {
      const ends = makerjs.point.fromPathEnds(wp.pathContext);
      if (ends) ends.forEach((e: number[]) => pts.push([e[0], e[1]]));
    } });
    return dedupe(pts);
  }
  const ext = makerjs.measure.modelExtents(model);
  const span = Math.max(ext?.width ?? 1, ext?.height ?? 1) || 1;
  const spacing = span / Math.max(8, segments);
  const keys = makerjs.chain.toKeyPoints(chain, spacing) as number[][];
  return dedupe(keys.map((k) => [k[0], k[1]] as Pt));
}

/** Drop consecutive duplicate points (within epsilon). */
function dedupe(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(last[0] - p[0], last[1] - p[1]) > 1e-6) out.push(p);
  }
  return out;
}

/** Render a sketch to an SVG string (for the editor preview / DXF later). */
export function sketchToSvg(ops: SketchOp[]): string {
  // Re-build the model (without sampling) for crisp curve rendering.
  const verts = toVerts(ops);
  if (verts.length < 2) return '';
  const pathsObj: Record<string, any> = {};
  for (let i = 0; i < verts.length; i++) {
    const a = verts[i].pt;
    const b = verts[(i + 1) % verts.length].pt;
    pathsObj[`e${i}`] = new makerjs.paths.Line(a as any, b as any);
  }
  return makerjs.exporter.toSVG({ paths: pathsObj });
}
