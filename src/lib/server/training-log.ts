/**
 * training-log.ts — the on-volume supervised-training / correction register for
 * the chat→wells local-AI loop (Phase 1 of docs/plans/chat-to-wells-ai.md).
 *
 * This is cadtrain's server-side answer to SVTC's client-side `trainingLog.js`
 * (`~/code/SVTC/src/lib/ai/trainingLog.js`), generalised past SVTC's flat
 * `{instruction, output}` pairs to also capture the two signals the user
 * explicitly wants for a prompt→well system:
 *
 *   1. `wrongResponse` — SVTC's "needs work" register: a prompt + the model
 *      output that was wrong, an optional user CORRECTION, and provenance
 *      (source / toolName / prior turns). Feeds a preference / negative set.
 *   2. `wellEdit`      — a (instruction, well_before, well_after, diff) TUPLE,
 *      recorded whenever a user ENHANCES/modifies a well. This is the primary
 *      supervised signal for prompt→well-EDIT. `diff` is a compact structural
 *      JSON diff (see `diffWell`) so a training job can learn the EDIT, not
 *      just the end state.
 *   3. `wellSnapshot`  — a full-well capture + provenance, for prompt→well
 *      (whole-schematic generation) and as the `before`/`after` anchor a diff
 *      references.
 *
 * STORAGE CONTRACT (root CLAUDE.md Rule 4 + Rule 13):
 *   * One JSON record per line (JSONL), append-only, at
 *     `<volume>/ai/training-log.jsonl` — mirrors the `ai/rag/parts.jsonl`
 *     corpus convention (rag-corpus.ts) so the whole `ai/` subtree is one
 *     family of newline-delimited stores.
 *   * `appendRecord` uses `fs.appendFile` (O_APPEND) — the atomic append for a
 *     JSONL log. This DIFFERS from rag-corpus.ts's temp-file+rename, on
 *     purpose: the corpus is REGENERABLE (full rewrite is cheap + safe), but a
 *     training log is APPEND-ONLY and must never rewrite prior records (Rule 4
 *     "never clobber"). `listRecords` tolerates a torn trailing line (skips
 *     unparseable), so a crash mid-append costs at most the in-flight record.
 *
 * LOCAL-FIRST NOTE (memory `ai_data_residency_local_first`): the on-volume log
 * is a DEV / authoring artefact — the corpus a fine-tune job consumes. Runtime
 * capture in the browser (IndexedDB, like SVTC) with an explicit user-consented
 * flush is the production stance; this module is the SERVER sink that flush
 * targets. No LLM is called here.
 *
 * PURE where it can be: `diffWell` + `summarizeWellDiff` are dependency-free and
 * headless-tested (`training-log.test.ts`); the I/O fns take an optional
 * `filePath` so tests write to a temp dir and NEVER touch the shared volume.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { volumePath } from '$lib/server/volume';

// ── record shapes ──────────────────────────────────────────────────────────

export type TrainingRecordKind = 'wrongResponse' | 'wellEdit' | 'wellSnapshot';

/** A WSON-shaped document. Typed loosely (structural JSON) so this module has
 *  ZERO dependency on the wells geometry stack and `diffWell` stays a general
 *  JSON differ — the WSON authored model is the canonical before/after form
 *  (see docs/plans/chat-to-wells-ai.md §"Why WSON, not the graph"). */
export type WellJson = Record<string, unknown>;

/** Common provenance carried by every record so a later training job can
 *  filter / weight (which model, which well, which chat session, when). */
interface BaseRecord {
  /** Stable unique id — assigned by `appendRecord` when absent. */
  id: string;
  kind: TrainingRecordKind;
  /** ISO-8601 capture time — assigned by `appendRecord` when absent. */
  ts: string;
  /** Chat / edit session id (groups a multi-turn interaction). */
  session?: string;
  /** Which well the record concerns (file id or well name) — provenance. */
  wellId?: string;
  /** The model that produced the response/edit (provenance for eval slicing). */
  model?: string;
}

/**
 * SVTC's "needs work" pair, generalised: the prompt + the wrong output, an
 * optional user-authored CORRECTION (the expected output — SVTC has no explicit
 * correction field, only a flag), plus the diagnostic provenance SVTC captures.
 */
