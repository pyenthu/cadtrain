import { describe, it, expect, beforeAll } from 'vitest';
import { isManifoldFatalTrap, describeManifoldError } from './manifold-trap';
import { initManifold, resetManifold, cyl } from './manifold-helpers';

describe('isManifoldFatalTrap', () => {
  it('recognises an ALREADY-poisoned singleton', () => {
    // The exact string a poisoned dev server returned on 2026-07-10.
    expect(isManifoldFatalTrap('bake failed: emval_methodCallers[caller] is not a function [in g_shaft → r_revolve({...})]')).toBe(true);
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
