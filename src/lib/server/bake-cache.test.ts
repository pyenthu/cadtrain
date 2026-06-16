import { describe, it, expect, beforeEach } from 'vitest';
import { hashBakeKey, type BakeCacheOptions } from './bake-cache';
import { collectDepSources, hashDepSources, _resetDepSourceCacheForTest } from './primitive-loader';

// The "deja-vu" bug: hashBakeKey hashed only the PARENT body + params + options,
// so a parent that composes `meta.uses` deps returned a STALE cached mesh when a
// DEP changed but the parent's own source was byte-identical. The fix folds a
// hash of the resolved dep sources (BakeCacheOptions.depSourcesHash) into the key.

const PARENT = `export const meta = { id:'g_widget', uses:['dep_a'], params:{ od:{default:1} } };
export function g_widget(od) { return dep_a(od); }`;

// A tiny mock of SvelteKit's event.fetch that serves a configurable dep source
// from /api/primitives/source?name=<id>. Lets us flip a dep's body and prove the
// parent's key changes — without touching the volume.
function mockFetch(sources: Record<string, string>): typeof fetch {
  return (async (input: any) => {
    const u = String(typeof input === 'string' ? input : input.url);
    const m = /[?&]name=([^&]+)/.exec(u);
    const id = m ? decodeURIComponent(m[1]) : '';
    const src = sources[id];
    if (src === undefined) {
      return { ok: false, status: 404, json: async () => ({}) } as any;
    }
    return { ok: true, status: 200, json: async () => ({ source: src }) } as any;
  }) as any;
}

describe('hashBakeKey — backward compatibility', () => {
  const params = [1, 2, 3];
  it('drops an undefined depSourcesHash → key identical to the legacy (depless) key', () => {
    const legacy = hashBakeKey(PARENT, 'g_widget', params, { cutaway: true });
    const withUndef = hashBakeKey(PARENT, 'g_widget', params, { cutaway: true, depSourcesHash: undefined });
    expect(withUndef).toBe(legacy);
  });
});

describe('hashBakeKey — dep-aware key', () => {
  const params = [1, 2, 3];
  it('SAME parent + CHANGED dep hash ⇒ DIFFERENT key', () => {
    const a: BakeCacheOptions = { depSourcesHash: 'aaaaaaaaaaaaaaaa' };
    const b: BakeCacheOptions = { depSourcesHash: 'bbbbbbbbbbbbbbbb' };
    expect(hashBakeKey(PARENT, 'g_widget', params, a))
      .not.toBe(hashBakeKey(PARENT, 'g_widget', params, b));
  });
  it('SAME parent + SAME dep hash ⇒ SAME key', () => {
    const a: BakeCacheOptions = { depSourcesHash: 'aaaaaaaaaaaaaaaa' };
    expect(hashBakeKey(PARENT, 'g_widget', params, a))
      .toBe(hashBakeKey(PARENT, 'g_widget', params, { ...a }));
  });
});

describe('collectDepSources / hashDepSources', () => {
  // Each test starts from a cold dep-source cache (the loader's 30s TTL cache
  // is module-level, so it would otherwise leak across tests / fetch versions).
  beforeEach(() => { _resetDepSourceCacheForTest(); });

  it('collects only resolvable (volume) deps, transitively, skipping bundle helpers', async () => {
    // dep_a uses dep_b (volume) + cyl (a bundle helper → 404 from the mock → skipped).
    const dep_a = `export const meta = { id:'dep_a', uses:['dep_b','cyl'] };
export function dep_a(od) { return dep_b(od).add(cyl(1,1)); }`;
    const dep_b = `export function dep_b(od) { return od; }`;
    const map = await collectDepSources(PARENT, mockFetch({ dep_a, dep_b }));
    expect([...map.keys()].sort()).toEqual(['dep_a', 'dep_b']); // cyl skipped (no volume source)
  });

  it('a CHANGED dep source ⇒ DIFFERENT depSourcesHash; UNCHANGED ⇒ identical', async () => {
    const dep_v1 = `export function dep_a(od) { return od; }`;
    const dep_v2 = `export function dep_a(od) { return od * 2; }`; // body changed
    const h1 = await hashDepSources(PARENT, mockFetch({ dep_a: dep_v1 }));
    _resetDepSourceCacheForTest();   // simulate the dep-source TTL expiring after the edit
    const h2 = await hashDepSources(PARENT, mockFetch({ dep_a: dep_v2 }));
    _resetDepSourceCacheForTest();
    const h1again = await hashDepSources(PARENT, mockFetch({ dep_a: dep_v1 }));
    expect(h1).toBeTypeOf('string');
    expect(h2).not.toBe(h1);
    expect(h1again).toBe(h1);
  });

  it('a leaf part (no resolvable deps) ⇒ undefined ⇒ legacy cache key preserved', async () => {
    const LEAF = `export const meta = { id:'r_leaf', params:{} };
export function r_leaf() { return cyl(1,1); }`;
    const h = await hashDepSources(LEAF, mockFetch({}));
    expect(h).toBeUndefined();
    // Folding undefined leaves the parent key byte-identical to the depless key.
    const legacy = hashBakeKey(LEAF, 'r_leaf', [1], {});
    const folded = hashBakeKey(LEAF, 'r_leaf', [1], { depSourcesHash: h });
    expect(folded).toBe(legacy);
  });

  it('end-to-end: a dep change propagates into the PARENT bake key', async () => {
    const mkOpts = async (depBody: string): Promise<BakeCacheOptions> => ({
      cutaway: true,
      depSourcesHash: await hashDepSources(PARENT, mockFetch({ dep_a: depBody })),
    });
    const keyV1 = hashBakeKey(PARENT, 'g_widget', [1, 2, 3], await mkOpts('export function dep_a(o){return o;}'));
    _resetDepSourceCacheForTest();   // simulate the dep-source TTL expiring after the edit
    const keyV2 = hashBakeKey(PARENT, 'g_widget', [1, 2, 3], await mkOpts('export function dep_a(o){return o*3;}'));
    expect(keyV2).not.toBe(keyV1); // dep edit busts the parent's cache → no more deja-vu
  });
});
