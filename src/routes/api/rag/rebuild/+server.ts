import { json, error } from '@sveltejs/kit';
import { rebuildCorpus } from '$lib/server/rag-corpus';

/**
 * POST /api/rag/rebuild → walk the on-volume primitives tree and
 * rewrite `<volume>/ai/rag/parts.jsonl` from scratch. Returns the new
 * record count + how long the rebuild took.
 *
 * Phase 1 of docs/plans/rag-prompt-builder.md — no LLM, just the corpus.
 *
 * Local dev with CADTRAIN_VOLUME_REMOTE_URL set: this route is in
 * `VOLUME_PROXY_PATHS` (src/hooks.server.ts), so the local POST is
 * forwarded to prod — local dev triggers a prod-side rebuild, matching
 * the "single live store" stance.
 */
export const POST = async () => {
  try {
    const out = await rebuildCorpus();
    return json(out);
  } catch (e: any) {
    throw error(500, `rebuild failed: ${e?.message ?? e}`);
  }
};
