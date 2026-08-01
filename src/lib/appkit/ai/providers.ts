// src/lib/appkit/ai/providers.ts — model provider resolution (rung 5).
// CLOUD (Anthropic) by default; LOCAL (Ollama via its OpenAI-compatible endpoint) for
// air-gapped / data-residency (D4). Same verb tool schema drives both — only the model
// swaps. The local path is build-green here, but a live local run needs Ollama running
// (http://localhost:11434) + a tool-capable model → human/Ollama verify.
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

export type Provider = 'cloud' | 'local';

export interface ProviderOpts {
  provider?: Provider;
  /** Cloud (Anthropic) key. */
  apiKey?: string;
  /** Model id; provider-appropriate default when omitted. */
  model?: string;
  /** Local (Ollama) OpenAI-compatible base URL. */
  baseURL?: string;
}

/** Return an AI SDK model for the chosen provider. */
export function resolveModel(opts: ProviderOpts): any {
  if ((opts.provider ?? 'cloud') === 'local') {
    const ollama = createOpenAICompatible({
      name: 'ollama',
      baseURL: opts.baseURL ?? 'http://localhost:11434/v1',
    });
    // Qwen3 is Apache-2.0 + trained for reliable native tool calling (Ollama tool-capable list),
    // which is exactly what the AI-SDK path uses. Override per-call via opts.model; lighter
    // fallback is 'qwen3:4b'. (Requires `ollama pull qwen3:8b`.) Ref: docs/research/local-model-survey.md.
    return ollama(opts.model ?? 'qwen3:8b');
  }
  return createAnthropic({ apiKey: opts.apiKey ?? '' })(opts.model ?? 'claude-sonnet-4-6');
}
