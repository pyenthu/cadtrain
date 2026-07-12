/**
 * brep-occt.test.ts — OFFLINE parity pins for the OCCT/BREP executor.
 *
 * Runs in the DEFAULT suite (no network, no volume): each case is a
 * self-contained inline part whose only deps are the local stdlib engines, so it
 * compiles through the Manifold pipeline (compilePrimitiveScript +
 * runCompiledManifold — the oracle) AND bakes through OCCT (brepFromSource) with
 * NO fetchFn. Each mechanical mapping added to brep-occt.ts is pinned here: the
 * BREP result must be a valid solid whose volume matches the Manifold oracle
 * within tolerance. If a mapping regresses (taper ignored, loft flattened,
 * place/sectionCut lost) these fail.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import * as helpers from '$lib/engines/manifold/manifold-helpers';
import { bakeMF, bakeBREP, defaultParamObject } from '../brep-audit';
import { hydrateGraph } from '$lib/graph/composition-graph-hydrate';
import { emitGraph } from '$lib/graph/composition-emit';
import sweepTubeDemo from '../../../../../tests/golden/graph/sweep_tube_demo.json';

// The inline parts below only depend on the stdlib engines. The MF compiler
// (compilePrimitiveScript) inlines engine deps through the fetchFn, so serve
// them from the bundled stdlib registry — fully offline, no network/volume.
// (BREP injects the engines directly, so it never calls this.)
const stdFetch = (async (url: any): Promise<any> => {
  const m = String(url).match(/[?&]name=([^&]+)/);
  if (m) {
    const { stdlibSource } = await import('$lib/server/stdlib');
    const s = stdlibSource(decodeURIComponent(m[1]));
    if (s) return { ok: true, status: 200, json: async () => ({ source: s }) };
  }
  return { ok: false, status: 404, json: async () => ({}) };
}) as unknown as typeof fetch;

beforeAll(async () => { await helpers.initManifold(); });

/** Bake a source through MF (oracle) + BREP and assert BREP is a valid solid
 *  whose volume matches MF within `tol` (relative). Returns both volumes. */
async function assertParity(id: string, source: string, tol = 0.06) {
  const params = defaultParamObject(source);
  const mf = await bakeMF(source, id, params, stdFetch);
  const brep = await bakeBREP(source, params, stdFetch);
  expect(brep.volume, `${id}: BREP volume must be positive`).toBeGreaterThan(0);
  expect(brep.tris, `${id}: BREP must produce triangles`).toBeGreaterThan(0);
  const rel = Math.abs(brep.volume - mf.volume) / mf.volume;
  expect(rel, `${id}: BREP vol ${brep.volume.toFixed(3)} vs MF ${mf.volume.toFixed(3)} (rel ${(rel * 100).toFixed(1)}%)`).toBeLessThanOrEqual(tol);
  return { mfVol: mf.volume, brepVol: brep.volume };
}

