// src/lib/appkit/ai/webllm-build.ts — the in-browser (WebLLM) build path (#40), still surfaced as
// the "Phi" model toggle. Runs ENTIRELY in the browser via WebGPU: zero API cost, zero
// subscription, perfect residency (satisfies the AI-data-residency rule outright). Client-safe:
// imports only headless appkit (no 'ai', no node) + lazy-loads @mlc-ai/web-llm INSIDE the worker.
//
// #906 — MLC inference now runs in a Web Worker (webllm.worker.ts). On the main thread the WebGPU
// generation loop froze the renderer for ~90s per prompt (the studio + eval UI locked up, CDP
// timed out). WebGPU is available in Workers, so the heavy engine lives off the UI thread. This
// module is now just the DRIVER: it builds the SAME emit-verbs prompt, ships it to the worker for
// inference, then runs parseVerbCalls + verb dispatch ON THE MAIN THREAD (that is where the .app
// state lives, and it is cheap). The public API (loadPhi / buildAppWithPhi / isWebGPUAvailable /
// phiReady / phiLoading) is UNCHANGED so /app_design chat + /app_design/eval need no edits.
//
// FALLBACK: if `new Worker` throws or the worker can't bring up WebGPU (Safari / older Chrome /
// worker-WebGPU disabled), we transparently fall back to running the engine on the main thread —
// the old behaviour (freezes, but still works).
import { verbsByGroup, type Ctx, type AppDoc } from '../verbs/registry';
import { dispatch } from '../verbs/dispatch';
import { systemPrompt, emitInstruction, parseVerbCalls } from './prompt';
import { sanitizeApp } from './sanitize';
import { MODEL_ID, IS_QWEN3, INFER_TEMPERATURE, INFER_MAX_TOKENS } from './webllm-model';
import type { WebllmWorkerReply } from './webllm.worker';

type ProgressCb = (p: { progress: number; text: string }) => void;
type MLCEngine = { chat: { completions: { create: (o: unknown) => Promise<any> } } };

// ── Module state (one worker OR one main-thread engine, chosen at load) ──────
let mode: 'worker' | 'main' | null = null;
let worker: Worker | null = null;
let mainEngine: MLCEngine | null = null;
let ready = false;
let loading = false;
let inferSeq = 0;

export function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as { gpu?: unknown }).gpu;
}
export function phiReady(): boolean {
  return ready;
}
export function phiLoading(): boolean {
  return loading;
}

/** Load Phi in the browser (idempotent). `onProgress` reports download/compile progress
 *  (0..1 + a text line). Throws if WebGPU is unavailable or the model can't load.
 *  Prefers a Web Worker (keeps the UI responsive); falls back to the main thread. */
export async function loadPhi(onProgress?: ProgressCb): Promise<void> {
  if (ready) return;
  if (loading) throw new Error('Phi is already loading');
  if (!isWebGPUAvailable()) throw new Error('WebGPU not available — Phi needs Chrome/Edge desktop with WebGPU enabled');
  loading = true;
  try {
    // Preferred path: the engine lives in a Web Worker so generation never blocks the renderer.
    if (typeof Worker !== 'undefined') {
      try {
        await loadViaWorker(onProgress);
        mode = 'worker';
        ready = true;
        return;
      } catch (e) {
        // Worker construction failed, or the worker couldn't bring up WebGPU / the model. Drop it
        // and fall through to the main-thread path so nothing breaks on unsupported browsers.
        teardownWorker();
        try { console.warn('[webllm] worker path unavailable, falling back to main thread:', String((e as { message?: string })?.message ?? e)); } catch { /* noop */ }
      }
    }
    // Fallback: run the engine on the main thread (the pre-#906 behaviour — freezes during gen).
    await loadOnMainThread(onProgress);
    mode = 'main';
    ready = true;
  } finally {
    loading = false;
  }
}

/** Spin up the worker, ask it to load the model, resolve on `ready` (forwarding progress). */
function loadViaWorker(onProgress?: ProgressCb): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let w: Worker;
    try {
      w = new Worker(new URL('./webllm.worker.ts', import.meta.url), { type: 'module' });
    } catch (e) {
      reject(e);
      return;
    }
    worker = w;
    const onMessage = (ev: MessageEvent<WebllmWorkerReply>) => {
      const d = ev.data;
      if (d.type === 'progress') onProgress?.(d.p);
      else if (d.type === 'ready') { cleanup(); resolve(); }
      else if (d.type === 'load-error') { cleanup(); reject(new Error(d.error)); }
    };
    const onError = (ev: ErrorEvent) => {
      cleanup();
      reject(new Error(`webllm worker error: ${ev?.message || 'script failed to load/parse'}`));
    };
    function cleanup(): void {
      w.removeEventListener('message', onMessage as EventListener);
      w.removeEventListener('error', onError as EventListener);
    }
    w.addEventListener('message', onMessage as EventListener);
    w.addEventListener('error', onError as EventListener);
    w.postMessage({ type: 'load' });
  });
}

