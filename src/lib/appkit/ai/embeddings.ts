// src/lib/appkit/ai/embeddings.ts — the EmbeddingProvider seam (D11) + pure vector math.
//
// PORTABLE + HEADLESS: this module is ONLY an interface + cosine/rank helpers — NO heavy imports —
// so it stays importable from the browser, Node, and tests. The concrete provider (transformers.js,
// which drags in onnxruntime) lives in `src/lib/server/local-embedder.ts` so it never leaks into the
// client bundle. Residency (local-first): the embed model runs on OUR infra / in-browser, never a
// 3rd-party embeddings API — the same standardized local model on both sides, so a corpus index is
// portable across server and browser (D11 rationale; Voyage/OpenAI were rejected for runtime egress).
export interface EmbeddingProvider {
  /** Human label (model id) for logging. */
  readonly id: string;
  /** Embed texts → vectors (same dimension for every text; unit-normalized). */
  embed(texts: string[]): Promise<number[][]>;
}

/** Cosine similarity of two vectors (0 for degenerate/empty input). */
export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  const d = Math.sqrt(na) * Math.sqrt(nb);
  return d === 0 ? 0 : dot / d;
}

/** L2-normalize a vector to unit length (a zero vector is returned unchanged). */
export function l2normalize(v: number[]): number[] {
  let n = 0;
  for (const x of v) n += x * x;
  const d = Math.sqrt(n);
  return d === 0 ? v.slice() : v.map((x) => x / d);
}

/** Rank items by cosine similarity to a query vector; top-k with scores, descending. Pure. */
export function rankByVector<T>(
  queryVec: number[],
  items: Array<{ item: T; vec: number[] }>,
  k = 3,
): Array<{ item: T; score: number }> {
  return items
    .map(({ item, vec }) => ({ item, score: cosineSim(queryVec, vec) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
