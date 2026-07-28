/**
 * Server-side Manifold fatal-trap guard (/plan #981).
 *
 * The server bake shares ONE Manifold WASM module across every request
 * (`globalThis.__cadtrain_manifold__`). A single trap — a boolean on degenerate
 * geometry, a non-manifold weld — corrupts that module, and from then on EVERY
 * request fails, with a message naming whatever part happened to be on the stack.
 * Observed 2026-07-10: a dev server returned
 * `emval_methodCallers[caller] is not a function [in g_shaft → r_revolve(...)]`
 * for `bw_casing`, a part that never calls `g_shaft`. The only cure was a process
 * restart.
 *
 * The trap is not preventable here. Leaving the module poisoned afterwards is.
 * This wraps a bake handler so a fatal trap resets the singleton before the
 * response is sent — the NEXT request gets a clean module.
 *
 * Note the ordering trap this itself has to dodge: our bake endpoints wrap a
 * failure in SvelteKit's `error(400, …)` *before* it reaches us, so the WASM
 * message is buried in `HttpError.body.message`. Sniffing only `e.message` would
 * see `"400"` and never reset. We check both.
 */
import { error, type HttpError } from '@sveltejs/kit';
import { isManifoldFatalTrap, describeManifoldError } from '$lib/graph/primitive/manifold-trap';
import { resetManifold } from '$lib/engines/manifold/manifold-helpers';

/** SvelteKit's `error()` produces `{ status, body: { message } }`. */
function isHttpError(e: unknown): e is HttpError {
  return !!e && typeof (e as any).status === 'number' && typeof (e as any).body === 'object';
}

/** The message a trap detector should look at, whether or not SvelteKit already
 *  wrapped the throw. */
export function trapText(e: unknown): string {
  if (isHttpError(e)) return String((e as any).body?.message ?? '');
  return String((e as any)?.message ?? e ?? '');
}

/**
 * Run a bake handler; on a fatal WASM trap, reset the Manifold singleton and
 * rethrow a readable 500. Non-trap errors (a 400 for bad params, a 404 for an
 * unknown part) pass through UNTOUCHED — resetting on those would throw away a
 * perfectly good module on every typo.
 */
export async function withManifoldTrapGuard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (!isManifoldFatalTrap(trapText(e))) throw e;

    const raw = trapText(e);
    let resetOk = true;
    try {
      await resetManifold();
    } catch (re) {
      resetOk = false;
      console.error('[manifold-guard] singleton reset FAILED — restart the process', re);
    }
    console.error(`[manifold-guard] fatal WASM trap; singleton ${resetOk ? 'reset' : 'NOT reset'}. raw: ${raw.slice(0, 200)}`);

    // 500, not 400: the request was not the client's fault in any actionable
    // way, and the part named in `raw` is very likely innocent.
    throw error(500, resetOk
      ? describeManifoldError(raw)
      : `${describeManifoldError(raw)} (automatic reset failed — restart the server)`);
  }
}
