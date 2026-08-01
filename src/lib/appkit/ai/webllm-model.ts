// src/lib/appkit/ai/webllm-model.ts — the ONE place the in-browser WebLLM model id lives, shared
// by BOTH the main-thread driver (webllm-build.ts) and the inference Web Worker
// (webllm.worker.ts) so they can never drift. Pure constants, no browser/Node deps — safe to
// import from either side (main thread or worker).
//
// Qwen2.5-1.5B-Instruct (Apache-2.0, ~1.6 GB q4f16) — the LIGHT pick from the model survey. Qwen3-4B
// (~3.4 GB) lost the WebGPU device ("Device was lost … resource constraints") on this machine, so
// 1.5B is the size that actually runs in-browser here (also the SVTC/web-llm default class).
// Ref: docs/research/local-model-survey.md. Swap MODEL_ID to try a bigger one if the GPU allows.
export const MODEL_ID = 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC';

// Qwen3 has a hybrid THINKING mode we must disable (extra_body.enable_thinking:false); Qwen2.5 has
// none, so the flag only applies to Qwen3.
export const IS_QWEN3 = MODEL_ID.startsWith('Qwen3');

// Inference sampling — kept here so the worker (executor) and the main thread (driver) agree.
export const INFER_TEMPERATURE = 0;
export const INFER_MAX_TOKENS = 2048;

// The in-browser context window. The prebuilt MLC config defaults Qwen2.5-1.5B to 4096, but the
// component/verb system prompt + RAG grounding runs ~4.4k tokens and OVERFLOWS it ("prompt tokens
// exceed context window size"). Qwen2.5 supports 32768; 8192 gives headroom for grounding while
// keeping the KV-cache memory modest for the 1.5B (Qwen3-4B lost the WebGPU device, but 1.5B@8192
// is well within budget). Passed as a ChatOptions override to CreateMLCEngine.
export const WEBLLM_CONTEXT_WINDOW = 8192;
