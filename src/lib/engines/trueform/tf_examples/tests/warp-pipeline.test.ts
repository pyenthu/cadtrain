import { describe, it, expect } from 'vitest';
import { buildRevolveMesh } from '../revolve';
import { weldMeshByPosition } from '../../trueform-client';
import {
  subdivideAxialAdaptive,
  warpMeshJS,
  splineSampler,
  type Pt2,
} from '$lib/engines/manifold/warp-spline';

/**
 * PURE pipeline guard for the TF WARP fix (execute.ts `case 'warp'`). No WASM: the
 * TF child is a lathe (buildRevolveMesh, the SAME builder tfRevolveProfile wraps), so
 * the coarse "few axial rings" mesh that broke the bend is reproduced exactly, and the
 * bend maths (subdivideAxialAdaptive → weldMeshByPosition → warpMeshJS) is all pure JS.
 *
 * The bug: bw_open_hole revolves a 2-z-level half-section → a tube with rings ONLY at
 * z0 and z1 (~978 verts). Warping that lays the tube on the spline with just 2 rings →
 * it renders as 1-2 straight chords (a straight tube with a kink), NOT the smooth
 * S-curve the Manifold path (which refines to ~25k verts) produces. The fix densifies
 * along Z FIRST (subdivideAxialAdaptive), so warpMeshJS has many rings to follow the
 * curve.
 */

/** A bored hollow cylinder half-section (like bw_open_hole): a closed [r,z] rectangle
 *  from (rInner..rOuter) × (z0..z1). Revolved → a tube with exactly TWO z-levels. */
function hollowTube(rInner: number, rOuter: number, z0: number, z1: number, segments: number) {
  const profile: [number, number][] = [
    [rOuter, z0],
    [rOuter, z1],
    [rInner, z1],
    [rInner, z0],
  ];
  return buildRevolveMesh(profile, segments); // { points: Float32Array, faces: Int32Array }
}

const vertCount = (p: Float32Array) => p.length / 3;
const maxAbsX = (p: Float32Array) => {
  let m = 0;
  for (let i = 0; i < p.length; i += 3) m = Math.max(m, Math.abs(p[i]));
  return m;
};

/** An S-curve control polyline in the x-z plane whose ENDS return near x≈0 but which
 *  bulges to x≈±3 in the middle — so a 2-ring warp (only the ends) stays ~straight,
 *  while a densified warp follows the bulge. Planar (`Pt2 = [x,z]`). */
const S_CURVE: Pt2[] = [
  [0, 0],
  [3, 3.5],
  [-3, 7],
  [0, 10.5],
];

describe('TF warp pipeline — densify-then-warp', () => {
  const rInner = 0.25;
  const rOuter = 0.4;
  const z0 = 0;
  const z1 = 10;

  it('the raw lathe has only ~2 axial rings (the bug precondition)', () => {
    const raw = hollowTube(rInner, rOuter, z0, z1, 64);
    // Every point sits on either z0 or z1 — no interior rings for the warp to follow.
    const zs = new Set<number>();
    for (let i = 2; i < raw.points.length; i += 3) zs.add(Math.round(raw.points[i] * 1e3) / 1e3);
    expect([...zs].sort((a, b) => a - b)).toEqual([z0, z1]);
  });

  it('densify → weld yields a mesh of THOUSANDS of verts (vs the ~978 coarse bug)', () => {
    const raw = hollowTube(rInner, rOuter, z0, z1, 64);
    const dense = subdivideAxialAdaptive(raw.points, null, raw.faces, S_CURVE, {});
    const welded = weldMeshByPosition(dense.positions, dense.faces);
    // The bug was ~978 verts (2 rings). Densified-then-welded is tens of thousands
    // — the equivalent of the Manifold path's ~25k. Far above the ~978 coarse count.
    expect(vertCount(welded.points)).toBeGreaterThan(5000);
    // And it inserts real interior z-levels (not just z0/z1).
    const zLevels = new Set<number>();
    for (let i = 2; i < welded.points.length; i += 3) zLevels.add(Math.round(welded.points[i] * 10) / 10);
    expect(zLevels.size).toBeGreaterThan(6);
  });

  it('is ADAPTIVE — a straight path stays coarse while a curved one explodes', () => {
    const raw = hollowTube(rInner, rOuter, z0, z1, 64);
    const rawTris = raw.faces.length / 3;
    const straight: Pt2[] = [[0, 0], [0, 5], [0, 10]];
    const straightTris = subdivideAxialAdaptive(raw.points, null, raw.faces, straight, {}).faces.length / 3;
    const curvedTris = subdivideAxialAdaptive(raw.points, null, raw.faces, S_CURVE, {}).faces.length / 3;
    // No curvature → ≈minStations rings → within a small factor of raw (NOT a uniform
    // giant refine); the curve triggers 10×+ more triangles where it bends.
    expect(straightTris).toBeLessThan(rawTris * 3);
    expect(curvedTris).toBeGreaterThan(straightTris * 10);
  });

  it('DENSIFIED warp follows the spline bulge; the coarse 2-ring warp stays ~straight', () => {
    const raw = hollowTube(rInner, rOuter, z0, z1, 64);

    // OLD path (the bug): warp the coarse mesh directly — only z0/z1 rings, whose
    // spline x ≈ 0 at both ends → the tube barely leaves the axis.
    const coarse = warpMeshJS(raw.points, null, S_CURVE, {}).positions;

    // NEW path (the fix): densify → weld → warp.
    const dense = subdivideAxialAdaptive(raw.points, null, raw.faces, S_CURVE, {});
    const welded = weldMeshByPosition(dense.positions, dense.faces);
    const bent = warpMeshJS(welded.points, null, S_CURVE, {}).positions;

    // The S-curve bulges to x≈±3 mid-span (arc-length ~4 and ~8), between the tube's
    // only two coarse rings. The densified bend samples the bulge (maxX ≈ 3.4); the
    // coarse 2-ring warp draws a straight chord through it and never reaches ±3
    // (maxX ≈ 1.7). So the fix visibly follows the curve where the bug kinks straight.
    expect(maxAbsX(bent)).toBeGreaterThan(2.5);
    expect(maxAbsX(coarse)).toBeLessThan(2.0);
    expect(maxAbsX(bent)).toBeGreaterThan(maxAbsX(coarse) * 1.8);
  });

  it('a mid-height axis point lands on spline.at(midZ), not near the start', () => {
    // Warp three center-axis sample points (x=y=0) so the warped position IS the
    // spline point pos(s), s = z - z0 (no radial offset). Proves the z→arc-length map.
    const midZ = (z0 + z1) / 2;
    const axis = new Float32Array([0, 0, z0, 0, 0, midZ, 0, 0, z1]);
    const { positions } = warpMeshJS(axis, null, S_CURVE, {});

    const sampler = splineSampler(S_CURVE);
    const start = sampler.sampleAt(1e-6).pos; // s ≈ 0
    const mid = sampler.sampleAt(midZ - z0).pos; // s = midZ

    const midWarp = [positions[3], positions[4], positions[5]];
    // Mid point tracks the spline at arc-length midZ (x-z plane; y≈0).
    expect(Math.hypot(midWarp[0] - mid[0], midWarp[2] - mid[2])).toBeLessThan(1e-3);
    // …and is well away from the start point (it did NOT stay pinned at z0).
    expect(Math.hypot(midWarp[0] - start[0], midWarp[2] - start[2])).toBeGreaterThan(1.0);
  });
});
