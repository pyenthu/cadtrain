import { describe, it, expect, beforeAll } from 'vitest';
import { isManifoldFatalTrap, describeManifoldError } from '../manifold-trap';
import { initManifold, resetManifold, cyl } from '$lib/engines/manifold/manifold-helpers';

describe('isManifoldFatalTrap', () => {
  it('recognises an ALREADY-poisoned singleton', () => {
    // The exact string a poisoned dev server returned on 2026-07-10.
    expect(isManifoldFatalTrap('bake failed: emval_methodCallers[caller] is not a function [in g_shaft → r_revolve({...})]')).toBe(true);
    // 2026-07-11: a corrupted embind type registry reads a GARBAGE type name for a
    // valid arg — this must respawn the worker, not reject-and-keep the bad heap.
    expect(isManifoldFatalTrap('primitive call failed: parameter 0 has unknown type À®')).toBe(true);
    expect(isManifoldFatalTrap('parameter 2 has unbound type N8manifold3vec3E')).toBe(true);
  });

  it('recognises the traps that do the poisoning', () => {
    for (const s of [
      'memory access out of bounds',
      'table index is out of bounds',
      'unreachable',
      'Aborted(). Build with -sASSERTIONS',
      'null function or function signature mismatch',
      'RuntimeError: unreachable',
    ]) expect(isManifoldFatalTrap(s), s).toBe(true);
  });

  it('accepts an Error, a bare abort code, and a WebAssembly.RuntimeError', () => {
    expect(isManifoldFatalTrap(new Error('memory access out of bounds'))).toBe(true);
    expect(isManifoldFatalTrap(1234)).toBe(true);           // raw Emscripten abort
    expect(isManifoldFatalTrap(new WebAssembly.RuntimeError('boom'))).toBe(true);
  });

  it('does NOT fire on ordinary bake errors — a reset would throw away a good module', () => {
    for (const s of [
      'primitive "g_nope" not found',
      'source required',
      'primitive did not return a Manifold',
      'completion 3 has an unmapped tool_comp "MISC.X"',
      'Not manifold',                     // a legitimate CSG rejection, NOT a trap
      'non-positive annulus',
      'invalid JSON body',
    ]) expect(isManifoldFatalTrap(s), s).toBe(false);
  });
});

describe('describeManifoldError', () => {
  it('says plainly that the named part is not the culprit', () => {
    const msg = describeManifoldError('emval_methodCallers[caller] is not a function [in g_shaft → r_revolve()]');
    expect(msg).toMatch(/NOT the culprit/i);
    expect(msg).toMatch(/reset/i);
  });

  it('explains the memory trap and the abort trap', () => {
    expect(describeManifoldError('memory access out of bounds')).toMatch(/out-of-bounds/i);
    expect(describeManifoldError('unreachable')).toMatch(/abort/i);
  });

  it('passes an unrecognised message through unchanged', () => {
    expect(describeManifoldError('primitive not found')).toBe('primitive not found');
  });
});

describe('resetManifold', () => {
  beforeAll(async () => { await initManifold(); }, 120_000);

  it('recovers a singleton that has been genuinely torn down', async () => {
    const G = globalThis as any;
    expect(cyl(10, 2).volume()).toBeGreaterThan(0);      // healthy

    // Simulate the poisoned state: the module reference is gone, exactly as
    // resetManifold leaves it mid-flight. `M` is a live-read Proxy, so every
    // helper now sees `undefined` and throws — the same class of failure a real
    // trap produces.
    G.__cadtrain_manifold__.wasm = null;
    G.__cadtrain_manifold__.M = null;
    expect(() => cyl(10, 2)).toThrow();

    await resetManifold();
    expect(cyl(10, 2).volume()).toBeGreaterThan(0);      // healthy again
  }, 120_000);

  it('leaves a working singleton working (idempotent)', async () => {
    await resetManifold();
    await resetManifold();
    expect(cyl(10, 2).volume()).toBeGreaterThan(0);
  }, 120_000);
});

/**
 * The classification `/api/primitives/preview` now depends on (2026-07-10).
 *
 * Its finalize catch used to `return json({...}, {status:400})` for EVERY failure.
 * A `return` is not a throw, so `withManifoldTrapGuard` never ran and the poisoned
 * singleton was never reset — one trap on well 09 made every LATER bake fail with
 * 09's stale message, naming an innocent part. The fix rethrows when (and only
 * when) the failure is a fatal trap, so the guard resets and answers 500.
 *
 * These pin both directions. A false NEGATIVE re-opens the poison cascade; a false
 * POSITIVE turns an ordinary geometry rejection into a needless WASM re-init.
 */
describe('preview trap-vs-geometry classification', () => {
  it('MATCHES the real trap messages observed in the wild', () => {
    // well 09 (hpht), finalizeManifold
    expect(isManifoldFatalTrap(new Error('null function or function signature mismatch'))).toBe(true);
    // the poisoned-module echo every later request produced
    expect(isManifoldFatalTrap(new Error('memory access out of bounds [in g_shaft → r_revolve({profile:?})]'))).toBe(true);
    // the browser worker's trap
    expect(isManifoldFatalTrap(new Error('emval_methodCallers[caller] is not a function'))).toBe(true);
  });

  it('does NOT match ordinary geometry rejections — those keep their 400', () => {
    // The empty-solid guard: a real authoring mistake (same OD both sides of a
    // subtract), and the message a `{` in meta.drawingMd also produces.
    expect(isManifoldFatalTrap(new Error(
      'Bake produced an EMPTY solid — a CSG op (subtract/intersect) removed all geometry. Check the dimensions (e.g. the same OD on both sides of a subtract).',
    ))).toBe(false);
    // A genuine CSG rejection from Manifold.
    expect(isManifoldFatalTrap(new Error('Not manifold'))).toBe(false);
    // A missing dep.
    expect(isManifoldFatalTrap(new Error('primitive "g_nope" not found'))).toBe(false);
  });
});
