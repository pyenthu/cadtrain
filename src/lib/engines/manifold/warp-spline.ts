/**
 * warp-spline — bend a BUILT Manifold along a spline (the "warp at the end"
 * transform of the construction tree, docs/plans/construction-tree.md; the
 * bend/deform modifier of docs/plans/warp-part-along-spline.md). Distinct from
 * the warp_along_spline PRIMITIVE, which GENERATES a swept surface from a
 * cross-section: here we displace the vertices of an already-composed solid via
 * Manifold.warp.
 *
 * Two path modes, auto-selected by the control-point arity:
 *  • PLANAR (`Pt2[]` = [x,z], or `Pt3[]` with negligible y): the original
 *    Catmull-Rom + arc-length + constant-world-Y frame (B = world-Y; N in the
 *    x-z plane). A vertex's z maps to arc-length along the spline; x = in-plane
 *    radial offset, y = out-of-plane (world-Y). Z-DOWN.
 *  • 3D (`Pt3[]` with real y variation): a rotation-minimizing frame (RMF, the
 *    double-reflection `sweepFrames` shared with sweepAlongPath) is carried
 *    along the 3D curve so the section never rolls. The per-station basis is
 *    made explicitly RIGHT-HANDED (det[N,B,T] = +1) — a left-handed frame makes
 *    `Manifold.warp` emit a NEGATIVE-volume (inverted) solid that silently
 *    breaks later CSG (unlike sweepAlongPath's weld, warp does NOT auto-correct
 *    the sign). See docs/plans/warp-part-along-spline.md "Verified facts".
 */
import { sweepFrames } from './manifold-mesh';

export type Pt2 = [number, number];
export type Pt3 = [number, number, number];
type V3 = [number, number, number];

// ── DTX autoscale (a z-scaler for the along-hole reparam) ─────────────────────
/**
 * A DTX ("depth transform") lookup table: a MONOTONIC, ANCHORED remap of the
 * part-local along-hole coordinate (`z − zBase`, which the warp consumes as the
 * raw arc-length station) → a magnified/compressed station. Detail-dense
 * sub-intervals occupy MORE arc-length while total length is preserved (the LUT
 * is anchored 0→0 and maxDepth→maxDepth). Our own smoothing/subdivision is
 * unchanged — DTX is JUST the z-scaler that replaces the linear `s = (z−zBase)`.
 *
 * PLAIN ARRAYS on purpose: the value must cross the Web-Worker JSON boundary, and
 * the engine layer must not import `$lib/wells/*` (dependency rule). Same shape as
 * `$lib/wells/dtx.ts`'s `Dtx` — deliberately NOT imported; see `lerpDtxLut`.
 */
export type DtxLut = { depth: number[]; depthTx: number[] };

/**
 * Linear-interpolate a raw station `d` through a {@link DtxLut}; clamps to the
 * endpoints outside the sampled range. A self-contained copy of
 * `$lib/wells/dtx.ts:lerpDTX` (pure, ~8 lines) so the engine stays wells-free and
 * the math survives structured-clone into the worker. Monotonic non-decreasing.
 */
export function lerpDtxLut(dtx: DtxLut, d: number): number {
  const D = dtx?.depth, T = dtx?.depthTx;
  if (!D || !T || D.length < 2) return d;
  if (d <= D[0]) return T[0];
  if (d >= D[D.length - 1]) return T[T.length - 1];
  for (let i = 1; i < D.length; i++) {
    if (d <= D[i]) {
      const t = (d - D[i - 1]) / ((D[i] - D[i - 1]) || 1e-9);
      return T[i - 1] + t * (T[i] - T[i - 1]);
    }
  }
  return d;
}

// ── Catmull-Rom densification (shared planar + 3D) ────────────────────────────

/** Densify Catmull-Rom control points into a fine polyline + its cumulative
 *  arc-length table. `SUB` sub-samples per control span. */
function catmullRomDense(CP: V3[], SUB = 16): { dense: V3[]; cum: number[]; total: number } {
  const at = (i: number) => CP[Math.max(0, Math.min(CP.length - 1, i))];
  const dense: V3[] = [];
  for (let i = 0; i < CP.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < SUB; s++) {
      const t = s / SUB, t2 = t * t, t3 = t2 * t;
      const pt: V3 = [0, 0, 0];
      for (let d = 0; d < 3; d++) {
        pt[d] = 0.5 * ((2 * p1[d]) + (-p0[d] + p2[d]) * t
          + (2 * p0[d] - 5 * p1[d] + 4 * p2[d] - p3[d]) * t2
          + (-p0[d] + 3 * p1[d] - 3 * p2[d] + p3[d]) * t3);
      }
      dense.push(pt);
    }
  }
  dense.push(CP[CP.length - 1]);
  const cum = [0];
  for (let i = 1; i < dense.length; i++) {
    const a = dense[i - 1], b = dense[i];
    cum.push(cum[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]));
  }
  const total = cum[cum.length - 1] || 1;
  return { dense, cum, total };
}

/** Given a dense polyline + arc-length table, locate the segment containing
 *  arc-length `s`: returns the dense-index bracket start `j` + the local
 *  fraction `f` within `[j, j+1]`. */
