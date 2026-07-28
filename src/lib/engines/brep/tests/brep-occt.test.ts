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
import { revolveBrep, brepFromSource } from '../brep-occt';
import { analyzeParts } from '$lib/server/part-colors';
import { hydrateGraph } from '$lib/graph/composition/composition-graph-hydrate';
import { emitGraph } from '$lib/graph/composition/composition-emit';
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

// ── TASK B — curvature-adaptive MakePipeShell spine ──────────────────────────
// The BREP warpSpline sweep used to sample its spine UNIFORMLY in z; it now lays
// the spine points at the SHARED κ→Δz stations (planAxialStations) — the same
// model the Manifold revolve + TrueForm executor use. These pin: a deviated
// warpSpline tube still bakes a VALID solid at parity with the Manifold oracle,
// and the spine stations follow curvature (sparse straight tangent, dense dogleg).
describe('brep-occt: curvature-adaptive warp spine (TASK B)', () => {
  it('deviated warpSpline hollow tube — curvature-adaptive spine bakes a valid solid at MF-oracle parity', async () => {
    const src = `export const meta = { id: 't_warp', name: 't_warp', kind: 'asm', uses: ['r_revolve'], params: { od: { default: 3 }, id: { default: 2.4 }, length: { default: 30 } } };
export function t_warp(p) {
  const prof = [[p.id/2, 0], [p.od/2, 0], [p.od/2, p.length], [p.id/2, p.length]];
  const tube = r_revolve({ profile: prof, segments: 48 });
  // vertical 0→12 (straight tangent), then kicks off 12→30 (the dogleg).
  return warpSpline(tube, [[0,0,0],[0,0,12],[3,0,22],[9,0,30]], { originZ: 0 });
}`;
    // Looser tol than the 0.06 straight cases: BREP sweeps EXACT curves (its bent
    // annulus ≈ the true π(1.5²−1.2²)·30 ≈ 76.3) while the MF ORACLE bends a FACETED
    // mesh (uniform-span rings → a chordal volume shortfall on the dogleg), so the
    // two differ by ~11% by construction (exact vs faceted), not from a spine bug.
    // The pin still catches a genus-wrong / collapsed-bore result (that would be off
    // by >50%). BREP being the HIGHER (exact) volume confirms the sweep is clean.
    const { brepVol, mfVol } = await assertParity('t_warp', src, 0.15);
    // A bent OD3/ID2.4 hollow tube, ~30 of arc: annular volume ≈ π(1.5²−1.2²)·30 ≈ 76.
    expect(brepVol, 'deviated BREP tube must be a real hollow solid').toBeGreaterThan(60);
    expect(mfVol).toBeGreaterThan(50);
  });

  it('the spine stations follow curvature: sparse on the straight tangent, dense at the dogleg', async () => {
    // The BREP spine is [z0, ...planAxialStations(path, z0, z1, clamp), z1]. Assert
    // the shared model clusters those interior stations at the bend — the exact
    // property that makes the deviated sweep FEWER spine points on the straight run
    // and MORE at the dogleg (OCCT internals aren't observable, so pin the model).
    const { planAxialStations } = await import('$lib/engines/manifold/warp-spline');
    const path = [[0, 0, 0], [0, 0, 12], [3, 0, 22], [9, 0, 30]]; // vertical, then kick-off
    const stations = planAxialStations(path as any, 0, 30, { minStations: 3, maxStations: 40, radialExtent: 1.5 });
    expect(stations.length).toBeGreaterThan(3);
    const nStraight = stations.filter((z) => z > 0.5 && z < 11.5).length;
    const nBend = stations.filter((z) => z > 12.5 && z < 29.5).length;
    expect(nBend / (30 - 12)).toBeGreaterThan(nStraight / 12); // κ drives spine density
  });
});

