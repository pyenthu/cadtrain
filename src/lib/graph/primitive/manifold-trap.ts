/**
 * Manifold fatal-trap detection — PURE, and deliberately free of any
 * `manifold-3d` import (/plan #981).
 *
 * `bake-client.ts` runs on the MAIN THREAD and must stay clear of the Manifold
 * module: the whole point of the client-bake design is that Manifold only ever
 * initialises inside the Web Worker (main-thread init is blocked by the app-wide
 * COEP `require-corp`). So the trap predicate lives here, importable from both
 * sides, rather than in `manifold-helpers.ts` — which pulls in the WASM module.
 *
 * A trap corrupts the Manifold module for the rest of the process/worker: every
 * later call throws, usually naming whatever part happened to be on the stack.
 * That misdirection is the expensive part — on 2026-07-10 a dev server reported
 * `emval_methodCallers[caller] is not a function [in g_shaft → r_revolve(...)]`
 * while baking `bw_casing`, a part that never calls `g_shaft`.
 */

/**
 * True when `e` is a WASM-level trap that has corrupted the Manifold module —
 * recovery needs a FRESH module, not a retry on the old one.
 *
 * `emval_methodCallers` AND `parameter N has unknown type …` / `… has unbound
 * type …` are tells of an ALREADY-poisoned module — Embind's type registry is
 * gone, so the next call reads a GARBAGE type name (`parameter 0 has unknown
 * type À®`) even for a perfectly valid argument. Without these, that error is
 * rejected as a plain build failure and the worker is NOT respawned, so the
 * corrupted heap survives and every later bake repeats it (then hangs). The rest
 * mirror `isTfFatalTrap` and catch the original trap that poisoned the module.
 * Accepts a raw string, an Error, or an Emscripten abort code (a bare number).
 */
export function isManifoldFatalTrap(e: unknown): boolean {
  if (typeof e === 'number' || typeof e === 'bigint') return true;
  if (typeof WebAssembly !== 'undefined' && e instanceof WebAssembly.RuntimeError) return true;
  const s = String((e as any)?.message ?? e);
  return /emval_methodCallers|has unknown type|has unbound type|unreachable|out of bounds|null function|signature mismatch|RuntimeError|\bAborted?\b|table index|memory access/i.test(s);
}

/**
 * Human-readable reason, so a bake pane shows something actionable instead of
 * `emval_methodCallers[caller] is not a function`. Mirrors `describeTfError`.
 */
export function describeManifoldError(e: unknown): string {
  const raw = String((e as any)?.message ?? e);
  if (/emval_methodCallers|has unknown type|has unbound type/i.test(raw))
    return 'Manifold kernel was in a corrupted state from an earlier trap (the part named in the raw error is NOT the culprit). Kernel reset; re-run the bake.';
  if (/out of bounds|memory access/i.test(raw))
    return 'Manifold kernel trap (memory out-of-bounds) — malformed mesh input, usually non-manifold geometry. Kernel reset; re-run the bake.';
  if (/unreachable|\bAborted?\b/i.test(raw))
    return 'Manifold kernel trap (abort) — a CSG op failed on degenerate/coincident geometry. Kernel reset; re-run the bake.';
  return raw;
}