function locate(cum: number[], total: number, s: number): { j: number; f: number } {
  if (s <= 0) s = 1e-6;
  if (s >= total) s = total - 1e-6;
  let j = 0;
  while (j < cum.length - 1 && cum[j + 1] < s) j++;
  const segLen = (cum[j + 1] - cum[j]) || 1e-9;
  return { j, f: (s - cum[j]) / segLen };
}

// ── PLANAR sampler (unchanged public contract) ────────────────────────────────

/** Catmull-Rom sampler over planar (x,z) control points → point + unit tangent
 *  at arc-length s, plus total arc length. */
export function splineSampler(cp: Pt2[]) {
  const CP: V3[] = cp.map((p) => [p[0], 0, p[1]]);
  const { dense, cum, total } = catmullRomDense(CP);
  const endTan = (a: V3, b: V3): V3 => {
    const tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    return [tx / tl, ty / tl, tz / tl];
  };
  const n = dense.length;
  function sampleAt(s: number): { pos: V3; tan: V3 } {
    // Beyond the ends (s<0 or s>total): extrapolate a STRAIGHT ray along the
    // endpoint tangent (constant tangent), rather than clamping s into
    // [0, total]. Inside the range the path is UNCHANGED (locate untouched), so
    // a part whose z-extent sits within the spline warps byte-identically.
    if (s < 0) {
      const a = dense[0], b = dense[1] ?? dense[0];
      const t = endTan(a, b);
      return { pos: [a[0] + t[0] * s, a[1] + t[1] * s, a[2] + t[2] * s], tan: t };
    }
    if (s > total) {
      const a = dense[n - 2] ?? dense[n - 1], b = dense[n - 1];
      const t = endTan(a, b);
      const ds = s - total;
      return { pos: [b[0] + t[0] * ds, b[1] + t[1] * ds, b[2] + t[2] * ds], tan: t };
    }
    const { j, f } = locate(cum, total, s);
    const a = dense[j], b = dense[j + 1];
    const pos: V3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    return { pos, tan: [tx / tl, ty / tl, tz / tl] };
  }
  return { sampleAt, total };
}

function frameN(tan: V3): V3 {
  const nx = tan[2], nz = -tan[0];
  const nl = Math.hypot(nx, nz) || 1;
  return [nx / nl, 0, nz / nl];
}

// ── 3D sampler (rotation-minimizing frame) ────────────────────────────────────

const _cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const _norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

/** Is the control-point set genuinely 3D (has out-of-plane, i.e. non-negligible
 *  y, variation)? A `Pt3[]` whose y is ~constant is treated as planar so it
 *  stays on the proven world-Y frame. */
function is3DPath(cp: number[][]): cp is Pt3[] {
  if (!cp.length || cp[0].length < 3) return false;
  let ymin = Infinity, ymax = -Infinity;
  for (const p of cp) { if (p[1] < ymin) ymin = p[1]; if (p[1] > ymax) ymax = p[1]; }
  return (ymax - ymin) > 1e-6;
}

/**
 * Build an arc-length-indexed table of RIGHT-HANDED frames along a 3D spline.
 * The RMF (sweepFrames, double-reflection parallel transport) gives a
 * torsion-free (side, up, tangent) basis whose det is -1; we re-derive a
 * right-handed basis N = side, B = tangent × N so that det[N, B, T] = +1 and
 * the warp preserves volume orientation. `at(s)` returns the interpolated
 * origin + the nearest station's (N, B, tangent).
 */
export function spline3DFrames(cp: Pt3[]) {
  const { dense, cum, total } = catmullRomDense(cp);
  const frames = sweepFrames(dense);
  // Right-handed basis per station: N = side, B = tangent × N (det[N,B,T] = +1).
  const N: V3[] = [], B: V3[] = [];
  for (const fr of frames) {
    const n = _norm(fr.side as V3);
    N.push(n);
    B.push(_norm(_cross(fr.tangent as V3, n)));
  }
  const last = dense.length - 1;
  function at(s: number): { pos: V3; N: V3; B: V3; tan: V3 } {
    // Straight-ray extension past the ends: constant endpoint frame + tangent
    // (see splineSampler). In-range behaviour is unchanged.
    if (s < 0) {
      const t = frames[0].tangent as V3;
      const a = dense[0];
      return { pos: [a[0] + t[0] * s, a[1] + t[1] * s, a[2] + t[2] * s], N: N[0], B: B[0], tan: t };
    }
    if (s > total) {
      const t = frames[last].tangent as V3;
      const b = dense[last];
      const ds = s - total;
      return { pos: [b[0] + t[0] * ds, b[1] + t[1] * ds, b[2] + t[2] * ds], N: N[last], B: B[last], tan: t };
    }
    const { j, f } = locate(cum, total, s);
    const a = dense[j], b = dense[j + 1];
    const pos: V3 = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    // Use the nearer station's orthonormal basis (avoids re-orthonormalizing a
    // lerp of two frames; RMF frames vary slowly along a dense polyline).
    const k = f < 0.5 ? j : j + 1;
    return { pos, N: N[k], B: B[k], tan: frames[k].tangent as V3 };
  }
  return { at, total };
}

// ── validity sanity check (opt-in) ────────────────────────────────────────────

