import { describe, it, expect } from 'vitest';
import { buildSweepPath, extendPathEnds } from './s_tube_demo';

/**
 * Guards the `s_tube_demo` TF demo's PURE inputs. The demo's `build()` loads the
 * 31 MB TrueForm WASM (needs cross-origin isolation — unavailable in vitest's node
 * env), so — like `revolve.test.ts` / `mandrel.test.ts` — we assert the pure
 * geometry we can compute here: the swept PATH (Catmull-Rom resample) and the
 * annular bore-extension. The closed / manifold / χ=0 / volume>0 verdict on the
 * WASM sweep itself is checked by the headless decode-probe (see the session report).
 */
describe('s_tube_demo TF demo — path + annulus inputs', () => {
  const SAMPLES = 32;

  it('resamples the 5-point spline to a well-formed 32-point path', () => {
    const path = buildSweepPath(SAMPLES);
    expect(path.length).toBe(SAMPLES * 3);
    // Every coordinate finite.
    for (const v of path) expect(Number.isFinite(v)).toBe(true);
  });

  it('passes through the first + last control points (Catmull-Rom endpoints)', () => {
    const path = buildSweepPath(SAMPLES);
    const n = path.length / 3;
    // First control point [-0.021, -0.186, 0.646].
    expect(path[0]).toBeCloseTo(-0.021, 6);
    expect(path[1]).toBeCloseTo(-0.186, 6);
    expect(path[2]).toBeCloseTo(0.646, 6);
    // Last control point [0, 0, 7.531].
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
    expect(m).toBe(n + 2); // one extra point at each end
    // Extended start z is BELOW the original first z; extended end z ABOVE the last.
    expect(ext[2]).toBeLessThan(path[2]);
    expect(ext[(m - 1) * 3 + 2]).toBeGreaterThan(path[(n - 1) * 3 + 2]);
    // The original path is preserved in the middle.
    for (let k = 0; k < path.length; k++) expect(ext[3 + k]).toBeCloseTo(path[k], 6);
  });
});
