/**
 * rag-chat.ts — a THIN retrieval adapter that grounds a chat→wells query in
 * cadtrain's existing corpus machinery. Phase 2 of docs/plans/chat-to-wells-ai.md.
 *
 * NOT a new retrieval engine: it REUSES `rag-query.ts`'s BM25 scorer (`bm25`,
 * which tokenizes internally) — the same scorer that backs the ✨ generate box
 * — over a HETEROGENEOUS chat corpus that spans the three sources a prompt→well
 * system needs to see:
 *
 *   • PART records   — the on-volume `ai/rag/parts.jsonl` corpus (rag-corpus.ts),
 *                      which already includes the `bw_*` well-element parts and
 *                      the `g_*` completion parts.
 *   • WELL records   — `.wson` samples distilled to searchable chunks (mirrors
 *                      SVTC's `extractWsonChunks`, adapted to cadtrain's WSON).
 *   • VOCAB records  — `docs/parts/vocabulary.json` entries (synonyms + desc),
 *                      the generative-authoring vocabulary (root CLAUDE.md
 *                      Rule 24).
 *
 * All three collapse to one `ChatCorpusRecord` shape and are scored together, so
 * a query like "add a permanent packer above the perfs" retrieves the `bw_packer`
 * part, the vocab entry for "packer", AND a sample well that uses one.
 *
 * PURE + injectable: `retrieveForChat` takes the records array as input, so the
 * ranking unit-tests against a small fixture with NO volume read (rag-chat.test.ts).
 * The `buildChatCorpus` convenience merges the on-volume parts corpus with
 * caller-supplied samples/vocab for the runtime path. No LLM here — retrieval
 * only; a later phase feeds the top-k into a grounded system prompt.
 */

import { bm25, loadCorpus } from '$lib/server/rag-query';
import type { RagRecord } from '$lib/server/rag-corpus';

// ── record shape ─────────────────────────────────────────────────────────────

export type ChatRecordKind = 'part' | 'well' | 'vocab' | 'doc';

/** One retrievable chunk in the chat corpus. `text` is the searchable body;
 *  `ref` is a deep-link the UI/model can act on (a part id, a `tool_comp` key,
 *  a sample path). */
export interface ChatCorpusRecord {
  id: string;
  kind: ChatRecordKind;
  /** Short human title for display. */
  title: string;
  /** The searchable text (what BM25 scores). */
  text: string;
  /** Provenance — which file / corpus this came from. */
  source: string;
  /** Optional actionable reference (part id / tool_comp / sample path). */
  ref?: string;
}

/** A retrieved record with its BM25 score attached. */
export type ScoredChatRecord = ChatCorpusRecord & { score: number };

/** The BM25 document text for a chat record — title folded in with the body so a
 *  query term in the title still scores. (The corpus `id` is deliberately NOT
 *  folded in, matching rag-query.ts's rationale: ids tokenize to noise.) */
function chatSearchText(r: ChatCorpusRecord): string {
  return [r.title ?? '', r.text ?? ''].filter((s) => s && s.length > 0).join(' ');
}

// ── retrieval (the reused core) ──────────────────────────────────────────────

/**
 * BM25-rank `records` against `query`, return the top-`k` (full records + score).
 * Pure — no I/O; the caller supplies the corpus so this is trivially testable
 * and reusable across corpora. Zero-score records are dropped (a query that
 * matched nothing returns [], the clearer "no context" signal — same stance as
 * rag-query.ts `topK`). An empty query returns the first `k` in corpus order.
 */
export function retrieveForChat(
  query: string,
  records: ChatCorpusRecord[],
  k = 6,
): ScoredChatRecord[] {
  if (records.length === 0) return [];
  const q = (query ?? '').trim();
  if (!q) return records.slice(0, k).map((r) => ({ ...r, score: 0 }));

  const docs = records.map((r) => ({ id: r.id, text: chatSearchText(r) }));
  const scored = bm25(q, docs); // reuse the existing scorer
  const byId = new Map(records.map((r) => [r.id, r]));

  const out: ScoredChatRecord[] = [];
  for (const { id, score } of scored) {
    if (out.length >= k) break;
    if (score <= 0) break; // ranking is desc; once we hit 0 there's nothing left
    const rec = byId.get(id);
    if (rec) out.push({ ...rec, score });
  }
  return out;
}