/** Post-warp sanity check (shared with todo_sweep_self_intersection_check): a
 *  NEGATIVE volume means the frame was left-handed / the solid inverted; a genus
 *  bump vs the input signals a self-overlapping (too-tight) bend. It forces the
 *  lazy warp to evaluate, so it is OPT-IN (`opts.validate`). Only WARNS — never
 *  mutates geometry. */
export function warpValidity(m: any, genusBefore?: number): { volume: number; genus: number; ok: boolean; reason?: string } {
  let volume = NaN, genus = NaN, ok = true, reason: string | undefined;
  try { volume = m.volume(); } catch { /* ignore */ }
  try { genus = m.genus(); } catch { /* ignore */ }
  if (Number.isFinite(volume) && volume < 0) { ok = false; reason = 'inverted (negative volume) — left-handed warp frame'; }
  else if (Number.isFinite(genus) && Number.isFinite(genusBefore as number) && genus > (genusBefore as number)) {
    ok = false; reason = `genus rose ${genusBefore}→${genus} — self-intersecting (bend radius < section radius?)`;
  }
  return { volume, genus, ok, reason };
}

// ── warp ──────────────────────────────────────────────────────────────────────

/** Largest |Δz| over every triangle edge of a Manifold. A small value means the
 *  walls are already finely sampled along Z (a revolve / welded half-section), so
 *  `refine` before a warp would only bloat — used to gate the adaptive skip. */
function maxAxialEdgeSpan(m: any): number {
  const mesh = m.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const tv = mesh.triVerts as Uint32Array;
  const np = mesh.numProp ?? 3;
  const z = (i: number) => vp[i * np + 2];
  let max = 0;
  for (let t = 0; t < tv.length; t += 3) {
    const a = tv[t], b = tv[t + 1], c = tv[t + 2];
    const d0 = Math.abs(z(a) - z(b)), d1 = Math.abs(z(b) - z(c)), d2 = Math.abs(z(c) - z(a));
    if (d0 > max) max = d0;
    if (d1 > max) max = d1;
    if (d2 > max) max = d2;
  }
  return max;
}

/**
 * Bend a built Manifold so its z-extent follows the spline. Each vertex's z
 * maps to an arc-length station; its (x, y) become offsets on the local frame
 * (planar: in-plane radial + world-Y; 3D: RMF N + B). Optional `refine`
 * subdivides first so flat walls bend as arcs rather than chords (n²-ish — keep
 * modest; auto-skipped on already-dense meshes). `stretch` elongates the part
 * to span the whole spline (default keeps the part's own length). `validate`
 * runs a genus/volume sanity check and warns on an inverted / self-intersecting
 * result. Returns a NEW Manifold.
 */
