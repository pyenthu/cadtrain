// src/lib/appkit/schema/to-aisdk.ts — project the verb registry → Vercel AI SDK tool
// descriptors. The pipeline (ai/pipeline.ts) wraps each with the SDK's tool() +
// jsonSchema() and an `execute` that calls dispatch(). Pure data — NO `ai` import
// here, so this stays server/worker/test-safe. See docs/architecture/app-harness.md §3.
import type { Verb } from '../verbs/registry';

export interface AiSdkToolDef {
  description: string;
  /** JSON Schema — wrapped with the SDK's jsonSchema() at the pipeline boundary. */
  parameters: unknown;
  group: string;
}

export function toAiSdkTools(verbs: Verb[]): Record<string, AiSdkToolDef> {
  const out: Record<string, AiSdkToolDef> = {};
  for (const v of verbs) out[v.name] = { description: v.desc, parameters: v.params, group: v.group };
  return out;
}
