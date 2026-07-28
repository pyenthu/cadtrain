/**
 * brep-bore-extend.test.ts — #B-bore-extend: BREP ports the proven MF/TF
 * BORE-EXTEND trick to a WARPED hollow swept-boolean.
 *
 * A hollow tube warped along a spline bakes as `sweep(outer).subtract(sweep(bore))`
 * (warpSpline). Riding the SAME spine, the bore's end caps land coincident with —
 * and, on a curve, tilted against — the outer's caps. The Manifold MESH boolean
 * stitches those coincident tri-disks into PHANTOM HANDLES (χ<0); the fix punches
 * the SUBTRAHEND (bore) sweep's spine past both ends (setBrepBoreExtFactor) so the
 * caps never share a plane.
 *
 * OCCT NOTE (measured): unlike the Manifold mesh boolean, OCCT's EXACT boolean
 * already tolerates coincident coaxial caps — so on BREP this is PARITY-with-MF/TF
 * + defense-in-depth, not a from-corrupted repair (both factor 0 and 2 yield the
 * same clean solid here). These OFFLINE pins therefore assert the fix keeps the
 * swept-boolean CLEAN (χ=0 genus-1 through-pipe) with a NON-THROWING cutaway — the
 * task's (a)+(b) — and exercise the degrade levers (noSectionCut / the exposed
 * factor dial). No network / no volume: the only dep is the local r_revolve engine.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as helpers from '$lib/engines/manifold/manifold-helpers';
import { brepFromSource, getBrepBoreExtFactor, setBrepBoreExtFactor } from '../brep-occt';
import { meshStats } from '../brep-audit';

const stdFetch = (async (url: any): Promise<any> => {
  const m = String(url).match(/[?&]name=([^&]+)/);
  if (m) {
    const { stdlibSource } = await import('$lib/server/stdlib');
    const s = stdlibSource(decodeURIComponent(m[1]));
    if (s) return { ok: true, status: 200, json: async () => ({ source: s }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
}) as unknown as typeof fetch;

const HEAVY = 60_000;
beforeAll(async () => { await helpers.initManifold(); }, HEAVY);
afterEach(() => setBrepBoreExtFactor(2)); // restore the default dial

// Full hollow tube (od 6, wall 1 → annular cross-section) warped along a curved
// spline → warpSpline sweeps the outer loop AND the bore loop, then subtracts:
// the swept-boolean the bore-extend targets. Straight tube would span x ∈ [−3, 3].
const tubeWarp = (path: string) => `
export const meta = { id: 'bt', name: 'bt', kind: 'asm', uses: ['r_revolve'], params: {} };
export function bt() {
  const path = ${path};
  const A = r_revolve({ profile: [[0,0],[3,0],[3,30],[0,30]], segments: 24 });
  const B = r_revolve({ profile: [[0,0],[2,0],[2,30],[0,30]], segments: 24 });
  return warpSpline(A.subtract(B), path, { refine: 8 });
}`;
const GENTLE = 'resampleSpline([[0,0,0],[2,0,15],[7,0,30]], 24, false)';
const SHARP = 'resampleSpline([[0,0,0],[-0.21,2.561,11.576],[3,0,20],[9,0,30]], 32, false)';

/** Euler characteristic χ = V − E + F of a triangle soup, welding coincident
 *  positions (OCCT tessellates each face independently + duplicates edge verts).
 *  A capped through-pipe is a torus → χ = 0; a solid half-pipe → χ = 2. */
function weldedEuler(pos: ArrayLike<number>, idx: ArrayLike<number> | undefined, q = 1e3) {
  const map = new Map<string, number>();
  const wid = (i: number) => {
    const k = `${Math.round(pos[i * 3] * q)}|${Math.round(pos[i * 3 + 1] * q)}|${Math.round(pos[i * 3 + 2] * q)}`;
    let id = map.get(k); if (id === undefined) { id = map.size; map.set(k, id); } return id;
  };
  const edges = new Set<string>();
  const addE = (a: number, b: number) => edges.add(a < b ? `${a}_${b}` : `${b}_${a}`);
  let F = 0;
  const n = idx && idx.length ? idx.length : pos.length / 3;
  for (let t = 0; t < n; t += 3) {
    const a = wid(idx ? idx[t] : t), b = wid(idx ? idx[t + 1] : t + 1), c = wid(idx ? idx[t + 2] : t + 2);
    addE(a, b); addE(b, c); addE(c, a); F++;
  }
  return { V: map.size, E: edges.size, F, chi: map.size - edges.size + F };
}