export function warpManifoldAlongSpline(
  m: any,
  cp: Pt2[] | Pt3[],
  opts: { refine?: number; stretch?: boolean; validate?: boolean; originZ?: number; xDiaScale?: number; yScale?: number; splineScale?: number; dtx?: DtxLut } = {},
): any {
  // A LIST input maps the warp over each member. A single-child warp whose child
  // is a list producer (a parts_table aggregate, a repeat/parts_map, or any node
  // emitting a bare `[...]`) inlines to a JS ARRAY here — and a JS array has no
  // `.boundingBox()`, so the guard below used to `catch` and return it UNWARPED
  // (the "parts_table → warp doesn't warp in the MF tab, but TF/BREP do" bug,
  // 2026-07-13 — TF/BREP walk the graph per-child so they never saw the array).
  // Recurse so every part bends along the spline; the result stays a list (the
  // loader spreads it into separate _parts — no fusion).
  if (Array.isArray(m)) return m.map((el) => warpManifoldAlongSpline(el, cp, opts));
  if (!m || !Array.isArray(cp) || cp.length < 2) return m;
  let bb: any;
  try { bb = m.boundingBox(); } catch { return m; }
  const z0 = bb.min[2], zLen = (bb.max[2] - bb.min[2]) || 1;
  // z → arc-length origin: absolute placement (`s = z − originZ`) when originZ is
  // given, else the legacy part-relative map (`s = z − z0`). A part offset
  // down-hole by mv(z) then sits at arc-length z along the spline.
  const zBase = opts.originZ !== undefined ? opts.originZ : z0;
  // BUILD-TIME exaggeration (N3, TODO #65) — part of the GEOMETRY, not a scene
  // dial, so it survives bake/export. `yScale` scales the ARC-LENGTH coordinate
  // `s` (NOT world z), so a vertical AND a horizontal section stretch by the same
  // factor ALONG the path; scaling world z would stretch a lateral by zero + shear
  // the trajectory. `xDiaScale` (radial/diameter) multiplies the in-frame offsets.
  // Naming mirrors SVTC's persisted displayOpts. Default 1 ⇒ byte-identical bake.
  const yScale = (Number.isFinite(opts.yScale) && (opts.yScale as number) > 0) ? (opts.yScale as number) : 1;
  const xDia = (Number.isFinite(opts.xDiaScale) && (opts.xDiaScale as number) > 0) ? (opts.xDiaScale as number) : 1;
  // DEPTH (Z) view-scale: scale the SPLINE control points UNIFORMLY so the
  // trajectory keeps its exact SHAPE but grows/shrinks proportionally in length
  // (the user's "span the 3D space maintaining its shape, proportionally longer").
  // Paired with `yScale = splineScale` by the caller so the part stretches to span
  // the scaled trajectory (the section stays perpendicular — radial is `xDia`).
  // Default 1 ⇒ byte-identical bake.
  const sScale = (Number.isFinite(opts.splineScale) && (opts.splineScale as number) > 0) ? (opts.splineScale as number) : 1;
  const cpS: number[][] = sScale !== 1 ? (cp as number[][]).map((p) => p.map((c) => c * sScale)) : (cp as number[][]);

  let mm = m;
  let refN = Math.max(0, Math.floor(opts.refine ?? 0));
  // Adaptive subdivision: refine ONLY exists to bend flat walls as arcs rather
  // than chords. An already-dense mesh (threads, revolves, welded half-sections)
  // bends smoothly as-is, and refine(n) = n²× its triangle count would be very
  // slow — plus the downstream cutaway CSG balloons. So skip refine when the mesh
  // is already dense; keep it for sparse flat-walled parts (blocks, L-brackets).
  //
  // The proxy is the mesh's largest AXIAL edge span, not its triangle count: a
  // clean welded half-section (the Track A sectionCut rebuild) carries fine z-rings
  // yet only ~1000 tris, so the old `numTri > 1200` gate misfired and let
  // `refine(40)` explode it ~1600× (→ the WASM heap trap). If no triangle edge
  // spans more than a fraction of the part's z-extent, the walls are already
  // finely sampled → refine is a no-op-but-catastrophic → skip it.
  if (refN > 1) {
    try {
      const dense = (mm.numTri?.() ?? 0) > 1200 || maxAxialEdgeSpan(mm) <= zLen / 8;
      if (dense) refN = 0;
    } catch { /* keep refN */ }
  }
  if (refN > 1) { try { mm = mm.refine(refN); } catch { /* leave un-refined */ } }

  const genusBefore = opts.validate
    ? (() => { try { return mm.genus(); } catch { return undefined; } })()
    : undefined;

  // NO-STRETCH (default): map z → arc-length 1:1 so the solid keeps its own
  // length and merely BENDS along the spline (a 3-unit part follows 3 units of
  // arc). `stretch:true` elongates/compresses the part to span the WHOLE spline.
  let out: any;
  if (is3DPath(cpS)) {
    const { at, total } = spline3DFrames(cpS as Pt3[]);
    out = mm.warp((p: number[]) => {
      const x = p[0] * xDia, y = p[1] * xDia, z = p[2];
      // AUTOSCALE (DTX): the along-hole station is the DTX-remapped depth instead
      // of the linear `(z−zBase)·yScale` — a detail-dense sub-interval magnifies
      // (occupies more arc-length) while total length holds (LUT anchored). Radial
      // offsets (x·N + y·B) are untouched so sections stay ⊥ the tangent.
      const s = opts.stretch ? ((z - z0) / zLen) * total * yScale : (opts.dtx ? lerpDtxLut(opts.dtx, z - zBase) * yScale : (z - zBase) * yScale);
      const { pos, N, B } = at(s);
      p[0] = pos[0] + x * N[0] + y * B[0];
      p[1] = pos[1] + x * N[1] + y * B[1];
      p[2] = pos[2] + x * N[2] + y * B[2];
    });
  } else {
    // Accept planar `Pt3[]` (drop the ~constant y) so callers can pass a single
    // 3D control-point list either way.
    const flat: Pt2[] = cpS.map((p) => (p.length >= 3 ? [p[0], p[2]] : (p as Pt2)));
    const { sampleAt, total } = splineSampler(flat);
    out = mm.warp((p: number[]) => {
      const x = p[0] * xDia, y = p[1] * xDia, z = p[2];
      const s = opts.stretch ? ((z - z0) / zLen) * total * yScale : (opts.dtx ? lerpDtxLut(opts.dtx, z - zBase) * yScale : (z - zBase) * yScale);
      const { pos, tan } = sampleAt(s);
      const N = frameN(tan);
      p[0] = pos[0] + x * N[0];
      p[1] = pos[1] + y;
      p[2] = pos[2] + x * N[2];
    });
  }

  if (opts.validate) {
    const v = warpValidity(out, genusBefore);
    if (!v.ok && typeof console !== 'undefined') console.warn(`[warpSpline] warped solid may be invalid: ${v.reason}`);
  }
  return out;
}

