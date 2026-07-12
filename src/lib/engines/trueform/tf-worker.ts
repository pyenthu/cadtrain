/// <reference lib="webworker" />
/**
 * tf-worker — the client-side TrueForm executor Web Worker (mirrors
 * `src/lib/graph/bake-worker.ts` for the TF backend).
 *
 * Building TrueForm geometry on the main thread janked the UI on every spline
 * drag (the whole executeTfRecipe / boolean-fold / warpMeshJS pipeline ran inline
 * in `rebuildTf`). This worker holds the warm TrueForm WASM kernel and runs the
 * build OFF the UI thread, returning RAW mesh data (`{ points, faces }` typed
 * arrays) + tf's topology `stats` + `cutPlanes` + per-part data as TRANSFERABLE
 * ArrayBuffers. The main thread then runs `tfMeshToGeo` (THREE) on that data.
 *
 * WORKER-INIT NOTE (the historical blocker): trueform@0.9.8 is built WITH pthreads
 * — `tf.init()` pre-creates a worker pool and transfers a SharedArrayBuffer, which
 * requires a cross-origin-isolated context. That is now satisfied APP-WIDE
 * (COOP:same-origin + COEP:require-corp, shipped 2026-07-02 via hooks.server.ts +
 * vite.config), and a dedicated worker inherits crossOriginIsolated from the
 * document, so tf's nested pthread workers can spawn from HERE. Earlier attempts
 * to run tf in a worker stalled BEFORE those headers existed. `ensureTf()` resolves
 * `trueform_wasm.wasm` via the module's own `import.meta.url` (unchanged by which
 * thread imports it), so no worker-specific `locateFile` is needed the way Manifold
 * needs one.
 *
 * The pure dispatch + serialize core lives in `tf-worker-core.ts` so it is
 * unit-testable in vitest with a MOCK kernel; this shell only warms the kernel and
 * transfers the result.
 */
import { ensureTf } from './trueform-client';
import { buildTfRecipe, packTfResult, type TfWorkerRequest } from './tf-worker-core';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

ctx.onmessage = async (ev: MessageEvent<TfWorkerRequest>) => {
  const req = ev.data ?? ({} as TfWorkerRequest);
  const { id, timings } = req;
  try {
    // Warm the kernel (one-time ~31 MB WASM + pthread pool; ~0 after) then build.
    const tw0 = now();
    const tf = await ensureTf();
    const warm = now() - tw0;
    const tb0 = now();
    const result = await buildTfRecipe(tf, req);
    const build = now() - tb0;
    const { payload, transfer } = packTfResult(result);
    if (timings) {
      try { console.log(`[tf-worker] warm=${warm.toFixed(1)} · build=${build.toFixed(1)} ms`); } catch { /* noop */ }
    }
    ctx.postMessage({ id, ok: true, ...payload, timings: { warm, build } }, transfer);
  } catch (e: any) {
    // A build failure (or a self-heal-rethrown kernel trap from executeTfRecipe's
    // runTfGuarded) — surface the readable reason; the main thread blanks + shows it.
    ctx.postMessage({ id, ok: false, error: String(e?.message ?? e) });
  }
};