export interface WrongResponseRecord extends BaseRecord {
  kind: 'wrongResponse';
  /** The user instruction that produced the output. */
  instruction: string;
  /** The model output that was wrong (assistant text OR a tool-call JSON blob). */
  output: string;
  /** The user-supplied fix / expected output. Absent = flagged-but-uncorrected
   *  (still useful as a negative example). */
  correction?: string;
  /** Free-text note from the user's "needs work" click. */
  note?: string;
  /** Who flagged it — SVTC's `source`: 'user' | 'tool-error' | 'api-error' |
   *  'create-intent-miss' | … (open string so new sources don't need a schema
   *  bump). */
  source: string;
  /** When source is a tool failure, which tool. */
  toolName?: string | null;
  /** Up to N prior turns for diagnosability (SVTC captures 3). */
  context?: Array<{ role: string; content: string }> | null;
}

/** One structural-diff operation between two well documents (JSON-pointer path). */
export interface WellDiffOp {
  op: 'add' | 'remove' | 'replace';
  /** JSON-pointer-ish path, e.g. `/ch/2/bot` or `/completions/4`. */
  path: string;
  /** Prior value (for `remove` / `replace`). */
  before?: unknown;
  /** New value (for `add` / `replace`). */
  after?: unknown;
}

/**
 * The prompt→well-EDIT tuple. Recorded whenever a user enhances/modifies a well
 * (the user's explicit ask: "if I enhance and get a modified well, that should
 * also be recorded"). `diff` is the compact edit; `before`/`after` are the full
 * WSON anchors so a training job can reconstruct either the patch or the pair.
 */
export interface WellEditRecord extends BaseRecord {
  kind: 'wellEdit';
  /** The NL instruction that drove the edit ('' for a purely manual edit —
   *  still a valuable (state, diff) pair even without a prompt). */
  instruction: string;
  /** WSON before the edit. */
  before: WellJson;
  /** WSON after the edit. */
  after: WellJson;
  /** Structural diff before→after. */
  diff: WellDiffOp[];
  /** Human-readable one-line summary of the diff. */
  summary: string;
  /** Where the edit came from: 'chat' (AI tool-call), 'manual' (editor UI),
   *  'tool' (scripted), … Open string. */
  origin: string;
}

/** A full-well capture + provenance — prompt→well (generation) supervision and
 *  the anchor a `wellEdit` diff is relative to. */
export interface WellSnapshotRecord extends BaseRecord {
  kind: 'wellSnapshot';
  /** The complete WSON document. */
  wson: WellJson;
  /** Optional label (archetype name, "post-generate", "baseline", …). */
  label?: string;
  /** Where the snapshot came from: 'generate' | 'load' | 'checkpoint' | … */
  origin?: string;
  /** The instruction that generated this well, when it was AI-generated. */
  instruction?: string;
}

export type TrainingRecord = WrongResponseRecord | WellEditRecord | WellSnapshotRecord;

/** The input to `appendRecord`: `id` + `ts` are optional (filled in on write). */
export type TrainingRecordInput =
  | (Omit<WrongResponseRecord, 'id' | 'ts'> & { id?: string; ts?: string })
  | (Omit<WellEditRecord, 'id' | 'ts'> & { id?: string; ts?: string })
  | (Omit<WellSnapshotRecord, 'id' | 'ts'> & { id?: string; ts?: string });

// ── paths ──────────────────────────────────────────────────────────────────

/** Relative path of the log under the volume root. Kept public so callers /
 *  tests can reference the exact location. */
export const TRAINING_LOG_REL = 'ai/training-log.jsonl';

/** The default absolute path — resolved lazily (NOT at import time) so a test
 *  that sets `CADTRAIN_VOLUME_ROOT` still gets the override, and so importing
 *  this module never assumes a volume exists. */
export function defaultLogPath(): string {
  return volumePath(TRAINING_LOG_REL);
}

export interface LogFileOpt {
  /** Absolute path override — tests pass a temp file so the shared volume is
   *  never written. Defaults to `defaultLogPath()`. */
  filePath?: string;
}

// ── id / time helpers ──────────────────────────────────────────────────────

let _seq = 0;
/** A sortable, collision-resistant id: time + a per-process counter + entropy.
 *  Not a UUID (no crypto dep needed) — good enough to key training rows. */
export function makeId(kind: TrainingRecordKind): string {
  _seq = (_seq + 1) % 0xffff;
  const t = Date.now().toString(36);
  const s = _seq.toString(36).padStart(3, '0');
  const r = Math.floor(Math.random() * 0xffffff).toString(36);
  return `${kind[0]}${t}${s}${r}`;
}

// ── append / read ───────────────────────────────────────────────────────────