// ── PURE-JS warp (positions + normals) — the chosen warp-step approach ─────────
// docs/plans/curvature-adaptive-warp-subdivision.md. Unlike warpManifoldAlongSpline
// (Manifold.warp → moves POSITIONS only → the pipeline re-derives normals via
// calculateNormals(crease) → the coarse axial chords crease-SPLIT → faceted), this
// bends BOTH the position AND the normal by the SAME local frame [N,B,T]. So the
// pre-warp SMOOTH normals stay smooth and pre-warp SHARP edges stay sharp — they
// just rotate along the bend (interpolation of normals, task #5). No WASM, no
// calculateNormals re-derive → smoother shading AND faster. Curvature-adaptive
// axial subdivision (task #4) is a SEPARATE step that densifies the arrays BEFORE
// this bend; this function is agnostic to how dense the input is.
//
// Local part axes map to the spline frame: x → N (side), y → B (up), z → T
// (tangent; z is consumed as the arc-length parameter). Operates on flat
// non-indexed typed arrays (THREE BufferGeometry `position`/`normal` layout).
export function warpMeshJS(
  positions: Float32Array,
  normals: Float32Array | null,
  cp: Pt2[] | Pt3[],
  opts: { stretch?: boolean; originZ?: number; xDiaScale?: number; yScale?: number; splineScale?: number; dtx?: DtxLut } = {},
): { positions: Float32Array; normals: Float32Array | null } {
  if (!positions || positions.length < 3 || !Array.isArray(cp) || cp.length < 2) {
    return { positions, normals };
  }
  // Z-range for the z → arc-length map (mirrors warpManifoldAlongSpline).
  let z0 = Infinity, z1 = -Infinity;
  for (let i = 2; i < positions.length; i += 3) {
    const z = positions[i]; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  const zLen = (z1 - z0) || 1;
  // Absolute placement `s = z − originZ` when given (a part offset by mv(z) sits
  // at arc-length z), else the legacy part-relative `s = z − z0`.
  const zBase = opts.originZ !== undefined ? opts.originZ : z0;
  // Build-time exaggeration — MUST agree with warpManifoldAlongSpline (N3): yScale
  // stretches the ARC-LENGTH coordinate (same factor for vertical + horizontal),
  // xDiaScale multiplies the in-frame radial offsets. Default 1 ⇒ byte-identical.
  const yScale = (Number.isFinite(opts.yScale) && (opts.yScale as number) > 0) ? (opts.yScale as number) : 1;
  const xDia = (Number.isFinite(opts.xDiaScale) && (opts.xDiaScale as number) > 0) ? (opts.xDiaScale as number) : 1;
  // DEPTH view-scale: uniform spline-cp scale (same shape, proportional length) —
  // MUST agree with warpManifoldAlongSpline. Default 1 ⇒ byte-identical.
  const sScale = (Number.isFinite(opts.splineScale) && (opts.splineScale as number) > 0) ? (opts.splineScale as number) : 1;
  const cpS: number[][] = sScale !== 1 ? (cp as number[][]).map((p) => p.map((c) => c * sScale)) : (cp as number[][]);

  const use3D = is3DPath(cpS);
  const s3 = use3D ? spline3DFrames(cpS as Pt3[]) : null;
  const sP = use3D ? null
    : splineSampler(cpS.map((p) => (p.length >= 3 ? [p[0], p[2]] : (p as Pt2))));
  const total = use3D ? s3!.total : sP!.total;

  const outP = new Float32Array(positions.length);
  const outN = normals ? new Float32Array(normals.length) : null;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i] * xDia, y = positions[i + 1] * xDia, z = positions[i + 2];
    // AUTOSCALE (DTX): DTX-remapped along-hole station (see warpManifoldAlongSpline).
    const s = opts.stretch ? ((z - z0) / zLen) * total * yScale : (opts.dtx ? lerpDtxLut(opts.dtx, z - zBase) * yScale : (z - zBase) * yScale);

    let N: V3, B: V3, T: V3, pos: V3;
    if (use3D) {
      const r = s3!.at(s); pos = r.pos; N = r.N; B = r.B; T = r.tan;
    } else {
      const r = sP!.sampleAt(s); pos = r.pos; N = frameN(r.tan); B = [0, 1, 0]; T = r.tan;
    }

    // position: pos(s) + x·N + y·B   (planar B = world-Y ⇒ matches the legacy warp)
    outP[i]     = pos[0] + x * N[0] + y * B[0];
    outP[i + 1] = pos[1] + x * N[1] + y * B[1];
    outP[i + 2] = pos[2] + x * N[2] + y * B[2];

    // normal: rotate by the SAME orthonormal basis (local x→N, y→B, z→T).
    if (normals && outN) {
      const nx = normals[i], ny = normals[i + 1], nz = normals[i + 2];
      outN[i]     = nx * N[0] + ny * B[0] + nz * T[0];
      outN[i + 1] = nx * N[1] + ny * B[1] + nz * T[1];
      outN[i + 2] = nx * N[2] + ny * B[2] + nz * T[2];
    }
  }
  return { positions: outP, normals: outN };
}

// ── CURVATURE-ADAPTIVE axial subdivision (task #4) ─────────────────────────────
// docs/plans/curvature-adaptive-warp-subdivision.md. A PURE, headless step that
// runs BEFORE warpMeshJS: it inserts extra vertex RINGS along Z (the part axis,
// which the warp maps to spline arc-length) so the later bend renders as a smooth
// arc rather than a few coarse chords. Density follows LOCAL spline curvature —
// dense where the spline bends sharply, sparse on straight runs. Unlike Manifold's
// uniform refine(n) (n² circumferential bloat + inside-bend slivers), this cuts
// ONLY along Z, at curvature-adaptive z-stations. No DOM / WASM / Manifold.

/** Unit tangent of the warp spline at arc-length `s` (planar OR 3D), the same
 *  path warpMeshJS bends along. Used only to measure curvature. */
