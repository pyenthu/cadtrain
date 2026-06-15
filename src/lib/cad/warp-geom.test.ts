import { describe, it, expect } from 'vitest';
import {
  warpVertex,
  subdivideMeshAlongZ,
  targetZLenForFreq,
  WARP_SAMPLES_PER_CYCLE,
  type MeshSoup,
} from './warp-geom';

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

// ─── Z-subdivision (the smooth-warp fix) ────────────────────────────────────

describe('targetZLenForFreq', () => {
  it('higher freq ⇒ shorter target edge (denser sampling)', () => {
    expect(targetZLenForFreq(3)).toBeLessThan(targetZLenForFreq(1));
    expect(targetZLenForFreq(10)).toBeLessThan(targetZLenForFreq(3));
  });

  it('reproduces the old client maxZSpan≈0.25 at the scene default freq 1.5', () => {
    expect(targetZLenForFreq(1.5)).toBeCloseTo(0.2618, 3); // 2π/(1.5·16)
  });

  it('exactly period / SAMPLES_PER_CYCLE', () => {
    const f = 2.4;
    expect(targetZLenForFreq(f)).toBeCloseTo((2 * Math.PI) / (f * WARP_SAMPLES_PER_CYCLE), 12);
  });

  it('freq ≤ 0 ⇒ Infinity (flat warp, nothing to subdivide)', () => {
    expect(targetZLenForFreq(0)).toBe(Infinity);
    expect(targetZLenForFreq(-2)).toBe((2 * Math.PI) / (2 * WARP_SAMPLES_PER_CYCLE)); // uses |freq|
  });
});

describe('subdivideMeshAlongZ', () => {
  const H = 10;
  // A tall side wall (y-z plane at x=0), z = 0..H, as one quad = 2 triangles.
  // Verts: A(0,0,0) B(0,1,0) C(0,1,H) D(0,0,H).
  const wall = (): MeshSoup => ({
    numProp: 3,
    vertProperties: [0, 0, 0,  0, 1, 0,  0, 1, H,  0, 0, H],
    triVerts: [0, 1, 2,  0, 2, 3],
  });

  const maxZSpan = (m: MeshSoup): number => {
    const z = (i: number) => m.vertProperties[i * m.numProp + 2];
    let mx = 0;
    for (let t = 0; t < m.triVerts.length; t += 3) {
      const a = m.triVerts[t], b = m.triVerts[t + 1], c = m.triVerts[t + 2];
      mx = Math.max(mx, Math.abs(z(a) - z(b)), Math.abs(z(b) - z(c)), Math.abs(z(c) - z(a)));
    }
    return mx;
  };

  it('infinite target ⇒ identity (no extra verts/tris)', () => {
    const out = subdivideMeshAlongZ(wall(), Infinity);
    expect(out.triVerts.length).toBe(6);
    expect(out.vertProperties.length).toBe(12);
  });

  it('splits long-Z edges until every edge ≤ target', () => {
    const target = 0.26;
    const out = subdivideMeshAlongZ(wall(), target);
    // Every triangle's largest Z-edge span is now within the target (a tiny
    // float slack covers the bisection's last halving).
    expect(maxZSpan(out)).toBeLessThanOrEqual(target + 1e-9);
    expect(out.triVerts.length).toBeGreaterThan(6 * 30); // ~H/target=38 bands
  });

  it('keeps the surface flat — every added vertex stays on x=0 (no shape drift)', () => {
    const out = subdivideMeshAlongZ(wall(), 0.26);
    for (let v = 0; v < out.vertProperties.length; v += out.numProp) {
      expect(out.vertProperties[v]).toBeCloseTo(0, 12); // x
      expect(out.vertProperties[v + 2]).toBeGreaterThanOrEqual(-1e-9); // z in [0,H]
      expect(out.vertProperties[v + 2]).toBeLessThanOrEqual(H + 1e-9);
    }
  });

  it('every triangle index is in range (no dangling refs / T-junction debris)', () => {
    const out = subdivideMeshAlongZ(wall(), 0.1);
    const nv = out.vertProperties.length / out.numProp;
    for (const i of out.triVerts) {
      expect(Number.isInteger(i)).toBe(true);
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(nv);
    }
  });

  it('vert count GROWS with warp frequency (freq drives the density)', () => {
    const lowF = subdivideMeshAlongZ(wall(), targetZLenForFreq(1));
    const highF = subdivideMeshAlongZ(wall(), targetZLenForFreq(5));
    expect(highF.vertProperties.length).toBeGreaterThan(lowF.vertProperties.length);
  });

  it('a coarse wall gets ≥8 distinct Z-samples per warp cycle', () => {
    const freq = 1.5;
    const out = subdivideMeshAlongZ(wall(), targetZLenForFreq(freq));
    const period = (2 * Math.PI) / freq; // ≈ 4.19
    // Distinct z values within the first cycle [0, period].
    const zs = new Set<number>();
    for (let v = 0; v < out.vertProperties.length; v += out.numProp) {
      const z = out.vertProperties[v + 2];
      if (z >= 0 && z <= period) zs.add(Math.round(z * 1e6) / 1e6);
    }
    expect(zs.size).toBeGreaterThanOrEqual(8);
  });

  it('warped subdivided wall traces a smooth sine (small chord error vs the curve)', () => {
    const amp = 0.3, freq = 1.5;
    const out = subdivideMeshAlongZ(wall(), targetZLenForFreq(freq));
    // Warp every vertex, then check each sample sits on amp·sin(z·freq) and
    // that consecutive Z-samples are close enough that the straight chord
    // between them barely departs from the true curve.
    const samples: { z: number; x: number }[] = [];
    for (let v = 0; v < out.vertProperties.length; v += out.numProp) {
      const z = out.vertProperties[v + 2];
      const w = warpVertex([0, 0, z], amp, freq, 'x');
      expect(w[0]).toBeCloseTo(amp * Math.sin(z * freq), 12);
      samples.push({ z, x: w[0] });
    }
    samples.sort((p, q) => p.z - q.z);
    // Max chord midpoint error between adjacent unique-z samples must be tiny
    // relative to amplitude (a faceted 2-triangle wall would be ~amp).
    let maxErr = 0;
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1], b = samples[i];
      if (b.z - a.z < 1e-9) continue;
      const zm = (a.z + b.z) / 2;
      const chord = (a.x + b.x) / 2;
      const truth = amp * Math.sin(zm * freq);
      maxErr = Math.max(maxErr, Math.abs(chord - truth));
    }
    expect(maxErr).toBeLessThan(amp * 0.05); // < 5% of amplitude ⇒ visually smooth
  });

  it('respects the output-triangle cap', () => {
    const out = subdivideMeshAlongZ(wall(), 1e-4, { maxOutputTris: 5000 });
    // Cap is checked at the top of each pass, so output may overshoot by one
    // pass; assert it stays within a single pass-multiple of the cap.
    expect(out.triVerts.length / 3).toBeLessThan(5000 * 4);
  });
});