/**
 * Append ONE training record to the JSONL log. Fills `id` + `ts` when absent.
 * Creates the `ai/` dir on first write. Returns the fully-stamped record.
 *
 * Atomicity: a single `appendFile` of a newline-terminated line is the
 * idiomatic atomic JSONL append (O_APPEND). We never rewrite existing lines, so
 * prior records are never clobbered (Rule 4). Serialisation failures throw
 * BEFORE any write so a bad record can't tear the file.
 */
export async function appendRecord(
  input: TrainingRecordInput,
  opt: LogFileOpt = {},
): Promise<TrainingRecord> {
  const rec = {
    ...input,
    id: input.id ?? makeId(input.kind),
    ts: input.ts ?? new Date().toISOString(),
  } as TrainingRecord;

  // Serialise FIRST — if this throws (circular ref, BigInt, …) nothing is
  // written, so the log stays intact.
  const line = JSON.stringify(rec) + '\n';

  const path = opt.filePath ?? defaultLogPath();
  const dir = dirname(path);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  await appendFile(path, line, 'utf8');
  return rec;
}

export interface ListOpt extends LogFileOpt {
  /** Only return records of this kind. */
  kind?: TrainingRecordKind;
}

/**
 * Read every record from the log. Returns `[]` when the file doesn't exist yet
 * (no capture ever happened) so callers don't special-case absence. A torn /
 * malformed trailing line is SKIPPED (mirrors rag-query.ts `loadCorpus`) — a
 * crash mid-append never breaks the reader.
 */
export async function listRecords(opt: ListOpt = {}): Promise<TrainingRecord[]> {
  const path = opt.filePath ?? defaultLogPath();
  if (!existsSync(path)) return [];
  let body: string;
  try {
    body = await readFile(path, 'utf8');
  } catch {
    return [];
  }
  const out: TrainingRecord[] = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: TrainingRecord | null = null;
    try {
      const parsed = JSON.parse(trimmed) as TrainingRecord;
      if (parsed && typeof parsed === 'object' && typeof (parsed as any).kind === 'string') {
        rec = parsed;
      }
    } catch {
      /* skip a bad / torn line */
    }
    if (rec && (!opt.kind || rec.kind === opt.kind)) out.push(rec);
  }
  return out;
}

/** Count records (optionally by kind) without materialising full objects into
 *  the caller. Cheap "how much training data have we got?" for a stats badge. */
export async function countRecords(opt: ListOpt = {}): Promise<number> {
  const recs = await listRecords(opt);
  return recs.length;
}

// ── structural well diff ─────────────────────────────────────────────────────

/**
 * Compute a compact STRUCTURAL diff between two well documents (WSON). General
 * recursive JSON diff, but tuned for WSON's shape: the top-level element arrays
 * (`ch`/`oh`/`completions`/`perforations`/`cementing`/`profile`) diff
 * ELEMENT-WISE by index, and objects (`meta`, an element row, `meta.location`)
 * diff FIELD-WISE — so the ops read as "ch[2].bot 1070→1200" rather than an
 * opaque whole-array replace. Pure + dependency-free.
 *
 * Design choice (WSON vs composition-graph): the before/after are the WSON
 * AUTHORED model, NOT the derived composition-graph. WSON is the layer the user
 * actually edits; it's compact, human-readable, kernel-version-independent, and
 * directly reversible. The graph is regenerated from WSON by
 * `wson-to-graph.ts`, so diffing it would couple training data to the geometry
 * pipeline version. See docs/plans/chat-to-wells-ai.md §"Why WSON".
 */
export function diffWell(before: WellJson, after: WellJson): WellDiffOp[] {
  const ops: WellDiffOp[] = [];
  diffValue('', before, after, ops);
  return ops;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Element-wise array diff (indices align; extras add/remove). */
function diffArrays(path: string, a: unknown[], b: unknown[], ops: WellDiffOp[]): void {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    diffValue(`${path}/${i}`, a[i], b[i], ops);
  }
}