function splineTangentSampler(cp: Pt2[] | Pt3[], dtx?: DtxLut): (s: number) => V3 {
  // Under DTX the z-station `s` (part-local depth) lands on the spline at the
  // REMAPPED arc-length lerpDtxLut(dtx, s), so curvature is measured in post-DTX
  // arc space → build-time stations concentrate where a magnified interval bends.
  const arc = dtx ? (s: number) => lerpDtxLut(dtx, s) : (s: number) => s;
  if (is3DPath(cp as number[][])) {
    const s3 = spline3DFrames(cp as Pt3[]);
    return (s: number) => s3.at(arc(s)).tan;
  }
  const sP = splineSampler((cp as number[][]).map((p) => (p.length >= 3 ? [p[0], p[2]] : (p as Pt2))));
  return (s: number) => sP.sampleAt(arc(s)).tan;
}

function _angleBetween(a: V3, b: V3): number {
  let d = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  if (d > 1) d = 1; else if (d < -1) d = -1;
  return Math.acos(d);
}

/**
 * Choose a sorted set of INTERIOR z-stations (planes strictly between z0 and z1)
 * to cut the mesh at, driven by the spline's local curvature. Exported for
 * headless testing of the station-selection rule in isolation.
 *
 * Rule: walk z from z0→z1 accumulating turning angle; drop a station whenever the
 * spacing since the last one reaches the tightest sagitta bound seen
 * (`Δz ≤ sqrt(8·ε/κ)`, clamped to [minSpacing, maxSpacing]) OR the accumulated
 * turning angle reaches Δθmax. minSpacing = zRange/maxStations,
 * maxSpacing = zRange/minStations, so a straight run gets ≈minStations rings and
 * no run can demand more than maxStations. Duplicate/near-coincident stations are
 * merged; the count is finally clamped to [minStations, maxStations].
 */
export function planAxialStations(
  cp: Pt2[] | Pt3[],
  z0: number,
  z1: number,
  opts: { epsilon?: number; minStations?: number; maxStations?: number; radialExtent?: number; dtx?: DtxLut } = {},
): number[] {
  const zRange = z1 - z0;
  if (!(zRange > 1e-9) || !Array.isArray(cp) || cp.length < 2) return [];

  const minStations = Math.max(0, Math.floor(opts.minStations ?? 1));
  const maxStations = Math.max(minStations + 1, Math.floor(opts.maxStations ?? 128));
  const radial = opts.radialExtent && opts.radialExtent > 1e-9 ? opts.radialExtent : zRange;
  const epsilon = opts.epsilon && opts.epsilon > 0 ? opts.epsilon : 0.02 * radial;

  const maxSpacing = zRange / Math.max(1, minStations);
  const minSpacing = zRange / maxStations;
  const dThetaMax = Math.PI / 12; // 15° of turning per station (curvature gate)

  const tanAt = splineTangentSampler(cp, opts.dtx);

  // Fine walk over arc-length s ∈ [0, zRange] (non-stretch: s = z - z0).
  const NF = Math.max(64, Math.min(4096, Math.ceil(zRange / Math.max(minSpacing / 4, 1e-6))));
  const ds = zRange / NF;

  const stations: number[] = [];
  let lastS = 0;
  let accumAngle = 0;
  let boundSinceLast = maxSpacing;
  let prevTan = tanAt(0);

  for (let k = 1; k <= NF; k++) {
    const s = k * ds;
    const tan = tanAt(s);
    const dTheta = _angleBetween(prevTan, tan);
    prevTan = tan;
    accumAngle += dTheta;

    // local curvature over this fine segment → sagitta spacing bound
    const kappa = dTheta / ds;
    let bound = kappa > 1e-9 ? Math.sqrt((8 * epsilon) / kappa) : Infinity;
    if (bound > maxSpacing) bound = maxSpacing;
    if (bound < minSpacing) bound = minSpacing;
    if (bound < boundSinceLast) boundSinceLast = bound;

    if (s < zRange - 1e-9 && (s - lastS >= boundSinceLast || accumAngle >= dThetaMax)) {
      stations.push(z0 + s);
      lastS = s;
      accumAngle = 0;
      boundSinceLast = maxSpacing;
    }
  }

  // Merge near-coincident stations (tolerance a fraction of minSpacing).
  const mergeTol = Math.max(minSpacing * 1e-3, zRange * 1e-9);
  const merged: number[] = [];
  for (const z of stations) {
    if (!merged.length || z - merged[merged.length - 1] > mergeTol) merged.push(z);
  }

  // Enforce minStations: pad with uniform interior stations if under-populated.
  if (merged.length < minStations) {
    const need = minStations;
    const uniform: number[] = [];
    for (let i = 1; i <= need; i++) uniform.push(z0 + (zRange * i) / (need + 1));
    return uniform;
  }
  // Enforce maxStations: evenly decimate if over-populated.
  if (merged.length > maxStations) {
    const thinned: number[] = [];
    const stride = merged.length / maxStations;
    for (let i = 0; i < maxStations; i++) thinned.push(merged[Math.floor(i * stride)]);
    return thinned;
  }
  return merged;
}

type _Vtx = { p: V3; n: V3 | null };

function _lerpVtx(a: _Vtx, b: _Vtx, t: number, zc: number): _Vtx {
  const p: V3 = [a.p[0] + (b.p[0] - a.p[0]) * t, a.p[1] + (b.p[1] - a.p[1]) * t, zc];
  let n: V3 | null = null;
  if (a.n && b.n) {
    let nx = a.n[0] + (b.n[0] - a.n[0]) * t;
    let ny = a.n[1] + (b.n[1] - a.n[1]) * t;
    let nz = a.n[2] + (b.n[2] - a.n[2]) * t;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    n = [nx, ny, nz];
  }
  return { p, n };
}

