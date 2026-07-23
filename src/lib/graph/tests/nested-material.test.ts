import { describe, it, expect } from 'vitest';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { analyzeParts, resolveDepColors } from '$lib/server/part-colors';
import { runCompiledManifold } from '$lib/engines/manifold/bake-worker-core';

// #947 — a part's OWN internal per-sub-part materials must survive when it is nested
// as an element inside a LARGER assembly (the packer-blob bug). A completion Calls
// `nm_packer` (an assembly = blue seal + brown body); baked STANDALONE the packer shows
// both colours, but nested one Call deeper the old `__tag` COLLAPSED the seal+body runs
// to one colour → a flat blob. The fix: `__tagNest` preserves the callee's named runs,
// namespaced (partNestId), + the LUT composes matching entries so both colours render.
//
// Self-contained (inline sources + a fake dep-source fetch), Manifold runs in Node.
const sources: Record<string, string> = {
  nm_seal:  `export const meta = { id:'nm_seal', name:'seal', params:{ r:{value:2}, h:{value:2} }, colorOuter:'#1133cc', colorInner:'#111166' };\nexport function nm_seal(r, h){ return cyl(h, r); }`,
  nm_body:  `export const meta = { id:'nm_body', name:'body', params:{ r:{value:2}, h:{value:2} }, colorOuter:'#cc7722', colorInner:'#663311' };\nexport function nm_body(r, h){ return cyl(h, r); }`,
  // the PACKER — an assembly of a blue seal + a brown body (disjoint so both survive).
  nm_packer: `export const meta = { id:'nm_packer', name:'packer', params:{}, uses:['nm_seal','nm_body'] };\nexport function nm_packer(){ const seal = nm_seal(2,2); const body = nm_body(2,2); return seal.add(mv(body, [6,0,0])); }`,
  // the COMPLETION — Calls the packer as ONE nested element (+ a plain leaf for contrast).
  nm_comp: `export const meta = { id:'nm_comp', name:'comp', params:{}, uses:['nm_packer','nm_body'] };\nexport function nm_comp(){ const E = nm_packer(); const L = nm_body(2,2); return E.add(mv(L, [0,12,0])); }`,
};
const fakeFetch = (async (url: any) => {
  const name = new URL(String(url), 'http://x').searchParams.get('name') ?? '';
  const source = sources[name];
  if (source == null) return { ok: false, status: 404, json: async () => ({}) } as any;
  return { ok: true, status: 200, json: async () => ({ source }) } as any;
}) as any;

const distinctColours = (out: any): Set<string> => {
  const cols = out.full.colors ?? [];
  const pos = out.full.positions ?? [];
  const nv = pos.length / 3;
  const comps = nv ? cols.length / nv : 3;
  const set = new Set<string>();
  for (let v = 0; v < nv; v++) {
    const i = v * comps;
    set.add([cols[i], cols[i + 1], cols[i + 2]].map((x: number) => Math.round(x * 255)).join(','));
  }
  return set;
};
const has = (set: Set<string>, r: number, g: number, b: number) =>
  [...set].some((s) => { const [R, G, B] = s.split(',').map(Number); return Math.abs(R - r) < 24 && Math.abs(G - g) < 24 && Math.abs(B - b) < 24; });

describe('#947 nested-assembly per-sub-part material transmission', () => {
  it('resolveDepColors attaches the packer dep its FULL childLut (multi-part)', async () => {
    const dep = await resolveDepColors(sources.nm_comp, fakeFetch);
    expect(dep.nm_packer?.childLut).toBeTruthy();
    // the packer's own LUT has ≥2 coloured sub-parts (seal + body)
    expect(Object.keys(dep.nm_packer!.childLut!.outer).length).toBeGreaterThanOrEqual(2);
    // a leaf dep (nm_body) has NO childLut
    expect(dep.nm_body?.childLut).toBeUndefined();
  });

  it('the completion bakes the packer\'s blue seal AND brown body (not a flat blob)', async () => {
    const { script } = await compilePrimitiveScript(sources.nm_comp, 'nm_comp', fakeFetch);
    expect(script).toContain('__tagNest(');   // the nested-preserving tagger is spliced
    const parts = analyzeParts(sources.nm_comp, await resolveDepColors(sources.nm_comp, fakeFetch));
    const out = await runCompiledManifold(script, [], { parts });
    const cols = distinctColours(out);
    expect(has(cols, 0x11, 0x33, 0xcc)).toBe(true);  // the packer's BLUE seal survived nesting
    expect(has(cols, 0xcc, 0x77, 0x22)).toBe(true);  // the packer's BROWN body survived nesting
  });

  it('a parent OVERRIDE on the nested element wins — the whole packer takes one colour', async () => {
    // completion sets instanceColors on the packer element E → steel-grey; both the
    // seal + body nested runs should take that ONE override colour (override precedence).
    const withOverride = sources.nm_comp.replace(
      `params:{}, uses:['nm_packer','nm_body'] }`,
      `params:{}, uses:['nm_packer','nm_body'], instanceColors:{ E:{ outer:'#8a929c' } } }`,
    );
    const dep = await resolveDepColors(withOverride, fakeFetch);
    const parts = analyzeParts(withOverride, dep);
    const { script } = await compilePrimitiveScript(withOverride, 'nm_comp', fakeFetch);
    const out = await runCompiledManifold(script, [], { parts });
    const cols = distinctColours(out);
    expect(has(cols, 0x8a, 0x92, 0x9c)).toBe(true);   // the override grey is present
    expect(has(cols, 0x11, 0x33, 0xcc)).toBe(false);  // the seal's OWN blue is gone (override wins)
  });
});
