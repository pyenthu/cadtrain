import { describe, it, expect } from 'vitest';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { analyzeParts, resolveDepColors } from '$lib/server/part-colors';
import { runCompiledManifold } from './bake-worker-core';
import { deserializeComponentResult } from './mesh-serial';

const sources: Record<string, string> = {
  t86_red: `export const meta = { id:'t86_red', name:'red', params:{ r:{value:2}, h:{value:4} }, colorOuter:'#cc0000', colorInner:'#661111' };\nexport function t86_red(r, h){ return cyl(h, r); }`,
  t86_blue: `export const meta = { id:'t86_blue', name:'blue', params:{ r:{value:2}, h:{value:4} }, colorOuter:'#1133cc', colorInner:'#111166' };\nexport function t86_blue(r, h){ return cyl(h, r); }`,
  t86_asm: `export const meta = { id:'t86_asm', name:'asm', params:{}, uses:['t86_red','t86_blue'] };\nexport function t86_asm(){ const a = t86_red(2,4); const b = t86_blue(2,4); return a.add(mv(b, [5,0,0])); }`,
};

const alphaSources: Record<string, string> = {
  t61_body: `export const meta = { id:'t61_body', name:'body', params:{ r:{value:2}, h:{value:4} }, colorOuter:'#cc0000', colorInner:'#661111' };\nexport function t61_body(r, h){ return cyl(h, r); }`,
  t61_glass: `export const meta = { id:'t61_glass', name:'glass', opacity:0.15, params:{ r:{value:2}, h:{value:4} }, colorOuter:'#1133cc', colorInner:'#111166' };\nexport function t61_glass(r, h){ return cyl(h, r); }`,
  t61_asm: `export const meta = { id:'t61_asm', name:'asm', params:{}, uses:['t61_body','t61_glass'] };\nexport function t61_asm(){ const a = t61_body(2,4); const b = t61_glass(2,4); return a.add(mv(b, [5,0,0])); }`,
};

const fakeFetch = (async (url: any) => {
  const name = new URL(String(url), 'http://x').searchParams.get('name') ?? '';
  const source = sources[name] ?? alphaSources[name];
  if (source == null) return { ok: false, status: 404, json: async () => ({}) } as any;
  return { ok: true, status: 200, json: async () => ({ source }) } as any;
}) as any;

describe('Manifold bake geo.parts[]', () => {
  it('runCompiledManifold emits parts[] for a tagged composite', async () => {
    const { script } = await compilePrimitiveScript(sources.t86_asm, 't86_asm', fakeFetch);
    const lut = analyzeParts(sources.t86_asm, await resolveDepColors(sources.t86_asm, fakeFetch));
    const out = await runCompiledManifold(script, [], { parts: lut, cutaway: false });
    expect(out.parts?.length).toBe(2);
    for (const p of out.parts ?? []) {
      expect(p.geo.positions.length).toBeGreaterThan(0);
      expect(p.geo.colors).toBeUndefined();
      expect(p.appearance?.colorOuter).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it('carries per-subpart opacity on appearance (not baked into part mesh colours)', async () => {
    const { script } = await compilePrimitiveScript(alphaSources.t61_asm, 't61_asm', fakeFetch);
    const lut = analyzeParts(alphaSources.t61_asm, await resolveDepColors(alphaSources.t61_asm, fakeFetch));
    const out = await runCompiledManifold(script, [], { parts: lut, cutaway: false });
    const glass = out.parts?.find((p) => (p.appearance?.opacity ?? 1) < 1);
    expect(glass?.appearance?.opacity).toBeCloseTo(0.15, 5);
    expect(glass?.geo.colors).toBeUndefined();
  });

  it('emits cutParts[] when cutaway is on', async () => {
    const { script } = await compilePrimitiveScript(sources.t86_asm, 't86_asm', fakeFetch);
    const lut = analyzeParts(sources.t86_asm, await resolveDepColors(sources.t86_asm, fakeFetch));
    const out = await runCompiledManifold(script, [], { parts: lut, cutaway: true });
    expect(out.cutParts?.length).toBeGreaterThan(0);
    expect((out.cutParts?.[0].geo.colors?.length ?? 0)).toBeGreaterThan(0);
  });

  it('round-trips parts through serialize → deserialize', async () => {
    const { script } = await compilePrimitiveScript(sources.t86_asm, 't86_asm', fakeFetch);
    const lut = analyzeParts(sources.t86_asm, await resolveDepColors(sources.t86_asm, fakeFetch));
    const out = await runCompiledManifold(script, [], { parts: lut, cutaway: false });
    const back = deserializeComponentResult(out);
    expect(back.parts?.length).toBe(2);
    expect(back.parts?.[0].appearance?.colorOuter).toBe(out.parts![0].appearance?.colorOuter);
    expect(back.parts?.[0].geo.getAttribute('position')).toBeTruthy();
  });

  it('leaf part without LUT has no parts key', async () => {
    const { script } = await compilePrimitiveScript(sources.t86_red, 't86_red', fakeFetch);
    const out = await runCompiledManifold(script, [2, 4], { cutaway: false });
    expect(out.parts).toBeUndefined();
  });
});