/** Render the retrieved records into a prompt-ready context block — the
 *  cadtrain analogue of SVTC's `buildRagContext`. Kept here so "what was
 *  retrieved" and "what the model saw" stay identical. A later phase drops this
 *  into the grounded system prompt; returned as a string, no LLM call. */
export function renderChatContext(records: ScoredChatRecord[]): string {
  if (records.length === 0) return '';
  const lines = records.map((r) => {
    const refBit = r.ref ? ` (${r.ref})` : '';
    return `- [${r.kind}] ${r.title}${refBit}: ${r.text}`;
  });
  return `RELEVANT CONTEXT (well parts, vocabulary, sample wells):\n${lines.join('\n')}`;
}

// ── extractors: heterogeneous sources → ChatCorpusRecord[] ───────────────────

/** Adapt a parts-corpus `RagRecord` (from `ai/rag/parts.jsonl`, incl. the
 *  `bw_*` well elements) into a chat record. */
export function ragRecordToChatRecord(r: RagRecord): ChatCorpusRecord {
  const text = [
    r.description ?? '',
    (r.tags ?? []).join(' '),
    r.structure_summary ?? '',
    (r.params ?? []).length ? `params: ${(r.params ?? []).join(', ')}` : '',
  ]
    .filter((s) => s && s.length > 0)
    .join('. ');
  return {
    id: `part:${r.id}`,
    kind: 'part',
    title: r.id,
    text,
    source: r.exemplar_path ?? 'parts.jsonl',
    ref: r.id,
  };
}

/**
 * Distill a WSON well into a small set of searchable chunks — mirrors SVTC's
 * `extractWsonChunks`, adapted to cadtrain's WSON (`meta/ch/oh/completions/
 * perforations/cementing/profile`, metres + inches). Loose input type so it
 * never depends on the wells geometry stack.
 */
export function wsonToChatRecords(wson: Record<string, any>, source: string): ChatCorpusRecord[] {
  if (!wson || typeof wson !== 'object') return [];
  const out: ChatCorpusRecord[] = [];
  const meta = (wson.meta ?? {}) as Record<string, any>;
  const name = String(meta.wellName ?? 'Unknown well');
  const base = source.replace(/\.wson$/i, '');

  const ch = Array.isArray(wson.ch) ? wson.ch : [];
  const oh = Array.isArray(wson.oh) ? wson.oh : [];
  const comps = Array.isArray(wson.completions) ? wson.completions : [];
  const perfs = Array.isArray(wson.perforations) ? wson.perforations : [];
  const prof = Array.isArray(wson.profile) ? wson.profile : [];

  const maxInc = prof.reduce((m: number, s: any) => Math.max(m, Number(s?.dev ?? 0)), 0);
  const deviated = prof.length > 1 && maxInc > 0.5;

  // Summary chunk.
  out.push({
    id: `well:${base}:summary`,
    kind: 'well',
    title: name,
    text:
      `Sample well "${name}" — type ${meta._wellType ?? 'unspecified'}, TD ${meta.td ?? '?'}m, ` +
      `${ch.length} casing strings, ${oh.length} open holes, ${comps.length} completion components, ` +
      `${perfs.length} perforation intervals, ${deviated ? `deviated (max ${maxInc.toFixed(0)}°)` : 'vertical'}.`,
    source,
    ref: source,
  });

  // Casing program.
  if (ch.length) {
    const prog = ch
      .map((c: any) => `${c.od}" ${c.grade ?? ''} ${c.type ?? ''} ${c.top}-${c.bot}m`.replace(/\s+/g, ' ').trim())
      .join('; ');
    out.push({
      id: `well:${base}:casing`,
      kind: 'well',
      title: `${name} casing program`,
      text: `Casing/tubular program of "${name}": ${prog}`,
      source,
      ref: source,
    });
  }

  // Completion string (the tool_comp catalogue in context).
  if (comps.length) {
    const stack = comps
      .map((c: any) => `${c.description ?? c.tool_comp} [${c.tool_comp}]`)
      .join('; ');
    out.push({
      id: `well:${base}:completions`,
      kind: 'well',
      title: `${name} completion string`,
      text: `Completion components of "${name}": ${stack}`,
      source,
      ref: source,
    });
  }

  // Perforations.
  if (perfs.length) {
    const p = perfs.map((x: any) => `${x.top}-${x.bot}m${x.label ? ` (${x.label})` : ''}`).join('; ');
    out.push({
      id: `well:${base}:perfs`,
      kind: 'well',
      title: `${name} perforations`,
      text: `Perforations of "${name}": ${p}`,
      source,
      ref: source,
    });
  }

  return out;
}