/** Split ONE triangle by a single z-plane `zc`. Vertices exactly on the plane go
 *  to both halves; each crossing edge gets an interpolated vertex. Winding is
 *  preserved (edges walked in original order, fan-triangulated). Returns the
 *  original triangle unchanged when it does not straddle the plane. */
function _splitTriByZ(tri: [_Vtx, _Vtx, _Vtx], zc: number, eps: number): [_Vtx, _Vtx, _Vtx][] {
  const V = tri;
  const d = [V[0].p[2] - zc, V[1].p[2] - zc, V[2].p[2] - zc];
  let pos = 0, neg = 0;
  for (const x of d) { if (x > eps) pos++; else if (x < -eps) neg++; }
  if (pos === 0 || neg === 0) return [tri]; // no real straddle

  const above: _Vtx[] = [], below: _Vtx[] = [];
  for (let i = 0; i < 3; i++) {
    const cur = V[i], nxt = V[(i + 1) % 3];
    const dc = d[i], dn = d[(i + 1) % 3];
    if (dc >= -eps) above.push(cur);
    if (dc <= eps) below.push(cur);
    if ((dc > eps && dn < -eps) || (dc < -eps && dn > eps)) {
      const t = dc / (dc - dn);
      const m = _lerpVtx(cur, nxt, t, zc);
      above.push(m); below.push(m);
    }
  }
  const out: [_Vtx, _Vtx, _Vtx][] = [];
  const fan = (poly: _Vtx[]) => {
    for (let i = 1; i + 1 < poly.length; i++) out.push([poly[0], poly[i], poly[i + 1]]);
  };
  fan(above); fan(below);
  return out.length ? out : [tri];
}

/**
 * Curvature-adaptive axial subdivision of a triangle mesh, ahead of warpMeshJS.
 *
 * Inserts extra vertex rings along Z at curvature-driven z-stations (see
 * `planAxialStations`) by plane-splitting every straddling triangle. Normals are
 * interpolated + renormalized at inserted vertices. A triangle crossing no
 * station passes through unchanged; output triangle count ≥ input, winding
 * preserved. Output is NON-INDEXED (positions/normals expanded per triangle,
 * faces = sequential indices). Pure JS — no DOM/WASM/Manifold.
 *
 * A straight spline (no curvature) yields ≈minStations stations → output ≈ input.
 */
export function subdivideAxialAdaptive(
  positions: Float32Array,
  normals: Float32Array | null,
  faces: Uint32Array | Int32Array,
  cp: Pt2[] | Pt3[],
  opts: { epsilon?: number; minStations?: number; maxStations?: number; dtx?: DtxLut } = {},
): { positions: Float32Array; normals: Float32Array | null; faces: Uint32Array } {
  const passthrough = (): { positions: Float32Array; normals: Float32Array | null; faces: Uint32Array } => ({
    positions,
    normals,
    faces: faces instanceof Uint32Array ? faces : Uint32Array.from(faces),
  });
  if (!positions || positions.length < 9 || !faces || faces.length < 3) return passthrough();
  if (!Array.isArray(cp) || cp.length < 2) return passthrough();

  // z-range + radial extent (drives the default epsilon = 2% of radial extent).
  let z0 = Infinity, z1 = -Infinity, radial = 0;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (z < z0) z0 = z; if (z > z1) z1 = z;
    const r = Math.hypot(x, y); if (r > radial) radial = r;
  }
  const zRange = z1 - z0;
  if (!(zRange > 1e-9)) return passthrough();

  const stations = planAxialStations(cp, z0, z1, { ...opts, radialExtent: radial });
  if (!stations.length) return passthrough();
  stations.sort((a, b) => a - b);

  const eps = Math.max(zRange * 1e-6, 1e-9);
  const hasN = !!normals && normals.length >= positions.length;

  const readVtx = (idx: number): _Vtx => ({
    p: [positions[3 * idx], positions[3 * idx + 1], positions[3 * idx + 2]],
    n: hasN ? [normals![3 * idx], normals![3 * idx + 1], normals![3 * idx + 2]] : null,
  });

  const outTris: [_Vtx, _Vtx, _Vtx][] = [];
  const nTri = Math.floor(faces.length / 3);
  for (let f = 0; f < nTri; f++) {
    const t0 = readVtx(faces[3 * f]);
    const t1 = readVtx(faces[3 * f + 1]);
    const t2 = readVtx(faces[3 * f + 2]);
    let work: [_Vtx, _Vtx, _Vtx][] = [[t0, t1, t2]];
    for (const zc of stations) {
      let next: [_Vtx, _Vtx, _Vtx][] | null = null;
      for (let wi = 0; wi < work.length; wi++) {
        const tri = work[wi];
        const zmin = Math.min(tri[0].p[2], tri[1].p[2], tri[2].p[2]);
        const zmax = Math.max(tri[0].p[2], tri[1].p[2], tri[2].p[2]);
        if (zc <= zmin + eps || zc >= zmax - eps) {
          if (next) next.push(tri);
          continue;
        }
        if (!next) next = work.slice(0, wi); // lazily copy the untouched prefix
        for (const sub of _splitTriByZ(tri, zc, eps)) next.push(sub);
      }
      if (next) work = next;
    }
    for (const tri of work) outTris.push(tri);
  }

  const outP = new Float32Array(outTris.length * 9);
  const outN = hasN ? new Float32Array(outTris.length * 9) : null;
  const outF = new Uint32Array(outTris.length * 3);
  for (let f = 0; f < outTris.length; f++) {
    const tri = outTris[f];
    for (let v = 0; v < 3; v++) {
      const o = f * 9 + v * 3;
      outP[o] = tri[v].p[0]; outP[o + 1] = tri[v].p[1]; outP[o + 2] = tri[v].p[2];
      if (outN) {
        const n = tri[v].n ?? [0, 0, 0];
        outN[o] = n[0]; outN[o + 1] = n[1]; outN[o + 2] = n[2];
      }
      outF[f * 3 + v] = f * 3 + v;
    }
  }
  return { positions: outP, normals: outN, faces: outF };
}

