/**
 * POST /api/volume/onedrive/diff
 *
 * Dev-only. Compares the PRODUCTION volume against the OneDrive backup
 * (onedrive:APPS/cadtrain) BY PATH + SIZE — a metadata-only diff, NO file
 * contents are downloaded, so it returns in seconds (unlike the full
 * staging-pull the backup itself does).
 *
 *   • volume side  → walk the prod /api/volume tree (name/size per file)
 *   • OneDrive side → `rclone lsjson <dest> -R --files-only` (Path/Size)
 *
 * Returns { ok, dest, counts, entries[] } where each entry is
 *   { path, status: 'new' | 'gone' | 'changed' | 'match', local, remote }
 * with status from the VOLUME's point of view:
 *   new     — in the volume, NOT on OneDrive (an upload would add it)
 *   gone    — on OneDrive, NOT in the volume (an upload would delete/back-up it)
 *   changed — both sides, different size
 *   match   — both sides, same size
 *
 * Same dev-only stance as /api/volume/onedrive (prod has no rclone/secrets).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { promisify } from 'node:util';
import { execFile as _execFile } from 'node:child_process';

const execFile = promisify(_execFile);

const DEST = env.ONEDRIVE_DEST || 'onedrive:APPS/cadtrain';
const BASE_URL = env.CADTRAIN_VOLUME_REMOTE_URL || 'https://cadtrain.up.railway.app';
const TOKEN = env.CADTRAIN_VOLUME_TOKEN || '';
// Mirror the backup script's exclusions so the two sides are comparable.
const SKIP = new Set(['node_modules', '.git', 'volume_backup']);

type VolNode = {
  type: 'file' | 'dir';
  id: string;
  size?: number | null;
  children?: Record<string, VolNode>;
};

/**
 * Walk the prod volume over /api/volume → Map<path, size>.
 *
 * The /api/volume listing is depth-1, so a deep tree needs one HTTP call
 * per directory. Done sequentially that's ~15s of round-trips; instead we
 * BFS with a bounded worker pool (CONCURRENCY dirs in flight) — the Map
 * writes are safe because JS is single-threaded.
 */
const CONCURRENCY = 8;
async function walkVolume(): Promise<Map<string, number>> {
  const hdrs: Record<string, string> = TOKEN ? { 'X-Volume-Token': TOKEN } : {};
  const out = new Map<string, number>();

  /** Fetch one dir listing; record its files, return its subdir paths. */
  async function listDir(rel: string): Promise<string[]> {
    const r = await fetch(`${BASE_URL}/api/volume?path=${encodeURIComponent(rel)}`, { headers: hdrs });
    if (!r.ok) throw new Error(`volume GET ${rel || '/'} → ${r.status}`);
    const node = (await r.json()) as VolNode;
    if (node.type !== 'dir') return [];
    const subdirs: string[] = [];
    for (const c of Object.values(node.children ?? {})) {
      const base = c.id.split('/').pop() ?? '';
      if (base.startsWith('.') || SKIP.has(base)) continue;
      if (c.type === 'dir') subdirs.push(c.id);
      else out.set(c.id, c.size ?? 0);
    }
    return subdirs;
  }

  const queue: string[] = [''];
  let active = 0;
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const pump = (): void => {
      if (settled) return;
      if (queue.length === 0 && active === 0) { settled = true; resolve(); return; }
      while (active < CONCURRENCY && queue.length > 0) {
        const rel = queue.shift()!;
        active++;
        listDir(rel)
          .then((subs) => { queue.push(...subs); active--; pump(); })
          .catch((e) => { if (!settled) { settled = true; reject(e); } });
      }
    };
    pump();
  });
  return out;
}

/** OneDrive side → Map<path, size> via rclone lsjson (recursive, files only). */
async function lsOneDrive(): Promise<Map<string, number>> {
  const { stdout } = await execFile('rclone', ['lsjson', DEST, '-R', '--files-only'], {
    timeout: 5 * 60_000,
    maxBuffer: 64 * 1024 * 1024,
  });
  const arr = JSON.parse(stdout) as { Path: string; Size: number }[];
  return new Map(arr.map((e) => [e.Path, e.Size]));
}

export const POST: RequestHandler = async () => {
  if (!dev) throw error(403, 'Volume ⇄ OneDrive diff is a dev-only operation.');

  let local: Map<string, number>, remote: Map<string, number>;
  try {
    [local, remote] = await Promise.all([walkVolume(), lsOneDrive()]);
  } catch (e: any) {
    return json({ ok: false, message: e?.message ?? String(e) }, { status: 500 });
  }

  const paths = new Set<string>([...local.keys(), ...remote.keys()]);
  const entries = [...paths].sort().map((path) => {
    const l = local.get(path), r = remote.get(path);
    const status =
      l === undefined ? 'gone' : r === undefined ? 'new' : l === r ? 'match' : 'changed';
    return { path, status, local: l ?? null, remote: r ?? null };
  });
  const counts = { new: 0, gone: 0, changed: 0, match: 0 } as Record<string, number>;
  for (const e of entries) counts[e.status]++;

  return json({ ok: true, dest: DEST, counts, entries });
};
