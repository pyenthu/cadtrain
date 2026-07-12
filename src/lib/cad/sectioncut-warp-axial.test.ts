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
import { initManifold, revolve, sectionCut, M, CS } from '$lib/engines/manifold/manifold-helpers';
import { setAxialMaxZSpan, getAxialMaxZSpan } from '$lib/engines/manifold/manifold-mesh';
import { warpManifoldAlongSpline } from '$lib/engines/manifold/warp-spline';
import { r_revolve } from './stdlib/r_revolve';

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

describe('sectionCut — clean arc half-section (Track A fix): same shape, lighter mesh', () => {
  it('dial OFF → clean arc half-section: ~half volume, genus 0, lighter mesh than the wedge', () => {
    // Track A fix: a surface-of-revolution cut is rebuilt as an ANGULAR-SPAN
    // revolve, not a wedge subtract. Same removed-half SHAPE (genus 0, ~half the
    // body) with a far cleaner mesh. The arc facets the curved wall so its volume
    // is within a few % of the true half — deliberately NOT byte-identical to the
    // wedge; that difference IS the point (no boolean shred).
    setAxialMaxZSpan(null);
    const body = revolve(CONTOUR);          // coarse solid cylinder (no warp)
    const viaFn = sectionCut(body, { az: 180 });
    const viaBare = bareSectionCut(body, 180);
    expect(getAxialMaxZSpan()).toBe(null);  // dial genuinely off
    expect(viaFn.genus()).toBe(0);
    const half = body.volume() / 2;
    expect(Math.abs(viaFn.volume() - half) / half).toBeLessThan(0.03);
    // …and a lighter mesh (the wedge boolean shredded the cut faces into slivers).
    expect(viaFn.numTri()).toBeLessThan(viaBare.numTri());
  });
});

describe('sectionCut — fix (dial ON): cut faces densify + warp stays manifold', () => {
  it('body built with the warp dial ON → its arc half-section inherits the axial rings', () => {
    // The density now lives in the revolve PROFILE (built under the dial) and the
    // arc half-section inherits it — NOT a cut-time boolean refine. So a dial-ON
    // BODY yields a denser cut than a dial-OFF body.
    setAxialMaxZSpan(null);
    const cutCoarse = sectionCut(revolve(CONTOUR), { az: 180 });
    setAxialMaxZSpan(1.5);
    const cutDense = sectionCut(revolve(CONTOUR), { az: 180 });

    // eslint-disable-next-line no-console
    console.log(`[sectionCut warp axial] cut verts  coarse=${cutCoarse.numVert()}  dense=${cutDense.numVert()}`);

    assertValidSolid(cutCoarse);
    assertValidSolid(cutDense);
    expect(cutDense.numVert()).toBeGreaterThan(cutCoarse.numVert());
    expect(cutDense.volume()).toBeCloseTo(cutCoarse.volume(), 1);
  });

  it('after warp along a curved spline, the dense-body section stays manifold + denser', () => {
    setAxialMaxZSpan(null);
    const cutCoarse = sectionCut(revolve(CONTOUR), { az: 180 });
    setAxialMaxZSpan(1.5);
    const cutDense = sectionCut(revolve(CONTOUR), { az: 180 });

    // Planar curved spline spanning the part's z-extent (0..H).
    const spline: [number, number][] = [[0, -5], [3, 5], [0, 15], [-3, 25]];
    const warpCoarse = warpManifoldAlongSpline(cutCoarse, spline, { validate: true });
    const warpDense = warpManifoldAlongSpline(cutDense, spline, { validate: true });

    // Both bake to valid solids (no "Not manifold" from the extrude-nDiv bug).
    assertValidSolid(warpCoarse);
    assertValidSolid(warpDense);
    // The dense-body cut faces survive the warp → more verts than the coarse case.
    expect(warpDense.numVert()).toBeGreaterThan(warpCoarse.numVert());
  });
});

/**
 * #64 — the BRIDGING TRIANGLE, pinned by the property that actually matters.
 *
 * The tests above assert "more verts + still manifold", which the pre-fix build
 * ALSO satisfied — so they never caught the bug. The defect is a SPANNING EDGE:
 * a triangle edge whose Δz crosses most of the part. Warp only moves existing
 * vertices, so a full-height edge bends into a straight chord across the cut.
 *
 * Refining the WEDGE was not sufficient: Manifold's mesh boolean retriangulates
 * the planar cut faces it creates and discards those rings. Measured on this
 * exact 40-long casing, across `subtract`: maxEdgeΔz 1.48 → 40.0, 208 spanning
 * edges. Hence `sectionCut` refines the CUT RESULT, not just the wedge.
 */