// ── #997 — CUT half-section honours colorOuter / colorInner ──────────────────
describe('brep-occt: cut half-section vertex colours (#997)', () => {
  // A solid cylinder half-section: outer cylindrical wall → colorOuter; the two
  // exposed cut planes (x=0, y=0) → colorInner. A quarter-cut revolve is the
  // simplest solid that produces BOTH classes of face.
  const cyl: [number, number][] = [[0.01, 0], [2, 0], [2, 6], [0.01, 6]];

  // Does the flat colours array contain a vertex ≈ [r,g,b]?
  const hasColour = (colors: number[] | undefined, rgb: [number, number, number], eps = 0.02): boolean => {
    if (!colors) return false;
    for (let i = 0; i + 2 < colors.length; i += 3) {
      if (Math.abs(colors[i] - rgb[0]) < eps && Math.abs(colors[i + 1] - rgb[1]) < eps && Math.abs(colors[i + 2] - rgb[2]) < eps) return true;
    }
    return false;
  };

  const GREEN: [number, number, number] = [0, 1, 0];        // #00ff00 → colorOuter
  const BLUE: [number, number, number] = [0, 0, 1];         // #0000ff → colorInner
  const LEGACY_OUTER: [number, number, number] = [0.8, 0.06, 0.06];  // legacy red
  const LEGACY_INNER: [number, number, number] = [0.45, 0.45, 0.45]; // legacy grey

  it('explicit colorOuter/colorInner paint the outer + exposed-cut faces', async () => {
    const mesh = await revolveBrep(cyl, { cut: true, colorOuter: '#00ff00', colorInner: '#0000ff' });
    expect(mesh.cut, 'must be a cut half-section (per-vertex colours)').toBe(true);
    expect(mesh.colors && mesh.colors.length, 'cut mesh must emit vertex colours').toBeGreaterThan(0);
    // Outer skin → colorOuter (green); exposed cut planes / bore → colorInner (blue).
    expect(hasColour(mesh.colors, GREEN), 'outer faces must use colorOuter (#00ff00)').toBe(true);
    expect(hasColour(mesh.colors, BLUE), 'exposed cut faces must use colorInner (#0000ff)').toBe(true);
    // The legacy red/grey must NOT appear — the overrides fully replaced them.
    expect(hasColour(mesh.colors, LEGACY_OUTER), 'legacy red must be gone when colorOuter is set').toBe(false);
    expect(hasColour(mesh.colors, LEGACY_INNER), 'legacy grey must be gone when colorInner is set').toBe(false);
  });

  it('omitting the colours falls back to the legacy red/grey (back-compat)', async () => {
    const mesh = await revolveBrep(cyl, { cut: true });
    expect(mesh.cut).toBe(true);
    expect(hasColour(mesh.colors, LEGACY_OUTER), 'outer faces default to legacy red').toBe(true);
    expect(hasColour(mesh.colors, LEGACY_INNER), 'cut/bore faces default to legacy grey').toBe(true);
    // And no stray green/blue leaked in.
    expect(hasColour(mesh.colors, GREEN)).toBe(false);
    expect(hasColour(mesh.colors, BLUE)).toBe(false);
  });

  it('one-sided override: colorInner set, colorOuter omitted → inner custom, outer legacy red', async () => {
    const mesh = await revolveBrep(cyl, { cut: true, colorInner: '#0000ff' });
    expect(hasColour(mesh.colors, BLUE), 'inner uses the supplied colorInner').toBe(true);
    expect(hasColour(mesh.colors, LEGACY_OUTER), 'outer still falls back to legacy red').toBe(true);
    expect(hasColour(mesh.colors, LEGACY_INNER), 'inner legacy grey replaced by colorInner').toBe(false);
  });
});

