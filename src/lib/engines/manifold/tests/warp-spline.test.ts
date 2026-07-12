import { describe, it, expect } from 'vitest';
import {
  splineSampler,
  spline3DFrames,
  warpValidity,
  warpManifoldAlongSpline,
  warpMeshJS,
  type Pt3,
} from '../warp-spline';

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

describe('splineSampler — ±∞ straight-tangent extension (TODO #36a)', () => {
  it('beyond the START: point lands on the straight ray, tangent constant', () => {
    // Diagonal spline 0..(3,0,4), total = 5, endpoint tangent = (0.6, 0, 0.8).
    const { sampleAt, total } = splineSampler([[0, 0], [3, 4]]);
    expect(total).toBeCloseTo(5, 3);
    const inTan = sampleAt(0.001).tan; // start tangent
    const r = sampleAt(-5); // 5 units BEFORE the start
    // tangent is the (constant) endpoint tangent
    expect(r.tan[0]).toBeCloseTo(inTan[0], 4);
    expect(r.tan[1]).toBeCloseTo(inTan[1], 4);
    expect(r.tan[2]).toBeCloseTo(inTan[2], 4);
    // pos = start(0,0,0) + tan·(−5)
    expect(r.pos[0]).toBeCloseTo(-5 * inTan[0], 3);
    expect(r.pos[1]).toBeCloseTo(0, 6);
    expect(r.pos[2]).toBeCloseTo(-5 * inTan[2], 3);
  });

  it('beyond the END: point lands on the straight ray, tangent constant', () => {
    const { sampleAt, total } = splineSampler([[0, 0], [3, 4]]);
    const endTan = sampleAt(total - 0.001).tan;
    const end = sampleAt(total - 1e-9).pos; // ~(3,0,4)
    const r = sampleAt(total + 5); // 5 units PAST the end
    expect(r.tan[0]).toBeCloseTo(endTan[0], 4);
    expect(r.tan[2]).toBeCloseTo(endTan[2], 4);
    // pos = end + tan·5  → collinear with the endpoint tangent
    expect(r.pos[0]).toBeCloseTo(end[0] + 5 * endTan[0], 2);
    expect(r.pos[2]).toBeCloseTo(end[2] + 5 * endTan[2], 2);
  });

  it('vertical spline: extension keeps x=0 and pushes z past both ends', () => {
    const { sampleAt, total } = splineSampler([[0, 0], [0, 10]]);
    const before = sampleAt(-4);
    const after = sampleAt(total + 4);
    expect(before.pos[0]).toBeCloseTo(0, 6);
    expect(before.pos[2]).toBeCloseTo(-4, 3);
    expect(after.pos[0]).toBeCloseTo(0, 6);
    expect(after.pos[2]).toBeCloseTo(total + 4, 3);
    // in-range unchanged (regression guard on the byte-identical gate)
    const mid = sampleAt(total / 2);
    expect(mid.pos[2]).toBeCloseTo(total / 2, 3);
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

  it('extends past both ends on the endpoint tangent, frame constant (TODO #36a)', () => {
    const { at, total } = spline3DFrames(path);
    const start = at(0.0001), end = at(total - 0.0001);
    const before = at(-3), after = at(total + 3);

    // tangent + frame are the (constant) endpoint values
    for (let d = 0; d < 3; d++) {
      expect(before.tan[d]).toBeCloseTo(start.tan[d], 4);
      expect(before.N[d]).toBeCloseTo(start.N[d], 6);
      expect(before.B[d]).toBeCloseTo(start.B[d], 6);
      expect(after.tan[d]).toBeCloseTo(end.tan[d], 4);
      expect(after.N[d]).toBeCloseTo(end.N[d], 6);
      expect(after.B[d]).toBeCloseTo(end.B[d], 6);
    }
    // pos = end + tan·offset → offset is exactly |Δs| along the endpoint tangent
    const dx = after.pos[0] - end.pos[0], dy = after.pos[1] - end.pos[1], dz = after.pos[2] - end.pos[2];
    expect(Math.hypot(dx, dy, dz)).toBeCloseTo(3, 1);
    // still right-handed past the end
    expect(det3(after.N, after.B, after.tan)).toBeCloseTo(1, 5);
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

  it('originZ: absolute-z placement shifts the part along the spline (TODO #36b)', () => {
    // A short part already offset down-hole to z∈[30,33]. On a long vertical
    // spline, originZ=0 places it at arc-length 30; originZ=30 at arc-length 0.
    const verts: V3[] = [];
    for (const z of [30, 33]) for (const x of [-0.5, 0.5]) verts.push([x, 0, z]);
    const cp: [number, number][] = [[0, 0], [0, 60]]; // vertical, total ≈ 60
    const m0 = fakeManifold(verts);
    const m1 = fakeManifold(verts);
    const at0: any = warpManifoldAlongSpline(m0, cp, { originZ: 0 });  // s = z
    const at30: any = warpManifoldAlongSpline(m1, cp, { originZ: 30 }); // s = z − 30
    for (let k = 0; k < verts.length; k++) {
      // x (radial) offset identical; only the arc-length station (z) shifts by 30
      expect(at0.verts[k][0]).toBeCloseTo(at30.verts[k][0], 4);
      expect(at0.verts[k][2] - at30.verts[k][2]).toBeCloseTo(30, 2);
    }
    // originZ=30 lands the part at the spline start (arc-length 0..3)
    const zs = at30.verts.map((v: V3) => v[2]);
    expect(Math.min(...zs)).toBeCloseTo(0, 2);
  });

  it('originZ absent reproduces the legacy z−z0 placement exactly', () => {
    const verts: V3[] = [];
    for (const z of [30, 33]) for (const x of [-0.5, 0.5]) verts.push([x, 0, z]);
    const cp: [number, number][] = [[0, 0], [0, 60]];
    const legacy: any = warpManifoldAlongSpline(fakeManifold(verts), cp);
    const explicit: any = warpManifoldAlongSpline(fakeManifold(verts), cp, { originZ: 30 });
    // z0 = 30 for this part ⇒ originZ:30 must be byte-identical to the default.
    for (let k = 0; k < verts.length; k++) {
      for (let d = 0; d < 3; d++) expect(legacy.verts[k][d]).toBe(explicit.verts[k][d]);
    }
  });
});

// ── N3: build-time xDiaScale (radial) + yScale (arc-length depth) ─────────────
// The subtlety is the whole task: under a warp, yScale scales the ARC-LENGTH
// coordinate `s` (so a vertical AND a horizontal section stretch by the SAME
// factor along the path); xDiaScale multiplies the in-frame radial offset.
describe('warp-spline build-time scale (N3)', () => {
  // A thin rod along local z 0..L, unit-ish cross-section, as flat positions.
  function rod(L = 10, nz = 6, hw = 0.5): Float32Array {
    const v: number[] = [];
    for (let k = 0; k < nz; k++) {
      const z = (L * k) / (nz - 1);
      for (const x of [-hw, hw]) for (const y of [-hw, hw]) v.push(x, y, z);
    }
    return new Float32Array(v);
  }
  const extent = (a: Float32Array, axis: 0 | 1 | 2): number => {
    let lo = Infinity, hi = -Infinity;
    for (let i = axis; i < a.length; i += 3) { if (a[i] < lo) lo = a[i]; if (a[i] > hi) hi = a[i]; }
    return hi - lo;
  };
  // planar [x,z] control lines: one straight DOWN z, one straight ALONG x.
  const vertCP: [number, number][] = [[0, 0], [0, 30]];     // path direction = world z
  const horizCP: [number, number][] = [[0, 5], [30, 5]];    // path direction = world x

  it('default scale (absent / 1,1) is byte-identical', () => {
    const p = rod();
    const base = warpMeshJS(p, null, vertCP).positions;
    const ones = warpMeshJS(p, null, vertCP, { xDiaScale: 1, yScale: 1 }).positions;
    expect(ones.length).toBe(base.length);
    for (let i = 0; i < base.length; i++) expect(ones[i]).toBe(base[i]);
    // scale=1 is the identity: a vertical spline maps local z → world z 1:1.
    expect(extent(base, 2)).toBeCloseTo(10, 5);
  });

  it('a vertical section and a horizontal section stretch by the SAME factor along the path', () => {
    const p = rod();
    // path-direction extent = world-z for the vertical spline, world-x for the horizontal.
    const vRatio = extent(warpMeshJS(p, null, vertCP, { yScale: 2 }).positions, 2)
                 / extent(warpMeshJS(p, null, vertCP, { yScale: 1 }).positions, 2);
    const hRatio = extent(warpMeshJS(p, null, horizCP, { yScale: 2 }).positions, 0)
                 / extent(warpMeshJS(p, null, horizCP, { yScale: 1 }).positions, 0);
    expect(vRatio).toBeCloseTo(2, 5);
    expect(hRatio).toBeCloseTo(2, 5);
    // The load-bearing assertion — scaling WORLD Z instead would leave hRatio ≈ 1
    // (a horizontal lateral stretches by zero), so the two factors would differ.
    expect(vRatio).toBeCloseTo(hRatio, 5);
  });

  it('xDiaScale fattens the cross-section but not the path extent', () => {
    const p = rod();
    const w1 = warpMeshJS(p, null, vertCP, { xDiaScale: 1 }).positions;
    const w3 = warpMeshJS(p, null, vertCP, { xDiaScale: 3 }).positions;
    // cross-section (world x, ⟂ the vertical path) triples; path extent (z) is unchanged.
    expect(extent(w3, 0) / extent(w1, 0)).toBeCloseTo(3, 5);
    expect(extent(w3, 2)).toBeCloseTo(extent(w1, 2), 5);
  });

  it('the bbox grows with both scales; arc-length position stays monotonic in local z', () => {
    const p = rod();
    const s1 = warpMeshJS(p, null, vertCP, { xDiaScale: 1, yScale: 1 }).positions;
    const s2 = warpMeshJS(p, null, vertCP, { xDiaScale: 2, yScale: 2 }).positions;
    expect(extent(s2, 0)).toBeGreaterThan(extent(s1, 0)); // wider
    expect(extent(s2, 2)).toBeGreaterThan(extent(s1, 2)); // longer along path
    // world-z (path position for the vertical spline) is monotonic non-decreasing
    // in local-z order (rings emitted bottom→top): the ring centres climb.
    let prev = -Infinity;
    for (let k = 0; k < 6; k++) {
      const zc = s2[(k * 4) * 3 + 2]; // first vert of ring k
      expect(zc).toBeGreaterThanOrEqual(prev - 1e-6);
      prev = zc;
    }
  });

  it('the Manifold warp and the JS warp AGREE under the same scale', () => {
    // Same verts through both engines; the fake Manifold applies the same
    // callback warpManifoldAlongSpline builds. Displacements must match.
    const verts: V3[] = [];
    for (const z of [0, 2, 4, 6, 8, 10]) for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) verts.push([x, y, z]);
    const flat = new Float32Array(verts.flat());
    const opts = { xDiaScale: 2.5, yScale: 1.7 };
    const mf: any = warpManifoldAlongSpline(fakeManifold(verts), vertCP, opts);
    const js = warpMeshJS(flat, null, vertCP, opts).positions;
    expect(mf.verts.length * 3).toBe(js.length);
    for (let k = 0; k < verts.length; k++) {
      for (let d = 0; d < 3; d++) expect(mf.verts[k][d]).toBeCloseTo(js[3 * k + d], 4);
    }
  });

  it('a non-positive / malformed scale falls back to 1 (byte-identical)', () => {
    const p = rod();
    const base = warpMeshJS(p, null, vertCP).positions;
    for (const bad of [0, -2, NaN, Infinity] as number[]) {
      const out = warpMeshJS(p, null, vertCP, { xDiaScale: bad, yScale: bad }).positions;
      for (let i = 0; i < base.length; i++) expect(out[i]).toBe(base[i]);
    }
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