describe('#64 sectionCut + warp — no spanning edges survive the cut', () => {
  const H = 40, RO = 3.5, RI = 3.1, SEG = 24, DIAL = 1.5;
  const SOLID = (R: number, h: number): [number, number][] => [[0, 0], [R, 0], [R, h], [0, h]];
  const SPLINE: [number, number][] = [[0, -5], [3, 10], [0, 25], [-3, 45]];

  /** Largest |Δz| over every triangle edge, and how many exceed `limit`. */
  function edgeSpan(m: any, limit: number): { max: number; over: number } {
    const mesh = m.getMesh();
    const vp = mesh.vertProperties, tv = mesh.triVerts, np = mesh.numProp ?? 3;
    const z = (i: number) => vp[i * np + 2];
    let max = 0, over = 0;
    for (let t = 0; t < tv.length / 3; t++) {
      const [i, j, k] = [tv[t * 3], tv[t * 3 + 1], tv[t * 3 + 2]];
      for (const [p, q] of [[i, j], [j, k], [k, i]]) {
        const dz = Math.abs(z(p) - z(q));
        if (dz > max) max = dz;
        if (dz > limit) over++;
      }
    }
    return { max, over };
  }

  /** `bw_casing` on the volume: hollow = r_revolve(outer) − r_revolve(inner). */
  const casing = () => r_revolve(SOLID(RO, H), SEG).subtract(r_revolve(SOLID(RI, H), SEG));

  it('the revolve itself is already dense — the dial reaches it via revolveProfile', () => {
    setAxialMaxZSpan(DIAL);
    const { max, over } = edgeSpan(casing(), DIAL * 2);
    expect(over).toBe(0);
    expect(max).toBeLessThanOrEqual(DIAL);
  });

  it('arc half-section is clean by CONSTRUCTION — no spanning edge even with the dial OFF', () => {
    // The old wedge SUBTRACT retriangulated the cut faces into full-height edges,
    // needing a post-subtract refine. The arc revolve never creates them, so even
    // dial-OFF (no refine) the cut carries zero spanning edges. (Was the bug: 208
    // spanning edges, max Δz 40.)
    setAxialMaxZSpan(DIAL);
    const body = casing();          // dense-profile hollow tube
    setAxialMaxZSpan(null);
    const cut = sectionCut(body, { az: 180 });
    expect(edgeSpan(cut, 10).over).toBe(0);
    expect(edgeSpan(cut, 10).max).toBeLessThan(H * 0.5);
  });

  it('dial ON → cut faces carry no spanning edge, before OR after the warp', () => {
    setAxialMaxZSpan(DIAL);
    const cut = sectionCut(casing(), { az: 180 });
    expect(edgeSpan(cut, 5).over).toBe(0);

    const warped = warpManifoldAlongSpline(cut, SPLINE, { validate: true });
    assertValidSolid(warped);
    // Bending stretches short edges a little (2.96 → 3.54 measured), but nothing
    // approaches a chord. Pre-fix this was 104 edges over Δz 10, max 40.49.
    expect(edgeSpan(warped, 5).over).toBe(0);
    expect(edgeSpan(warped, 10).max).toBeLessThan(H * 0.25);
  });

  it('dense warp preserves volume; the lean one loses it to chords', () => {
    setAxialMaxZSpan(DIAL);
    const dense = warpManifoldAlongSpline(sectionCut(casing(), { az: 180 }), SPLINE, {});
    const denseVol = dense.volume();

    setAxialMaxZSpan(null);
    const lean = warpManifoldAlongSpline(sectionCut(casing(), { az: 180 }), SPLINE, {});
    const leanVol = lean.volume();

    const trueVol = 163.99; // the unwarped sectioned casing
    expect(Math.abs(denseVol - trueVol) / trueVol).toBeLessThan(0.01); // ~0.03%
    expect(Math.abs(leanVol - trueVol) / trueVol).toBeGreaterThan(0.02);  // ~3.8%
  });
});
