import { beforeEach, describe, it, expect } from 'vitest';
import { analyzeParts, resolveDepColors } from './part-colors';
import { _resetDepSourceCacheForTest } from './primitive-loader';
import { partHashId } from '$lib/cad/part-id';

// A minimal recognizable composed part: two named instances whose calls are
// declared in meta.uses, combined with .add — exactly the shape
// recognizeComposite + tagInstanceSources drive color-by-source from.
const COMPOSED = `
export const meta = {
  id: 'test_asm',
  name: 'test asm',
  params: {},
  uses: ['g_alpha', 'g_beta'],
};
export function test_asm() {
  const body = g_alpha(1);
  const cap = g_beta(2);
  return body.add(cap);
}
`;

describe('#86 analyzeParts — subpart-own colours via depColors', () => {
  it('is active and colours each instance by its dep colour', () => {
    const lut = analyzeParts(COMPOSED, {
      g_alpha: { outer: '#111111' },
      g_beta: { outer: '#222222', inner: '#333333' },
    });
    expect(lut.active).toBe(true);
    expect(lut.outer[partHashId('body')]).toBe('#111111');
    expect(lut.outer[partHashId('cap')]).toBe('#222222');
    expect(lut.inner[partHashId('cap')]).toBe('#333333');
  });

  it('parent meta.instanceColors override still wins over the dep colour', () => {
    const src = COMPOSED.replace(
      'params: {},',
      `params: {}, instanceColors: { body: '#abcdef' },`,
    );
    const lut = analyzeParts(src, { g_alpha: { outer: '#111111' } });
    expect(lut.outer[partHashId('body')]).toBe('#abcdef');
  });

  it('no depColors → falls back to the deterministic palette (pre-#86 behaviour)', () => {
    const bare = analyzeParts(COMPOSED);
    const withDeps = analyzeParts(COMPOSED, {});
    expect(bare.active).toBe(true);
    // Empty map behaves identically to omitting it entirely.
    expect(withDeps.outer[partHashId('body')]).toBe(bare.outer[partHashId('body')]);
    // Palette colour is a real hex, not the dep colour.
    expect(bare.outer[partHashId('body')]).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('a leaf part (no uses) is INACTIVE', () => {
    const leaf = `export const meta = { id: 'x', name: 'x', params: {} };\nexport function x() { return cyl(1, 1); }`;
    expect(analyzeParts(leaf).active).toBe(false);
  });
});

describe('#86 resolveDepColors — harvest each dep meta colour', () => {
  // resolveDepColors reads through the loader's 30s TTL dep-source cache, which
  // is module state shared across tests: without this, a dep fetched by an
  // earlier test is still cached and the fakeFetch below never gets consulted.
  beforeEach(() => _resetDepSourceCacheForTest());

  const fakeFetch = (byId: Record<string, string>): typeof globalThis.fetch =>
    (async (url: any) => {
      const name = new URL(String(url), 'http://x').searchParams.get('name') ?? '';
      const source = byId[name];
      if (source == null) return { ok: false, status: 404, json: async () => ({}) } as any;
      return { ok: true, status: 200, json: async () => ({ source }) } as any;
    }) as any;

  it('reads colorOuter/colorInner and material.color from dep sources', async () => {
    const fetchFn = fakeFetch({
      g_alpha: `export const meta = { id:'g_alpha', name:'a', params:{}, colorOuter:'#aa0000', colorInner:'#00aa00' };\nexport function g_alpha(){ return cyl(1,1); }`,
      g_beta: `export const meta = { id:'g_beta', name:'b', params:{}, material:{ color:'#0000bb' } };\nexport function g_beta(){ return cyl(1,1); }`,
    });
    const map = await resolveDepColors(COMPOSED, fetchFn);
    expect(map.g_alpha).toEqual({ outer: '#aa0000', inner: '#00aa00' });
    // material.color fills both sides when no explicit colorOuter/Inner.
    expect(map.g_beta).toEqual({ outer: '#0000bb', inner: '#0000bb' });
  });

  it('tolerates an unreadable dep (omits it)', async () => {
    const map = await resolveDepColors(COMPOSED, fakeFetch({}));
    expect(map).toEqual({});
  });
});

// #86 own-colour precedence — a part's OWN explicit meta.colorOuter/colorInner
// must beat the colour it INHERITS from its body's dep. The reported bug:
// `bw_casing` (colorOuter set) built on `g_shaft` (colorOuter green) rendered
// GREEN because the inherited dep colour shadowed the part's own colour, and
// editing the part colour "did nothing". Mirrors the real graph shape: two
// g_shaft instances (A body, B bore) combined with A.subtract(B).
describe('#86 own-colour precedence — explicit part colour beats inherited dep', () => {
  beforeEach(() => _resetDepSourceCacheForTest());

  const fakeFetch = (byId: Record<string, string>): typeof globalThis.fetch =>
    (async (url: any) => {
      const name = new URL(String(url), 'http://x').searchParams.get('name') ?? '';
      const source = byId[name];
      if (source == null) return { ok: false, status: 404, json: async () => ({}) } as any;
      return { ok: true, status: 200, json: async () => ({ source }) } as any;
    }) as any;

  // g_shaft: a plain part whose ONLY colour is a top-level green Default.
  const G_SHAFT = `export const meta = { id:'g_shaft', name:'g_shaft', kind:'asm', uses:['r_revolve'], colorOuter:'#2ecd23' };\nexport function g_shaft(p){ const A = r_revolve({}); return A; }`;
  // g_shaft_bi: same, but ALSO declares a green inner (for the per-side test).
  const G_SHAFT_BI = `export const meta = { id:'g_shaft', name:'g_shaft', kind:'asm', uses:['r_revolve'], colorOuter:'#2ecd23', colorInner:'#0a5c04' };\nexport function g_shaft(p){ const A = r_revolve({}); return A; }`;
  const R_REVOLVE = `export const meta = { id:'r_revolve', kind:'prim' };\nexport function r_revolve(p){ return null; }`;

  // bw_casing: its OWN colorOuter (red) is set; NO instanceColors. Body A and
  // bore B both call g_shaft, combined A.subtract(B) — exactly the real shape.
  const BW_CASING = `export const meta = { id:'bw_casing', name:'bw_casing', kind:'asm', uses:['g_shaft'], colorOuter:'#460101' };\nexport function bw_casing(p){ const A = g_shaft({r:2}); const B = g_shaft({r:1}); return A.subtract(B); }`;

  it('(a) an explicit part colour beats the colour inherited from its body dep', async () => {
    const fetchFn = fakeFetch({ r_revolve: R_REVOLVE, g_shaft: G_SHAFT, bw_casing: BW_CASING });
    const dep = await resolveDepColors(BW_CASING, fetchFn);
    // g_shaft still exports its own green up (inheritance intact at that level).
    expect(dep.g_shaft).toEqual({ outer: '#2ecd23' });
    const lut = analyzeParts(BW_CASING, dep);
    expect(lut.active).toBe(true);
    // Both instances + the body colour render in bw_casing's OWN red, NOT g_shaft green.
    expect(lut.outer[partHashId('A')]).toBe('#460101');
    expect(lut.outer[partHashId('B')]).toBe('#460101');
    expect(lut.bodyColor).toBe('#460101');
    expect(lut.appearance[partHashId('A')].colorOuter).toBe('#460101');
  });

  it('(b) inheritance still works when the intermediate part sets NO colour', async () => {
    // bw_plain has no colorOuter of its own → g_shaft's green must carry up.
    const BW_PLAIN = `export const meta = { id:'bw_plain', name:'bw_plain', kind:'asm', uses:['g_shaft'] };\nexport function bw_plain(p){ const A = g_shaft({r:2}); return A; }`;
    const fetchFn = fakeFetch({ r_revolve: R_REVOLVE, g_shaft: G_SHAFT, bw_plain: BW_PLAIN });
    const dep = await resolveDepColors(BW_PLAIN, fetchFn);
    const lut = analyzeParts(BW_PLAIN, dep);
    expect(lut.outer[partHashId('A')]).toBe('#2ecd23'); // inherited green
    expect(lut.bodyColor).toBe('#2ecd23');
  });

  it('(c) per-side — part sets only colorOuter → colorInner still inherited from the dep', async () => {
    // bw_casing sets colorOuter (red) only; g_shaft_bi provides BOTH outer+inner.
    const fetchFn = fakeFetch({ r_revolve: R_REVOLVE, g_shaft: G_SHAFT_BI, bw_casing: BW_CASING });
    const dep = await resolveDepColors(BW_CASING, fetchFn);
    expect(dep.g_shaft).toEqual({ outer: '#2ecd23', inner: '#0a5c04' });
    const lut = analyzeParts(BW_CASING, dep);
    // outer = the part's own red; inner = still the dep's inherited green.
    expect(lut.outer[partHashId('A')]).toBe('#460101');
    expect(lut.inner[partHashId('A')]).toBe('#0a5c04');
    expect(lut.bodyColor).toBe('#460101');
    expect(lut.bodyInner).toBe('#0a5c04');
    const app = lut.appearance[partHashId('A')];
    expect(app.colorOuter).toBe('#460101');
    expect(app.colorInner).toBe('#0a5c04');
  });

  it('(d) a parent per-instance override still beats the part own colour', async () => {
    // bw_casing sets colorOuter red AND instanceColors.A grey → the per-instance
    // override is more specific and wins for A; B (no override) takes the red.
    const BW_MIXED = `export const meta = { id:'bw_casing', name:'bw_casing', kind:'asm', uses:['g_shaft'], colorOuter:'#460101', instanceColors:{ A:{ outer:'#dddddd' } } };\nexport function bw_casing(p){ const A = g_shaft({r:2}); const B = g_shaft({r:1}); return A.subtract(B); }`;
    const fetchFn = fakeFetch({ r_revolve: R_REVOLVE, g_shaft: G_SHAFT, bw_casing: BW_MIXED });
    const dep = await resolveDepColors(BW_MIXED, fetchFn);
    const lut = analyzeParts(BW_MIXED, dep);
    expect(lut.outer[partHashId('A')]).toBe('#dddddd'); // per-instance override wins
    expect(lut.outer[partHashId('B')]).toBe('#460101'); // part own colour beats dep green
  });
});
