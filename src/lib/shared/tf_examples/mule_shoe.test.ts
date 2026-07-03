import { describe, it, expect } from 'vitest';
import { mule_shoe } from './mule_shoe';

/**
 * Integration test for the `mule_shoe` TF demo — it drives the REAL TrueForm WASM
 * kernel (init + cylinder booleans + a tilted-box difference), so it verifies the
 * end-to-end build tf actually produces, not just a pure mesh predicate.
 *
 * The mule shoe is a hollow tube (genus-1, χ=0) with a 45° mouth cut into its +z
 * end. We assert the honest watertightness verdict (`tfAnalyze` via the builder's
 * `tfResult`): CLOSED + MANIFOLD + zero open boundary loops + positive volume —
 * i.e. the KNOWN tilted-coincident-cap boolean weakness did NOT bite. We also
 * confirm the ANGLED MOUTH is really there: the tube spans z∈[−7,7] uncut, so the
 * kept solid's max-z must be pulled back to ≈ CUT_Z + OUTER_R (≈5.44) — proof the
 * diagonal cut removed the top wedge rather than leaving a full-length tube.
 */
const OUTER_R = 1.4375;
const CUT_Z = 4;
const FULL_HALF = 7; // uncut tube spans z ∈ [−7, 7]

function zRange(points: Float32Array): [number, number] {
  let mn = Infinity, mx = -Infinity;
  for (let i = 2; i < points.length; i += 3) {
    if (points[i] < mn) mn = points[i];
    if (points[i] > mx) mx = points[i];
  }
  return [mn, mx];
}

describe('mule_shoe (TrueForm angled-cut demo)', () => {
  it('builds a closed, manifold, watertight genus-1 hollow tube (χ=0, volume>0)', async () => {
    const { stats } = await mule_shoe.build();
    expect(stats.closed, 'closed / watertight').toBe(true);
    expect(stats.manifold, 'manifold').toBe(true);
    expect(stats.boundaryLoops, 'no open boundary loops (no tilted-cap slivers)').toBe(0);
    expect(stats.euler, 'genus-1 hollow tube → χ=0').toBe(0);
    expect(stats.volume, 'positive enclosed volume').toBeGreaterThan(0);
  }, 60_000);

  it('the 45° mouth is actually cut — max-z is pulled back below the full length', async () => {
    const { data } = await mule_shoe.build();
    const [, maxZ] = zRange(data.points);
    // Uncut, the tube reaches z=7. The 45° plane through z=CUT_Z leaves the tallest
    // surviving wall at ≈ CUT_Z + OUTER_R, well short of the full half-length.
    expect(maxZ).toBeGreaterThan(CUT_Z);              // mouth not cut too deep
    expect(maxZ).toBeLessThan(FULL_HALF - 0.5);       // clearly cut back from 7
    expect(maxZ).toBeCloseTo(CUT_Z + OUTER_R, 1);     // the diagonal mouth apex
  }, 60_000);

  it('cutaway sections the hollow solid without breaking watertightness', async () => {
    const { stats, cutPlanes } = await mule_shoe.build({ cutaway: true });
    expect(cutPlanes, 'cutaway produced section planes').toBeTruthy();
    expect(stats.closed, 'cut solid still closed').toBe(true);
    expect(stats.manifold, 'cut solid still manifold').toBe(true);
    expect(stats.volume, 'cut solid positive volume').toBeGreaterThan(0);
  }, 60_000);
});
