/// <reference lib="webworker" />
/**
 * bake-worker — the client-side Manifold executor Web Worker (PR2 of
 * docs/plans/client-side-execution.md).
 *
 * Baking on the main thread freezes the UI (we already felt "GLB bake blocked
 * the mesh thread"), so the worker is MANDATORY. It holds the warm Manifold WASM
 * singleton and runs compiled scripts off the UI thread, returning serialized
 * `{ full, cutVC, instanced }` geometry as TRANSFERABLE ArrayBuffers.
 *
 * THE ONE REAL GOTCHA (plan §4a — "WASM locate"): the default Manifold init
 * resolves its wasm via `new URL('manifold.wasm', import.meta.url)`, which can
 * miss inside a bundled worker. We side-step that by importing the asset with
 * Vite's `?url` suffix — Vite emits `manifold.wasm` as a build asset and rewrites
 * the import to its served URL — then pointing Emscripten's `locateFile` at it.
 * This is the proven worker-locate pattern; the URL is correct under both `bun
 * run dev` (served from node_modules) and the production build (hashed asset).
 *
 * The pure run → finalize → serialize core lives in `bake-worker-core.ts` so it
 * can be unit-tested in vitest without spinning up a real Worker. This file is
 * only ever instantiated as a Worker (never imported by tests), so the `?url`
 * import + `self` references stay isolated from the testable path.
 */
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { initManifold } from './manifold-helpers';
import { runCompiledManifold, packTransferable, type BakeOptions } from './bake-worker-core';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Request from the main thread (bake-client). */
export interface BakeWorkerRequest {
  id: number;
  script: string;
  params: Array<number | string> | Record<string, unknown>;
  options?: BakeOptions;
  /** Opt-in perf logging (build · mesh · cutaway · serialize). Set per-message
   *  from the client's `cad-bake-timings` flag — NOT always-on. */
  timings?: boolean;
}

// Warm the Manifold singleton ONCE, with a worker-safe locateFile. Cached as a
// promise so concurrent first messages dedupe to a single init.
let initPromise: Promise<void> | null = null;
function ensureInit(): Promise<void> {
  if (!initPromise) {
    initPromise = initManifold({
      // Emscripten asks for 'manifold.wasm'; hand back the Vite-served URL.
      locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path),
    });
  }
  return initPromise;
}

ctx.onmessage = async (ev: MessageEvent<BakeWorkerRequest>) => {
  const { id, script, params, options, timings } = ev.data ?? ({} as BakeWorkerRequest);
  (globalThis as any).__bakeTimings = !!timings;
  try {
    await ensureInit();
    const serialized = await runCompiledManifold(script, params, options ?? {});
    const { payload, transfer } = packTransferable(serialized);
    ctx.postMessage({ id, ok: true, ...payload }, transfer);
  } catch (e: any) {
    ctx.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};
