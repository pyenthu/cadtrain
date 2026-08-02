// src/lib/server/vector-retrieval.ts — SEMANTIC retrieval over the golden corpus (D11 vector RAG).
//
// Embeds each golden's md (its retrieval key) with the LOCAL embedder, caches the index (keyed by a
// content hash of the golden set, so it rebuilds only when the goldens change), and ranks by cosine
// similarity to the embedded prompt — catching paraphrases the lexical ranker misses ("3D viewer" ↔
// "cad viewer", "revenue by month" ↔ "monthly sales"). docType-scoped like the lexical `rankGolden`
// (#49). Best-effort: returns [] on ANY embed failure so `buildGrounding` degrades to lexical, never
// throws. Opt-in (APP_RAG_VECTOR) so we A/B it vs lexical via the eval gate before flipping default.
import type { GoldenPair } from './app-corpus-store';
import { docTypeOf } from './app-corpus';
import { rankByVector } from '$lib/appkit/ai/embeddings';
import { localEmbedder } from './local-embedder';

const firstLine = (md: string): string => (md.split('\n').find((l) => l.trim()) ?? '').replace(/^#+\s*/, '').trim();

// In-memory embedded index of the FULL golden set (docType filtering happens at query time so the
// cache is stable across docTypes). Rebuilt when the golden set's names/keys change.
let cache: { key: string; index: Array<{ item: GoldenPair; vec: number[] }> } | null = null;
const keyOf = (golden: GoldenPair[]): string => golden.map((g) => `${g.name}:${firstLine(g.md)}`).join('|');

async function fullIndex(golden: GoldenPair[]): Promise<Array<{ item: GoldenPair; vec: number[] }>> {
  const key = keyOf(golden);
  if (cache && cache.key === key) return cache.index;
  const vecs = await localEmbedder.embed(golden.map((g) => firstLine(g.md)));
  const index = golden.map((g, i) => ({ item: g, vec: vecs[i] ?? [] }));
  cache = { key, index };
  return index;
}

/** Rank goldens by SEMANTIC similarity (cosine over local embeddings), docType-scoped. Mirrors
 *  `rankGolden`'s signature; returns [] on any failure so the caller falls back to lexical. */
export async function rankGoldenVector(prompt: string, golden: GoldenPair[], k = 3, docType?: string): Promise<GoldenPair[]> {
  try {
    if (!golden.length) return [];
    const index = await fullIndex(golden);
    const pool = docType ? index.filter((x) => docTypeOf(x.item.app) === docType) : index;
    if (!pool.length) return [];
    const [q] = await localEmbedder.embed([prompt]);
    if (!q?.length) return [];
    return rankByVector(q, pool, k)
      .filter((r) => r.score > 0)
      .map((r) => r.item);
  } catch {
    return [];
  }
}

/** Test/ops hook: drop the cached index (e.g. after promoting a golden). */
export function clearVectorIndex(): void {
  cache = null;
}
