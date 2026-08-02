// src/lib/appkit/schema/to-aisdk.ts — project the verb registry → Vercel AI SDK tool
// descriptors. The pipeline (ai/pipeline.ts) wraps each with the SDK's tool() +
// jsonSchema() and an `execute` that calls dispatch(). Pure data — NO `ai` import
// here, so this stays server/worker/test-safe. See docs/architecture/app-harness.md §3.
import { type Verb, verbExample } from '../verbs/registry';

export interface AiSdkToolDef {
  description: string;
  /** JSON Schema — wrapped with the SDK's jsonSchema() at the pipeline boundary. */
  parameters: unknown;
  group: string;
}

/** The full tool-description string the model sees: the verb's prose + its canonical example
 *  appended as `Example: {args} — note`. AI SDK `tool()` descriptions are plain strings, so the
 *  example rides along in the description. Shared with the native tool-call path (ai/pipeline.ts)
 *  so BOTH surfaces show the example. */
export function verbDescription(v: Verb): string {
  const ex = verbExample(v);
  return ex ? `${v.desc} Example: ${ex}` : v.desc;
}

export function toAiSdkTools(verbs: Verb[]): Record<string, AiSdkToolDef> {
  const out: Record<string, AiSdkToolDef> = {};
  for (const v of verbs) out[v.name] = { description: verbDescription(v), parameters: v.params, group: v.group };
  return out;
}