describe('brep bore-extend (#B-bore-extend)', () => {
  it('exposes the bore-extend factor dial (default 2)', () => {
    expect(getBrepBoreExtFactor()).toBe(2);
    setBrepBoreExtFactor(-1); expect(getBrepBoreExtFactor()).toBe(0); // clamps ≥0
    setBrepBoreExtFactor(3.5); expect(getBrepBoreExtFactor()).toBe(3.5);
  });

  it('curved hollow swept-boolean → clean genus-1 (χ=0) through-pipe + a NON-THROWING cutaway', { timeout: HEAVY }, async () => {
    const src = tubeWarp(SHARP);
    // (a) the bore-extended swept-boolean is a clean through-pipe: a torus, χ = 0.
    const uncut = await brepFromSource(src, {}, { cut: false }, stdFetch);
    expect(uncut, 'swept-boolean bakes a solid').toBeTruthy();
    const e = weldedEuler(uncut!.positions, uncut!.index);
    expect(e.chi, `Euler χ=${e.chi} (V${e.V}-E${e.E}+F${e.F}) — genus-1 through-pipe`).toBe(0);
    const st = meshStats(uncut!.positions, uncut!.index);
    expect(st.volume, 'positive volume').toBeGreaterThan(0);
    // it genuinely rode the spline (survey ends x≈9) — a straight tube maxes at r=3.
    expect(st.bbox.max[0], `bbox maxX ${st.bbox.max[0].toFixed(1)} curves past straight radius 3`).toBeGreaterThan(6);

    // (b) the half-section CUTAWAY on top meshes WITHOUT throwing (the coincident
    // caps used to make OCCT's `.cut` throw un-tessellably; the bore-extend keeps
    // it valid). cut===true means meshBrepSolid applied the cut (did not degrade).
    const cut = await brepFromSource(src, {}, { cut: true }, stdFetch);
    expect(cut, 'cutaway bake returns a mesh').toBeTruthy();
    expect(cut!.cut, 'cutaway applied — .cut did not throw + degrade to uncut').toBe(true);
    expect(cut!.meta?.tris ?? 0, 'cutaway produced triangles').toBeGreaterThan(0);
  });

  it('bore-extend does not regress the swept-boolean at factor 0 vs 2 (χ stays 0)', { timeout: HEAVY }, async () => {
    const src = tubeWarp(GENTLE);
    for (const f of [0, 2]) {
      setBrepBoreExtFactor(f);
      const m = await brepFromSource(src, {}, { cut: false }, stdFetch);
      const e = weldedEuler(m!.positions, m!.index);
      expect(e.chi, `factor ${f}: through-pipe χ=0`).toBe(0);
      const cut = await brepFromSource(src, {}, { cut: true }, stdFetch);
      expect(cut!.cut, `factor ${f}: cutaway meshes`).toBe(true);
    }
  });

  it('noSectionCut degrades a body half-section to the full uncut solid (SVG degrade lever)', { timeout: HEAVY }, async () => {
    // A straight hollow tube with a baked 180° half-section (the well-part shape).
    const sectioned = `
export const meta = { id: 'bs', name: 'bs', kind: 'asm', uses: ['r_revolve'], params: {} };
export function bs() {
  const A = r_revolve({ profile: [[0,0],[3,0],[3,30],[0,30]], segments: 24 });
  const B = r_revolve({ profile: [[0,0],[2,0],[2,30],[0,30]], segments: 24 });
  return sectionCut(A.subtract(B), { az: 180, offset: 0 });
}`;
    // WITH the section: a solid half-pipe (simply connected, χ=2).
    const withSec = await brepFromSource(sectioned, {}, { cut: false }, stdFetch);
    expect(weldedEuler(withSec!.positions, withSec!.index).chi, 'half-section is genus 0').toBe(2);
    // noSectionCut: sectionCut is a passthrough → the FULL through-pipe (torus, χ=0).
    const noSec = await brepFromSource(sectioned, {}, { cut: false, noSectionCut: true }, stdFetch);
    expect(weldedEuler(noSec!.positions, noSec!.index).chi, 'noSectionCut → full through-pipe (χ=0)').toBe(0);
    // …and its volume is the full annulus (≈2× the half-section) — proof the cut
    // was actually skipped, not merely a no-op.
    const vSec = meshStats(withSec!.positions, withSec!.index).volume;
    const vFull = meshStats(noSec!.positions, noSec!.index).volume;
    expect(vFull, `full ${vFull.toFixed(0)} > 1.5× half-section ${vSec.toFixed(0)}`).toBeGreaterThan(vSec * 1.5);
  });
});
