/**
 * label-layout.test.ts — pins the pure force de-overlap used for the depth-axis
 * labels (`spreadLabels`, the dependency-free stand-in for SVTC's labella
 * "simple" force). Invariants: order preserved, adjacent spacing ≥ gap,
 * positions stay near their ideal, and clamping into [min,max] holds.
 */
import { describe, it, expect } from 'vitest';
import { spreadLabels } from '../label-layout';

/** Adjacent (in ideal-sorted order) spacing ≥ gap − eps for every neighbour. */
function assertNonOverlapping(ideals: number[], out: number[], gap: number) {
  const order = ideals
    .map((v, i) => ({ v, i }))
    .sort((a, b) => a.v - b.v);
  for (let k = 1; k < order.length; k++) {
    const prev = out[order[k - 1]!.i]!;
    const cur = out[order[k]!.i]!;
    expect(cur - prev).toBeGreaterThanOrEqual(gap - 1e-6);
  }
}

describe('spreadLabels', () => {
  it('returns empty for empty input', () => {
    expect(spreadLabels([], { gap: 10 })).toEqual([]);
  });

  it('leaves a single label at its ideal (within clamp)', () => {
    expect(spreadLabels([42], { gap: 10 })).toEqual([42]);
    expect(spreadLabels([42], { gap: 10, min: 0, max: 30 })).toEqual([30]);
  });

  it('leaves already-spaced labels untouched', () => {
    const ideals = [0, 20, 40, 60];
    expect(spreadLabels(ideals, { gap: 15 })).toEqual(ideals);
  });

  it('spreads a fully-collapsed cluster apart, centred on the mean', () => {
    // Four labels all at 100, gap 10 → symmetric about 100: 85,95,105,115.
    const out = spreadLabels([100, 100, 100, 100], { gap: 10 });
    expect(out).toEqual([85, 95, 105, 115]);
    assertNonOverlapping([100, 100, 100, 100], out, 10);
  });

  it('preserves order + non-overlap on a dense, jittered cluster', () => {
    const ideals = [10, 12, 13, 40, 41, 42, 43, 90];
    const gap = 8;
    const out = spreadLabels(ideals, { gap });
    assertNonOverlapping(ideals, out, gap);
    // Monotonic in the ideal order (here input is already ascending).
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!).toBeGreaterThanOrEqual(out[i - 1]!);
    }
  });

  it('returns positions in INPUT order even when ideals are unsorted', () => {
    const ideals = [50, 10, 52, 12];
    const gap = 8;
    const out = spreadLabels(ideals, { gap });
    // Input order preserved: index 0 (ideal 50) > index 1 (ideal 10).
    expect(out[0]!).toBeGreaterThan(out[1]!);
    expect(out[2]!).toBeGreaterThan(out[3]!);
    assertNonOverlapping(ideals, out, gap);
  });

  it('clamps within [min,max] by shifting when it fits', () => {
    const ideals = [2, 3, 4]; // collapses to a cluster near 3, would dip below 0
    const out = spreadLabels(ideals, { gap: 5, min: 0, max: 100 });
    assertNonOverlapping(ideals, out, 5);
    expect(Math.min(...out)).toBeGreaterThanOrEqual(-1e-9);
    expect(Math.max(...out)).toBeLessThanOrEqual(100 + 1e-9);
    // First member sits at min (shifted up to fit).
    expect(out[0]).toBeCloseTo(0, 6);
  });

  it('distributes evenly when the band is too small to hold every label', () => {
    const ideals = [0, 1, 2, 3, 4]; // 5 labels, gap 10 → needs 40, band is 20
    const out = spreadLabels(ideals, { gap: 10, min: 0, max: 20 });
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[4]).toBeCloseTo(20, 6);
    // Evenly spaced across the band, still ordered.
    expect(out).toEqual([0, 5, 10, 15, 20]);
  });

  it('keeps labels close to their ideal when possible', () => {
    const ideals = [0, 100, 200];
    const out = spreadLabels(ideals, { gap: 10 });
    // Plenty of room → each stays exactly on its ideal.
    expect(out).toEqual(ideals);
  });
});