// END-TO-END color-by-source through the REAL OCCT executor (#86 "Phase B" for
// BREP). Pins the full seam the pure brep-part-colors.test.ts can't: the source
// is `tagInstanceSources`-tagged, `__tag` records each instance's hashId on its
// OCCT solid, `carryTag` carries it through a transform, brepFromSource meshes
// each top-level sub-solid separately, and each part comes out in its OWN LUT
// colour — where the pre-fix BREP baked the whole multi-part solid one colour.
describe('brep-occt: multi-part color-by-source (uncut full solid)', () => {
  // Two revolves, coloured via meta.instanceColors. A is section-cut and B is
  // moved AFTER their `const` init (so tagInstanceSources tags them and carryTag
  // must carry the tag through sectionCut / mv to the returned sub-solids).
  const src = `export const meta = { id: 'cbs_two', name: 'cbs_two', kind: 'asm', uses: ['r_revolve'], instanceColors: { A: { outer: '#3399ff' }, B: { outer: '#ff9933' } }, params: { od: { default: 4 }, length: { default: 6 } } };
export function cbs_two(p) {
  const prof = [[0.01, 0], [p.od/2, 0], [p.od/2, p.length], [0.01, p.length]];
  const A = r_revolve({ profile: prof, segments: 16 });
  const B = r_revolve({ profile: prof, segments: 16 });
  return [ sectionCut(A, { az: 180, offset: 0 }), mv(B, [10, 0, 0]) ];
}`;

  const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
  const rgb = (hex: string): [number, number, number] => {
    const v = hex.replace('#', '');
    return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
  };
  const distinctColours = (colors: number[] | undefined): [number, number, number][] => {
    const out: [number, number, number][] = [];
    for (let i = 0; i + 2 < (colors?.length ?? 0); i += 3) {
      const c: [number, number, number] = [colors![i], colors![i + 1], colors![i + 2]];
      if (!out.some((o) => near(o[0], c[0]) && near(o[1], c[1]) && near(o[2], c[2]))) out.push(c);
    }
    return out;
  };

  it('meshes each sub-solid separately and tints it with its LUT colour', async () => {
    const lut = analyzeParts(src);              // the SAME LUT the MF tab computes
    expect(lut.active).toBe(true);
    const mesh = await brepFromSource(src, { od: 4, length: 6 }, { partColors: lut }, stdFetch);
    expect(mesh, 'brepFromSource should produce a mesh').toBeTruthy();
    expect(mesh!.cut, 'uncut per-part colour path → cut:false → adapter routes to full').toBe(false);
    expect(mesh!.colors, 'multi-part BREP must carry per-vertex colours').toBeTruthy();

    const colours = distinctColours(mesh!.colors);
    // TWO parts → TWO distinct colour regions (the bug rendered ONE uniform colour).
    expect(colours.length, `expected 2 colour regions, got ${colours.length}`).toBe(2);
    // Each region is exactly a LUT outer entry — BREP == MF colour for the part.
    const A = rgb('#3399ff'); const B = rgb('#ff9933');
    const hasA = colours.some((c) => near(c[0], A[0]) && near(c[1], A[1]) && near(c[2], A[2]));
    const hasB = colours.some((c) => near(c[0], B[0]) && near(c[1], B[1]) && near(c[2], B[2]));
    expect(hasA, 'part A must be #3399ff').toBe(true);
    expect(hasB, 'part B must be #ff9933').toBe(true);
  });

  it('no LUT → the legacy single-mesh path, uncoloured (byte-identical fallback)', async () => {
    const mesh = await brepFromSource(src, { od: 4, length: 6 }, {}, stdFetch);
    expect(mesh).toBeTruthy();
    expect(mesh!.cut).toBe(false);
    // The uncut legacy path is an INDEXED mesh with NO per-vertex colours — the
    // scene paints it one uniform material colour (pre-#86 behaviour, unchanged).
    expect(mesh!.colors, 'no LUT → no per-part colours').toBeFalsy();
    expect(mesh!.index, 'legacy path stays indexed').toBeTruthy();
  });
});

