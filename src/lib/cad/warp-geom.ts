// Pure warp deformation math — the single source of truth for the sinusoidal
// Z-axis displacement that finalizeManifold bakes into the Manifold geometry
// (so the mesh AND its EdgesGeometry both follow the bulge). Mirrors the
// now-retired render-time vertex shader in `src/lib/shared/warp.ts` EXACTLY:
//
//   disp = amp * sin(z * freq)
//   axis 'x' → x += disp ;  axis 'y' → y += disp
//
// Kept dependency-free so it's cheap to unit-test in isolation.

export type WarpAxis = 'x' | 'y';

export interface WarpSpec {
  amp: number;
  freq: number;
  axis: WarpAxis;
}

/**
 * Mutate a Manifold vertex `[x, y, z]` IN PLACE by the sinusoidal warp and
 * return it (for test convenience). `Manifold.warp(cb)` hands each vertex to
 * `cb` as a `Vec3` tuple `[x, y, z]` and reads the (mutated) tuple back —
 * verified against the installed manifold-3d 3.4.1 types
 * (`manifold-encapsulated-types.d.ts`: `warp(warpFunc: (vert: Vec3) => void)`,
 * with `Vec3 = [number, number, number]`) and the existing in-tree callback in
 * `warp-spline.ts` (which indexes `p[0..2]`).
 */
export function warpVertex(
  v: [number, number, number],
  amp: number,
  freq: number,
  axis: WarpAxis,
): [number, number, number] {
  const disp = amp * Math.sin(v[2] * freq);
  if (axis === 'y') v[1] += disp;
  else v[0] += disp;
  return v;
}
