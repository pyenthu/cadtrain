/**
 * render-material-parity.test.ts — PER-PART (per-subpart) material parity across
 * the three render backends (TODO #947, render side).
 *
 * GOAL: a multi-material assembly (e.g. a well: steel casing + brass sleeve)
 * must render EACH subpart in ITS OWN material — colour · MATL preset · opacity —
 * not one merged material for the whole part. TF (`graph-to-tf`) is the reference
 * ("oracle") for the per-part appearance assignment.
 *
 * WHAT THIS PINS (all HEADLESS — Manifold + OCCT run in Node; TF appearance
 * resolution is a PURE graph walk, no WASM):
 *
 *  1. MF (Manifold) already emits per-part `{ geo, appearance }` for BOTH the
 *     solid AND the cut view, each carrying its subpart's own material — the
 *     render side of #947 landed via `render-helpers.ts:buildSourceParts` +
 *     `part-colors.ts` (LUT.appearance) and reaches the scene's per-part arm
 *     (`PrimitiveDualScene` "PER-PART textured meshes"). This locks that in.
 *
 *  2. The per-part MATERIAL/COLOUR ASSIGNMENT MF resolves is EQUIVALENT to what
 *     TF resolves for the same assembly (TF = oracle). Both read each subpart's
 *     authored colour/material; MF from the emitted source (`analyzeParts`), TF
 *     from the graph's material bindings (`resolveEffectiveAppearance`).
 *
 *  3. A SINGLE-material / un-preset part stays BYTE-IDENTICAL — no `parts` key,
 *     so it renders through the unchanged merged-mesh path (the hard gate).
 *
 *  4. BREP CANNOT feed the per-part path from the adapter: `brep-occt.ts` FUSES
 *     every subpart into ONE OCCT solid before tessellating, so the response
 *     (and `brepResponseToGeo`) is a single merged mesh with no per-part /
 *     per-material data. Per-part BREP would require a server-side change
 *     (emit per-part geometry) — out of scope here. This documents the real,
 *     structural limitation so a future reader knows WHY BREP differs.
 */
import { describe, it, expect } from 'vitest';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { analyzeParts, resolveDepColors } from '$lib/server/part-colors';
import { runCompiledManifold } from '$lib/engines/manifold/bake-worker-core';
import { deserializeComponentResult } from '$lib/engines/manifold/mesh-serial';
import { graphToTf } from '$lib/engines/trueform/graph-to-tf';
import type { Graph } from '../composition-graph-types';
import { brepResponseToGeo } from '$lib/engines/brep/brep-adapter';
import { brepFromSource } from '$lib/engines/brep/brep-occt';

// ── shared multi-material fixture ────────────────────────────────────────────
// Two engine-backed leaves (r_cuboid, so BOTH MF and BREP can bake them) with
// DISTINCT materials: A = steel/#cc0000, B = brass/#1133cc. The assembly places
// them apart and `.add`s them — disjoint bodies survive as two source-tagged
// parts, so the LUT-active bake splits them per-subpart.
const M_STEEL = '#cc0000';
const M_BRASS = '#1133cc';

// NB: engine-backed part bodies MUST use the `p`-object convention (`p.a`) —
// the MF compiler treats a single-param geom whose meta.params has that key as
// object-style, and the BREP executor only binds `p`. So both bake identically.
const sources: Record<string, string> = {
  m_steel: `export const meta = { id:'m_steel', name:'steel', kind:'asm', uses:['r_cuboid'], material:'steel', colorOuter:'${M_STEEL}', params:{ a:{ default:3 } } };\nexport function m_steel(p){ return r_cuboid(p.a, p.a, p.a); }`,
  m_brass: `export const meta = { id:'m_brass', name:'brass', kind:'asm', uses:['r_cuboid'], material:'brass', colorOuter:'${M_BRASS}', params:{ a:{ default:3 } } };\nexport function m_brass(p){ return r_cuboid(p.a, p.a, p.a); }`,
  m_asm: `export const meta = { id:'m_asm', name:'asm', kind:'asm', uses:['m_steel','m_brass'], params:{} };\nexport function m_asm(){ const A = m_steel({ a: 3 }); const B = m_brass({ a: 3 }); return A.add(mv(B, [8,0,0])); }`,
};

/** Serve the fixture sources + fall through to the bundled stdlib engines
 *  (r_cuboid) so the compile + BREP dep-resolve run fully offline. */
