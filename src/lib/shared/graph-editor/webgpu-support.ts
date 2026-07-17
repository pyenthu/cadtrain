// ─────────────────────────────────────────────────────────────────────────
// webgpu-support.ts — SPIKE (not wired). Pure feature-detect guard for the
// proposed "WGPU" render tab (a GPU-rasterized vector sibling of B·SVG).
//
// Design/plan: docs/research/webgpu-onedraw-tab.md.
//
// PURE + headless-safe: no DOM, no Svelte, no async. Unit-tested in
// webgpu-support.test.ts (the vitest env is `node`, where the global
// `navigator` has no `.gpu`, so the guard must return false there). The
// component (WebGpuView.svelte) calls this BEFORE it ever touches
// `navigator.gpu.requestAdapter()`, so a browser without WebGPU takes the
// graceful-fallback path instead of throwing.
// ─────────────────────────────────────────────────────────────────────────

/** The minimal shape we probe for — just "is there a `gpu` entry point?".
 *  Kept structural (not the full `Navigator`/`GPU` lib types) so this module
 *  compiles with NO `@webgpu/types` dependency (the app must not add deps for a
 *  spike) and stays testable with a plain object stand-in. */
export interface GpuNavigatorLike {
  gpu?: unknown;
}

/**
 * Is the WebGPU entry point present on this navigator?
 *
 * This is a CHEAP, SYNCHRONOUS capability check — the presence of
 * `navigator.gpu` (a `GPU` object). It does NOT prove a usable adapter exists
 * (that needs the async `navigator.gpu.requestAdapter()`, which can still
 * return `null` on a blocklisted GPU / software-only stack). Treat a `true`
 * here as "worth ATTEMPTING GPU init", and handle a null adapter at init time.
 *
 * @param nav Optional navigator-like object; defaults to the global
 *   `navigator` when present. Passing an explicit object keeps the guard
 *   deterministic in headless tests (Node's global navigator has no `.gpu`).
 * @returns `true` only when a `gpu` entry point is present.
 */
export function webgpuSupported(nav?: GpuNavigatorLike | null): boolean {
  const n = nav ?? (typeof navigator !== 'undefined' ? (navigator as unknown as GpuNavigatorLike) : undefined);
  return !!(n && n.gpu != null);
}
