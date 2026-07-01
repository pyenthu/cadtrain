import { describe, it, expect } from 'vitest';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { analyzeParts, resolveDepColors } from '$lib/server/part-colors';
import { runCompiledManifold } from './bake-worker-core';

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