describe('brep-occt: core mappings match the Manifold oracle', () => {
  it('revolve — annular tube (r_revolve → OCCT surface of revolution)', async () => {
    const src = `export const meta = { id: 't_rev', name: 't_rev', kind: 'asm', uses: ['r_revolve'], params: { od: { default: 4 }, id: { default: 3 }, length: { default: 6 } } };
export function t_rev(p) {
  const prof = [[p.id/2, 0], [p.od/2, 0], [p.od/2, p.length], [p.id/2, p.length]];
  return r_revolve({ profile: prof, segments: 96 });
}`;
    const { mfVol } = await assertParity('t_rev', src);
    // sanity: π(Ro²−Ri²)L = π(4−2.25)·6 ≈ 32.99
    expect(mfVol).toBeGreaterThan(28);
    expect(mfVol).toBeLessThan(36);
  });

  it('CSG — box minus box (subtract → OCCT .cut)', async () => {
    const src = `export const meta = { id: 't_csg', name: 't_csg', kind: 'asm', uses: ['r_cuboid'], params: { a: { default: 4 }, b: { default: 2 } } };
export function t_csg(p) {
  return r_cuboid(p.a, p.a, p.a).subtract(r_cuboid(p.b, p.b, p.a + 1));
}`;
    await assertParity('t_csg', src);
  });

  it('taper — r_weld_extrude scales the top face (extrusionProfile endFactor = 1−taper)', async () => {
    const src = `export const meta = { id: 't_tap', name: 't_tap', kind: 'asm', uses: ['r_weld_extrude'], params: { size: { default: 2 }, length: { default: 6 }, taper: { default: 0.3 } } };
export function t_tap(p) {
  const sq = [[-p.size, -p.size], [p.size, -p.size], [p.size, p.size], [-p.size, p.size]];
  return r_weld_extrude({ profile: sq, length: p.length, divs: 24, twist: 0, taper: p.taper, segments: 8 });
}`;
    // A tapered prism's volume ≠ a straight prism's — this only passes if BREP
    // applies the taper (a straight extrude was ~19% over-volume).
    await assertParity('t_tap', src);
  });

  it('loft — barrel bulge (per-t scaled sections, not a monotonic end-scale)', async () => {
    const src = `export const meta = { id: 't_barrel', name: 't_barrel', kind: 'asm', uses: ['r_loft'], params: { size: { default: 2 }, length: { default: 8 }, bulge: { default: 0.4 } } };
export function t_barrel(p) {
  const sq = [[-p.size, -p.size], [p.size, -p.size], [p.size, p.size], [-p.size, p.size]];
  return r_loft({ profile: sq, length: p.length, divs: 48, twist: 0, bulge: p.bulge, shape: 'barrel', segments: 8 });
}`;
    // A barrel is fat in the MIDDLE with equal ends — replicad's monotonic
    // extrusionProfile can't make it, so this pins the multi-section loft.
    await assertParity('t_barrel', src);
  });

  it('sectionCut — authored 180° half-section (angular wedge → OCCT .cut)', async () => {
    const src = `export const meta = { id: 't_half', name: 't_half', kind: 'asm', uses: ['r_revolve'], params: { od: { default: 4 }, length: { default: 6 } } };
export function t_half(p) {
  const prof = [[0.01, 0], [p.od/2, 0], [p.od/2, p.length], [0.01, p.length]];
  const A = r_revolve({ profile: prof, segments: 96 });
  return sectionCut(A, { az: 180, offset: 0 });
}`;
    const { mfVol, brepVol } = await assertParity('t_half', src);
    // Half a solid cylinder: ½·π·(od/2)²·L = ½·π·4·6 ≈ 37.7
    expect(mfVol).toBeGreaterThan(33);
    expect(mfVol).toBeLessThan(42);
    expect(brepVol).toBeGreaterThan(33);
  });

  it('coincident-vertex profile — degenerate zero-length edge (chamfer === length)', async () => {
    // Mirrors bw_hanger at chamfer === length: [od/2, length−chamfer] collapses
    // onto [od/2, 0], a zero-length edge. Manifold tolerates it; OCCT's exact
    // kernel threw a Standard_Failure (a bare numeric pointer) that poisoned the
    // whole assembly — misread as a heap OOM. The sketchPoly dedupe drops the
    // duplicate vertex so BREP now bakes this at parity with the oracle. This is
    // the actual fix that unblocked w_sample_1 (a full 16-part vertical well).
    const src = `export const meta = { id: 't_degen', name: 't_degen', kind: 'asm', uses: ['r_revolve'], params: { od: { default: 8 }, id: { default: 3 }, length: { default: 2 }, chamfer: { default: 2 } } };
export function t_degen(p) {
  const prof = [[p.id/2, 0], [p.od/2, 0], [p.od/2, p.length - p.chamfer], [p.od/2 - p.chamfer, p.length], [p.id/2, p.length]];
  return r_revolve({ profile: prof, segments: 32 });
}`;
    const { brepVol } = await assertParity('t_degen', src);
    expect(brepVol, 't_degen: coincident-vertex revolve must bake a positive solid').toBeGreaterThan(0);
  });

  it('r_sweep — resampled-spline tube: MakePipeShell throws, rail-loft recovers at parity', async () => {
    // sweep_tube_demo sweeps a circle down a NEARLY-STRAIGHT resampled spline
    // (max ~5° turn/segment, no fold). Manifold bakes it fine, but OCCT's
    // BRepOffsetAPI_MakePipeShell throws a Standard_Failure on that spine — which
    // failed the WHOLE BREP build (the "flicker": the tab showed a stale/partial
    // mesh). The fix keeps MakePipeShell as primary and, ONLY on its throw,
    // recovers by lofting the section through per-station RMF frames
    // (ThruSections). This pins that the golden now bakes a valid solid at parity
    // with the Manifold oracle instead of failing.
    const graph = hydrateGraph(sweepTubeDemo as any);
    const { source } = emitGraph(graph, { id: 'sweep_tube_demo' });
    const { brepVol } = await assertParity('sweep_tube_demo', source, 0.06);
    expect(brepVol, 'sweep_tube_demo: BREP must build a real solid (was a throw)').toBeGreaterThan(6);
  });

  it('place + fold — A.add(place([…])) unions a repeated part (combineBool)', async () => {
    const src = `export const meta = { id: 't_place', name: 't_place', kind: 'asm', uses: ['r_cuboid'], params: { n: { default: 3 } } };
export function t_place(p) {
  const A = r_cuboid(4, 4, 4);
  const B = r_cuboid(1, 1, 1);
  const placed = place(Array.from({ length: p.n }, (_, i) => mv(B, [0, 0, 3 + i * 1.5])));
  return A.add(placed);
}`;
    const { mfVol } = await assertParity('t_place', src);
    // 4³ + 3·1³ = 67 (disjoint boxes fused onto the cube).
    expect(mfVol).toBeGreaterThan(64);
  });
});