// ── #997 — `.add`/`.union` of DIFFERENTLY-COLOURED parts keeps BOTH colours ──────
// The reported bug: `bw_packer` = body`.add(`seal`)` rendered ALL-brown (the body
// colour) instead of a brown body + a blue seal, because OCCT's fuse collapses the
// two solids into ONE — and a fused OCCT solid (unlike a Manifold's mesh relation)
// can only carry a single part tag, so the added part's colour was lost. The fix
// keeps differently-tagged additive parts SEPARATE (a GROUP, mirroring Manifold's
// lazy _parts) so each keeps its own colour AND geometry. This is the exact `.add`
// path the pure/array color tests above DON'T cover — they returned an array.
describe('brep-occt: #997 — .add keeps per-part colours (no fuse-away)', () => {
  // A body cylinder + a wider, shorter seal ring, each an r_revolve instance with
  // its OWN instanceColor, COMBINED WITH `.add` (the packer pattern). Pre-fix this
  // fused to one brown solid; post-fix it stays two coloured parts.
  const src = `export const meta = { id: 'cbs_add', name: 'cbs_add', kind: 'asm', uses: ['r_revolve'], instanceColors: { body: { outer: '#8b5a2b' }, seal: { outer: '#3366ff' } }, params: { od: { default: 4 }, length: { default: 8 } } };
export function cbs_add(p) {
  const bodyProf = [[0.01, 0], [p.od/2, 0], [p.od/2, p.length], [0.01, p.length]];
  const sealProf = [[0.01, 3], [p.od/2 + 1.5, 3], [p.od/2 + 1.5, 5], [0.01, 5]];
  const body = r_revolve({ profile: bodyProf, segments: 16 });
  const seal = r_revolve({ profile: sealProf, segments: 16 });
  return body.add(seal);
}`;

  const near = (a: number, b: number) => Math.abs(a - b) < 0.02;
  const rgb = (hex: string): [number, number, number] => {
    const v = hex.replace('#', '');
    return [parseInt(v.slice(0, 2), 16) / 255, parseInt(v.slice(2, 4), 16) / 255, parseInt(v.slice(4, 6), 16) / 255];
  };
  const distinctColours = (colors: number[] | undefined): [number, number, number][] => {
    const out: [number, number, number][] = [];
    for (let i = 0; i + 2 < (colors?.length ?? 0); i += 3) {
      const c: [number, number, number] = [colors![i], colors![i + 1], colors![i + 2]];
      if (!out.some((o) => near(o[0], c[0]) && near(o[1], c[1]) && near(o[2], c[2]))) out.push(c);
    }
    return out;
  };
  // Signed volume of a NON-INDEXED triangle soup (divergence theorem) — a decode,
  // not an eyeball. A GROUP of two closed solids meshed separately concatenates to
  // vol(body)+vol(seal); both closed + positively oriented → total > 0.
  const soupVolume = (pos: number[]): number => {
    let vol = 0;
    for (let i = 0; i + 8 < pos.length; i += 9) {
      const ax = pos[i], ay = pos[i + 1], az = pos[i + 2];
      const bx = pos[i + 3], by = pos[i + 4], bz = pos[i + 5];
      const cx = pos[i + 6], cy = pos[i + 7], cz = pos[i + 8];
      vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    }
    return vol;
  };

  it('body.add(seal) → TWO distinct colours (body brown + seal blue), not one flat colour', async () => {
    const lut = analyzeParts(src);
    expect(lut.active, 'LUT must be active for the colour path').toBe(true);
    const mesh = await brepFromSource(src, { od: 4, length: 8 }, { partColors: lut }, stdFetch);
    expect(mesh, 'brepFromSource should produce a mesh').toBeTruthy();
    expect(mesh!.cut, 'uncut per-part colour path → cut:false').toBe(false);
    expect(mesh!.colors, 'an added multi-part BREP solid must carry per-vertex colours').toBeTruthy();

    // THE FIX: two colour regions from an `.add` (the pre-fix fuse gave ONE).
    const colours = distinctColours(mesh!.colors);
    expect(colours.length, `expected 2 colours from body.add(seal), got ${colours.length}`).toBe(2);
    const BODY = rgb('#8b5a2b'); const SEAL = rgb('#3366ff');
    const hasBody = colours.some((c) => near(c[0], BODY[0]) && near(c[1], BODY[1]) && near(c[2], BODY[2]));
    const hasSeal = colours.some((c) => near(c[0], SEAL[0]) && near(c[1], SEAL[1]) && near(c[2], SEAL[2]));
    expect(hasBody, 'the body must stay its own brown (#8b5a2b)').toBe(true);
    expect(hasSeal, 'the added seal must keep its blue (#3366ff) — not fuse to brown').toBe(true);

    // Per-part render list (#947) also carries both parts, each with its appearance.
    expect(mesh!.parts, 'per-part mesh list must be present').toBeTruthy();
    expect(mesh!.parts!.length, 'two additive parts → two per-part meshes').toBe(2);

    // Geometry stays VALID: positive total volume, both parts non-trivial.
    expect(soupVolume(mesh!.positions), 'added group must have positive volume').toBeGreaterThan(0);
    for (const part of mesh!.parts!) expect(part.positions.length, 'each part has real geometry').toBeGreaterThan(0);
  });

  it('downstream `.subtract` after `.add` folds PER-ELEMENT → both colours survive a shared bore', async () => {
    // (body.add(seal)).subtract(bore) → [body−bore, seal−bore]: each part CSG'd
    // independently (MF per-part CSG), so BOTH colours AND the bore survive.
    const boreSrc = `export const meta = { id: 'cbs_addsub', name: 'cbs_addsub', kind: 'asm', uses: ['r_revolve'], instanceColors: { body: { outer: '#8b5a2b' }, seal: { outer: '#3366ff' } }, params: { od: { default: 4 }, length: { default: 8 } } };
export function cbs_addsub(p) {
  const bodyProf = [[0.01, 0], [p.od/2, 0], [p.od/2, p.length], [0.01, p.length]];
  const sealProf = [[0.01, 3], [p.od/2 + 1.5, 3], [p.od/2 + 1.5, 5], [0.01, 5]];
  const boreProf = [[0.01, -1], [0.6, -1], [0.6, p.length + 1], [0.01, p.length + 1]];
  const body = r_revolve({ profile: bodyProf, segments: 16 });
  const seal = r_revolve({ profile: sealProf, segments: 16 });
  const bore = r_revolve({ profile: boreProf, segments: 16 });
  return body.add(seal).subtract(bore);
}`;
    const lut = analyzeParts(boreSrc);
    const mesh = await brepFromSource(boreSrc, { od: 4, length: 8 }, { partColors: lut }, stdFetch);
    expect(mesh!.colors, 'add-then-subtract must still carry per-vertex colours').toBeTruthy();
    const colours = distinctColours(mesh!.colors);
    expect(colours.length, `(body.add(seal)).subtract(bore) must keep 2 colours, got ${colours.length}`).toBe(2);
    expect(soupVolume(mesh!.positions), 'bored add-group must still be a positive solid').toBeGreaterThan(0);
  });

  it('a SINGLE-solid part with a LUT is UNCHANGED — no spurious grouping (1 colour, still valid)', async () => {
    // No `.add` of differently-tagged parts → NO group is ever formed → the
    // single-solid path is byte-identical: one colour region, positive volume.
    const oneSrc = `export const meta = { id: 'cbs_one', name: 'cbs_one', kind: 'asm', uses: ['r_revolve'], instanceColors: { body: { outer: '#8b5a2b' } }, params: { od: { default: 4 }, length: { default: 8 } } };
export function cbs_one(p) {
  const bodyProf = [[0.01, 0], [p.od/2, 0], [p.od/2, p.length], [0.01, p.length]];
  const body = r_revolve({ profile: bodyProf, segments: 16 });
  return body;
}`;
    const lut = analyzeParts(oneSrc);
    const mesh = await brepFromSource(oneSrc, { od: 4, length: 8 }, { partColors: lut }, stdFetch);
    const colours = distinctColours(mesh!.colors);
    expect(colours.length, 'a single-solid part stays ONE colour region').toBe(1);
    expect(near(colours[0][0], rgb('#8b5a2b')[0]) && near(colours[0][2], rgb('#8b5a2b')[2]), 'that colour is the body colour').toBe(true);
    expect(soupVolume(mesh!.positions), 'single solid keeps positive volume').toBeGreaterThan(0);
    expect(mesh!.parts!.length, 'exactly one per-part mesh').toBe(1);
  });
});
