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
  function sampleAt(s: number): { pos: V3; tan: V3 } {
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
  function at(s: number): { pos: V3; N: V3; B: V3; tan: V3 } {
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
  opts: { refine?: number; stretch?: boolean; validate?: boolean } = {},
): any {
  if (!m || !Array.isArray(cp) || cp.length < 2) return m;
  let bb: any;
  try { bb = m.boundingBox(); } catch { return m; }
  const z0 = bb.min[2], zLen = (bb.max[2] - bb.min[2]) || 1;

  let mm = m;
  let refN = Math.max(0, Math.floor(opts.refine ?? 0));
  // Adaptive subdivision: refine ONLY exists to bend flat walls as arcs rather
  // than chords. An already-dense mesh (threads, revolves) bends smoothly as-is,
  // and refine(n) = n²× its (already large) triangle count would be very slow —
  // plus the downstream cutaway CSG balloons. So skip refine when the mesh is
  // already dense; keep it for sparse flat-walled parts (blocks, L-brackets).
  if (refN > 1) {
    try { if ((mm.numTri?.() ?? 0) > 1200) refN = 0; } catch { /* keep refN */ }
  }
  if (refN > 1) { try { mm = mm.refine(refN); } catch { /* leave un-refined */ } }

  const genusBefore = opts.validate
    ? (() => { try { return mm.genus(); } catch { return undefined; } })()
    : undefined;

  // NO-STRETCH (default): map z → arc-length 1:1 so the solid keeps its own
  // length and merely BENDS along the spline (a 3-unit part follows 3 units of
  // arc). `stretch:true` elongates/compresses the part to span the WHOLE spline.
  let out: any;
  if (is3DPath(cp as number[][])) {
    const { at, total } = spline3DFrames(cp as Pt3[]);
    out = mm.warp((p: number[]) => {
      const x = p[0], y = p[1], z = p[2];
      const s = opts.stretch ? ((z - z0) / zLen) * total : (z - z0);
      const { pos, N, B } = at(s);
      p[0] = pos[0] + x * N[0] + y * B[0];
      p[1] = pos[1] + x * N[1] + y * B[1];
      p[2] = pos[2] + x * N[2] + y * B[2];
    });
  } else {
    // Accept planar `Pt3[]` (drop the ~constant y) so callers can pass a single
    // 3D control-point list either way.
    const flat: Pt2[] = (cp as number[][]).map((p) => (p.length >= 3 ? [p[0], p[2]] : (p as Pt2)));
    const { sampleAt, total } = splineSampler(flat);
    out = mm.warp((p: number[]) => {
      const x = p[0], y = p[1], z = p[2];
      const s = opts.stretch ? ((z - z0) / zLen) * total : (z - z0);
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
  opts: { stretch?: boolean } = {},
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

  const use3D = is3DPath(cp as number[][]);
  const s3 = use3D ? spline3DFrames(cp as Pt3[]) : null;
  const sP = use3D ? null
    : splineSampler((cp as number[][]).map((p) => (p.length >= 3 ? [p[0], p[2]] : (p as Pt2))));
  const total = use3D ? s3!.total : sP!.total;

  const outP = new Float32Array(positions.length);
  const outN = normals ? new Float32Array(normals.length) : null;

  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    const s = opts.stretch ? ((z - z0) / zLen) * total : (z - z0);

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
