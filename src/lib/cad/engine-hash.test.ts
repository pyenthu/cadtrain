/**
 * engine-hash.test.ts — the N4 content hash over the geometry-engine modules.
 *
 * Proves the pure hash is deterministic + sensitive to any engine-source edit,
 * and that the `import.meta.glob` SCOPE is exactly the engine set — so an edit to
 * an UNRELATED module can never enter the digest (the "unrelated edit does NOT
 * change the key" guarantee lives here, structurally: a file not captured can't
 * affect a hash computed only over captured files).
 */
import { describe, it, expect } from 'vitest';
import { hashEngineSources, ENGINE_HASH, ENGINE_SOURCES } from './engine-hash';

describe('hashEngineSources — pure content hash', () => {
  const fixture: Record<string, string> = {
    '/src/lib/cad/manifold-mesh.ts': 'export function gridPatch() { return 1; }',
    '/src/lib/cad/manifold-helpers.ts': 'export const cyl = () => {};',
    '/src/lib/cad/stdlib/r_cuboid.ts': 'export function r_cuboid() {}',
  };

  it('is deterministic — same input → same digest (test #3)', () => {
    expect(hashEngineSources(fixture)).toBe(hashEngineSources(fixture));
  });

  it('returns 16 lowercase hex chars', () => {
    expect(hashEngineSources(fixture)).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is order-invariant (keys sorted before hashing)', () => {
    const reordered: Record<string, string> = {
      '/src/lib/cad/stdlib/r_cuboid.ts': fixture['/src/lib/cad/stdlib/r_cuboid.ts']!,
      '/src/lib/cad/manifold-mesh.ts': fixture['/src/lib/cad/manifold-mesh.ts']!,
      '/src/lib/cad/manifold-helpers.ts': fixture['/src/lib/cad/manifold-helpers.ts']!,
    };
    expect(hashEngineSources(reordered)).toBe(hashEngineSources(fixture));
  });

  it('CHANGES when any engine file CONTENT changes (test #1 — the +cap1/+cut2 fix)', () => {
    const edited = { ...fixture, '/src/lib/cad/manifold-mesh.ts': 'export function gridPatch() { return 2; }' };
    expect(hashEngineSources(edited)).not.toBe(hashEngineSources(fixture));
  });

  it('CHANGES on a whitespace-only edit (content-exact, byte-sensitive)', () => {
    const ws = { ...fixture, '/src/lib/cad/manifold-mesh.ts': fixture['/src/lib/cad/manifold-mesh.ts']! + '\n' };
    expect(hashEngineSources(ws)).not.toBe(hashEngineSources(fixture));
  });

  it('CHANGES when an engine file is added or removed', () => {
    const added = { ...fixture, '/src/lib/cad/warp-spline.ts': 'export const w = 0;' };
    expect(hashEngineSources(added)).not.toBe(hashEngineSources(fixture));
    const { '/src/lib/cad/stdlib/r_cuboid.ts': _drop, ...removed } = fixture;
    expect(hashEngineSources(removed)).not.toBe(hashEngineSources(fixture));
  });

  it('is bundle-path independent (normalizes to the src-relative path)', () => {
    // Same relative path under a different absolute prefix → identical digest, so
    // the SERVER and CLIENT bundles agree even if Vite emits differently-rooted keys.
    const abs: Record<string, string> = {
      '/abs/proj/src/lib/cad/manifold-mesh.ts': fixture['/src/lib/cad/manifold-mesh.ts']!,
      '/abs/proj/src/lib/cad/manifold-helpers.ts': fixture['/src/lib/cad/manifold-helpers.ts']!,
      '/abs/proj/src/lib/cad/stdlib/r_cuboid.ts': fixture['/src/lib/cad/stdlib/r_cuboid.ts']!,
    };
    expect(hashEngineSources(abs)).toBe(hashEngineSources(fixture));
  });
});

describe('ENGINE_SOURCES — glob scope (what an edit CAN and CANNOT touch)', () => {
  const keys = Object.keys(ENGINE_SOURCES);

  it('captures the four named engine modules', () => {
    for (const f of ['manifold-helpers.ts', 'manifold-mesh.ts', 'warp-spline.ts', 'render-helpers.ts']) {
      expect(keys.some((k) => k.endsWith('/' + f))).toBe(true);
    }
  });

  it('captures the stdlib engines (active + stale)', () => {
    expect(keys.some((k) => /\/stdlib\/r_cuboid\.ts$/.test(k))).toBe(true);
    expect(keys.some((k) => /\/stdlib\/stale\//.test(k))).toBe(true);
  });

  it('EXCLUDES co-located stdlib test files (they do not affect baked geometry)', () => {
    expect(keys.some((k) => k.endsWith('.test.ts'))).toBe(false);
  });

  it('EXCLUDES unrelated cad modules — an edit there must NOT move ENGINE_HASH (test #2)', () => {
    for (const unrelated of ['composition-graph.ts', 'bake-client.ts', 'bake-worker-core.ts', 'mesh-serial.ts', 'engine-hash.ts']) {
      expect(keys.some((k) => k.endsWith('/' + unrelated))).toBe(false);
    }
  });

  it('every captured value is source TEXT', () => {
    expect(keys.length).toBeGreaterThan(4);
    for (const k of keys) expect(typeof ENGINE_SOURCES[k]).toBe('string');
  });

  it('ENGINE_HASH is the digest of ENGINE_SOURCES (16 hex)', () => {
    expect(ENGINE_HASH).toMatch(/^[0-9a-f]{16}$/);
    expect(ENGINE_HASH).toBe(hashEngineSources(ENGINE_SOURCES));
  });
});