const fetchFixture = (async (url: any): Promise<any> => {
  const name = new URL(String(url), 'http://x').searchParams.get('name') ?? '';
  if (sources[name] != null) return { ok: true, status: 200, json: async () => ({ source: sources[name] }) };
  const { stdlibSource } = await import('$lib/server/stdlib');
  const s = stdlibSource(name);
  if (s) return { ok: true, status: 200, json: async () => ({ source: s }) };
  return { ok: false, status: 404, json: async () => ({}) };
}) as unknown as typeof fetch;

/** Reduce an appearance object to the fields that BOTH engines resolve
 *  deterministically — the per-part material/colour ASSIGNMENT the task cares
 *  about — so MF and TF can be compared apples-to-apples. */
function keyOf(a: { colorOuter?: string; material?: string; opacity?: number } | undefined) {
  return JSON.stringify({
    colorOuter: (a?.colorOuter ?? '').toLowerCase(),
    material: a?.material ?? '',
    opacity: a?.opacity ?? 1,
  });
}
const sortedKeys = (arr: any[]) => arr.map(keyOf).sort();

describe('per-part material — MF emits per-part {geo, appearance} (#947 render side)', () => {
  it('SOLID view: one mesh per subpart, each with its OWN material + colour', async () => {
    const { script } = await compilePrimitiveScript(sources.m_asm, 'm_asm', fetchFixture);
    const lut = analyzeParts(sources.m_asm, await resolveDepColors(sources.m_asm, fetchFixture));
    const out = await runCompiledManifold(script, [], { parts: lut, cutaway: false });

    expect(out.parts?.length).toBe(2);
    const byMat = new Map<string, any>();
    for (const p of out.parts ?? []) {
      expect(p.geo.positions.length).toBeGreaterThan(0);   // real per-part geometry
      byMat.set(p.appearance?.material ?? '', p.appearance);
    }
    // Distinct materials assigned to distinct subparts (not one merged material).
    expect(byMat.get('steel')?.colorOuter?.toLowerCase()).toBe(M_STEEL);
    expect(byMat.get('brass')?.colorOuter?.toLowerCase()).toBe(M_BRASS);
    expect(byMat.size).toBe(2);
  });

  it('CUT view: per-part cut meshes each carry the subpart material on appearance', async () => {
    const { script } = await compilePrimitiveScript(sources.m_asm, 'm_asm', fetchFixture);
    const lut = analyzeParts(sources.m_asm, await resolveDepColors(sources.m_asm, fetchFixture));
    const out = await runCompiledManifold(script, [], { parts: lut, cutaway: true });

    expect(out.cutParts?.length).toBe(2);
    const mats = new Set((out.cutParts ?? []).map((p) => p.appearance?.material));
    expect(mats).toEqual(new Set(['steel', 'brass']));
    // The cut mesh carries vertex colours (section grey / outer tint) — the same
    // `cutVC`/vertexColors branch the scene's per-part-cut arm renders.
    expect((out.cutParts?.[0].geo.colors?.length ?? 0)).toBeGreaterThan(0);
  });

  it('parts + appearance survive serialize → deserialize (transport to the scene)', async () => {
    const { script } = await compilePrimitiveScript(sources.m_asm, 'm_asm', fetchFixture);
    const lut = analyzeParts(sources.m_asm, await resolveDepColors(sources.m_asm, fetchFixture));
    const out = await runCompiledManifold(script, [], { parts: lut, cutaway: false });
    const back = deserializeComponentResult(out);
    expect(back.parts?.length).toBe(2);
    expect(sortedKeys(back.parts!.map((p) => p.appearance))).toEqual(sortedKeys(out.parts!.map((p) => p.appearance)));
    expect(back.parts?.[0].geo.getAttribute('position')).toBeTruthy();
  });
});

// ── the SAME assembly as a graph, so TF resolves per-part appearance (oracle) ──
function tfGraph(): Graph {
  return {
    nodes: {
      n_root: { id: 'n_root', type: 'list', children: ['n_A', 'n_Bmv'] },
      n_A: { id: 'n_A', type: 'call', src: 'r_cuboid', alias: 'A', args: { w: { kind: 'literal', value: 3 }, h: { kind: 'literal', value: 3 }, d: { kind: 'literal', value: 3 } } },
      n_B: { id: 'n_B', type: 'call', src: 'r_cuboid', alias: 'B', args: { w: { kind: 'literal', value: 3 }, h: { kind: 'literal', value: 3 }, d: { kind: 'literal', value: 3 } } },
      n_Bmv: { id: 'n_Bmv', type: 'mv', child: 'n_B', offset: [{ kind: 'literal', value: 8 }, { kind: 'literal', value: 0 }, { kind: 'literal', value: 0 }] },
      n_mat_steel: { id: 'n_mat_steel', type: 'material', colorOuter: M_STEEL, material: 'steel' },
      n_mat_brass: { id: 'n_mat_brass', type: 'material', colorOuter: M_BRASS, material: 'brass' },
    },
    root: 'n_root',
    params: {},
    edges: [],
    imports: [],
    layout: {},
    materialBindings: { n_A: 'n_mat_steel', n_B: 'n_mat_brass' },
  } as unknown as Graph;
}

