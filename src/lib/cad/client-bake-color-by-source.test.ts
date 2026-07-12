import { describe, it, expect } from 'vitest';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { analyzeParts, resolveDepColors } from '$lib/server/part-colors';
import { runCompiledManifold } from '$lib/engines/manifold/bake-worker-core';

// #86 — end-to-end proof that the CLIENT-exec bake (compile → runCompiledManifold)
// tints each subpart in its OWN authored colour, matching the server /preview
// path. Self-contained (inline sources + a fake dep-source fetch) so it does not
// depend on any on-disk volume fixture. Regression guard for the two links this
// feature added on the client side:
//   1. assemblePrimitiveBody must splice `__tag(...)` even when meta is stripped
//      (the compiler path) — else client geometry carries no source IDs.
//   2. runCompiledManifold must forward options.parts to finalizeManifold.
const sources: Record<string, string> = {
  t86_red: `export const meta = { id:'t86_red', name:'red', params:{ r:{value:2}, h:{value:4} }, colorOuter:'#cc0000', colorInner:'#661111' };\nexport function t86_red(r, h){ return cyl(h, r); }`,
  t86_blue: `export const meta = { id:'t86_blue', name:'blue', params:{ r:{value:2}, h:{value:4} }, colorOuter:'#1133cc', colorInner:'#111166' };\nexport function t86_blue(r, h){ return cyl(h, r); }`,
  t86_asm: `export const meta = { id:'t86_asm', name:'asm', params:{}, uses:['t86_red','t86_blue'] };\nexport function t86_asm(){ const a = t86_red(2,4); const b = t86_blue(2,4); return a.add(mv(b, [5,0,0])); }`,
};
const fakeFetch = (async (url: any) => {
  const name = new URL(String(url), 'http://x').searchParams.get('name') ?? '';
  const source = sources[name];
  if (source == null) return { ok: false, status: 404, json: async () => ({}) } as any;
  return { ok: true, status: 200, json: async () => ({ source }) } as any;
}) as any;

describe('#86 client-bake core applies the subpart LUT', () => {
  it('runCompiledManifold(parts) tints each subpart its own colour', async () => {
    const { script } = await compilePrimitiveScript(sources.t86_asm, 't86_asm', fakeFetch);
    // The compiled (meta-stripped) script must still carry instance tags.
    expect(script).toContain('__tag(');
    const parts = analyzeParts(sources.t86_asm, await resolveDepColors(sources.t86_asm, fakeFetch));
    const out = await runCompiledManifold(script, [], { parts });
    const cols = out.full.colors ?? [];
    const set = new Set<string>();
    for (let i = 0; i < cols.length; i += 3) set.add([cols[i], cols[i + 1], cols[i + 2]].map((x) => Math.round(x * 255)).join(','));
    const has = (r: number, g: number, b: number) => [...set].some((s) => { const [R, G, B] = s.split(',').map(Number); return Math.abs(R - r) < 20 && Math.abs(G - g) < 20 && Math.abs(B - b) < 20; });
    expect(has(0xcc, 0, 0)).toBe(true);       // red subpart
    expect(has(0x11, 0x33, 0xcc)).toBe(true); // blue subpart
  });
});

// #61 G-MAT1 stage C — per-SUBPART opacity. A composed assembly where ONE
// subpart carries meta.opacity < 1 must bake a 4-component (RGBA) colour
// attribute: that subpart's vertices at its alpha, every other subpart at 1.0.
// This is what lets a well render a transparent open-hole beside an opaque
// casing/cement/tubing in ONE welded mesh.
const alphaSources: Record<string, string> = {
  // opaque body — no meta.opacity
  t61_body: `export const meta = { id:'t61_body', name:'body', params:{ r:{value:2}, h:{value:4} }, colorOuter:'#cc0000', colorInner:'#661111' };\nexport function t61_body(r, h){ return cyl(h, r); }`,
  // transparent subpart — meta.opacity 0.15 (the open-hole analogue)
  t61_glass: `export const meta = { id:'t61_glass', name:'glass', opacity:0.15, params:{ r:{value:2}, h:{value:4} }, colorOuter:'#1133cc', colorInner:'#111166' };\nexport function t61_glass(r, h){ return cyl(h, r); }`,
  t61_asm: `export const meta = { id:'t61_asm', name:'asm', params:{}, uses:['t61_body','t61_glass'] };\nexport function t61_asm(){ const a = t61_body(2,4); const b = t61_glass(2,4); return a.add(mv(b, [5,0,0])); }`,
};
const alphaFetch = (async (url: any) => {
  const name = new URL(String(url), 'http://x').searchParams.get('name') ?? '';
  const source = alphaSources[name];
  if (source == null) return { ok: false, status: 404, json: async () => ({}) } as any;
  return { ok: true, status: 200, json: async () => ({ source }) } as any;
}) as any;

describe('#61 stage C — per-subpart alpha in the color LUT → RGBA vertex attr', () => {
  it('resolveDepColors carries each dep meta.opacity; analyzeParts folds it into the LUT', async () => {
    const depColors = await resolveDepColors(alphaSources.t61_asm, alphaFetch);
    expect(depColors.t61_glass?.opacity).toBeCloseTo(0.15, 5);
    expect(depColors.t61_body?.opacity).toBeUndefined(); // opaque → no entry
    const lut = analyzeParts(alphaSources.t61_asm, depColors);
    const alphas = Object.values(lut.opacity);
    expect(alphas.some((v) => Math.abs(v - 0.15) < 1e-6)).toBe(true); // glass subpart
    expect(alphas.every((v) => v < 1)).toBe(true);                    // opaque body omitted
  });

  it('runCompiledManifold(parts) bakes a 4-component colour attr: glass verts at α≈0.15, body at 1.0', async () => {
    const { script } = await compilePrimitiveScript(alphaSources.t61_asm, 't61_asm', alphaFetch);
    const parts = analyzeParts(alphaSources.t61_asm, await resolveDepColors(alphaSources.t61_asm, alphaFetch));
    const out = await runCompiledManifold(script, [], { parts });
    const cols = out.full.colors ?? [];
    const pos = out.full.positions ?? [];
    const nv = pos.length / 3;
    expect(nv).toBeGreaterThan(0);
    // RGBA → 4 components per vertex.
    const comps = cols.length / nv;
    expect(comps).toBe(4);
    // Collect the distinct alpha values (rounded) across all vertices.
    const alphaSet = new Set<number>();
    for (let i = 0; i < nv; i++) alphaSet.add(Math.round(cols[i * 4 + 3] * 100) / 100);
    expect([...alphaSet].some((a) => Math.abs(a - 0.15) < 0.02)).toBe(true); // transparent glass
    expect([...alphaSet].some((a) => Math.abs(a - 1.0) < 0.02)).toBe(true);  // opaque body
  });

  it('an all-opaque assembly bakes a 3-component (RGB) attr — byte-identical to pre-alpha', async () => {
    // Reuse the original red/blue asm (neither has meta.opacity).
    const { script } = await compilePrimitiveScript(sources.t86_asm, 't86_asm', fakeFetch);
    const parts = analyzeParts(sources.t86_asm, await resolveDepColors(sources.t86_asm, fakeFetch));
    expect(Object.keys(parts.opacity).length).toBe(0); // no transparent subpart
    const out = await runCompiledManifold(script, [], { parts });
    const cols = out.full.colors ?? [];
    const nv = (out.full.positions ?? []).length / 3;
    expect(cols.length / nv).toBe(3); // RGB, no alpha channel
  });
});
