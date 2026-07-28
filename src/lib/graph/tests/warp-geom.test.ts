import { describe, it, expect } from 'vitest';
import { warpVertex } from '$lib/graph/warp/warp-geom';

// The warp baked into the Manifold geometry MUST match the old render-time
// shader EXACTLY: disp = amp * sin(z * freq); axis 'x' → x += disp, axis 'y'
// → y += disp. These tests pin that contract.

describe('warpVertex', () => {
  it('axis x: x += amp·sin(z·freq), y and z untouched', () => {
    const amp = 2, freq = 1.5, z = 0.7;
    const out = warpVertex([1, 3, z], amp, freq, 'x');
    expect(out[0]).toBeCloseTo(1 + amp * Math.sin(z * freq), 12);
    expect(out[1]).toBe(3);
    expect(out[2]).toBe(z);
  });

  it('axis y: y += amp·sin(z·freq), x and z untouched', () => {
    const amp = 0.3, freq = 1.5, z = 4.2;
    const out = warpVertex([5, -2, z], amp, freq, 'y');
    expect(out[0]).toBe(5);
    expect(out[1]).toBeCloseTo(-2 + amp * Math.sin(z * freq), 12);
    expect(out[2]).toBe(z);
  });

  it('amp 0 ⇒ identity on both axes', () => {
    expect(warpVertex([1, 2, 3], 0, 1.5, 'x')).toEqual([1, 2, 3]);
    expect(warpVertex([1, 2, 3], 0, 1.5, 'y')).toEqual([1, 2, 3]);
  });

  it('mutates the tuple IN PLACE (the Manifold.warp callback contract)', () => {
    const v: [number, number, number] = [0, 0, Math.PI / 2];
    const ret = warpVertex(v, 1, 1, 'x');
    expect(ret).toBe(v);            // same reference
    expect(v[0]).toBeCloseTo(1, 12); // sin(π/2) = 1
  });

  it('matches the shader at the scene defaults (amp 0.3, freq 1.5)', () => {
    // Sample a few z values against the literal shader formula.
    for (const z of [-2.5, -1, 0, 1, 3.3]) {
      const expected = 0.3 * Math.sin(z * 1.5);
      const ox = warpVertex([0, 0, z], 0.3, 1.5, 'x');
      expect(ox[0]).toBeCloseTo(expected, 12);
      const oy = warpVertex([0, 0, z], 0.3, 1.5, 'y');
      expect(oy[1]).toBeCloseTo(expected, 12);
    }
  });
});
