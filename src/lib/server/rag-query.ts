/**
 * RAG corpus query — BM25 retrieval over `<volume>/ai/rag/parts.jsonl`.
 *
 * Phase 2 of docs/plans/rag-prompt-builder.md. Pure functions: no Anthropic
 * SDK here, no side effects beyond a read of the corpus file. The corpus is
 * produced by `rag-corpus.ts` (Phase 1).
 *
 * BM25 design choices for cadtrain's small (~50 part) catalog:
 *   * tokenizer: lowercase, split on non-word, drop empties. Good enough
 *     given description/tags/structure are written in plain English.
 *   * doc text = description + tags joined + structure_summary. Identifier
 *     id NOT folded in — `g_spiral` would otherwise tokenize to ['g','spiral']
 *     and bias every search by id-prefix, which is noise.
 *   * k1=1.5, b=0.75 (standard defaults). Tuning is plan-deferred until the
 *     catalog grows past ~200 entries; the design doc flags an embedding
 *     upgrade as the next move, not parameter sweeps.
 */

import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import type { RagRecord } from '$lib/server/rag-corpus';

const CORPUS_REL = 'ai/rag/parts.jsonl';

// ── load ─────────────────────────────────────────────────────────────────

/** Read + parse the on-volume corpus into RagRecord[]. Returns [] when the
 *  file isn't there yet (no rebuild ever fired) so callers don't have to
 *  special-case absence. Bad lines are skipped not thrown — one corrupt
 *  record shouldn't break retrieval. */
export async function loadCorpus(): Promise<RagRecord[]> {
  const corpusPath = volumePath(CORPUS_REL);
  if (!existsSync(corpusPath)) return [];
  let body: string;
  try { body = await readFile(corpusPath, 'utf8'); }
  catch { return []; }
  const out: RagRecord[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const r = JSON.parse(trimmed) as RagRecord;
      if (r && typeof r.id === 'string') out.push(r);
    } catch { /* skip bad line */ }
  }
  return out;
}

// ── tokenize ─────────────────────────────────────────────────────────────

/** Lowercase + split on non-word + drop empties. ASCII only (the corpus
 *  is English; Unicode word-class handling would add cost for zero benefit
 *  here). */
export function tokenize(s: string): string[] {
  if (!s) return [];
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 0);
}

// ── BM25 ─────────────────────────────────────────────────────────────────

/** Score every doc against the tokenized query with BM25. Pure: no I/O, no
 *  state. Caller supplies the docs (id + text) so the same function can be
 *  reused for corpus-vs-query OR for offline ablation experiments.
 *
 *  Returns [{id, score}] sorted desc by score. Zero-scoring docs are kept
 *  in the result with score 0 so callers that want a stable top-k of the
 *  catalog can use the full output without re-zipping ids. */
export function bm25(
  query: string,
  docs: { id: string; text: string }[],
  k1 = 1.5,
  b = 0.75,
): { id: string; score: number }[] {
  const queryTokens = tokenize(query);
  if (queryTokens.length === 0 || docs.length === 0) {
    return docs.map((d) => ({ id: d.id, score: 0 }));
  }

  // Per-doc bag of tokens + length. Tokenize once up-front so the inner
  // loop only does arithmetic.
  const docTokens: string[][] = docs.map((d) => tokenize(d.text));
  const docLens = docTokens.map((t) => t.length);
  const avgLen = docLens.reduce((a, n) => a + n, 0) / Math.max(1, docs.length);

  // df = number of docs containing the term. Computed only for the query
  // terms (lazy idf — terms not in the query are never inspected).
  const df: Record<string, number> = {};
  for (const term of queryTokens) {
    if (df[term] !== undefined) continue;
    let n = 0;
    for (const dt of docTokens) {
      if (dt.includes(term)) n++;
    }
    df[term] = n;
  }
  const N = docs.length;
  const idf = (term: string): number => {
    const dfT = df[term] ?? 0;
    // Standard BM25 idf with +1 smoothing so a term in every doc still
    // contributes a tiny positive signal (instead of going negative).
    return Math.log(1 + (N - dfT + 0.5) / (dfT + 0.5));
  };

  const out: { id: string; score: number }[] = [];
  for (let i = 0; i < docs.length; i++) {
    const dt = docTokens[i];
    const dl = docLens[i];
    let score = 0;
    for (const term of queryTokens) {
      const tf = countOccurrences(dt, term);
      if (tf === 0) continue;
      const num = tf * (k1 + 1);
      const den = tf + k1 * (1 - b + b * (dl / Math.max(1, avgLen)));
      score += idf(term) * (num / den);
    }
    out.push({ id: docs[i].id, score });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

function countOccurrences(tokens: string[], term: string): number {
  let n = 0;
  for (const t of tokens) if (t === term) n++;
  return n;
}

// ── top-k ────────────────────────────────────────────────────────────────

/** Build the search text for a corpus record. Pulled out so the prompt
 *  module can render the same string into Claude's context — keeps "what
 *  was retrieved on" and "what Claude saw" identical. */
export function recordSearchText(r: RagRecord): string {
  return [r.description ?? '', (r.tags ?? []).join(' '), r.structure_summary ?? '']
    .filter((s) => s && s.length > 0)
    .join(' ');
}

/** Convenience — load the corpus, BM25-score every record vs the query,
 *  return the top-k records (full RagRecord, not just id + score). When
 *  the corpus is empty returns []. When the query is empty returns the
 *  first k records in corpus order (so a Generate-without-a-query still
 *  surfaces something to look at).
 *
 *  k defaults to 5 per the plan doc. */
export async function topK(query: string, k = 5): Promise<RagRecord[]> {
  const records = await loadCorpus();
  if (records.length === 0) return [];
  const q = (query ?? '').trim();
  if (!q) return records.slice(0, k);
  const docs = records.map((r) => ({ id: r.id, text: recordSearchText(r) }));
  const scored = bm25(q, docs);
  // bm25 returns ALL docs (zero scores included); the top-k slice is what
  // the caller asked for. Re-resolve scored ids back to full records by
  // id-keyed lookup so the order matches the bm25 ranking.
  const byId = new Map(records.map((r) => [r.id, r]));
  const out: RagRecord[] = [];
  for (const { id, score } of scored) {
    if (out.length >= k) break;
    // Once we hit zero-score entries, stop — a Generate query that matched
    // nothing should return an empty list rather than padding with
    // unrelated parts the user didn't ask about. (Empty list is a clearer
    // "no exemplars" signal than 5 random ones.)
    if (score <= 0) break;
    const rec = byId.get(id);
    if (rec) out.push(rec);
  }
  return out;
}
