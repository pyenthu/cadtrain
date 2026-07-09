/**
 * engine-cache-bust.test.ts — N4 end-to-end: a geometry-engine edit invalidates
 * BOTH persistent bake caches automatically (no manual KERNEL_VERSION bump).
 *
 *   - SERVER cache: `hashBakeKey` (bake-cache.ts) folds ENGINE_HASH directly.
 *   - CLIENT cache: `bakeCacheKey` (bake-worker-core.ts) keys on `scriptHash`,
 *     and `compilePrimitiveScript` folds ENGINE_HASH into `scriptHash` — so the
 *     client key moves without the worker computing anything.
 *
 * Both key builders take the engine hash as a defaulted arg so the test can drive
 * two engine states ('ENGINE_A' vs 'ENGINE_B') WITHOUT editing real engine files
 * — the "mutate an engine source fixture → assert the key moves" check, made
 * deterministic. The production default (the real ENGINE_HASH) is asserted too.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { hashBakeKey } from '$lib/server/bake-cache';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import { bakeCacheKey } from './bake-worker-core';
import { ENGINE_HASH } from './engine-hash';

// A real leaf engine (no meta.uses) so compile needs no dep fetch.
const R_CUBOID = readFileSync(resolve('src/lib/cad/stdlib/r_cuboid.ts'), 'utf8');
const noFetch = (async () => { throw new Error('no dep fetch expected'); }) as unknown as typeof fetch;

const PARAMS = [2, 3, 4];
const OPTS = { zScale: 0.5, cutaway: true } as const;

describe('N4 — server bake cache (hashBakeKey)', () => {
  it('key MOVES when the engine hash changes (an engine fix busts the cache)', () => {
    const a = hashBakeKey(R_CUBOID, 'r_cuboid', PARAMS, OPTS, 'ENGINE_A');
    const b = hashBakeKey(R_CUBOID, 'r_cuboid', PARAMS, OPTS, 'ENGINE_B');
    expect(a).not.toBe(b);
  });

  it('key is DETERMINISTIC for a fixed engine hash (test #3)', () => {
    const a = hashBakeKey(R_CUBOID, 'r_cuboid', PARAMS, OPTS, 'ENGINE_A');
    const b = hashBakeKey(R_CUBOID, 'r_cuboid', PARAMS, OPTS, 'ENGINE_A');
    expect(a).toBe(b);
  });

  it('key does NOT move when nothing engine-relevant changed (test #2)', () => {
    // Identical body/params/options/engineHash → identical key. An edit to a
    // NON-engine module leaves ENGINE_HASH unchanged, so this key is unchanged.
    const a = hashBakeKey(R_CUBOID, 'r_cuboid', PARAMS, OPTS, ENGINE_HASH);
    const b = hashBakeKey(R_CUBOID, 'r_cuboid', PARAMS, OPTS, ENGINE_HASH);
    expect(a).toBe(b);
  });

  it('the production default folds in the real ENGINE_HASH', () => {
    expect(hashBakeKey(R_CUBOID, 'r_cuboid', PARAMS, OPTS))
      .toBe(hashBakeKey(R_CUBOID, 'r_cuboid', PARAMS, OPTS, ENGINE_HASH));
  });
});

describe('N4 — client IndexedDB cache (scriptHash → bakeCacheKey)', () => {
  it('scriptHash MOVES when the engine hash changes, but the script TEXT does not', async () => {
    const a = await compilePrimitiveScript(R_CUBOID, 'r_cuboid', noFetch, 'ENGINE_A');
    const b = await compilePrimitiveScript(R_CUBOID, 'r_cuboid', noFetch, 'ENGINE_B');
    expect(a.scriptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(b.scriptHash).not.toBe(a.scriptHash);
    // The compiled body is byte-identical — only its hash advances (the point:
    // an engine edit is invisible to the script text, yet must bust the cache).
    expect(b.script).toBe(a.script);
  });

  it('the client bake key MOVES because scriptHash moved', async () => {
    const a = await compilePrimitiveScript(R_CUBOID, 'r_cuboid', noFetch, 'ENGINE_A');
    const b = await compilePrimitiveScript(R_CUBOID, 'r_cuboid', noFetch, 'ENGINE_B');
    expect(bakeCacheKey(a.scriptHash, PARAMS, OPTS)).not.toBe(bakeCacheKey(b.scriptHash, PARAMS, OPTS));
  });

  it('the production default folds in the real ENGINE_HASH', async () => {
    const s1 = (await compilePrimitiveScript(R_CUBOID, 'r_cuboid', noFetch)).scriptHash;
    const s2 = (await compilePrimitiveScript(R_CUBOID, 'r_cuboid', noFetch, ENGINE_HASH)).scriptHash;
    expect(s1).toBe(s2);
  });
});

describe('N4 — server AND client keys move TOGETHER (test #4)', () => {
  it('one engine change busts both the server and client cache keys', async () => {
    const serverA = hashBakeKey(R_CUBOID, 'r_cuboid', PARAMS, OPTS, 'ENGINE_A');
    const serverB = hashBakeKey(R_CUBOID, 'r_cuboid', PARAMS, OPTS, 'ENGINE_B');
    const scriptA = (await compilePrimitiveScript(R_CUBOID, 'r_cuboid', noFetch, 'ENGINE_A')).scriptHash;
    const scriptB = (await compilePrimitiveScript(R_CUBOID, 'r_cuboid', noFetch, 'ENGINE_B')).scriptHash;
    const clientA = bakeCacheKey(scriptA, PARAMS, OPTS);
    const clientB = bakeCacheKey(scriptB, PARAMS, OPTS);

    expect(serverA).not.toBe(serverB); // server FS cache busts
    expect(clientA).not.toBe(clientB); // client IndexedDB cache busts — together
  });
});
