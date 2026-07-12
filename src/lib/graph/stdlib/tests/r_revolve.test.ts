/**
 * r_revolve.test.ts — opt-in axial Z-segmentation (`zSegments`).
 *
 * r_revolve is the SOLE revolve engine with 12 consumers (Rule 21), so the
 * `zSegments` param MUST be strictly opt-in: with no third arg (or 0) the built
 * solid is UNCHANGED from the pre-change engine. With zSegments ≥ 1 the side
 * wall gains ~N axial RINGS across the profile's full Z-span — geometrically
 * identical (same bbox + volume, collinear inserted points) but denser, which
 * (a) smooths the tube and (b) gives Manifold.warp real slices to bend.
 *
 * These pin: back-compat (2-arg == 3-arg-with-0), extra rings when ON, invariant
 * bbox/volume/positive-orientation, and that a warped zSegments tube keeps its
 * radius (does not collapse to a top+bottom-only chord).
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initManifold } from '$lib/engines/manifold/manifold-helpers';
import { setAxialMaxZSpan } from '$lib/engines/manifold/manifold-mesh';
import { r_revolve } from '../r_revolve';

beforeAll(async () => {
  await initManifold();
});

// r_revolve calls revolveProfile, which ALSO applies the module-global axial
// dial. Force it OFF around every test so we measure ONLY the `zSegments` arg
// (and restore the shipped default afterwards so ordering can't leak).
afterEach(() => setAxialMaxZSpan(null));

/** Solid-cylinder (r,z) profile: axis→rim→up→back. Unique loop, no wrap copy. */
const CYL = (R: number, H: number): [number, number][] => [
  [0, 0], [R, 0], [R, H], [0, H],
];
/** Hollow-tube (r,z) profile (a bored casing section) — annular, no axis point. */
const TUBE = (rIn: number, rOut: number, H: number): [number, number][] => [
  [rIn, 0], [rOut, 0], [rOut, H], [rIn, H],
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

/** Max |radius| = sqrt(x²+y²) over all verts — for the warp-collapse check. */
function maxRadius(m: any): number {
  const mesh = m.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const np = mesh.numProp;
  let r = 0;
  for (let i = 0; i < vp.length / np; i++) {
    const x = vp[i * np], y = vp[i * np + 1];
    r = Math.max(r, Math.hypot(x, y));
  }
  return r;
}

/**
 * For a DEVIATED (bent) tube, the plain hypot(x,y) mixes the lateral bend with
 * the section radius. To prove the SECTION radius is preserved, measure the
 * cross-section at a single z-ring: the spread of the ring's x-values about its
 * OWN center should still ≈ the tube radius (a collapse would shrink it to 0).
 */
function ringDiameterAtZ(m: any, zTarget: number): number {
  const mesh = m.getMesh();
  const vp = mesh.vertProperties as Float32Array;
  const np = mesh.numProp;
  let xmin = Infinity, xmax = -Infinity;
  for (let i = 0; i < vp.length / np; i++) {
    const z = vp[i * np + 2];
    if (Math.abs(z - zTarget) < 0.25) {
      const x = vp[i * np];
      if (x < xmin) xmin = x;
      if (x > xmax) xmax = x;
    }
  }
  return xmax - xmin;
}

/** World-space X extent of all verts — the lateral bend of a deviated tube. */
function xExtent(m: any): number {
  const b = m.boundingBox();
  return b.max[0] - b.min[0];
}

describe('r_revolve — zSegments back-compat', () => {
  it('no third arg → byte-identical to zSegments:0 (default OFF)', () => {
    setAxialMaxZSpan(null);
    const noArg = r_revolve(CYL(1.2, 3), 96);
    const zero = r_revolve(CYL(1.2, 3), 96, 0);
    expect(noArg.numVert()).toBe(zero.numVert());
    expect(noArg.numTri()).toBe(zero.numTri());
    expect(noArg.volume()).toBeCloseTo(zero.volume(), 9);
  });

  it('OFF: a straight wall has ONLY the 2 profile z-rings (the warp-collapse case)', () => {
    setAxialMaxZSpan(null);
    const m = r_revolve(CYL(1.2, 3), 96); // no zSegments
    expect(distinctZ(m)).toBe(2); // z=0 and z=3 only → nothing for warp to bend
  });
});

describe('r_revolve — zSegments adds axial rings', () => {
  it('ON (40): gains ~40 interior-z rings on the side wall', () => {
    setAxialMaxZSpan(null);
    const m = r_revolve(CYL(1.2, 3), 96, 40);
    // ~40 slices across the Z-span ⇒ well over the 2-ring coarse case.
    expect(distinctZ(m)).toBeGreaterThanOrEqual(40);
  });

  it('coarse vs segmented: SAME bbox + volume + positive orientation, MORE verts', () => {
    setAxialMaxZSpan(null);
    const coarse = r_revolve(CYL(1.2, 3), 96);        // 2 rings
    const dense = r_revolve(CYL(1.2, 3), 96, 40);     // ~40 rings

    // Positive volume (inside-out solids carve instead of add under CSG).
    expect(coarse.volume()).toBeGreaterThan(0);
    expect(dense.volume()).toBeGreaterThan(0);
    // Same solid → same volume within float tolerance.
    expect(dense.volume()).toBeCloseTo(coarse.volume(), 3);
    // Same bounding box (points are collinear on the original edges).
    const bc = coarse.boundingBox(), bd = dense.boundingBox();
    for (let i = 0; i < 3; i++) {
      expect(bd.min[i]).toBeCloseTo(bc.min[i], 5);
      expect(bd.max[i]).toBeCloseTo(bc.max[i], 5);
    }
    // Denser mesh actually gained vertices (real axial rings).
    expect(dense.numVert()).toBeGreaterThan(coarse.numVert());
  });

  it('works on an ANNULAR (bored-tube) profile too — the well-casing case', () => {
    setAxialMaxZSpan(null);
    const coarse = r_revolve(TUBE(0.8, 1.2, 4), 96);
    const dense = r_revolve(TUBE(0.8, 1.2, 4), 96, 40);
    expect(dense.volume()).toBeGreaterThan(0);
    expect(dense.volume()).toBeCloseTo(coarse.volume(), 3);
    expect(distinctZ(dense)).toBeGreaterThanOrEqual(40);
    expect(dense.numVert()).toBeGreaterThan(coarse.numVert());
  });
});

describe('r_revolve — zSegments makes a straight wall WARPABLE (no collapse)', () => {
  it('a warped zSegments tube keeps its radius (side wall bends, not collapses)', () => {
    setAxialMaxZSpan(null);
    const R = 1.2, H = 6;
    const dense = r_revolve(CYL(R, H), 96, 40);
    const r0 = maxRadius(dense);
    // Bend the built solid along Z with a sine offset in X — the classic warp.
    // With ~40 axial rings the wall follows a smooth curve; the RADIUS (the
    // cross-section) must be preserved (a collapse would shrink it toward 0).
    const warped = dense.warp((v: number[]) => {
      v[0] += 0.8 * Math.sin((v[2] / H) * Math.PI); // lateral offset by depth
    });
    expect(warped.volume()).toBeGreaterThan(0);
    // Radius (distance from the LOCAL bent axis) — approximate via the fact that
    // a pure lateral translation per-slice preserves cross-section size, so the
    // solid's volume is unchanged and it did not pinch. Volume ≈ coarse tube vol.
    expect(warped.volume()).toBeCloseTo(dense.volume(), 1);
    // And the mesh still spans a real radius band (not collapsed to the axis).
    expect(maxRadius(warped)).toBeGreaterThan(r0 * 0.5);
  });
});

describe('r_revolve — axisPath deviation (the deviated well tube)', () => {
  it('no axisPath (or null) → byte-identical to the plain revolve (back-compat)', () => {
    setAxialMaxZSpan(null);
    const plain = r_revolve(CYL(1.2, 3), 96);
    const nullPath = r_revolve(CYL(1.2, 3), 96, 0, null);
    expect(nullPath.numVert()).toBe(plain.numVert());
    expect(nullPath.numTri()).toBe(plain.numTri());
    expect(nullPath.volume()).toBeCloseTo(plain.volume(), 9);
    // A straight (all-zero) path is also a no-op → identical.
    const zeroPath = r_revolve(CYL(1.2, 3), 96, 0, [[0, 0, 0], [0, 0, 3]]);
    expect(zeroPath.numVert()).toBe(plain.numVert());
    expect(zeroPath.volume()).toBeCloseTo(plain.volume(), 9);
  });

  it('a kick-off path bends the axis laterally while preserving the section radius', () => {
    setAxialMaxZSpan(null);
    const R = 3.5, H = 30; // OD 7 tube (matches the w_dev_revolve demo)
    const straight = r_revolve(CYL(R, H), 96, 40);
    // vertical to z=12, then kicks off in +X out to x=9 at the bottom.
    const path: [number, number, number][] = [[0, 0, 0], [0, 0, 12], [3, 0, 22], [9, 0, 30]];
    const dev = r_revolve(CYL(R, H), 96, 0 /* auto */, path);

    expect(dev.volume()).toBeGreaterThan(0);
    // Same volume — a lateral shear preserves the solid's volume.
    expect(dev.volume()).toBeCloseTo(straight.volume(), 1);
    // LATERAL BEND: the straight tube spans x∈[-R,R] (7); the deviated tube's
    // bottom center shifts to x≈9 → x extent ≈ 9 + 2R.
    expect(xExtent(straight)).toBeCloseTo(2 * R, 1);
    expect(xExtent(dev)).toBeGreaterThan(9 + R); // the +9 kick shows up
    // RADIUS PRESERVED: the section at the TOP (z≈0, un-offset) still ≈ OD 7.
    expect(ringDiameterAtZ(dev, 0)).toBeCloseTo(2 * R, 0);
    // …and at the deviated BOTTOM the section is still ≈ OD 7 (not collapsed).
    expect(ringDiameterAtZ(dev, H)).toBeCloseTo(2 * R, 0);
  });

  it('bare [x,y] knots spread evenly across the profile Z-span', () => {
    setAxialMaxZSpan(null);
    const R = 1.2, H = 10;
    // 3 knots, no z → z spread as 0, H/2, H. Bottom offset x=4.
    const dev = r_revolve(CYL(R, H), 96, 0, [[0, 0], [2, 0], [4, 0]]);
    expect(dev.volume()).toBeGreaterThan(0);
    // top ring un-offset, bottom ring shifted +4 → x extent ≈ 4 + 2R.
    expect(xExtent(dev)).toBeCloseTo(4 + 2 * R, 0);
    expect(ringDiameterAtZ(dev, 0)).toBeCloseTo(2 * R, 0);
  });

  it('a deviation path auto-picks axial rings when zSegments is 0 (smooth, not faceted)', () => {
    setAxialMaxZSpan(null);
    const R = 1.2, H = 30;
    const path: [number, number, number][] = [[0, 0, 0], [0, 0, 12], [3, 0, 22], [9, 0, 30]];
    const dev = r_revolve(CYL(R, H), 96, 0 /* auto */, path);
    // auto density from path length (~32) ⇒ many interior z-rings, not just 2.
    expect(distinctZ(dev)).toBeGreaterThanOrEqual(32);
  });
});
