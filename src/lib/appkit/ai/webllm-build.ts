// src/lib/appkit/ai/webllm-build.ts — the in-browser (WebLLM) build path (#40), still surfaced as
// the "Phi" model toggle. Runs ENTIRELY in the browser via WebGPU: zero API cost, zero
// subscription, perfect residency (satisfies the AI-data-residency rule outright). The model is
// now Qwen3-4B (Apache-2.0); its q4f16 weights (~3.4 GB) download ONCE and cache in the browser
// Cache API. Client-safe: imports only headless appkit (no 'ai', no node) + lazy-loads
// @mlc-ai/web-llm. Same emit-then-dispatch shape as build-cli, but the model is local.
// Qwen3 is a HYBRID-THINKING model: we pass extra_body.enable_thinking:false (below) so it does
// NOT prepend a <think>…</think> block, which would otherwise confuse parseVerbCalls into an empty
// no-op build. Verify in a WebGPU browser (Chrome/Edge desktop); the model download is one-time.
import { verbsByGroup, type Ctx, type AppDoc } from '../verbs/registry';
import { dispatch } from '../verbs/dispatch';
import { systemPrompt, emitInstruction, parseVerbCalls } from './prompt';
import { sanitizeApp } from './sanitize';

// Qwen2.5-1.5B-Instruct (Apache-2.0, ~1.6 GB q4f16) — the LIGHT pick from the model survey. Qwen3-4B
// (~3.4 GB) lost the WebGPU device ("Device was lost … resource constraints") on this machine, so
// 1.5B is the size that actually runs in-browser here (also the SVTC/web-llm default class).
// Ref: docs/research/local-model-survey.md. Swap MODEL_ID to try a bigger one if the GPU allows.
const MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';
// Qwen3 has a hybrid THINKING mode we must disable; Qwen2.5 has none, so the flag only applies to Qwen3.
const IS_QWEN3 = MODEL_ID.startsWith('Qwen3');

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
    // Qwen3 is hybrid-thinking: WebLLM's non-thinking template (a leading closed empty
    // <think></think> block) suppresses reasoning so the reply is a clean JSON verb-array. Without
    // this, <think>…</think> prose can make parseVerbCalls return [] → a silent no-op build.
    ...(IS_QWEN3 ? { extra_body: { enable_thinking: false } } : {}),
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
