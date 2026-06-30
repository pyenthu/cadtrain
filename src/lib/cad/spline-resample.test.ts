import { describe, it, expect } from 'vitest';
import { resampleSpline, denseSampleSpline, type Vec3 } from './spline-resample';

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
