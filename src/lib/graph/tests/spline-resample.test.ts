import { describe, it, expect } from 'vitest';
import { resampleSpline, denseSampleSpline, splineArcLength, type Vec3 } from '../spline-resample';

/** Chord length between consecutive points of a polyline. */
function gaps(pts: Vec3[]): number[] {
  const g: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i]!;
    const b = pts[i - 1]!;
    g.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  }
  return g;
}

function stats(xs: number[]) {
  const mean = xs.reduce((s, x) => s + x, 0) / xs.length;
  const max = Math.max(...xs);
  const min = Math.min(...xs);
  return { mean, max, min };
}

describe('resampleSpline — equal arc-length spacing', () => {
  it('produces exactly N points', () => {
    const pts: Vec3[] = [[0, 0, 0], [3, 1.5, 0], [6, 0, 0], [9, 2, 0]];
    expect(resampleSpline(pts, 32).length).toBe(32);
    expect(resampleSpline(pts, 8).length).toBe(8);
  });

  it('clamps N to ≥ 2', () => {
    const pts: Vec3[] = [[0, 0, 0], [1, 0, 0]];
    expect(resampleSpline(pts, 1).length).toBe(2);
    expect(resampleSpline(pts, 0).length).toBe(2);
  });

  it('spaces a CURVED 4-point spline equally within tolerance', () => {
    // A non-trivial S-curve through 4 control points (varying segment lengths).
    const pts: Vec3[] = [[0, 0, 0], [2, 3, 0], [5, -2, 1], [8, 1, -1]];
    const out = resampleSpline(pts, 40);
    const g = gaps(out);
    const { mean, max, min } = stats(g);
    // Equal spacing ⇒ every chord gap is within ~3% of the mean. (Discrete
    // arc-length interpolation has a small residual on high-curvature spans.)
    expect((max - min) / mean).toBeLessThan(0.05);
    for (const gap of g) {
      expect(Math.abs(gap - mean) / mean).toBeLessThan(0.05);
    }
  });

  it('spaces a 3D helix-like curve equally', () => {
    const pts: Vec3[] = [
      [0, 0, 0], [1, 1, 1], [0, 2, 2], [-1, 1, 3], [0, 0, 4], [1, 1, 5],
    ];
    const out = resampleSpline(pts, 60);
    const { mean, max, min } = stats(gaps(out));
    expect((max - min) / mean).toBeLessThan(0.06);
  });

  it('passes through the first + last control points', () => {
    const pts: Vec3[] = [[1, 2, 3], [4, 0, -1], [7, 5, 2]];
    const out = resampleSpline(pts, 20);
    const first = out[0]!;
    const last = out[out.length - 1]!;
    expect(first[0]).toBeCloseTo(1, 4);
    expect(first[1]).toBeCloseTo(2, 4);
    expect(first[2]).toBeCloseTo(3, 4);
    expect(last[0]).toBeCloseTo(7, 4);
    expect(last[1]).toBeCloseTo(5, 4);
    expect(last[2]).toBeCloseTo(2, 4);
  });

  it('degrades gracefully on degenerate input', () => {
    expect(resampleSpline([], 10)).toEqual([]);
    // Single point → N copies of it.
    const one = resampleSpline([[2, 2, 2]], 5);
    expect(one.length).toBe(5);
    expect(one.every((p) => p[0] === 2 && p[1] === 2 && p[2] === 2)).toBe(true);
    // Coincident control points (zero total length) → N copies of the point.
    const coincident = resampleSpline([[1, 1, 1], [1, 1, 1], [1, 1, 1]], 4);
    expect(coincident.length).toBe(4);
  });

  it('straight 2-point line resamples evenly', () => {
    const out = resampleSpline([[0, 0, 0], [10, 0, 0]], 11);
    const g = gaps(out);
    const { max, min } = stats(g);
    expect(max - min).toBeLessThan(1e-6);
    expect(out[5]![0]).toBeCloseTo(5, 4);
  });

  it('denseSampleSpline returns control points verbatim for < 2 points', () => {
    expect(denseSampleSpline([[1, 2, 3]])).toEqual([[1, 2, 3]]);
    expect(denseSampleSpline([])).toEqual([]);
  });
});

