/**
 * well-samples.ts — the on-volume WSON well-sample store.
 *
 * The `/wells` sample wells used to live ONLY in the source tree
 * (`src/lib/wells/samples/*.wson`, loaded via an eager `import.meta.glob`), so a
 * user could not add / edit / customise them without a code edit + dev restart.
 * This module moves the canonical copy onto the **persistent data volume**
 * (root CLAUDE.md Rule 13) under `wells/samples/`, exactly like `primitives/`,
 * so the set is live-editable through `/api/wells/samples`.
 *
 * STORAGE CONTRACT (Rule 4 + Rule 13):
 *   * Files live at `<volume>/wells/samples/<name>.wson`.
 *   * `writeWellSample` is a temp-file + `rename()` ATOMIC write (mirrors
 *     `rag-corpus.ts`) — a reader never sees a half-written `.wson`.
 *   * `seedIfEmpty` populates the volume dir from the bundled seed set the FIRST
 *     time it's empty, so a fresh volume is never blank. The bundled
 *     `src/lib/wells/samples/*.wson` files stay in the tree as that seed source.
 *
 * FORMAT-AGNOSTIC BY DESIGN (#77 lookahead): the file ops key on a generic
 * `.wson` filename under one wells dir — nothing here parses WSON. When #77
 * remodels WSON → a native graph doc, the same store holds those docs (extend
 * the extension allowlist); the endpoint stays a plain file list/read/write.
 *
 * TESTABILITY (mirrors `training-log.ts`): every FS fn takes an optional
 * `{ dir }` override so `well-samples.test.ts` writes to an `os.tmpdir()` dir
 * and NEVER touches the shared `.dev-volume` / prod volume.
 */

import { readdir, readFile, writeFile, rename, mkdir, stat, unlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { volumePath } from '$lib/server/volume';

/** Volume-relative directory holding the WSON sample wells. */
export const WELLS_SAMPLES_REL = 'wells/samples';

/** Absolute path of the on-volume sample dir (root CLAUDE.md Rule 13). */
export function wellsSamplesDir(): string {
  return volumePath(WELLS_SAMPLES_REL);
}

/** One sample file as returned by the store. `text` is the raw `.wson` source
 *  (unparsed — this module is format-agnostic). */
export interface WellSampleFile {
  /** Filename WITH extension, e.g. `01-vertical-land-producer.wson`. */
  name: string;
  /** Filename stem (selection/tab key), e.g. `01-vertical-land-producer`. */
  slug: string;
  /** Raw file source. */
  text: string;
  /** Byte length of `text`. */
  size: number;
}

// ── Bundled seed set ─────────────────────────────────────────────────────────
// The git-tracked `src/lib/wells/samples/*.wson` files, baked into the build via
// `?raw` glob. Used ONLY to seed an empty volume (seedIfEmpty); once the volume
// has files, this is never read. Removing the src files is safe AFTER the volume
// is confirmed seeded in prod (see report / scripts/seed-well-samples.ts).
const bundledRaw = import.meta.glob('/src/lib/wells/samples/*.wson', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** The bundled seed samples as `{name,text}`, sorted by name. */
export function bundledSamples(): Array<{ name: string; text: string }> {
  return Object.entries(bundledRaw)
    .map(([path, text]) => ({ name: (path.split('/').pop() ?? '').trim(), text }))
    .filter((f) => f.name)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// ── Name safety ──────────────────────────────────────────────────────────────
// A sample name is a bare `.wson` filename — no path separators, no traversal.
// safeVolumePath would also catch traversal, but validating the filename up
// front lets the endpoint return a clean 400 and forbids nested writes.
const SAFE_SAMPLE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*\.wson$/i;

/** True when `name` is a safe bare `<stem>.wson` filename (no `/`, `\`, `..`). */
export function isValidSampleName(name: string): boolean {
  if (typeof name !== 'string' || name.length > 128) return false;
  if (name.includes('/') || name.includes('\\') || name.includes('..')) return false;
  return SAFE_SAMPLE_NAME.test(name);
}

function assertValidSampleName(name: string): void {
  if (!isValidSampleName(name)) {
    throw new Error(`Invalid WSON sample name: ${JSON.stringify(name)}`);
  }
}

function slugOf(name: string): string {
  return name.replace(/\.wson$/i, '');
}

function baseDir(opts?: { dir?: string }): string {
  return opts?.dir ?? wellsSamplesDir();
}

// ── FS operations ────────────────────────────────────────────────────────────

/** List every `.wson` in the sample dir (sorted by name). Missing dir → []. */
export async function listWellSamples(opts?: { dir?: string }): Promise<WellSampleFile[]> {
  const dir = baseDir(opts);
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (e: any) {
    if (e?.code === 'ENOENT') return [];
    throw e;
  }
  const wson = names.filter((n) => isValidSampleName(n)).sort((a, b) => a.localeCompare(b));
  const out: WellSampleFile[] = [];
  for (const name of wson) {
    try {
      const text = await readFile(join(dir, name), 'utf8');
      out.push({ name, slug: slugOf(name), text, size: Buffer.byteLength(text) });
    } catch {
      /* skip a file that vanished / is unreadable between readdir and read */
    }
  }
  return out;
}

/** Read a single sample's raw text, or `null` when it doesn't exist. */
export async function readWellSample(name: string, opts?: { dir?: string }): Promise<string | null> {
  assertValidSampleName(name);
  try {
    return await readFile(join(baseDir(opts), name), 'utf8');
  } catch (e: any) {
    if (e?.code === 'ENOENT') return null;
    throw e;
  }
}

/**
 * Atomically write a sample (Rule 4: temp file + rename). Creates the dir if
 * needed. Returns the stored file's metadata.
 */
export async function writeWellSample(
  name: string,
  text: string,
  opts?: { dir?: string },
): Promise<WellSampleFile> {
  assertValidSampleName(name);
  const dir = baseDir(opts);
  if (!existsSync(dir)) await mkdir(dir, { recursive: true });
  const target = join(dir, name);
  const tmp = join(dir, `.${name}.${randomUUID()}.tmp`);
  try {
    await writeFile(tmp, text, 'utf8');
    await rename(tmp, target);
  } catch (e) {
    await unlink(tmp).catch(() => {});
    throw e;
  }
  const st = await stat(target);
  return { name, slug: slugOf(name), text, size: st.size };
}

/** Delete a sample. Returns true if a file was removed, false if absent. */
export async function deleteWellSample(name: string, opts?: { dir?: string }): Promise<boolean> {
  assertValidSampleName(name);
  try {
    await unlink(join(baseDir(opts), name));
    return true;
  } catch (e: any) {
    if (e?.code === 'ENOENT') return false;
    throw e;
  }
}

/**
 * Seed the volume dir from the bundled set the FIRST time it's empty. No-op once
 * any `.wson` exists (users can add/remove freely afterwards). Idempotent +
 * race-safe (writes are atomic + content-identical). Returns how many were
 * written.
 */
export async function seedIfEmpty(opts?: { dir?: string }): Promise<{ seeded: number; existing: number }> {
  const existing = await listWellSamples(opts);
  if (existing.length > 0) return { seeded: 0, existing: existing.length };
  let seeded = 0;
  for (const { name, text } of bundledSamples()) {
    if (!isValidSampleName(name)) continue;
    await writeWellSample(name, text, opts);
    seeded++;
  }
  return { seeded, existing: 0 };
}
