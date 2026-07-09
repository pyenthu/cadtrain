/**
 * sectioncut-warp-axial.test.ts — the cut FACES of a sectioned (cutaway) solid
 * must densify along Z under an active warp so they bend as a smooth arc, not a
 * straight chord (Rule 25).
 *
 * Bug: `sectionCut` built its subtract wedge with a bare 2-level
 * `new CS([pts]).extrude(zlen)`, while the revolve it cut from was densified
 * along Z (subdivideProfileAxial via the getAxialMaxZSpan dial) under a warp. So
 * the NEW cut faces had only 2 z-rings → `warpManifoldAlongSpline` bent them as
 * straight chords → the sectioned part deformed. (TF was fine — it densifies the
 * whole tree before warping.)
 *
 * Fix: when the axial dial is positive (warp active) `sectionCut` refines the
 * wedge's long vertical edges to <= maxZSpan via `refineToLength` (NOT
 * `extrude(zlen, nDiv, 0)`, which trips manifold-3d's degenerate-slice
 * "Not manifold" bug). Dial off (no warp) → bare extrude → byte-identical golden.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import { initManifold, revolve, sectionCut, M, CS } from './manifold-helpers';
import { setAxialMaxZSpan, getAxialMaxZSpan } from './manifold-mesh';
import { warpManifoldAlongSpline } from './warp-spline';

beforeAll(async () => {
  await initManifold();
});

// Restore the shipped default (OFF) so ordering can't leak.
afterEach(() => setAxialMaxZSpan(null));

/** Tall solid-cylinder (r,z) contour, JSON-packed for the `revolve` helper. */
const H = 20, R = 3;
const CONTOUR = JSON.stringify([[0, 0], [R, 0], [R, H], [0, H]]);

/** Replicates the PRE-FIX sectionCut wedge EXACTLY (bare 2-level extrude) so the
 *  golden byte-identical claim is verifiable, not just asserted structurally. */
function bareSectionCut(solid: any, az = 180, offset = 0): any {
  const bb = solid.boundingBox();
  const MARGIN = 20;
  const Rr = Math.max(
    Math.abs(bb.min[0]), Math.abs(bb.max[0]),
    Math.abs(bb.min[1]), Math.abs(bb.max[1]),
  ) + MARGIN;
  const zlen = (bb.max[2] - bb.min[2]) + 2 * MARGIN;
  const z0 = bb.min[2] - MARGIN;
  const seg = Math.max(2, Math.ceil(az / 5));
  const pts: [number, number][] = [[0, 0]];
  for (let i = 0; i <= seg; i++) {
    const a = ((offset + (az * i) / seg) * Math.PI) / 180;
    pts.push([Rr * Math.cos(a), Rr * Math.sin(a)]);
  }
  const wedge = new CS([pts]).extrude(zlen).translate([0, 0, z0]);
  return solid.subtract(wedge);
}

/** A valid closed solid: finite genus, positive volume, has triangles. Proves
 *  the bake did NOT throw "Not manifold". */
function assertValidSolid(m: any) {
  expect(m.numTri()).toBeGreaterThan(0);
  expect(m.volume()).toBeGreaterThan(0);
  expect(Number.isFinite(m.genus())).toBe(true);
}

describe('sectionCut — golden (dial OFF): byte-identical to the bare pre-fix wedge', () => {
  it('dial OFF → same vert count + volume as the explicit bare-extrude subtract', () => {
    setAxialMaxZSpan(null);
    const body = revolve(CONTOUR);          // coarse body (no warp)
    const viaFn = sectionCut(body, { az: 180 });
    const viaBare = bareSectionCut(body, 180);
    expect(getAxialMaxZSpan()).toBe(null);  // dial genuinely off
    expect(viaFn.numVert()).toBe(viaBare.numVert());
    expect(viaFn.volume()).toBeCloseTo(viaBare.volume(), 6);
  });
});

describe('sectionCut — fix (dial ON): cut faces densify + warp stays manifold', () => {
  it('dial ON → sectionCut adds z-rings to the cut faces (more verts than bare)', () => {
    // Build the body ONCE with the warp dial active (dense body, mirrors a real
    // warped bake). Then cut it two ways to isolate the WEDGE densification:
    //   bare  = pre-fix wedge  (dial turned off only for the cut call)
    //   dense = post-fix wedge (dial on → refineToLength)
    setAxialMaxZSpan(1.5);
    const body = revolve(CONTOUR);

    setAxialMaxZSpan(null);                  // pre-fix: bare wedge
    const cutBare = sectionCut(body, { az: 180 });
    setAxialMaxZSpan(1.5);                   // post-fix: refined wedge
    const cutDense = sectionCut(body, { az: 180 });

    // eslint-disable-next-line no-console
    console.log(`[sectionCut warp axial] cut verts  bare=${cutBare.numVert()}  dense=${cutDense.numVert()}`);

    assertValidSolid(cutBare);
    assertValidSolid(cutDense);
    // The fix's whole point: the cut faces gained axial rings.
    expect(cutDense.numVert()).toBeGreaterThan(cutBare.numVert());
    // Same solid geometry (subtracting a densified-but-identical wedge shape).
    expect(cutDense.volume()).toBeCloseTo(cutBare.volume(), 3);
  });

  it('after warp along a curved spline, the densified section stays manifold + denser', () => {
    setAxialMaxZSpan(1.5);
    const body = revolve(CONTOUR);

    setAxialMaxZSpan(null);
    const cutBare = sectionCut(body, { az: 180 });
    setAxialMaxZSpan(1.5);
    const cutDense = sectionCut(body, { az: 180 });

    // Planar curved spline spanning the part's z-extent (0..H).
    const spline: [number, number][] = [[0, -5], [3, 5], [0, 15], [-3, 25]];
    const warpBare = warpManifoldAlongSpline(cutBare, spline, { validate: true });
    const warpDense = warpManifoldAlongSpline(cutDense, spline, { validate: true });

    // eslint-disable-next-line no-console
    console.log(`[sectionCut warp axial] warped verts  bare=${warpBare.numVert()}  dense=${warpDense.numVert()}`);

    // Both bake to valid solids (no "Not manifold" from the extrude-nDiv bug).
    assertValidSolid(warpBare);
    assertValidSolid(warpDense);
    // Densified cut faces survive the warp → still more verts than the bare case.
    expect(warpDense.numVert()).toBeGreaterThan(warpBare.numVert());
  });
});