describe('resampleSpline — closed loop', () => {
  const SQUARE: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]];

  /** Chord gaps around a CLOSED loop — includes the wrap edge (last → first). */
  function loopGaps(pts: Vec3[]): number[] {
    const g = gaps(pts);
    const a = pts[pts.length - 1]!;
    const b = pts[0]!;
    g.push(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
    return g;
  }

  it('spaces N points equally AROUND a square loop (wrap included)', () => {
    const out = resampleSpline(SQUARE, 40, true);
    expect(out.length).toBe(40);
    const g = loopGaps(out);            // 40 gaps: 39 consecutive + 1 wrap
    expect(g.length).toBe(40);
    const { mean, max, min } = stats(g);
    // Every gap (INCLUDING the closing wrap) within ~4% of the mean ⇒ the last
    // sample is one even step before the first (no duplicate, no big seam gap).
    expect((max - min) / mean).toBeLessThan(0.04);
  });

  it('does NOT duplicate the first control point as the last sample', () => {
    const out = resampleSpline(SQUARE, 24, true);
    const first = out[0]!;
    const last = out[out.length - 1]!;
    // Open would end AT the last control point; closed ends a step before start.
    const d = Math.hypot(last[0] - first[0], last[1] - first[1], last[2] - first[2]);
    expect(d).toBeGreaterThan(0.5);
    // First sample still starts at the first control point.
    expect(first[0]).toBeCloseTo(0, 4);
    expect(first[1]).toBeCloseTo(0, 4);
  });

  it('closed and open outputs differ for the same control points', () => {
    const openOut = resampleSpline(SQUARE, 32, false);
    const closedOut = resampleSpline(SQUARE, 32, true);
    expect(closedOut.length).toBe(openOut.length);
    const differ = closedOut.some((p, i) =>
      Math.hypot(p[0] - openOut[i]![0], p[1] - openOut[i]![1], p[2] - openOut[i]![2]) > 1e-6);
    expect(differ).toBe(true);
  });

  it('closed-loop total length ≈ the square perimeter', () => {
    const out = resampleSpline(SQUARE, 200, true);
    const total = loopGaps(out).reduce((s, x) => s + x, 0);
    const perimeter = 40; // 4 × 10
    // A centripetal Catmull-Rom loop through the 4 corners rounds the corners +
    // bulges the edges; its length lands within ~20% of the straight perimeter.
    expect(total).toBeGreaterThan(perimeter * 0.8);
    expect(total).toBeLessThan(perimeter * 1.2);
  });

  it('open path stays byte-identical when closed omitted vs explicit false', () => {
    const a = resampleSpline(SQUARE, 30);
    const b = resampleSpline(SQUARE, 30, false);
    expect(a).toEqual(b);
  });

  it('denseSampleSpline closed loop wraps without duplicating the start', () => {
    const dense = denseSampleSpline(SQUARE, 16, true);
    expect(dense.length).toBe(SQUARE.length * 16); // n segments × perSeg, no dup
    expect(dense[0]).toEqual([0, 0, 0]);           // starts at first control pt
  });
});

describe('splineArcLength', () => {
  it('is 0 for < 2 usable points', () => {
    expect(splineArcLength([])).toBe(0);
    expect(splineArcLength([[1, 2, 3]])).toBe(0);
  });

  it('equals the distance for a straight 2-point line', () => {
    expect(splineArcLength([[0, 0, 0], [3, 4, 0]])).toBeCloseTo(5, 6); // 3-4-5
  });

  it('matches the summed gaps of a dense resample of the SAME curve', () => {
    const pts: Vec3[] = [[0, 0, 0], [2, 3, 0], [5, -2, 1], [8, 1, -1]];
    const out = resampleSpline(pts, 400);
    let summed = 0;
    for (let i = 1; i < out.length; i++) {
      const a = out[i]!;
      const b = out[i - 1]!;
      summed += Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    }
    // The N-sample chord sum slightly UNDER-estimates the true arc length; a fine
    // resample lands within ~1% of splineArcLength's dense measure.
    expect(Math.abs(summed - splineArcLength(pts)) / splineArcLength(pts)).toBeLessThan(0.01);
  });

  it('closed loop ≈ the square perimeter (rounded corners, within 20%)', () => {
    const SQUARE: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]];
    const total = splineArcLength(SQUARE, true);
    expect(total).toBeGreaterThan(40 * 0.8);
    expect(total).toBeLessThan(40 * 1.2);
  });

  it('a closed loop is longer than the open path for the same points', () => {
    const SQUARE: Vec3[] = [[0, 0, 0], [10, 0, 0], [10, 10, 0], [0, 10, 0]];
    expect(splineArcLength(SQUARE, true)).toBeGreaterThan(splineArcLength(SQUARE, false));
  });
});
