/**
 * GET /api/cache/list — enumerate the bake cache for the Cache inspector.
 *
 * Walks `<volume>/cache/<part_id>/*.json` (mesh payloads) + their `.meta`
 * sidecars and reports a per-part breakdown. The bake cache lives on the
 * LOCAL volume (it is NOT in `VOLUME_PROXY_PATHS`), so this always reads
 * the machine's own `<volume>/cache` — even in dev where primitive data is
 * proxied to prod.
 *
 * Shape:
 *   { ok, totalBytes,
 *     parts: [ { id, count, bytes,
 *                hashes: [ { hash, bytes, mtime, meta } ] } ] }
 * Parts sort by bytes desc; hashes within a part sort by mtime desc.
 *
 * See `src/lib/server/bake-cache.ts` for the on-disk layout. We re-declare
 * CACHE_DIR + the part-id sanitiser here (they aren't exported) — keep them
 * in sync with that module. The id regex doubles as the path-traversal
 * guard: `^[a-z_][a-z0-9_]*$` admits no `.` or `/`, so `join(root, id)`
 * can never escape the cache root.
 */
import { json } from '@sveltejs/kit';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

const CACHE_DIR = 'cache';
const PART_ID_RE = /^[a-z_][a-z0-9_]*$/i;

export const GET = async () => {
  const root = volumePath(CACHE_DIR);

  let partDirs: string[] = [];
  try {
    partDirs = await readdir(root);
  } catch {
    // Missing cache root — nothing baked yet.
    return json({ ok: true, totalBytes: 0, parts: [] });
  }

  const parts: Array<{
    id: string;
    count: number;
    bytes: number;
    hashes: Array<{ hash: string; bytes: number; mtime: number; meta: unknown }>;
  }> = [];
  let totalBytes = 0;

  for (const id of partDirs) {
    if (!PART_ID_RE.test(id)) continue;
    const dir = join(root, id);
    let names: string[] = [];
    try {
      const s = await stat(dir);
      if (!s.isDirectory()) continue;
      names = await readdir(dir);
    } catch {
      continue;
    }

    const hashes: Array<{ hash: string; bytes: number; mtime: number; meta: unknown }> = [];
    let bytes = 0;
    for (const name of names) {
      // Only the payloads. `.meta` sidecars + in-flight `.json.tmp.*` writes
      // are skipped by the `.json` suffix test.
      if (!name.endsWith('.json')) continue;
      const hash = name.slice(0, -'.json'.length);
      let size = 0;
      let mtime = 0;
      try {
        const st = await stat(join(dir, name));
        size = st.size;
        mtime = st.mtimeMs;
      } catch {
        continue;
      }
      let meta: unknown = null;
      try {
        meta = JSON.parse(await readFile(join(dir, `${hash}.meta`), 'utf8'));
      } catch {
        meta = null;
      }
      hashes.push({ hash, bytes: size, mtime, meta });
      bytes += size;
    }
    if (hashes.length === 0) continue;
    hashes.sort((a, b) => b.mtime - a.mtime);
    parts.push({ id, count: hashes.length, bytes, hashes });
    totalBytes += bytes;
  }

  parts.sort((a, b) => b.bytes - a.bytes);
  return json({ ok: true, totalBytes, parts });
};
