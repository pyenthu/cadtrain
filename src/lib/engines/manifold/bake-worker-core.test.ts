/**
 * bake-worker-core.test.ts — adapter test for the PR2 client-side Manifold
 * executor (docs/plans/client-side-execution.md §9 "PR2").
 *
 * vitest runs Manifold in Node, loading the SAME `manifold.wasm` off disk that
 * the browser worker serves — so this exercises the REAL run → finalize →
 * serialize core (`runCompiledManifold`) against the real kernel. A live browser
 * Worker is hard to spin up in vitest, so per the brief we unit-test the pure
 * core directly (it also documents the contract). The worker (`bake-worker.ts`)
 * is a thin shell that calls exactly this function.
 *
 * Proves:
 *   1. A hand-written `return cyl(...)` script bakes to a valid { full, cutVC }
 *      with non-empty positions (the core works end-to-end against real WASM).
 *   2. A REAL compiled script (r_cuboid via the PR1 compiler) bakes the same way
 *      — the SCRIPT_PRELUDE + __adapt path round-trips client-side.
 *   3. Render options (cutaway tri-state) are honoured like /preview.
 *   4. packTransferable produces typed-array buffers + a transfer list.
 *   5. bakeCacheKey is stable, params/options/hash-sensitive, and order-invariant.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as helpers from './manifold-helpers';
import { compilePrimitiveScript } from '$lib/server/primitive-loader';
import {
  runCompiledManifold,
  packTransferable,
  bakeCacheKey,
  KERNEL_VERSION,
} from './bake-worker-core';
import { deserializeComponentResult } from './mesh-serial';

beforeAll(async () => {
  await helpers.initManifold();
});

// A trivial self-contained script in the SAME shape the compiler emits + the
// server runs: `new Function(...SANDBOX_ARG_NAMES, script)(...values)` returns
// the geom fn, which is then called with params. cyl(height, radius).
const TRIVIAL_SCRIPT = `return function (od, length) { return cyl(length, od / 2); };`;

describe('runCompiledManifold — hand-written script', () => {
  it('bakes a valid { full, cutVC } with non-empty positions', async () => {
    const s = await runCompiledManifold(TRIVIAL_SCRIPT, [4, 10]);
    expect(s.full.positions.length).toBeGreaterThan(0);
    expect(s.full.positions.length % 3).toBe(0);
    // cutaway auto → small body → cross-section computed (non-empty).
    expect(s.cutVC.positions.length).toBeGreaterThan(0);

    // Rehydrates to real THREE.BufferGeometry the scene consumes (PR3 shape).
    const geo = deserializeComponentResult(s as any);
    expect(geo.full.getAttribute('position').count).toBeGreaterThan(0);
    expect(geo.cutVC.getAttribute('position').count).toBeGreaterThan(0);
  });

  it('honours the cutaway tri-state like /preview', async () => {
    const forced = await runCompiledManifold(TRIVIAL_SCRIPT, [4, 10], { cutaway: true });
    expect(forced.cutVC.positions.length).toBeGreaterThan(0);
    const skipped = await runCompiledManifold(TRIVIAL_SCRIPT, [4, 10], { cutaway: false });
    expect(skipped.cutVC.positions.length).toBe(0); // force-skip → empty cross-section
    expect(skipped.full.positions.length).toBeGreaterThan(0);
  });

  it('throws a clean error when the script does not return a function', async () => {
    await expect(runCompiledManifold(`return 42;`, [])).rejects.toThrow(/did not return a geom function/);
  });
});

describe('runCompiledManifold — real compiled primitive (r_cuboid)', () => {
  it('compiles r_cuboid via the PR1 compiler and bakes it client-side', async () => {
    const source = readFileSync(resolve('src/lib/graph/stdlib/r_cuboid.ts'), 'utf8');
    // No deps → fetchFn is never called; a throwing stub proves it.
    const fetchFn = (async () => { throw new Error('no dep fetch expected'); }) as unknown as typeof fetch;
    const { script, scriptHash } = await compilePrimitiveScript(source, 'r_cuboid', fetchFn);
    expect(scriptHash).toMatch(/^[0-9a-f]{64}$/);

    const s = await runCompiledManifold(script, [2, 3, 4]); // w, h, d
    expect(s.full.positions.length).toBeGreaterThan(0);
    expect(s.full.positions.length % 3).toBe(0);

    // A box centered at origin is 2×3×4 → bbox extents match (sanity on the bake).
    const geo = deserializeComponentResult(s as any);
    geo.full.computeBoundingBox();
    const bb = geo.full.boundingBox!;
    expect(bb.max.x - bb.min.x).toBeCloseTo(2, 1);
    expect(bb.max.y - bb.min.y).toBeCloseTo(3, 1);
    expect(bb.max.z - bb.min.z).toBeCloseTo(4, 1);
  });
});

describe('packTransferable', () => {
  it('packs positions onto transferable ArrayBuffers + collects the transfer list', async () => {
    const s = await runCompiledManifold(TRIVIAL_SCRIPT, [4, 10]);
    const { payload, transfer } = packTransferable(s);
    expect(payload.full.positions).toBeInstanceOf(Float32Array);
    expect(transfer.length).toBeGreaterThan(0);
    for (const t of transfer) expect(t).toBeInstanceOf(ArrayBuffer);
    // The full mesh's position buffer must be in the transfer list (zero-copy).
    expect(transfer).toContain((payload.full.positions as unknown as Float32Array).buffer);
    // Round-trips back to geometry unchanged.
    const geo = deserializeComponentResult(payload as any);
    expect(geo.full.getAttribute('position').count).toBe(s.full.positions.length / 3);
  });
});

describe('bakeCacheKey', () => {
  const hashA = 'a'.repeat(64);
  const hashB = 'b'.repeat(64);

  it('is identical for identical inputs and includes the kernel version', () => {
    const k1 = bakeCacheKey(hashA, [1, 2, 3], { zScale: 0.5 });
    const k2 = bakeCacheKey(hashA, [1, 2, 3], { zScale: 0.5 });
    expect(k1).toBe(k2);
    expect(k1.startsWith(KERNEL_VERSION)).toBe(true);
  });

  it('differs on scriptHash, params, or options', () => {
    const base = bakeCacheKey(hashA, [1, 2, 3], { zScale: 0.5 });
    expect(bakeCacheKey(hashB, [1, 2, 3], { zScale: 0.5 })).not.toBe(base); // dep edit → new hash
    expect(bakeCacheKey(hashA, [1, 2, 4], { zScale: 0.5 })).not.toBe(base); // param change
    expect(bakeCacheKey(hashA, [1, 2, 3], { zScale: 0.9 })).not.toBe(base); // option change
  });

  it('is invariant to option key ORDER (stable stringify)', () => {
    const k1 = bakeCacheKey(hashA, [1], { zScale: 0.5, cutaway: true, segments: 32 });
    const k2 = bakeCacheKey(hashA, [1], { segments: 32, cutaway: true, zScale: 0.5 });
    expect(k1).toBe(k2);
  });
});
