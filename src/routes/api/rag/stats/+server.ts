import { json } from '@sveltejs/kit';
import { readCorpusStats } from '$lib/server/rag-corpus';

/**
 * GET /api/rag/stats → returns { count, lastRebuiltAt } for the on-volume
 * RAG corpus at `<volume>/ai/rag/parts.jsonl`. `count` = 0 + `lastRebuiltAt`
 * = null when no corpus has been written yet.
 *
 * Phase 1 of docs/plans/rag-prompt-builder.md. Used by the `/primitives`
 * sidebar to render the "last refreshed Xm ago" label next to the rebuild
 * button.
 */
export const GET = async () => {
  const stats = await readCorpusStats();
  return json(stats);
};
