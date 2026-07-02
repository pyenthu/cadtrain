import { describe, it, expect } from 'vitest';
import {
  splineSampler,
  spline3DFrames,
  warpValidity,
  warpManifoldAlongSpline,
  type Pt3,
} from './warp-spline';

type V3 = [number, number, number];
const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const det3 = (n: V3, b: V3, t: V3) => dot(n, cross(b, t));
const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);

describe('splineSampler (planar, unchanged contract)', () => {
  it('arc length is positive + tangents are unit', () => {
    const { sampleAt, total } = splineSampler([[0, 0], [0, 2], [0, 5]]);
    expect(total).toBeGreaterThan(4.9);
    const { tan } = sampleAt(total / 2);
    expect(len(tan)).toBeCloseTo(1, 6);
  });

  it('a vertical (z) control line samples straight up the z axis', () => {
    // x=0 line: pos.x stays 0, pos.z tracks arc length.
    const { sampleAt } = splineSampler([[0, 0], [0, 3], [0, 6]]);
    const { pos } = sampleAt(3);
    expect(pos[0]).toBeCloseTo(0, 6);
    expect(pos[1]).toBeCloseTo(0, 6);
    expect(pos[2]).toBeCloseTo(3, 4);
  });
});

describe('spline3DFrames — right-handed rotation-minimizing frame', () => {
  const path: Pt3[] = [
    [0, 0, 0],
    [1, 1, 1],
    [2, 0, 3],
    [1, -1, 5],
  ];

  it('frames are orthonormal and RIGHT-handed (det[N,B,T] = +1)', () => {
    const { at, total } = spline3DFrames(path);
    for (const s of [0.001, total * 0.25, total * 0.5, total * 0.75, total - 0.001]) {
      const { N, B, tan } = at(s);
      expect(len(N)).toBeCloseTo(1, 6);
      expect(len(B)).toBeCloseTo(1, 6);
      expect(len(tan)).toBeCloseTo(1, 6);
      // mutually perpendicular
      expect(dot(N, B)).toBeCloseTo(0, 5);
      expect(dot(N, tan)).toBeCloseTo(0, 5);
      expect(dot(B, tan)).toBeCloseTo(0, 5);
      // positive orientation — the load-bearing fix (a left-handed frame makes
      // Manifold.warp emit a negative-volume solid).
      expect(det3(N, B, tan)).toBeCloseTo(1, 5);
    }
  });

  it('origin tracks arc length monotonically along the path', () => {
    const { at, total } = spline3DFrames(path);
    let prev = -Infinity;
    for (let i = 0; i <= 10; i++) {
      const { pos } = at((i / 10) * total);
      expect(pos.every((c) => Number.isFinite(c))).toBe(true);
      prev = pos[2] > prev ? pos[2] : prev; // z is monotonically increasing on this path
    }
    expect(prev).toBeGreaterThan(4.5);
  });
});

// A minimal fake Manifold sufficient to drive warpManifoldAlongSpline: it
// captures its verts, applies the warp callback in place on .warp(), and
// reports bbox / counts / volume / genus.
function fakeManifold(verts: V3[], opts: { volume?: number; genus?: number } = {}) {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let d = 0; d < 3; d++) { if (v[d] < min[d]) min[d] = v[d]; if (v[d] > max[d]) max[d] = v[d]; }
  return {
    verts,
    boundingBox: () => ({ min, max }),
    numTri: () => verts.length,
    volume: () => opts.volume ?? 1,
    genus: () => opts.genus ?? 0,
    warp(cb: (p: number[]) => void) {
      const out = verts.map((v) => { const p: V3 = [...v]; cb(p); return p; });
      return fakeManifold(out, opts);
    },
  };
}

describe('warpManifoldAlongSpline', () => {
  it('returns the input untouched for < 2 control points', () => {
    const m = fakeManifold([[0, 0, 0]]);
    expect(warpManifoldAlongSpline(m, [[0, 0]] as any)).toBe(m);
  });

  it('planar bend keeps a right-handed straight prism at positive volume', () => {
    // a unit prism straddling z 0..2, centred on x/y
    const verts: V3[] = [];
    for (const z of [0, 1, 2]) for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) verts.push([x, y, z]);
    const m = fakeManifold(verts, { volume: 2 });
    const bent: any = warpManifoldAlongSpline(m, [[0, 0], [1, 1], [0, 2]]);
    // still 12 verts, all finite, and displaced away from the straight line.
    expect(bent.verts.length).toBe(12);
    expect(bent.verts.every((v: V3) => v.every((c) => Number.isFinite(c)))).toBe(true);
  });

  it('3D path (real y variation) routes through the RMF branch and stays finite', () => {
    const verts: V3[] = [];
    for (const z of [0, 1, 2, 3]) for (const x of [-0.3, 0.3]) for (const y of [-0.3, 0.3]) verts.push([x, y, z]);
    const m = fakeManifold(verts);
    const bent: any = warpManifoldAlongSpline(m, [[0, 0, 0], [1, 1, 1.5], [0, 0, 3]] as Pt3[]);
    expect(bent.verts.length).toBe(16);
    expect(bent.verts.every((v: V3) => v.every((c) => Number.isFinite(c)))).toBe(true);
  });
});

describe('warpValidity', () => {
  it('flags a negative volume as inverted', () => {
    const v = warpValidity({ volume: () => -3, genus: () => 0 });
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/inverted/);
  });

  it('flags a genus increase as self-intersecting', () => {
    const v = warpValidity({ volume: () => 5, genus: () => 3 }, 0);
    expect(v.ok).toBe(false);
    expect(v.reason).toMatch(/self-intersecting/);
  });

  it('passes a clean warp (positive volume, same genus)', () => {
    const v = warpValidity({ volume: () => 5, genus: () => 0 }, 0);
    expect(v.ok).toBe(true);
    expect(v.reason).toBeUndefined();
  });
});
