/**
 * GET /api/cache/bake-stats
 *   ?id=<part_id>   — stats just for that part
 *   (no params)     — global stats across all parts
 *
 * Phase 2 of docs/plans/bake-cache.md. Powers the cache badge on
 * /vocab term rows + the future /cache browser. Distinct path from
 * /api/cache/stats which is the Railway healthcheck (don't touch).
 *
 * Returns:
 *   { ok, count, bytes, oldestAge, newestAge, parts: [{id, count, bytes, oldest, newest}] }
 */
import { json } from '@sveltejs/kit';
import { readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

const CACHE_DIR = 'cache';
const PART_ID_RE = /^[a-z_][a-z0-9_]*$/i;

interface PartStats {
  id: string;
  count: number;
  bytes: number;
  oldest: number;
  newest: number;
}

async function statsForPart(partId: string): Promise<PartStats | null> {
  const dir = volumePath(join(CACHE_DIR, partId));
  let count = 0, bytes = 0;
  let oldest = Date.now(), newest = 0;
  try {
    const names = await readdir(dir);
    for (const n of names) {
      if (!n.endsWith('.json')) continue;
      try {
        const s = await stat(join(dir, n));
        bytes += s.size;
        count++;
        if (s.mtimeMs < oldest) oldest = s.mtimeMs;
        if (s.mtimeMs > newest) newest = s.mtimeMs;
      } catch { /* skip */ }
    }
  } catch {
    return null;
  }
  if (count === 0) return null;
  return { id: partId, count, bytes, oldest, newest };
}

export const GET = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (id) {
    if (!PART_ID_RE.test(id)) return json({ ok: false, error: 'invalid id' }, { status: 400 });
    const s = await statsForPart(id);
    if (!s) return json({ ok: true, id, count: 0, bytes: 0, parts: [] });
    return json({
      ok: true,
      id: s.id,
      count: s.count,
      bytes: s.bytes,
      oldestAge: Date.now() - s.oldest,
      newestAge: Date.now() - s.newest,
      parts: [s],
    });
  }
  const root = volumePath(CACHE_DIR);
  const parts: PartStats[] = [];
  let count = 0, bytes = 0, oldest = Date.now(), newest = 0;
  try {
    const dirs = await readdir(root);
    for (const d of dirs) {
      const s = await statsForPart(d);
      if (!s) continue;
      parts.push(s);
      count += s.count;
      bytes += s.bytes;
      if (s.oldest < oldest) oldest = s.oldest;
      if (s.newest > newest) newest = s.newest;
    }
  } catch { /* empty cache */ }
  return json({
    ok: true,
    count,
    bytes,
    oldestAge: count > 0 ? Date.now() - oldest : 0,
    newestAge: count > 0 ? Date.now() - newest : 0,
    parts: parts.sort((a, b) => b.bytes - a.bytes),
  });
};