/**
 * Adapt `docs/parts/vocabulary.json` entries into chat records. Tolerant of the
 * two shapes the vocabulary file can take (a bare array of entries, or an object
 * with an `entries` / `vocab` array) so a schema tweak doesn't break retrieval.
 * Each entry contributes its id, synonyms, and description to the search text.
 */
export function vocabToChatRecords(vocab: unknown): ChatCorpusRecord[] {
  const entries: any[] = Array.isArray(vocab)
    ? vocab
    : Array.isArray((vocab as any)?.entries)
      ? (vocab as any).entries
      : Array.isArray((vocab as any)?.vocab)
        ? (vocab as any).vocab
        : [];

  const out: ChatCorpusRecord[] = [];
  for (const e of entries) {
    if (!e || typeof e !== 'object') continue;
    const id = String(e.id ?? e.name ?? e.key ?? '').trim();
    if (!id) continue;
    const syn: string[] = Array.isArray(e.synonyms) ? e.synonyms.map(String) : [];
    const tags: string[] = Array.isArray(e.tags) ? e.tags.map(String) : [];
    const desc = String(e.description ?? e.desc ?? '').trim();
    const text = [desc, syn.length ? `synonyms: ${syn.join(', ')}` : '', tags.join(' ')]
      .filter((s) => s && s.length > 0)
      .join('. ');
    out.push({
      id: `vocab:${id}`,
      kind: 'vocab',
      title: id,
      text: text || id,
      source: 'vocabulary.json',
      ref: id,
    });
  }
  return out;
}

// ── runtime corpus assembly (thin) ───────────────────────────────────────────

export interface BuildChatCorpusInput {
  /** WSON samples to fold in — `{ name, wson }` pairs. The runtime endpoint
   *  supplies these (e.g. from the wells samples glob) so this module stays
   *  free of the wells geometry stack. */
  samples?: Array<{ name: string; wson: Record<string, any> }>;
  /** Parsed `vocabulary.json` (any of the tolerated shapes). */
  vocab?: unknown;
  /** Skip the on-volume parts corpus (tests / offline). */
  skipParts?: boolean;
}

/**
 * Assemble the full chat corpus: the on-volume parts corpus (`bw_*` + `g_*`)
 * merged with the supplied WSON samples + vocabulary. Runtime convenience for a
 * `/api/ai/chat`-style endpoint — the parts read is the only I/O and is skipped
 * in tests (`skipParts`). Returns a flat `ChatCorpusRecord[]` ready for
 * `retrieveForChat`.
 */
export async function buildChatCorpus(input: BuildChatCorpusInput = {}): Promise<ChatCorpusRecord[]> {
  const out: ChatCorpusRecord[] = [];

  if (!input.skipParts) {
    try {
      const parts = await loadCorpus(); // reuse rag-corpus/rag-query volume reader
      for (const p of parts) out.push(ragRecordToChatRecord(p));
    } catch {
      /* corpus absent (never rebuilt) → parts simply don't contribute */
    }
  }

  for (const s of input.samples ?? []) {
    out.push(...wsonToChatRecords(s.wson, s.name));
  }

  if (input.vocab !== undefined) {
    out.push(...vocabToChatRecords(input.vocab));
  }

  return out;
}
