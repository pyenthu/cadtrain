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