// ── BUILD-TIME axial densification of a REVOLVE profile (the durable warp fix) ──
// docs/plans/curvature-adaptive-warp-subdivision.md + root CLAUDE.md Rule 25
// ("segmentation belongs at BUILD time, never as a post-bake mesh rewrite").
//
// subdivideAxialAdaptive (above) plane-splits an already-built triangle mesh. For a
// TUBE that is FATAL: every wall quad is two triangles sharing a DIAGONAL edge that
// spans BOTH z and the circumference, and a z-plane always crosses that diagonal —
// so each inserted "ring" gets an off-ring vertex at an intermediate angle (and a
// chord-shrunk radius). Those interleaved off-ring points are the "strange
// circumferential subdivisions" / long spanning triangles seen on the TF warp.
//
// A revolve, though, has a clean fix upstream of the lathe: subdivide the half-
// section PROFILE along Z FIRST, then revolve — buildRevolveMesh stitches a perfect
// ring×segment grid with NO diagonal artifact (matching Manifold's r_revolve
// zSegments + refine). This densifier inserts z-samples on the profile's AXIAL edges
// (edges whose z changes) at the SAME curvature-adaptive stations planAxialStations
// picks — dense where the spline bends, sparse on straight runs. Constant-z edges
// (annular caps) pass through untouched. Pure JS.

type RZ = readonly [number, number];

/**
 * Densify a revolve half-section profile `[r,z][]` along Z ahead of a lathe→warp, so
 * the revolved solid has enough axial rings to bend into a smooth arc. Inserts
 * curvature-adaptive z-stations (see {@link planAxialStations}) onto each profile edge
 * that spans z, interpolating r linearly; constant-z edges are left alone. The profile
 * is treated as a CLOSED loop (last→first). Returns a NEW `[r,z][]` (the input when
 * there is nothing to do — <2 points, no z-range, or no stations). Pure, headless.
 */
export function densifyProfileAxial(
  profile: readonly RZ[],
  cp: Pt2[] | Pt3[],
  opts: { minStations?: number; maxStations?: number; epsilon?: number; dtx?: DtxLut } = {},
): [number, number][] {
  const P: [number, number][] = profile.map((p) => [p[0], p[1]]);
  if (P.length < 2 || !Array.isArray(cp) || cp.length < 2) return P;

  let z0 = Infinity, z1 = -Infinity, rMax = 0;
  for (const [r, z] of P) {
    if (z < z0) z0 = z; if (z > z1) z1 = z;
    if (Math.abs(r) > rMax) rMax = Math.abs(r);
  }
  const zRange = z1 - z0;
  if (!(zRange > 1e-9)) return P;

  // A baseline of interior rings (minStations) guarantees a smooth grid even on the
  // straight run; curvature adds more where the spline bends, capped at maxStations.
  const stations = planAxialStations(cp, z0, z1, {
    radialExtent: rMax > 1e-9 ? rMax : zRange,
    minStations: Math.max(1, Math.floor(opts.minStations ?? 8)),
    maxStations: Math.max(2, Math.floor(opts.maxStations ?? 96)),
    ...(opts.epsilon ? { epsilon: opts.epsilon } : {}),
    ...(opts.dtx ? { dtx: opts.dtx } : {}),
  });
  if (!stations.length) return P;
  const sorted = [...stations].sort((a, b) => a - b);
  const eps = Math.max(zRange * 1e-6, 1e-9);

  const out: [number, number][] = [];
  const n = P.length;
  for (let k = 0; k < n; k++) {
    const [r0, za] = P[k];
    const [r1, zb] = P[(k + 1) % n];
    out.push([r0, za]);
    if (Math.abs(zb - za) <= eps) continue; // constant-z edge (cap) — nothing to insert
    const lo = Math.min(za, zb), hi = Math.max(za, zb);
    const inside = sorted.filter((z) => z > lo + eps && z < hi - eps);
    if (za > zb) inside.reverse(); // walk the edge in its OWN direction (keep winding)
    for (const z of inside) {
      const t = (z - za) / (zb - za);
      out.push([r0 + (r1 - r0) * t, z]);
    }
  }
  return out;
}
