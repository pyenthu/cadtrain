/**
 * RAG corpus extractor + storage — Phase 1 of the rag-prompt-builder plan
 * (docs/plans/rag-prompt-builder.md).
 *
 * Walks the on-volume `primitives/**` tree, distills each `.prim.ts` /
 * `.asm.ts` / `.prvl.ts` / `.prex.ts` to a one-line record (id, kind,
 * description, tags, params, structure_summary), and writes the result as
 * a single JSONL file at `<volume>/ai/rag/parts.jsonl`. The corpus is the
 * input to Phase 2 retrieval; Phase 1 just produces + serves it.
 *
 * Storage contract (Rule 4 — atomic writes):
 *   * Write to a sibling `.tmp` file, then `rename()` over the live file
 *     so a partial write is never visible to readers.
 *   * One JSON record per line, no enclosing array — append-safe.
 *
 * No LLM, no embeddings here — that's Phase 2.
 */

import { readdir, readFile, writeFile, rename, mkdir, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';
import {
  primIdFromFile,
  profileIdFromFile,
} from '$lib/server/primitive-paths';
import { evalMetaLiteral } from '$lib/server/primitives-meta';

export type RagRecordKind = 'prim' | 'asm' | 'prvl' | 'prex' | 'exp' | 'rev';

/** One corpus record — matches the shape in
 *  docs/plans/rag-prompt-builder.md "Corpus record shape". The extra
 *  typed kinds (exp/rev) follow the file-based layout in
 *  primitive-paths.ts (the mid-extension IS the type). */
export interface RagRecord {
  id: string;
  kind: RagRecordKind;
  description: string;
  tags: string[];
  params: string[];
  structure_summary: string;
  exemplar_path: string;        // RELATIVE to the volume root (e.g. primitives/basic/foo.prim.ts)
  updated_at: string;           // ISO timestamp of the file's mtime
}

export interface CorpusStats {
  count: number;
  /** ISO timestamp of the last successful rebuild, or null when no
   *  corpus has been written yet. */
  lastRebuiltAt: string | null;
}

const CORPUS_REL = 'ai/rag/parts.jsonl';
const CORPUS_DIR_REL = 'ai/rag';

const PRIM_EXT_RE = /\.(prim|exp|rev|asm)\.ts$/i;
const PROFILE_EXT_RE = /\.(prvl|prex)\.ts$/i;

// ── extraction ────────────────────────────────────────────────────────────

/**
 * Read a primitive/profile source file at the given ABSOLUTE path, parse
 * its `export const meta = {...}` literal, and distill to a `RagRecord`.
 * Returns null when the file isn't a recognised primitive/profile or the
 * meta literal can't be evaluated (corrupt files shouldn't poison the
 * corpus — they're skipped + counted by the caller).
 *
 * `relPath` is the path RELATIVE to the volume root (e.g.
 * `primitives/basic/foo.prim.ts`). Stored on the record so a Phase-2
 * retrieval pass can deep-link straight to the source.
 */
export async function extractRecord(absPath: string, relPath?: string): Promise<RagRecord | null> {
  // Identify the file kind from the filename. The mid-extension IS the
  // type — primitive-paths.ts is the canonical reader of this scheme.
  const fileName = absPath.split('/').pop() ?? '';
  let kind: RagRecordKind | null = null;
  let id: string | null = null;
  const primHit = primIdFromFile(fileName);
  if (primHit) {
    id = primHit.id;
    kind = primHit.kind;
  } else {
    const profHit = profileIdFromFile(fileName);
    if (profHit) {
      id = profHit.id;
      kind = profHit.ext;
    }
  }
  if (!id || !kind) return null;

  let src: string;
  try { src = await readFile(absPath, 'utf8'); }
  catch { return null; }

  // evalMetaLiteral throws on missing/unbalanced meta; caller treats that
  // as a skip rather than a hard failure (one bad part shouldn't break
  // the rebuild).
  let meta: any;
  try { meta = evalMetaLiteral(src); }
  catch { return null; }

  const description = String(meta?.description ?? meta?.name ?? id ?? '');
  const tags: string[] = Array.isArray(meta?.tags) ? meta.tags.map(String) : [];
  const params: string[] = (meta?.params && typeof meta.params === 'object')
    ? Object.keys(meta.params)
    : [];

  // structure_summary is a cheap one-liner the Phase-2 prompt template
  // can include verbatim. Prefer the K.63 composition `meta.graph` when
  // present (assemblies built in /graph-editor); else fall back to
  // counting `r_*` references in the body (heuristic, but stable for
  // hand-written primitives).
  const structure_summary = summariseStructure(meta, src);

  let updated_at = new Date().toISOString();
  try { updated_at = (await stat(absPath)).mtime.toISOString(); }
  catch { /* fall through to now() */ }

  return {
    id,
    kind,
    description,
    tags,
    params,
    structure_summary,
    exemplar_path: relPath ?? absPath,
    updated_at,
  };
}

/**
 * Derive a one-line structure summary. Three strategies, in order:
 *   1. `meta.graph` (K.63 composition graph) — count node types.
 *   2. Heuristic body scan — count `r_*(` callsites + presence of
 *      polygon literals.
 *   3. Fallback — `<kind>`.
 */
function summariseStructure(meta: any, src: string): string {
  const graph = meta?.graph;
  if (graph && Array.isArray(graph?.nodes)) {
    const counts: Record<string, number> = {};
    for (const n of graph.nodes) {
      const t = String(n?.type ?? 'unknown');
      counts[t] = (counts[t] ?? 0) + 1;
    }
    const parts: string[] = [];
    for (const t of ['call', 'polygon', 'poly_repeat', 'method', 'mv', 'rot', 'repeat', 'list', 'stack', 'group']) {
      if (counts[t]) parts.push(`${t}×${counts[t]}`);
    }
    // catch anything we didn't list explicitly
    for (const t of Object.keys(counts)) {
      if (!['call','polygon','poly_repeat','method','mv','rot','repeat','list','stack','group'].includes(t)) {
        parts.push(`${t}×${counts[t]}`);
      }
    }
    return parts.length ? `graph: ${parts.join(' + ')}` : 'graph: (empty)';
  }

  // Heuristic body scan — count r_* references. Strip comments + strings
  // would be ideal, but we're indexing not executing — a cheap regex is
  // fine for a one-line summary.
  const rCalls = src.match(/\br_[a-z][a-z0-9_]*\s*\(/g) ?? [];
  const callCounts: Record<string, number> = {};
  for (const c of rCalls) {
    const name = c.replace(/\s*\($/, '').trim();
    callCounts[name] = (callCounts[name] ?? 0) + 1;
  }
  const rTotal = rCalls.length;
  const hasPolygon = /\[\s*\[\s*-?[\d.]+\s*,\s*-?[\d.]+\s*\]/.test(src);

  const parts: string[] = [];
  if (rTotal) {
    const top = Object.entries(callCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 4)
      .map(([k, v]) => v > 1 ? `${k}×${v}` : k);
    parts.push(`calls: ${top.join(', ')}`);
  }
  if (hasPolygon) parts.push('polygon');

  return parts.length ? parts.join(' · ') : '(no structure detected)';
}

// ── walk + rebuild ────────────────────────────────────────────────────────

/**
 * Walk `<volume>/primitives` recursively, extract a record per primitive/
 * profile file, atomically write the JSONL corpus, return summary stats.
 * Skips `archive/` so soft-deleted parts don't pollute retrieval — they
 * stay reachable via /list + restore but shouldn't surface in suggestions.
 */
export async function rebuildCorpus(): Promise<{ count: number; durationMs: number; skipped: number }> {
  const t0 = Date.now();
  const root = volumePath('primitives');
  const records: RagRecord[] = [];
  let skipped = 0;

  if (existsSync(root)) {
    const files = await walkPrimitiveFiles(root);
    for (const { abs, rel } of files) {
      const rec = await extractRecord(abs, rel);
      if (rec) records.push(rec);
      else skipped++;
    }
  }

  // Stable order — easier to diff between rebuilds. Sort by relative
  // path so files near each other in the tree stay near each other in
  // the JSONL.
  records.sort((a, b) => a.exemplar_path.localeCompare(b.exemplar_path));

  // Atomic write — temp file + rename (Rule 4). Even though this isn't
  // the training cache, the corpus is regenerable so the consequence of
  // a partial write is "stats show wrong count for a moment" not data
  // loss — but the rename pattern is cheap and prevents readers seeing
  // an incomplete file.
  await mkdir(volumePath(CORPUS_DIR_REL), { recursive: true });
  const corpusPath = volumePath(CORPUS_REL);
  const tmpPath = corpusPath + '.tmp';
  const body = records.map((r) => JSON.stringify(r)).join('\n') + (records.length ? '\n' : '');
  await writeFile(tmpPath, body, 'utf8');
  await rename(tmpPath, corpusPath);

  return { count: records.length, durationMs: Date.now() - t0, skipped };
}

/**
 * Recursively walk a directory under the volume root, returning paths
 * for every `.prim.ts` / `.asm.ts` / `.exp.ts` / `.rev.ts` / `.prvl.ts`
 * / `.prex.ts` file. Skips `archive/` (soft-deleted).
 */
async function walkPrimitiveFiles(absRoot: string): Promise<{ abs: string; rel: string }[]> {
  const root = volumePath(''); // for computing relative paths
  const out: { abs: string; rel: string }[] = [];

  async function walk(dir: string): Promise<void> {
    let ents;
    try { ents = await readdir(dir, { withFileTypes: true }); }
    catch { return; }
    for (const e of ents) {
      const p = join(dir, e.name);
      if (e.isDirectory()) {
        // Skip archive/ at any level — it's a graveyard, not a corpus
        // source. Other dirs (basic, completions, profiles, completions/<family>,
        // basic/<subfolder>, …) are walked.
        if (e.name === 'archive') continue;
        await walk(p);
      } else if (e.isFile()) {
        if (PRIM_EXT_RE.test(e.name) || PROFILE_EXT_RE.test(e.name)) {
          const rel = p.startsWith(root + '/') ? p.slice(root.length + 1) : p;
          out.push({ abs: p, rel });
        }
      }
    }
  }

  await walk(absRoot);
  return out;
}

// ── stats ─────────────────────────────────────────────────────────────────

/**
 * Quick stats for the rebuild button's "last refreshed Xm ago" label.
 * Counts JSONL records by parsing line breaks; uses the file's mtime as
 * `lastRebuiltAt`. Both `null` when no corpus has been written yet.
 */
export async function readCorpusStats(): Promise<CorpusStats> {
  const corpusPath = volumePath(CORPUS_REL);
  if (!existsSync(corpusPath)) return { count: 0, lastRebuiltAt: null };
  try {
    const [body, st] = await Promise.all([
      readFile(corpusPath, 'utf8'),
      stat(corpusPath),
    ]);
    // JSONL = one record per line. Trailing newline doesn't count.
    const lines = body.split('\n').filter((l) => l.trim().length > 0);
    return { count: lines.length, lastRebuiltAt: st.mtime.toISOString() };
  } catch {
    return { count: 0, lastRebuiltAt: null };
  }
}
