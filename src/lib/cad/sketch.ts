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
  /** Smooth curve to (r,z) — start = the preceding vertex `a`, end = `b=(r,z)`.
   *  `pts` are ordered through-points in the CHORD-AFFINE frame: `(u,v)` with
   *  `u`≈0..1 along the chord and `v` = perpendicular bulge as a fraction of
   *  |b−a| (`abs = a + u·d + v·rot90(d)`, `d=b−a`). The curve interpolates them.
   *  `h0`/`h1` are optional chord-relative end-tangent handles — displacements
   *  off `a`/`b` in the same frame. Omit all three → an auto Catmull-Rom smooth
   *  curve, geometry-identical to the pre-redesign plain spline. */
  | { op: 'spline'; r: number; z: number; pts?: [number, number][]; h0?: [number, number]; h1?: [number, number] }
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
  pts?: Pt[];   // chord-relative through-points (u,v) on a spline edge
  h0?: Pt;      // chord-relative start tangent handle
  h1?: Pt;      // chord-relative end tangent handle
  corner?: { kind: 'fillet'; radius: number } | { kind: 'chamfer'; dist: number };
}

/** Parse the flat op list into vertices (point ops) with corner mods
 *  (fillet/chamfer) attached to the preceding vertex. */
function toVerts(ops: SketchOp[]): Vert[] {
  const verts: Vert[] = [];
  for (const op of ops) {
    if (op.op === 'line' || op.op === 'spline') {
      verts.push({
        pt: [op.r, op.z],
        edge: op.op,
        pts: op.op === 'spline' ? op.pts : undefined,
        h0: op.op === 'spline' ? op.h0 : undefined,
        h1: op.op === 'spline' ? op.h1 : undefined,
      });
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

// ── Chord-affine frame ──────────────────────────────────────────────────
// A spline edge spans `a` (preceding vertex) → `b` (this op's (r,z)). Internal
// through-points + end handles are stored RELATIVE to that chord so they
// parametrise: move / rotate / scale an endpoint and the curve follows. With
// `d = b − a` and `rot90([dx,dy]) = [−dy, dx]`:
//   abs = a + u·d + v·rot90(d)
// `u` runs ≈0..1 along the chord, `v` is the perpendicular bulge as a fraction
// of |d|.

/** Chord-frame displacement vector for `(u,v)` (no anchor added). */
const chordDisp = (a: Pt, b: Pt, u: number, v: number): Pt => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  return [u * dx - v * dy, u * dy + v * dx];
};

/** Chord-frame `(u,v)` → absolute point. */
export function chordToAbs(a: Pt, b: Pt, u: number, v: number): Pt {
  const d = chordDisp(a, b, u, v);
  return [a[0] + d[0], a[1] + d[1]];
}

/** Inverse of `chordToAbs` — absolute point `p` → its `(u,v)` in the chord
 *  frame. Used by the editor's drag→relative-coords path (degenerate chord
 *  |d|≈0 falls back to det=1 so it returns finite numbers). */
export function absToChord(a: Pt, b: Pt, p: Pt): [number, number] {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const det = dx * dx + dy * dy || 1;
  const px = p[0] - a[0], py = p[1] - a[1];
  const u = (dx * px + dy * py) / det;
  const v = (dx * py - dy * px) / det;
  return [u, v];
}

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
  const chamfered: { pt: Pt; edge: 'line' | 'spline'; pts?: Pt[]; h0?: Pt; h1?: Pt; fillet?: number }[] = [];
  for (let i = 0; i < verts.length; i++) {
    const v = verts[i];
    if (v.corner?.kind === 'chamfer') {
      const prev = verts[(i - 1 + verts.length) % verts.length].pt;
      const next = verts[(i + 1) % verts.length].pt;
      const [a, b] = chamferCorner(prev, v.pt, next, v.corner.dist);
      chamfered.push({ pt: a, edge: v.edge, pts: v.pts, h0: v.h0, h1: v.h1 });
      chamfered.push({ pt: b, edge: 'line' });
    } else {
      chamfered.push({ pt: v.pt, edge: v.edge, pts: v.pts, h0: v.h0, h1: v.h1, fillet: v.corner?.kind === 'fillet' ? v.corner.radius : undefined });
    }
  }

  // ── 2. Build a Maker.js model — lines + Bézier curves, named in order ──
  const pathsObj: Record<string, any> = {};
  const modelsObj: Record<string, any> = {};
  const n = chamfered.length;
  // edgeLine[i] = the Line path for edge i (vertex i → i+1), or null when that
  // edge is a Bézier (splines aren't filletable here — M.4).
  const edgeLine: (any | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const a = chamfered[i].pt;
    const b = chamfered[(i + 1) % n].pt;
    const target = chamfered[(i + 1) % n];
    if (target.edge === 'spline') {
      // Build the knot sequence K = [a, ...through-points, b] (through-points
      // are chord-relative → absolute) and emit ONE cubic Bézier per
      // sub-segment. Each interior tangent is the uniform Catmull-Rom tangent
      // (K[k+1]−K[k−1])/6, with the outer neighbours being the polygon
      // vertices before `a` and after `b`. With no through-points this reduces
      // EXACTLY to the previous single-segment auto formula → migrated plain
      // splines bake identically. End handles override the very first c1 (h0)
      // and the very last c2 (h1) so the user can steer the end tangents.
      const prev = chamfered[(i - 1 + n) % n].pt; // vertex before a (K[-1])
      const next = chamfered[(i + 2) % n].pt;      // vertex after b  (K[m+1])
      const through = (target.pts ?? []).map(([u, v]) => chordToAbs(a, b, u, v));
      const K: Pt[] = [a, ...through, b];
      const ext: Pt[] = [prev, ...K, next]; // ext[s] = K[s-1], ext[s+3] = K[s+2]
      const segs = K.length - 1;
      for (let s = 0; s < segs; s++) {
        const p0 = K[s], p3 = K[s + 1];
        const km1 = ext[s];      // K[s-1]
        const kp2 = ext[s + 3];  // K[s+2]
        let c1 = add(p0, scale(sub(p3, km1), 1 / 6));
        let c2 = sub(p3, scale(sub(kp2, p0), 1 / 6));
        if (s === 0 && target.h0) {
          const d = chordDisp(a, b, target.h0[0], target.h0[1]);
          c1 = [a[0] + d[0], a[1] + d[1]];
        }
        if (s === segs - 1 && target.h1) {
          const d = chordDisp(a, b, target.h1[0], target.h1[1]);
          c2 = [b[0] + d[0], b[1] + d[1]];
        }
        modelsObj[`s${i}_${s}`] = new makerjs.models.BezierCurve([p0, c1, c2, p3] as any);
      }
    } else {
      const line = new makerjs.paths.Line(a, b);
      pathsObj[`e${i}`] = line;
      edgeLine[i] = line;
    }
  }
  const model: any = { paths: pathsObj, models: modelsObj };

  // ── 3. Apply FILLETS PER CORNER via makerjs.path.fillet ────────────────
  // The corner at vertex j sits between edge (j-1) [reaching j] and edge j
  // [leaving j]. path.fillet rounds JUST that corner with JUST its radius and
  // crops the two incident lines to the tangent points — so every vertex keeps
  // its OWN radius. (The old chain.fillet rounded EVERY filleted corner with a
  // single shared radius — the M.3 limitation this fixes.) A corner where
  // either incident edge is a spline is left sharp (M.4).
  for (let j = 0; j < n; j++) {
    const r = chamfered[j].fillet;
    if (r == null || r <= 0) continue;
    const into = edgeLine[(j - 1 + n) % n];
    const outOf = edgeLine[j];
    if (!into || !outOf) continue; // a spline meets at this corner — skip
    try {
      const arc = makerjs.path.fillet(into, outOf, r);
      if (arc) pathsObj[`f${j}`] = arc;
    } catch { /* leave this corner sharp on failure (e.g. radius too large) */ }
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
