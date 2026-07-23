import { describe, it, expect } from 'vitest';
import {
  warpMeshJS,
  warpManifoldAlongSpline,
  splineSampler,
  lerpDtxLut,
  planAxialStations,
  type Pt2,
  type DtxLut,
} from '../warp-spline';

// A minimal fake Manifold that applies the warp callback to its verts (mirrors
// warp-spline.test.ts) so warpManifoldAlongSpline runs without the WASM kernel.
type V3 = [number, number, number];
function fakeManifold(verts: V3[]) {
  const min: V3 = [Infinity, Infinity, Infinity], max: V3 = [-Infinity, -Infinity, -Infinity];
  for (const v of verts) for (let d = 0; d < 3; d++) { if (v[d] < min[d]) min[d] = v[d]; if (v[d] > max[d]) max[d] = v[d]; }
  return {
    verts,
    boundingBox: () => ({ min, max }),
    numTri: () => verts.length,
    volume: () => 1,
    genus: () => 0,
    warp(cb: (p: number[]) => void) { return fakeManifold(verts.map((v) => { const p: V3 = [...v]; cb(p); return p; })); },
  };
}

/**
 * AUTOSCALE (DTX) — the along-hole z-scaler for the warp. DTX replaces the linear
 * station map `s = (z − zBase)·yScale` with a monotonic, anchored depth remap that
 * MAGNIFIES a detail-dense sub-interval (it occupies more arc-length) while TOTAL
 * length is preserved (anchored 0→0 and maxDepth→maxDepth). Our own smoothing /
 * subdivision is unchanged; DTX is JUST the z-scaler + radial offsets stay ⊥ the
 * tangent. These pins are the HEADLESS gate for the feature.
 */
