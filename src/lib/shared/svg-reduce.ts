// svg-reduce.ts — PURE triangle-reduction helpers for the SVG emitter.
//
// The SVG tab paints one filled polygon per (sub-)triangle, so the fill count is
// the render cost. Two cheap, provably-safe reductions run BEFORE the Phong
// subdivision + emit in svg-emit.ts, so every dropped triangle also drops its
// K×K subdivided fills:
//
//   (1) BACK-FACE CULL — for a CLOSED solid, a triangle whose outward face
//       normal points away from the camera is always occluded by the solid's
//       front faces, so removing it is VISUALLY IDENTICAL (painter's algorithm
//       draws back faces first, then front faces paint over them). This roughly
//       HALVES the triangle count on a closed part before any subdivision. It is
//       gated OFF for the cutaway/open mesh, whose exposed concave inner walls
//       legitimately face away from the lens (same reason svg-emit does two-
//       sided lighting). We test facing with the BAKED per-vertex normals (the
//       same outward normals the shader trusts) — NOT a position cross product —
//       so it is winding-agnostic and consistent with the shading.
//
//   (2) DEGENERATE DROP — a numerically-degenerate (collinear / zero-area)
//       triangle contributes nothing but can still be handed to the subdivider
//       (K up to 6 → 36 zero-area sub-fills). Dropping it up front is free and
//       also clears the odd degenerate stray from a CSG boolean.
//
// NO Svelte, NO THREE, NO DOM, NO module state — plain typed-array in / mask
// out, so it unit-tests in the bare `node` vitest environment.

export interface TriReduceInput {
  /** Triangle count. */
  triN: number;
  /** Per-triangle vertex indices (into pos/nrm), length ≥ triN each. */
  a: ArrayLike<number>;
  b: ArrayLike<number>;
  c: ArrayLike<number>;
  /** Local vertex positions, xyz interleaved (for the degenerate-area test). */
  pos: ArrayLike<number>;
  /** Local vertex normals, xyz interleaved (for back-face cull). When absent,
   *  culling is skipped (facing is undeterminable). */
  nrm?: ArrayLike<number>;
}

export interface TriReduceOptions {
  /** View vector V = direction from the surface TOWARD the camera (need not be
   *  unit — it is normalised here). A face is BACK-facing when faceNormal·V̂ is
   *  below −epsCull. */
  view: [number, number, number];
  /** Enable back-face culling. TRUE only for a CLOSED solid mesh; FALSE for the
   *  cutaway / any open surface (whose inner walls face away yet are visible). */
  cull: boolean;
  /** Back-face margin (default 1e-3) so silhouette-grazing faces (faceN·V̂≈0)
   *  are NEVER over-culled — over-culling a front face punches a visible hole,
   *  under-culling a back face is harmless (it's painted over). */
  epsCull?: number;
  /** Drop triangles whose (2×area)² is below this — i.e. numerically degenerate
   *  (collinear / coincident). Default 1e-20 → truly-degenerate only, so no real
   *  geometry is ever removed. */
  minArea2Sq?: number;
}

export interface TriReduceResult {
  /** keep[t] === 1 → emit triangle t; 0 → skip it. */
  mask: Uint8Array;
  /** Triangles kept. */
  kept: number;
  /** Triangles dropped by the back-face cull. */
  culled: number;
  /** Triangles dropped as degenerate. */
  degenerate: number;
}

/**
 * Build a per-triangle keep/skip mask applying back-face culling (closed solids)
 * + degenerate drop. Pure: reads the typed arrays, returns a fresh mask.
 */
export function triangleKeepMask(
  input: TriReduceInput,
  opts: TriReduceOptions,
): TriReduceResult {
  const { triN, a, b, c, pos, nrm } = input;
  const { view, cull } = opts;
  const epsCull = opts.epsCull ?? 1e-3;
  const minArea2Sq = opts.minArea2Sq ?? 1e-20;

  const mask = new Uint8Array(triN);
  let kept = 0;
  let culled = 0;
  let degenerate = 0;

  // Normalise the view vector once (guard the zero vector).
  const vlen = Math.hypot(view[0], view[1], view[2]) || 1;
  const vx = view[0] / vlen, vy = view[1] / vlen, vz = view[2] / vlen;

  const canCull = cull && !!nrm;

  for (let t = 0; t < triN; t++) {
    const ia = a[t], ib = b[t], ic = c[t];

    // --- degenerate (zero-area) drop, in LOCAL space -------------------------
    const ax = pos[3 * ia], ay = pos[3 * ia + 1], az = pos[3 * ia + 2];
    const bx = pos[3 * ib], by = pos[3 * ib + 1], bz = pos[3 * ib + 2];
    const cx = pos[3 * ic], cy = pos[3 * ic + 1], cz = pos[3 * ic + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    // cross(e1, e2) — its length is 2×area; also reused as the geometric normal.
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const area2Sq = nx * nx + ny * ny + nz * nz;
    if (!(area2Sq > minArea2Sq)) { degenerate++; continue; } // NaN-safe

    // --- back-face cull, via the BAKED outward vertex normals ----------------
    if (canCull && nrm) {
      // Face normal = sum of the 3 vertex normals (baked outward). Sign of its
      // dot with V decides facing; magnitude is irrelevant, so no normalise of
      // the sum is needed beyond the epsCull margin scale below.
      const fnx = nrm[3 * ia] + nrm[3 * ib] + nrm[3 * ic];
      const fny = nrm[3 * ia + 1] + nrm[3 * ib + 1] + nrm[3 * ic + 1];
      const fnz = nrm[3 * ia + 2] + nrm[3 * ib + 2] + nrm[3 * ic + 2];
      const flen = Math.hypot(fnx, fny, fnz);
      if (flen > 1e-12) {
        const d = (fnx * vx + fny * vy + fnz * vz) / flen; // faceN̂·V̂ ∈ [-1,1]
        if (d < -epsCull) { culled++; continue; }          // clearly away → cull
      }
    }

    mask[t] = 1;
    kept++;
  }

  return { mask, kept, culled, degenerate };
}
