/**
 * warp-spline — bend a BUILT Manifold along a planar (x,z) spline (the
 * "warp at the end" transform of the construction tree, docs/plans/
 * construction-tree.md). Distinct from the warp_along_spline PRIMITIVE, which
 * GENERATES a swept surface from a cross-section: here we displace the vertices
 * of an already-composed solid via Manifold.warp.
 *
 * Shares the Catmull-Rom + arc-length + rotation-minimizing PLANAR frame
 * (B = world-Y constant; N = cross(B, T)) with the primitive. Z-DOWN: a
 * vertex's z maps to arc-length along the spline; x = in-plane radial offset,
 * y = out-of-plane (world-Y).
 */
export type Pt2 = [number, number];

/** Catmull-Rom sampler over planar (x,z) control points → point + unit tangent
 *  at arc-length s, plus total arc length. */
export function splineSampler(cp: Pt2[]) {
  const CP: [number, number, number][] = cp.map((p) => [p[0], 0, p[1]]);
  const at = (i: number) => CP[Math.max(0, Math.min(CP.length - 1, i))];
  const SUB = 16;
  const dense: [number, number, number][] = [];
  for (let i = 0; i < CP.length - 1; i++) {
    const p0 = at(i - 1), p1 = at(i), p2 = at(i + 1), p3 = at(i + 2);
    for (let s = 0; s < SUB; s++) {
      const t = s / SUB, t2 = t * t, t3 = t2 * t;
      const pt: [number, number, number] = [0, 0, 0];
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
  function sampleAt(s: number): { pos: [number, number, number]; tan: [number, number, number] } {
    if (s <= 0) s = 1e-6;
    if (s >= total) s = total - 1e-6;
    let j = 0;
    while (j < cum.length - 1 && cum[j + 1] < s) j++;
    const segLen = (cum[j + 1] - cum[j]) || 1e-9;
    const f = (s - cum[j]) / segLen;
    const a = dense[j], b = dense[j + 1];
    const pos: [number, number, number] = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
    let tx = b[0] - a[0], ty = b[1] - a[1], tz = b[2] - a[2];
    const tl = Math.hypot(tx, ty, tz) || 1;
    return { pos, tan: [tx / tl, ty / tl, tz / tl] };
  }
  return { sampleAt, total };
}

function frameN(tan: [number, number, number]): [number, number, number] {
  const nx = tan[2], nz = -tan[0];
  const nl = Math.hypot(nx, nz) || 1;
  return [nx / nl, 0, nz / nl];
}

/**
 * Bend a built Manifold so its z-extent follows the spline. Each vertex's z
 * maps to an arc-length station; its (x, y) become (in-plane radial, world-Y)
 * offsets on the local frame. Optional `refine` subdivides first so flat walls
 * bend as arcs rather than chords (n²-ish — keep modest). Returns a NEW Manifold.
 */
export function warpManifoldAlongSpline(m: any, cp: Pt2[], opts: { refine?: number; stretch?: boolean } = {}): any {
  if (!m || !Array.isArray(cp) || cp.length < 2) return m;
  const { sampleAt, total } = splineSampler(cp);
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
  // NO-STRETCH (default): map z → arc-length 1:1 so the solid keeps its own
  // length and merely BENDS along the spline (a 3-unit part follows 3 units of
  // arc, regardless of the spline's total length). `stretch:true` opts into the
  // old behaviour — elongate/compress the part to span the WHOLE spline.
  return mm.warp((p: number[]) => {
    const x = p[0], y = p[1], z = p[2];
    const s = opts.stretch ? ((z - z0) / zLen) * total : (z - z0);
    const { pos, tan } = sampleAt(s);
    const N = frameN(tan);
    p[0] = pos[0] + x * N[0];
    p[1] = pos[1] + y;
    p[2] = pos[2] + x * N[2];
  });
}
