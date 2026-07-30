// src/lib/appkit/ai/webllm-build.ts — the PHI (WebLLM) build path (#40). Runs ENTIRELY in the
// browser via WebGPU: zero API cost, zero subscription, perfect residency (satisfies the
// AI-data-residency rule outright). Phi-3.5-mini weights (~2.4 GB) download ONCE and cache in
// the browser Cache API. Client-safe: imports only headless appkit (no 'ai', no node) + lazy-
// loads @mlc-ai/web-llm. Same emit-then-dispatch shape as build-cli, but the model is local.
// Verify in a WebGPU browser (Chrome/Edge desktop); the model download is one-time.
import { verbsByGroup, type Ctx, type AppDoc } from '../verbs/registry';
import { dispatch } from '../verbs/dispatch';
import { systemPrompt, emitInstruction, parseVerbCalls } from './prompt';
import { sanitizeApp } from './sanitize';

const MODEL_ID = 'Phi-3.5-mini-instruct-q4f16_1-MLC';

let engine: { chat: { completions: { create: (o: unknown) => Promise<any> } } } | null = null;
let loading = false;

export function isWebGPUAvailable(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as { gpu?: unknown }).gpu;
}
export function phiReady(): boolean {
  return engine !== null;
}
export function phiLoading(): boolean {
  return loading;
}

/** Load Phi in the browser (idempotent). `onProgress` reports download/compile progress
 *  (0..1 + a text line). Throws if WebGPU is unavailable or the model can't load. */
export async function loadPhi(onProgress?: (p: { progress: number; text: string }) => void): Promise<void> {
  if (engine) return;
  if (loading) throw new Error('Phi is already loading');
  if (!isWebGPUAvailable()) throw new Error('WebGPU not available — Phi needs Chrome/Edge desktop with WebGPU enabled');
  loading = true;
  try {
    const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
    engine = (await CreateMLCEngine(MODEL_ID, { initProgressCallback: onProgress ?? (() => {}) })) as typeof engine;
  } finally {
    loading = false;
  }
}

export interface PhiBuildResult {
  trace: Array<{ verb: string; args: unknown; ok: boolean; error?: string }>;
  raw: string;
}

/** Build the .app with Phi (in-browser): emit a verb-list → parse → dispatch against `app`. */
export async function buildAppWithPhi(app: AppDoc, prompt: string, grounding = ''): Promise<PhiBuildResult> {
  if (!engine) throw new Error('Phi not loaded — call loadPhi() first');
  const full = `${systemPrompt(app, grounding, prompt)}\n\n=== REQUEST ===\n${prompt}\n${emitInstruction()}`;
  const res = await engine.chat.completions.create({
    messages: [{ role: 'user', content: full }],
    temperature: 0,
    max_tokens: 2048,
  });
  const raw = String(res?.choices?.[0]?.message?.content ?? '');

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
