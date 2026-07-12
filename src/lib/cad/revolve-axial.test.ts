/**
 * revolve-axial.test.ts — build-time AXIAL (Z) segmentation for smooth warp.
 *
 * Pins the durable fix for "warp looks faceted on coarse revolves" (Rule 25):
 * `revolveProfile` densifies the 2D (r,z) profile along Z BEFORE the revolve, so
 * a later `Manifold.warp` bends side walls as a smooth curve instead of chords.
 *
 * Two halves:
 *   1. `subdivideProfileAxial` — pure 2D math (collinearity, cap, off-switch).
 *   2. real revolved Manifolds — VOLUME-SIGN stays positive, the solid is
 *      geometrically UNCHANGED (bbox + volume), and the dense build actually
 *      gained interior-z rings (the thing that makes warp smooth).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initManifold } from '$lib/engines/manifold/manifold-helpers';
import {
  revolveProfile,
  weldAndBuild,
  subdivideProfileAxial,
  setAxialMaxZSpan,
  getAxialMaxZSpan,
} from '$lib/engines/manifold/manifold-mesh';

beforeAll(async () => {
  await initManifold();
});

// Each `build*` test mutates the module-global dial; restore the default so
// ordering can't leak (default = 0.25, matching the shipped value).
afterEach(() => setAxialMaxZSpan(0.25));

/** Solid-cylinder (r,z) profile: axis→rim→up→back. Unique loop, no wrap copy. */
const CYL = (R: number, H: number): [number, number][] => [
  [0, 0], [R, 0], [R, H], [0, H],
];

/** Distinct z values present in a built Manifold's vertices (rounded). */
function distinctZ(m: any): number {
  const mesh = m.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const np = mesh.numProp;
  const set = new Set<number>();
  for (let i = 0; i < vp.length / np; i++) set.add(Math.round(vp[i * np + 2] / 1e-5));
  return set.size;
}

describe('subdivideProfileAxial — pure 2D densification', () => {
  it('inserts interior points on the long-Z side edge, leaves caps alone', () => {
    const out = subdivideProfileAxial(CYL(2, 3), 0.25, 64);
    // Original 4 verts + (12-1) on the up side edge + (12-1) on the axis edge
    // back-to-start (both span Δz=3). Caps (Δz=0) get none.
    expect(out.length).toBe(4 + 11 + 11);
    // First vert unchanged.
    expect(out[0]).toEqual([0, 0]);
  });

  it('interior points are COLLINEAR on their edge (shape preserved exactly)', () => {
    // A diagonal cone edge: both r and z change — interp must stay on the line.
    const out = subdivideProfileAxial([[0, 0], [4, 8]], 1, 64);
    for (const [r, z] of out) {
      // line r = z/2  ⇒  r - z/2 == 0 for every inserted point.
      expect(r - z / 2).toBeCloseTo(0, 9);
    }
  });

  it('null / ≤0 span → identity (byte-identical, subdivision OFF)', () => {
    const p = CYL(2, 3);
    expect(subdivideProfileAxial(p, null, 64)).toBe(p);
    expect(subdivideProfileAxial(p, 0, 64)).toBe(p);
    expect(subdivideProfileAxial(p, -1, 64)).toBe(p);
  });

  it('per-edge cap bounds the blow-up on a very long edge', () => {
    // Δz = 1000, maxZSpan 0.25 would want 4000 splits — cap to 8.
    const out = subdivideProfileAxial([[1, 0], [1, 1000]], 0.25, 8);
    // 2 endpoints + (8-1) interior on the long edge + (8-1) on the closing edge.
    expect(out.length).toBe(2 + 7 + 7);
  });
});

describe('revolveProfile — built solid invariants + axial density', () => {
  it('dial OFF: only the 2 profile z-rings (faceted under warp)', () => {
    setAxialMaxZSpan(null);
    const m = weldAndBuild([revolveProfile(CYL(1.2, 3), 96)]);
    expect(distinctZ(m)).toBe(2); // z = 0 and z = 3 only
  });

  it('dial ON (0.25): gains ample interior-z rings (smooth under warp)', () => {
    setAxialMaxZSpan(0.25);
    const m = weldAndBuild([revolveProfile(CYL(1.2, 3), 96)]);
    // ceil(3 / 0.25) = 12 segments ⇒ ≥ 13 distinct z rings.
    expect(distinctZ(m)).toBeGreaterThanOrEqual(12);
  });

  it('densifying does NOT change the solid (positive volume, same bbox + volume)', () => {
    setAxialMaxZSpan(null);
    const coarse = weldAndBuild([revolveProfile(CYL(1.2, 3), 96)]);
    setAxialMaxZSpan(0.25);
    const dense = weldAndBuild([revolveProfile(CYL(1.2, 3), 96)]);

    // Orientation: POSITIVE volume (inside-out solids carve instead of add).
    expect(coarse.volume()).toBeGreaterThan(0);
    expect(dense.volume()).toBeGreaterThan(0);
    // Same solid → same volume within float tolerance.
    expect(dense.volume()).toBeCloseTo(coarse.volume(), 3);
    // Same bounding box.
    const bc = coarse.boundingBox(), bd = dense.boundingBox();
    for (let i = 0; i < 3; i++) {
      expect(bd.min[i]).toBeCloseTo(bc.min[i], 5);
      expect(bd.max[i]).toBeCloseTo(bc.max[i], 5);
    }
    // Denser mesh actually has more vertices.
    expect(dense.numVert()).toBeGreaterThan(coarse.numVert());
  });

  it('default dial is 0.25 (smooth-by-default)', () => {
    expect(getAxialMaxZSpan()).toBe(0.25);
  });
});
