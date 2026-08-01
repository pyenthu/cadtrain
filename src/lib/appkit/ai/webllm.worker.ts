/// <reference lib="webworker" />
/**
 * webllm.worker.ts — the in-browser (WebLLM) INFERENCE Web Worker (/plan #906).
 *
 * `@mlc-ai/web-llm` runs the model on WebGPU. On the MAIN THREAD that WebGPU work
 * (token-by-token generation) BLOCKS the renderer for ~90s per prompt, freezing the
 * /app_design studio + the /app_design/eval harness (and starving CDP/automation).
 * WebGPU is available inside a Web Worker in Chrome, so the heavy MLC engine lives
 * here and the UI thread stays responsive. SVTC does exactly this.
 *
 * SPLIT: ONLY the MLC engine (load + inference) runs in this worker. Prompt building,
 * `parseVerbCalls`, and verb dispatch stay on the main thread (that is where the .app
 * state lives, and they are cheap) — see webllm-build.ts.
 *
 * Worker-locate note: web-llm resolves its own WASM/wgsl assets from the CDN at
 * runtime (it does NOT bundle them), so there is no `?url` locateFile dance like the
 * Manifold bake worker — the dynamic `import('@mlc-ai/web-llm')` is all that is needed.
 *
 * This file is ONLY ever instantiated as a Worker (never imported by tests or the
 * server bundle), so the top-level `self` handler + the web-llm import stay isolated.
 */
import { MODEL_ID, IS_QWEN3, INFER_TEMPERATURE, INFER_MAX_TOKENS, WEBLLM_CONTEXT_WINDOW } from './webllm-model';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

// ── Message protocol (mirrored as `import type` in webllm-build.ts) ──────────
/** Main → worker. */
export type WebllmWorkerRequest =
  | { type: 'load' }
  | { type: 'infer'; id: number; messages: Array<{ role: string; content: string }>; extra_body?: Record<string, unknown> };

/** Worker → main. */
export type WebllmWorkerReply =
  | { type: 'progress'; p: { progress: number; text: string } }
  | { type: 'ready' }
  | { type: 'load-error'; error: string }
  | { type: 'result'; id: number; text: string }
  | { type: 'error'; id: number; error: string };

type MLCEngine = { chat: { completions: { create: (o: unknown) => Promise<any> } } };

let engine: MLCEngine | null = null;
let loadPromise: Promise<void> | null = null;

/** Load the MLC engine ONCE (idempotent), forwarding init progress to the main thread. */
function ensureLoaded(): Promise<void> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
      // 3rd arg = ChatOptions override: widen the context window past the prebuilt 4096 default so
      // the grounded system prompt (~4.4k tokens) fits (see WEBLLM_CONTEXT_WINDOW).
      engine = (await CreateMLCEngine(
        MODEL_ID,
        {
          initProgressCallback: (p: { progress: number; text: string }) =>
            ctx.postMessage({ type: 'progress', p } satisfies WebllmWorkerReply),
        },
        { context_window_size: WEBLLM_CONTEXT_WINDOW },
      )) as MLCEngine;
    })();
  }
  return loadPromise;
}

ctx.onmessage = async (ev: MessageEvent<WebllmWorkerRequest>) => {
  const msg = ev.data;
  if (!msg) return;

  if (msg.type === 'load') {
    try {
      await ensureLoaded();
      ctx.postMessage({ type: 'ready' } satisfies WebllmWorkerReply);
    } catch (e: any) {
      // Reset so a later retry (e.g. after a fallback decision) can try again cleanly.
      loadPromise = null;
      engine = null;
      ctx.postMessage({ type: 'load-error', error: String(e?.message ?? e) } satisfies WebllmWorkerReply);
    }
    return;
  }

  if (msg.type === 'infer') {
    const { id, messages, extra_body } = msg;
    try {
      if (!engine) throw new Error('WebLLM engine not loaded');
      const res = await engine.chat.completions.create({
        messages,
        temperature: INFER_TEMPERATURE,
        max_tokens: INFER_MAX_TOKENS,
        // Qwen3-only hybrid-thinking suppression (extra_body.enable_thinking:false), built on the
        // main thread and passed through verbatim so the worker stays a dumb executor.
        ...(extra_body ? { extra_body } : {}),
      });
      const text = String(res?.choices?.[0]?.message?.content ?? '');
      ctx.postMessage({ type: 'result', id, text } satisfies WebllmWorkerReply);
    } catch (e: any) {
      ctx.postMessage({ type: 'error', id, error: String(e?.message ?? e) } satisfies WebllmWorkerReply);
    }
    return;
  }
};
