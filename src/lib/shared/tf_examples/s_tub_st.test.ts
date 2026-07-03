import { describe, it, expect } from 'vitest';
import { buildSweepPath, extendPathEnds } from './s_tub_st';

/**
 * Guards the `s_tub_st` TF demo's PURE inputs — same rationale as
 * `s_tube_demo.test.ts` (the WASM sweep can't run in vitest's node env; the
 * closed/manifold/χ verdict is the headless decode-probe's job). `s_tub_st` shares
 * s_tube_demo's exact bent path; it differs only in the thicker (0.2) wall, so this
 * asserts the shared path is well-formed here too.
 */
describe('s_tub_st TF demo — path + annulus inputs', () => {
  const SAMPLES = 32;

  it('resamples the 5-point spline to a well-formed 32-point path', () => {
    const path = buildSweepPath(SAMPLES);
    expect(path.length).toBe(SAMPLES * 3);
    for (const v of path) expect(Number.isFinite(v)).toBe(true);
  });

  it('passes through the first + last control points (same path as s_tube_demo)', () => {
    const path = buildSweepPath(SAMPLES);
    const n = path.length / 3;
    expect(path[0]).toBeCloseTo(-0.021, 6);
    expect(path[1]).toBeCloseTo(-0.186, 6);
    expect(path[2]).toBeCloseTo(0.646, 6);
    expect(path[(n - 1) * 3]).toBeCloseTo(0, 6);
    expect(path[(n - 1) * 3 + 1]).toBeCloseTo(0, 6);
    expect(path[(n - 1) * 3 + 2]).toBeCloseTo(7.531, 6);
  });

  it('produces a monotonically increasing z (a valid open sweep path)', () => {
    const path = buildSweepPath(SAMPLES);
    const n = path.length / 3;
    for (let i = 1; i < n; i++) {
      expect(path[i * 3 + 2]).toBeGreaterThan(path[(i - 1) * 3 + 2]);
    }
  });

  it('extends the inner bore past BOTH ends so it punches through the caps', () => {
    const path = buildSweepPath(SAMPLES);
    const ext = extendPathEnds(path, 1.0);
    const n = path.length / 3;
    const m = ext.length / 3;
    expect(m).toBe(n + 2);
    expect(ext[2]).toBeLessThan(path[2]);
    expect(ext[(m - 1) * 3 + 2]).toBeGreaterThan(path[(n - 1) * 3 + 2]);
    for (let k = 0; k < path.length; k++) expect(ext[3 + k]).toBeCloseTo(path[k], 6);
  });
});
