import { describe, it, expect, beforeAll } from 'vitest';
import { error } from '@sveltejs/kit';
import { withManifoldTrapGuard, trapText } from './manifold-guard';
import { initManifold, cyl } from '$lib/engines/manifold/manifold-helpers';

const G = globalThis as any;
const poison = () => { G.__cadtrain_manifold__.wasm = null; G.__cadtrain_manifold__.M = null; };
const healthy = () => { try { return cyl(10, 2).volume() > 0; } catch { return false; } };

const TRAP = 'bake failed: emval_methodCallers[caller] is not a function [in g_shaft → r_revolve()]';

beforeAll(async () => { await initManifold(); }, 120_000);

describe('trapText', () => {
  it('unwraps SvelteKit HttpError — the WASM message is in body.message, not message', () => {
    // This is the whole reason the guard exists as a wrapper: our endpoints call
    // `throw error(400, 'primitive call failed: <wasm message>')` BEFORE the guard
    // sees it. Sniffing `e.message` would read "400" and never reset.
    const httpErr = (() => { try { error(400, `primitive call failed: ${TRAP}`); } catch (e) { return e; } })();
    expect(trapText(httpErr)).toContain('emval_methodCallers');
  });

  it('reads a plain Error and a bare string', () => {
    expect(trapText(new Error('unreachable'))).toBe('unreachable');
    expect(trapText('memory access out of bounds')).toBe('memory access out of bounds');
  });
});

describe('withManifoldTrapGuard', () => {
  it('passes a successful result straight through', async () => {
    await expect(withManifoldTrapGuard(async () => 42)).resolves.toBe(42);
  });

  it('does NOT reset on an ordinary error, and rethrows it unchanged', async () => {
    expect(healthy()).toBe(true);
    const notFound = (() => { try { error(404, 'primitive "g_nope" not found'); } catch (e) { return e; } })();
    await expect(withManifoldTrapGuard(async () => { throw notFound; })).rejects.toBe(notFound);
    expect(healthy()).toBe(true); // module untouched — a typo must not cost a reset
  });

  it('resets the singleton on a trap wrapped in an HttpError, and rethrows a readable 500', async () => {
    poison();
    expect(healthy()).toBe(false);

    const wrapped = (() => { try { error(400, `primitive call failed: ${TRAP}`); } catch (e) { return e; } })();
    let caught: any;
    try { await withManifoldTrapGuard(async () => { throw wrapped; }); } catch (e) { caught = e; }

    expect(caught.status).toBe(500);
    expect(caught.body.message).toMatch(/NOT the culprit/i);
    expect(healthy()).toBe(true);   // the NEXT request gets a clean module
  }, 120_000);

  it('resets on a raw (unwrapped) trap too', async () => {
    poison();
    let caught: any;
    try {
      await withManifoldTrapGuard(async () => { throw new Error('memory access out of bounds'); });
    } catch (e) { caught = e; }
    expect(caught.status).toBe(500);
    expect(caught.body.message).toMatch(/out-of-bounds/i);
    expect(healthy()).toBe(true);
  }, 120_000);
});

/**
 * The end-to-end claim: a server whose Manifold module is corrupted serves the
 * NEXT request successfully, with no process restart. This is the whole point of
 * the guard — before it, a single trap made every later bake fail until someone
 * restarted `bun run dev`.
 */
describe('a poisoned server recovers on the NEXT request', () => {
  /** Faithful poison: the module survives but every Embind call throws the exact
   *  string a corrupted Manifold emits. Nulling the singleton instead yields
   *  "M.cylinder is not a function" — which is NOT a trap, and which the guard
   *  correctly refuses to reset on. */
  function poisonLikeRealLife() {
    const real = G.__cadtrain_manifold__.M;
    G.__cadtrain_manifold__.M = new Proxy(real ?? {}, {
      get: () => () => { throw new Error('emval_methodCallers[caller] is not a function'); },
    });
  }

  /** Stand-in for a bake endpoint: it wraps the failure in `error(400, …)` before
   *  the guard ever sees it, exactly as preview/bake-preview do. */
  const handler = async () => {
    try {
      return { tris: cyl(10, 2).getMesh().triVerts.length / 3 };
    } catch (e: any) {
      error(400, `bake failed: ${e?.message ?? e} [in g_shaft → r_revolve()]`);
    }
  };

  it('request 1 → readable 500 + reset; request 2 → succeeds', async () => {
    poisonLikeRealLife();

    let first: any;
    try { await withManifoldTrapGuard(handler); } catch (e) { first = e; }
    expect(first?.status).toBe(500);
    expect(first.body.message).toMatch(/NOT the culprit/i);

    const second = await withManifoldTrapGuard(handler);
    expect(second.tris).toBeGreaterThan(0);
  }, 180_000);
});
