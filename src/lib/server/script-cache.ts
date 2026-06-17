/**
 * Script cache — persistent cache of /api/primitives/compile output.
 *
 * Mirrors bake-cache.ts in shape, but stores TEXT scripts (KB-scale) instead of
 * baked meshes (MB-scale). The compile step is a pure function of the resolved,
 * dep-inlined script; its sha256 IS the cache key (see compilePrimitiveScript).
 * Because the script folds in dependency source, a dep edit changes the hash →
 * a fresh entry → the "deja-vu" stale-bake bug is impossible by construction
 * (no dep-aware key gymnastics needed — it's free).
 *
 * Layout (one file per script — the .meta sidecar of bake-cache is unnecessary
 * because the hash already keys on the full script content):
 *   $APP_DATA_DIR/cache/scripts/<part_id>/<scriptHash>.js   ← the script text
 *
 * All writes are ATOMIC (temp file + rename, Rule 4). Reads are tolerant of
 * missing / partial entries — they count as a miss and the caller re-compiles.
 */
import { mkdir, readFile, rename, rm, stat, unlink, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from './volume';

const CACHE_DIR = join('cache', 'scripts');
/** Validate part_id up-front so a malformed id can't escape the cache dir via
 *  path traversal. Same regex bake-cache.ts uses. */
const PART_ID_RE = /^[a-z_][a-z0-9_]*$/i;
/** sha256 hex is 64 chars; accept the full digest (compile emits the full hex). */
const HASH_RE = /^[0-9a-f]{8,64}$/i;

function partCacheDir(partId: string): string {
  if (!PART_ID_RE.test(partId)) {
    throw new Error(`script-cache: invalid part_id "${partId}"`);
  }
  return volumePath(join(CACHE_DIR, partId));
}

function scriptPath(partId: string, scriptHash: string): string {
  if (!HASH_RE.test(scriptHash)) {
    throw new Error(`script-cache: invalid scriptHash "${scriptHash}"`);
  }
  return join(partCacheDir(partId), `${scriptHash}.js`);
}

/** Look up a cached script. Returns null on miss / corrupt entry / I/O error
 *  (callers re-compile on null — safe to fall back). */
export async function readScriptCache(partId: string, scriptHash: string): Promise<string | null> {
  try {
    const text = await readFile(scriptPath(partId, scriptHash), 'utf8');
    return text.length ? text : null;
  } catch {
    return null;
  }
}

/** Write a script cache entry. ATOMIC via .tmp + rename. Best-effort — a write
 *  failure doesn't break the compile response (the script is the source of
 *  truth; the cache just makes the next call a hit). */
export async function writeScriptCache(partId: string, scriptHash: string, script: string): Promise<void> {
  const dir = partCacheDir(partId);
  const target = scriptPath(partId, scriptHash);
  await mkdir(dir, { recursive: true });
  const tmp = `${target}.tmp.${process.pid}.${Date.now()}`;
  await writeFile(tmp, script, 'utf8');
  await rename(tmp, target);
}

/** Clear options — symmetrical with bake-cache's clear. */
export interface ScriptCacheClearOptions {
  partId?: string;
  scriptHash?: string;
}

/** Clear script-cache entries. Tolerant of missing files / dirs. Returns counts
 *  so a caller can report what was cleared. */
export async function clearScriptCache(opts: ScriptCacheClearOptions): Promise<{ cleared: number; bytes: number }> {
  let cleared = 0;
  let bytes = 0;

  // Specific script within a part.
  if (opts.partId && opts.scriptHash) {
    const p = scriptPath(opts.partId, opts.scriptHash);
    try {
      const s = await stat(p);
      bytes += s.size;
      cleared++;
      await unlink(p);
    } catch { /* missing — ignore */ }
    return { cleared, bytes };
  }

  // Part-wide — wipe the part's whole script dir.
  if (opts.partId) {
    const dir = partCacheDir(opts.partId);
    try {
      const entries = await readdir(dir);
      for (const name of entries) {
        if (!name.endsWith('.js')) continue;
        try {
          const s = await stat(join(dir, name));
          bytes += s.size;
          cleared++;
        } catch { /* skip */ }
      }
      await rm(dir, { recursive: true, force: true });
    } catch { /* missing dir — nothing to clear */ }
    return { cleared, bytes };
  }

  // Global wipe.
  const root = volumePath(CACHE_DIR);
  try {
    const parts = await readdir(root);
    for (const part of parts) {
      const sub = await clearScriptCache({ partId: part });
      cleared += sub.cleared;
      bytes += sub.bytes;
    }
  } catch { /* missing root — nothing to clear */ }
  return { cleared, bytes };
}