describe('DTX autoscale z-scaler in the spline warp', () => {
  // A planar (x,z) bend so the local spline tangent genuinely rotates along z.
  const CP: Pt2[] = [[0, 0], [0, 5], [4, 9], [8, 12]];
  const { total } = splineSampler(CP);

  // A DTX over the FULL depth domain [0, total] that magnifies the MID interval
  // [mLo, mHi] (raw Δ = 2) into a display Δ of 6 (≈3× arc), compressing the
  // surrounding gaps. Anchored: depth[0]=0→depthTx[0]=0, and last=total→total.
  const mLo = total * 0.4, mHi = total * 0.55;
  const dtx: DtxLut = {
    depth:   [0, mLo,          mHi,          total],
    depthTx: [0, total * 0.2,  total * 0.8,  total],
  };
  // Identity LUT (autoNodes([], …) shape): a safe no-op over the same domain.
  const identity: DtxLut = { depth: [0, total], depthTx: [0, total] };

  // A unit cross-section RING at local z (its plane's perpendicularity we check).
  const N = 24;
  const ringAt = (z: number) => {
    const r = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = (2 * Math.PI * i) / N;
      r[i * 3] = Math.cos(a);
      r[i * 3 + 1] = Math.sin(a);
      r[i * 3 + 2] = z;
    }
    return r;
  };

  // (1) Perpendicularity: under a magnifying DTX, a ring at z still lands with its
  // plane-normal PARALLEL to the local spline tangent — sampled at the DTX-remapped
  // arc s = lerpDtxLut(dtx, z). Radial offsets (x·N + y·B) are untouched by DTX.
  it('each ring stays ⊥ the local tangent under a magnifying DTX', () => {
    const { sampleAt } = splineSampler(CP);
    for (const z of [1, mLo + (mHi - mLo) * 0.5, total - 1]) {
      // originZ:0 pins the station origin — a FLAT ring's own z-extent is 0, so
      // without it every ring would collapse to s = lerpDtxLut(dtx, 0) = 0.
      const { positions } = warpMeshJS(ringAt(z), null, CP, { dtx, originZ: 0 });
      const s = lerpDtxLut(dtx, z); // station = lerpDtxLut(dtx, z − zBase), zBase = 0
      const { pos, tan } = sampleAt(s);
      let maxDot = 0;
      for (let i = 0; i < N; i++) {
        const px = positions[i * 3], py = positions[i * 3 + 1], pz = positions[i * 3 + 2];
        const dot = (px - pos[0]) * tan[0] + (py - pos[1]) * tan[1] + (pz - pos[2]) * tan[2];
        maxDot = Math.max(maxDot, Math.abs(dot));
      }
      expect(maxDot).toBeLessThan(1e-4);
    }
  });

  // (2) Magnification + anchoring: an equal-Δz slice INSIDE the magnified node maps
  // to a strictly LONGER arc-length span than an equal-Δz slice in an unmagnified
  // gap; endpoints anchor (s(0)=0, s(total)=total) so total length is preserved.
  it('equal-Δz maps to more arc inside the node; endpoints anchor', () => {
    const dz = (mHi - mLo) * 0.3; // a slice smaller than the node
    const mid = (mLo + mHi) / 2;
    // Inside the magnified interval:
    const insideSpan = lerpDtxLut(dtx, mid + dz / 2) - lerpDtxLut(dtx, mid - dz / 2);
    // In an unmagnified (compressed) gap near the top:
    const gapMid = total * 0.85;
    const gapSpan = lerpDtxLut(dtx, gapMid + dz / 2) - lerpDtxLut(dtx, gapMid - dz / 2);
    expect(insideSpan).toBeGreaterThan(gapSpan * 1.5); // clearly magnified

    // Anchored endpoints → total length preserved.
    expect(lerpDtxLut(dtx, 0)).toBeCloseTo(0, 10);
    expect(lerpDtxLut(dtx, total)).toBeCloseTo(total, 10);

    // And the WARP itself places the two rings that far apart along the spline.
    const { sampleAt } = splineSampler(CP);
    const arcOf = (z: number) => sampleAt(lerpDtxLut(dtx, z)).pos;
    const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const insideWorld = dist(arcOf(mid - dz / 2), arcOf(mid + dz / 2));
    const gapWorld = dist(arcOf(gapMid - dz / 2), arcOf(gapMid + dz / 2));
    expect(insideWorld).toBeGreaterThan(gapWorld);
  });

  // (3) Golden gate: DTX ABSENT is byte-identical to the no-DTX bake (the guarantee
  // that matters — a bake with Auto-depth off). An IDENTITY LUT is a no-op to within
  // interpolation float error (~1e-6), not bit-exact — the interior lerp reconstructs
  // d as (d/max)·max — so it's asserted CLOSE, not equal.
  it('golden: absent DTX ≡ no-DTX (byte-identical); identity DTX ≈ no-op', () => {
    // A spread of vertices covering the whole z-range (all within [0, total]).
    const M = 40;
    const pts = new Float32Array(M * 3);
    for (let i = 0; i < M; i++) {
      pts[i * 3] = Math.cos(i) * 0.7;
      pts[i * 3 + 1] = Math.sin(i) * 0.5;
      pts[i * 3 + 2] = (total * i) / (M - 1); // 0 .. total
    }
    const base = warpMeshJS(pts, null, CP, {}).positions;
    const absent = warpMeshJS(pts, null, CP, { dtx: undefined }).positions;
    const ident = warpMeshJS(pts, null, CP, { dtx: identity }).positions;
    for (let i = 0; i < base.length; i++) {
      expect(absent[i]).toBe(base[i]);            // literally the same code path
      expect(ident[i]).toBeCloseTo(base[i], 4);   // identity LUT ≈ no-op (~1e-6)
    }
  });

  // (4) lerpDtxLut is monotonic non-decreasing (a valid depth transform).
  it('lerpDtxLut is monotonic non-decreasing', () => {
    let prev = -Infinity;
    for (let k = 0; k <= 200; k++) {
      const d = (total * k) / 200;
      const v = lerpDtxLut(dtx, d);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
    // Clamps outside the sampled range.
    expect(lerpDtxLut(dtx, -5)).toBeCloseTo(0, 10);
    expect(lerpDtxLut(dtx, total + 100)).toBeCloseTo(total, 10);
    // Degenerate LUT (< 2 samples) → passthrough identity.
    expect(lerpDtxLut({ depth: [0], depthTx: [0] }, 3.3)).toBeCloseTo(3.3, 10);
  });

  // (5) Build-time station planner samples curvature in POST-DTX arc space: a
  // magnifying DTX concentrates MORE axial stations inside the magnified interval
  // (where the arc — hence the bend — is stretched) than the identity LUT does.
  it('planAxialStations places more stations in the magnified interval', () => {
    const opts = { minStations: 2, maxStations: 200 } as const;
    const withDtx = planAxialStations(CP, 0, total, { ...opts, dtx });
    const withoutDtx = planAxialStations(CP, 0, total, { ...opts });
    const inNode = (arr: number[]) => arr.filter((z) => z > mLo && z < mHi).length;
    // The magnified node subtends more arc under DTX → at least as many interior
    // stations as the un-remapped plan (usually strictly more).
    expect(inNode(withDtx)).toBeGreaterThanOrEqual(inNode(withoutDtx));
    // Identity DTX reproduces the no-DTX plan (same stations; identity is a no-op).
    const identPlan = planAxialStations(CP, 0, total, { ...opts, dtx: identity });
    expect(identPlan.length).toBe(withoutDtx.length);
    for (let i = 0; i < identPlan.length; i++) expect(identPlan[i]).toBeCloseTo(withoutDtx[i], 6);
  });

  // (6) The Manifold warp (warpManifoldAlongSpline, the PRIMARY bake path) and the
  // JS warp (warpMeshJS, the TF/BREP path) must AGREE under the SAME DTX — both edit
  // the station map identically, so a part bends the same in every engine.
  it('warpManifoldAlongSpline and warpMeshJS agree under the same DTX', () => {
    const verts: V3[] = [];
    for (const z of [0, 3, 6, 9, 12, total]) for (const x of [-0.5, 0.5]) for (const y of [-0.5, 0.5]) verts.push([x, y, z]);
    const flat = new Float32Array(verts.flat());
    const optsDtx = { dtx, originZ: 0 };
    const mf: any = warpManifoldAlongSpline(fakeManifold(verts), CP, optsDtx);
    const js = warpMeshJS(flat, null, CP, optsDtx).positions;
    expect(mf.verts.length * 3).toBe(js.length);
    for (let k = 0; k < verts.length; k++) {
      for (let d = 0; d < 3; d++) expect(mf.verts[k][d]).toBeCloseTo(js[3 * k + d], 5);
    }
  });
});