/** Fallback: CreateMLCEngine on the main thread (blocks the UI during generation). */
async function loadOnMainThread(onProgress?: ProgressCb): Promise<void> {
  const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
  mainEngine = (await CreateMLCEngine(MODEL_ID, { initProgressCallback: onProgress ?? (() => {}) })) as MLCEngine;
}

function teardownWorker(): void {
  try { worker?.terminate(); } catch { /* already dead */ }
  worker = null;
}

export interface PhiBuildResult {
  trace: Array<{ verb: string; args: unknown; ok: boolean; error?: string }>;
  raw: string;
}

/** Build the .app with Phi (in-browser): emit a verb-list (in the worker) → parse → dispatch
 *  against `app` (on the main thread — that is where the .app state lives). */
export async function buildAppWithPhi(app: AppDoc, prompt: string, grounding = ''): Promise<PhiBuildResult> {
  if (!ready) throw new Error('Phi not loaded — call loadPhi() first');
  // The SAME emit-verbs prompt as before — unchanged. Only WHERE inference runs changed.
  const full = `${systemPrompt(app, grounding, prompt)}\n\n=== REQUEST ===\n${prompt}\n${emitInstruction()}`;
  const messages = [{ role: 'user', content: full }];
  // Qwen3 is hybrid-thinking: WebLLM's non-thinking template (a leading closed empty
  // <think></think> block) suppresses reasoning so the reply is a clean JSON verb-array. Without
  // this, <think>…</think> prose can make parseVerbCalls return [] → a silent no-op build.
  const extra_body = IS_QWEN3 ? { enable_thinking: false } : undefined;

  const raw = mode === 'worker' && worker
    ? await inferViaWorker(messages, extra_body)
    : await inferOnMainThread(messages, extra_body);

  // ── parse + dispatch ON THE MAIN THREAD (identical to the pre-worker path) ──
  const guiNames = verbsByGroup('gui').map((v) => v.name);
  const calls = parseVerbCalls(raw);
  const ctx: Ctx = { appStore: app };
  const trace: PhiBuildResult['trace'] = [];
  for (const c of calls) {
    if (!guiNames.includes(c.verb)) {
      trace.push({ verb: c.verb, args: c.args, ok: false, error: 'not a callable gui verb' });
      continue;
    }
    try {
      await dispatch(c.verb, c.args, ctx);
      trace.push({ verb: c.verb, args: c.args, ok: true });
    } catch (e) {
      trace.push({ verb: c.verb, args: c.args, ok: false, error: String((e as { message?: string })?.message ?? e) });
    }
  }
  sanitizeApp(app);
  return { trace, raw };
}

/** Run one inference in the worker; resolve to the raw model text. */
function inferViaWorker(messages: Array<{ role: string; content: string }>, extra_body?: Record<string, unknown>): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const w = worker;
    if (!w) { reject(new Error('webllm worker missing')); return; }
    const id = ++inferSeq;
    const onMessage = (ev: MessageEvent<WebllmWorkerReply>) => {
      const d = ev.data;
      if (d.type === 'result' && d.id === id) { cleanup(); resolve(d.text); }
      else if (d.type === 'error' && d.id === id) { cleanup(); reject(new Error(d.error)); }
    };
    const onError = (ev: ErrorEvent) => {
      cleanup();
      reject(new Error(`webllm worker error: ${ev?.message || 'inference failed'}`));
    };
    function cleanup(): void {
      w.removeEventListener('message', onMessage as EventListener);
      w.removeEventListener('error', onError as EventListener);
    }
    w.addEventListener('message', onMessage as EventListener);
    w.addEventListener('error', onError as EventListener);
    w.postMessage({ type: 'infer', id, messages, extra_body });
  });
}

/** Fallback: run inference on the main-thread engine (blocks the UI). */
async function inferOnMainThread(messages: Array<{ role: string; content: string }>, extra_body?: Record<string, unknown>): Promise<string> {
  if (!mainEngine) throw new Error('Phi not loaded — call loadPhi() first');
  const res = await mainEngine.chat.completions.create({
    messages,
    temperature: INFER_TEMPERATURE,
    max_tokens: INFER_MAX_TOKENS,
    ...(extra_body ? { extra_body } : {}),
  });
  return String(res?.choices?.[0]?.message?.content ?? '');
}
