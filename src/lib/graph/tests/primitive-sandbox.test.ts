/**
 * primitive-sandbox.test.ts — the NAMES/VALUES positional contract.
 *
 * `new Function(...SANDBOX_ARG_NAMES, body)(...sandboxArgValues())` binds by
 * POSITION, so the two lists must stay index-aligned. A one-slot drift does not
 * throw — it silently binds the wrong function to every primitive's helper name
 * (e.g. `sectionCut` would become `resolveProfile`), and the failure surfaces
 * later as garbage geometry. Adding a helper is a two-line edit across both
 * lists, which is exactly the kind of edit that drifts.
 */
import { describe, it, expect } from 'vitest';
import { SANDBOX_ARG_NAMES, sandboxArgValues } from '../primitive-sandbox';
import { warpManifoldAlongSpline, type DtxLut } from '$lib/engines/manifold/warp-spline';

describe('primitive sandbox — NAMES/VALUES index alignment', () => {
  it('the two lists are the same length', () => {
    expect(sandboxArgValues().length).toBe(SANDBOX_ARG_NAMES.length);
  });

  it('every injected name is unique (a dupe silently shadows the earlier slot)', () => {
    const dupes = SANDBOX_ARG_NAMES.filter((n, i) => SANDBOX_ARG_NAMES.indexOf(n) !== i);
    expect(dupes).toEqual([]);
  });

  it('no injected value is undefined (a bad import lands as a silent undefined)', () => {
    const vals = sandboxArgValues();
    const missing = SANDBOX_ARG_NAMES.filter((_, i) => vals[i] === undefined);
    expect(missing).toEqual([]);
  });

  it('the named helpers land on the values they claim', () => {
    const vals = sandboxArgValues();
    for (const n of ['sectionCut', 'revolveProfile', 'weldAndBuild', 'resolveProfile']) {
      const i = SANDBOX_ARG_NAMES.indexOf(n);
      expect(i, `${n} must be injected`).toBeGreaterThanOrEqual(0);
      expect(typeof vals[i], `${n} must be a function`).toBe('function');
    }
  });

  it('a sandboxed body can call an injected helper by bare name', () => {
    // Exactly how primitive-loader evaluates a part/engine source.
    const fn = new Function(...SANDBOX_ARG_NAMES, 'return typeof sectionCut;');
    expect(fn(...sandboxArgValues())).toBe('function');
  });
});

// A minimal fake Manifold sufficient to drive the injected warpSpline: it captures
// its verts, applies the warp callback in place on .warp(), and reports bbox.
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

describe('primitive sandbox — AUTOSCALE (DTX) warpSpline threading', () => {
  const warpIdx = SANDBOX_ARG_NAMES.indexOf('warpSpline');
  const vertCP: [number, number][] = [[0, 0], [0, 60]]; // vertical spline, total ≈ 60
  const part = (): V3[] => [[-0.5, 0, 0], [0.5, 0, 0], [-0.5, 0, 10], [0.5, 0, 10]]; // z ∈ [0,10]
  const zExtent = (m: any) => { let lo = Infinity, hi = -Infinity; for (const v of m.verts) { if (v[2] < lo) lo = v[2]; if (v[2] > hi) hi = v[2]; } return hi - lo; };
  // Identity LUT over the depth domain [0,60] (autoNodes([], 60) shape) → a no-op remap.
  const identity: DtxLut = { depth: [0, 60], depthTx: [0, 60] };

  it('no viewScale injects the RAW warpManifoldAlongSpline (byte-identical)', () => {
    expect(sandboxArgValues()[warpIdx]).toBe(warpManifoldAlongSpline);
  });

  it('manual depth stretches along the path; AUTO (dtx) COMPOSES with the depth', () => {
    const manual = sandboxArgValues({ depth: 5 })[warpIdx] as any;
    const auto = sandboxArgValues({ dtx: identity, depth: 5 })[warpIdx] as any;
    // Manual depth=5: the part's z∈[0,10] stretches to ~50 along the vertical spline.
    expect(zExtent(manual(fakeManifold(part()), vertCP))).toBeCloseTo(50, 1);
    // AUTO with an identity DTX + depth=5: the DTX normalizes the distribution and the
    // manual depth STILL scales the normalized length (s = dtx(z)·5) — they COMPOSE
    // (user 2026-07-27), so an identity DTX + depth 5 == the manual depth 5 → ~50.
    expect(zExtent(auto(fakeManifold(part()), vertCP))).toBeCloseTo(50, 1);
  });

  it('radial (depth=1) with a dtx still applies + a degenerate LUT falls back to manual', () => {
    // A <2-sample LUT is ignored → manual path (depth=3 stretches to ~30).
    const degenerate = sandboxArgValues({ dtx: { depth: [0], depthTx: [0] } as DtxLut, depth: 3 })[warpIdx] as any;
    expect(zExtent(degenerate(fakeManifold(part()), vertCP))).toBeCloseTo(30, 1);
  });
});