describe('per-part material — MF ↔ TF appearance parity (TF is the oracle)', () => {
  it('MF and TF assign the SAME material/colour to the SAME two subparts', async () => {
    // TF (oracle): pure graph walk → per-part appearance.
    const recipe = graphToTf(tfGraph());
    expect(recipe.instrs).toHaveLength(2);           // two separate parts (not folded)
    const tfKeys = sortedKeys(recipe.partAppearance ?? []);
    expect(tfKeys).toEqual(sortedKeys([
      { colorOuter: M_STEEL, material: 'steel' },
      { colorOuter: M_BRASS, material: 'brass' },
    ]));

    // MF: bake the equivalent assembly → per-part appearance.
    const { script } = await compilePrimitiveScript(sources.m_asm, 'm_asm', fetchFixture);
    const lut = analyzeParts(sources.m_asm, await resolveDepColors(sources.m_asm, fetchFixture));
    const out = await runCompiledManifold(script, [], { parts: lut, cutaway: false });
    const mfKeys = sortedKeys((out.parts ?? []).map((p) => p.appearance));

    // Equivalent per-part material/colour assignment across the two engines.
    expect(mfKeys).toEqual(tfKeys);
  });
});

describe('hard gate — single-material parts stay byte-identical (no per-part path)', () => {
  it('a single-material LEAF emits NO parts/cutParts — the merged mesh path', async () => {
    // No LUT is passed (analyzeParts on a leaf is INACTIVE → the canvas passes
    // no `parts` option), so the bake stays on the merged full/cutVC path.
    const { script } = await compilePrimitiveScript(sources.m_steel, 'm_steel', fetchFixture);
    const out = await runCompiledManifold(script, { a: 3 }, { cutaway: true });
    expect(out.parts).toBeUndefined();
    expect(out.cutParts).toBeUndefined();
    expect(out.full.positions.length).toBeGreaterThan(0); // merged mesh unchanged
  });

  it('analyzeParts is INACTIVE for a leaf (→ no LUT → no per-part meshes)', () => {
    expect(analyzeParts(sources.m_steel).active).toBe(false);
  });
});

describe('BREP — structurally single-merged (no per-part path in the adapter)', () => {
  // The BREP server (`brep-occt.ts`) fuses/compounds every subpart into ONE OCCT
  // solid before tessellating, so the response carries no per-part / per-material
  // data. The adapter therefore returns a single merged geometry and can never
  // feed the scene's per-part arm. Per-part BREP needs a SERVER change (emit
  // per-part geometry) — out of scope (brep-occt.ts is off-limits here).
  const solidResponse = {
    supported: true as const,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    index: [0, 1, 2],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    cut: false,
  };
  const cutResponse = {
    supported: true as const,
    positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
    colors: [0.8, 0.06, 0.06, 0.8, 0.06, 0.06, 0.45, 0.45, 0.45],
    normals: [0, 0, 1, 0, 0, 1, 0, 0, 1],
    cut: true,
  };

  it('brepResponseToGeo emits a single { full } / { cutVC } — never parts/cutParts', () => {
    const solidGeo = brepResponseToGeo(solidResponse) as any;
    expect(solidGeo.full).toBeTruthy();
    expect(solidGeo.parts).toBeUndefined();
    expect(solidGeo.cutParts).toBeUndefined();

    const cutGeo = brepResponseToGeo(cutResponse) as any;
    expect(cutGeo.cutVC).toBeTruthy();
    expect(cutGeo.parts).toBeUndefined();
    expect(cutGeo.cutParts).toBeUndefined();
  });

  it('a multi-material assembly bakes to ONE merged OCCT mesh (no per-part fields)', async () => {
    const mesh: any = await brepFromSource(sources.m_asm, {}, { cut: false }, fetchFixture);
    expect(mesh).toBeTruthy();
    expect(mesh.positions.length).toBeGreaterThan(0);
    // No per-part breakdown exists on the BREP response — one fused mesh.
    expect(mesh.parts).toBeUndefined();
    expect(mesh.cutParts).toBeUndefined();
  });
});