/** Recurse. `path` is a JSON-pointer prefix ('' at the root). */
function diffValue(path: string, a: unknown, b: unknown, ops: WellDiffOp[]): void {
  if (a === b) return;

  const aMissing = a === undefined;
  const bMissing = b === undefined;

  // Exactly one side missing. If the PRESENT side is an ARRAY, recurse element-
  // wise (treating the missing side as []) so an appended / removed element
  // reads as `/completions/0` — the same shape whether or not the array pre-
  // existed (the "enhance" case). A missing OBJECT / scalar is a single whole
  // add/remove (a fresh `meta.location` is one `add`, not one op per field).
  if (aMissing !== bMissing) {
    const present = aMissing ? b : a;
    if (Array.isArray(present)) {
      diffArrays(path, aMissing ? [] : (a as unknown[]), bMissing ? [] : (b as unknown[]), ops);
      return;
    }
    if (aMissing) ops.push({ op: 'add', path: path || '/', after: b });
    else ops.push({ op: 'remove', path: path || '/', before: a });
    return;
  }

  // Both present. Same-shape objects / arrays recurse; otherwise it's a replace.
  if (Array.isArray(a) && Array.isArray(b)) {
    diffArrays(path, a, b, ops);
    return;
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
    for (const k of keys) {
      diffValue(`${path}/${escapePointer(k)}`, a[k], b[k], ops);
    }
    return;
  }

  // Scalars (or shape mismatch, e.g. object↔array) → replace if unequal.
  if (!deepEqual(a, b)) {
    ops.push({ op: 'replace', path: path || '/', before: a, after: b });
  }
}

/** JSON-pointer escaping (RFC 6901): `~` → `~0`, `/` → `~1`. WSON keys are
 *  plain identifiers so this is mostly a no-op, but correct by construction. */
function escapePointer(k: string): string {
  return k.replace(/~/g, '~0').replace(/\//g, '~1');
}

/** Structural equality for the scalar/leaf comparison (arrays+objects are
 *  handled by recursion, so this only fires on leaves + shape mismatches). */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return a === b;
  if (typeof a !== 'object') return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

// ── diff summary ─────────────────────────────────────────────────────────────

/** Render a compact one-line summary of a well diff — the human-readable
 *  `summary` a `WellEditRecord` carries + what a review UI shows. Groups by the
 *  top-level array touched (ch/oh/completions/…) with add/remove/change counts,
 *  then lists the first few concrete field changes. Pure. */
export function summarizeWellDiff(ops: WellDiffOp[], maxDetail = 3): string {
  if (ops.length === 0) return 'no change';

  // Bucket by the FIRST path segment (the top-level WSON key).
  const byKey = new Map<string, { add: number; remove: number; replace: number }>();
  for (const op of ops) {
    const seg = op.path.split('/')[1] || '(root)';
    const b = byKey.get(seg) ?? { add: 0, remove: 0, replace: 0 };
    b[op.op]++;
    byKey.set(seg, b);
  }

  const groups: string[] = [];
  for (const [key, c] of byKey) {
    const bits: string[] = [];
    if (c.add) bits.push(`+${c.add}`);
    if (c.remove) bits.push(`-${c.remove}`);
    if (c.replace) bits.push(`~${c.replace}`);
    groups.push(`${key} ${bits.join(' ')}`);
  }

  // A few concrete field changes for readability.
  const details: string[] = [];
  for (const op of ops) {
    if (details.length >= maxDetail) break;
    if (op.op === 'replace') {
      details.push(`${trimPath(op.path)} ${fmt(op.before)}→${fmt(op.after)}`);
    } else if (op.op === 'add') {
      details.push(`+${trimPath(op.path)}`);
    } else {
      details.push(`-${trimPath(op.path)}`);
    }
  }

  const head = `${ops.length} change${ops.length === 1 ? '' : 's'} (${groups.join('; ')})`;
  return details.length ? `${head}: ${details.join('; ')}` : head;
}

function trimPath(p: string): string {
  return p.replace(/^\//, '').replace(/\//g, '.');
}

function fmt(v: unknown): string {
  if (v === undefined) return '∅';
  if (v === null) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (typeof v === 'string') return v.length > 24 ? `"${v.slice(0, 21)}…"` : `"${v}"`;
  const j = JSON.stringify(v);
  return j.length > 32 ? j.slice(0, 29) + '…}' : j;
}

// ── convenience builder ──────────────────────────────────────────────────────

/**
 * Build a `wellEdit` record from a before/after pair — computes the diff +
 * summary so a caller (a client edit hook, an endpoint) doesn't repeat the
 * wiring. Does NOT write; pass the result to `appendRecord`. Pure.
 */
export function buildWellEditRecord(args: {
  instruction: string;
  before: WellJson;
  after: WellJson;
  origin?: string;
  wellId?: string;
  session?: string;
  model?: string;
}): Omit<WellEditRecord, 'id' | 'ts'> {
  const diff = diffWell(args.before, args.after);
  return {
    kind: 'wellEdit',
    instruction: args.instruction,
    before: args.before,
    after: args.after,
    diff,
    summary: summarizeWellDiff(diff),
    origin: args.origin ?? 'manual',
    wellId: args.wellId,
    session: args.session,
    model: args.model,
  };
}
