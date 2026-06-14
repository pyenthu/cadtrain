/**
 * POST /api/cache/delete — remove bake-cache entries for one part.
 *
 * Body is JSON, two modes:
 *
 *   { id, hash }
 *     Delete a single entry (the `<hash>.json` payload + its `.meta`).
 *
 *   { id, prune: { small?: 20, large?: 10, thresholdMB?: 5 } }
 *     Size-aware prune for the part: split the part's entries at
 *     `thresholdMB`, keep the newest `small` entries BELOW the threshold and
 *     the newest `large` entries AT/ABOVE it, delete the rest. This matches
 *     the user's "20 small / 10 large" retention rule. Newest = highest
 *     payload mtime.
 *
 * Validation: id must match the part-id sanitiser, hash must be lowercase
 * hex — both reject `.`/`/`, so the joined path can't escape the cache root.
 * Tolerant of missing files (counts what it actually removed).
 *
 * Local-only: the bake cache is not in `VOLUME_PROXY_PATHS`. For a part-wide
 * wipe use the existing `/api/cache/clear?id=<part>`.
 */
import { json } from '@sveltejs/kit';
import { readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

const CACHE_DIR = 'cache';
const PART_ID_RE = /^[a-z_][a-z0-9_]*$/i;
const HASH_RE = /^[a-f0-9]{4,64}$/i;

interface PruneOpts {
  small?: number;
  large?: number;
  thresholdMB?: number;
}

async function unlinkPair(dir: string, hash: string): Promise<number> {
  let bytes = 0;
  try {
    const st = await stat(join(dir, `${hash}.json`));
    bytes = st.size;
  } catch {
    /* already gone */
  }
  await unlink(join(dir, `${hash}.json`)).catch(() => { /* ignore */ });
  await unlink(join(dir, `${hash}.meta`)).catch(() => { /* ignore */ });
  return bytes;
}

export const POST = async ({ request }) => {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const id = typeof body?.id === 'string' ? body.id : '';
  if (!PART_ID_RE.test(id)) {
    return json({ ok: false, error: 'invalid id' }, { status: 400 });
  }
  const dir = join(volumePath(CACHE_DIR), id);

  // ── Prune mode ────────────────────────────────────────────────────────
  if (body?.prune && typeof body.prune === 'object') {
    const p = body.prune as PruneOpts;
    const small = Number.isFinite(p.small) ? Math.max(0, Math.floor(p.small as number)) : 20;
    const large = Number.isFinite(p.large) ? Math.max(0, Math.floor(p.large as number)) : 10;
    const thresholdMB = Number.isFinite(p.thresholdMB) ? (p.thresholdMB as number) : 5;
    const thresholdBytes = thresholdMB * 1024 * 1024;

    let names: string[] = [];
    try {
      names = await readdir(dir);
    } catch {
      return json({ ok: true, deleted: 0, bytes: 0, kept: 0 });
    }

    const entries: Array<{ hash: string; size: number; mtime: number }> = [];
    for (const name of names) {
      if (!name.endsWith('.json')) continue;
      const hash = name.slice(0, -'.json'.length);
      try {
        const st = await stat(join(dir, name));
        entries.push({ hash, size: st.size, mtime: st.mtimeMs });
      } catch {
        /* skip */
      }
    }

    const smalls = entries.filter((e) => e.size < thresholdBytes).sort((a, b) => b.mtime - a.mtime);
    const larges = entries.filter((e) => e.size >= thresholdBytes).sort((a, b) => b.mtime - a.mtime);
    const keep = new Set<string>([
      ...smalls.slice(0, small).map((e) => e.hash),
      ...larges.slice(0, large).map((e) => e.hash),
    ]);

    let deleted = 0;
    let bytes = 0;
    for (const e of entries) {
      if (keep.has(e.hash)) continue;
      bytes += await unlinkPair(dir, e.hash);
      deleted++;
    }
    return json({ ok: true, deleted, bytes, kept: keep.size });
  }

  // ── Single-entry mode ─────────────────────────────────────────────────
  const hash = typeof body?.hash === 'string' ? body.hash : '';
  if (!HASH_RE.test(hash)) {
    return json({ ok: false, error: 'invalid hash' }, { status: 400 });
  }
  const bytes = await unlinkPair(dir, hash);
  return json({ ok: true, deleted: 1, bytes });
};
