/**
 * POST /api/volume/backup
 *
 * Snapshot the ENTIRE volume into the repo at `volume_backup/`.
 *
 * Reads through the app's own `/api/volume` endpoint via SvelteKit's
 * server `fetch`, so when `CADTRAIN_VOLUME_REMOTE_URL` is set (local dev)
 * the read transparently proxies to PRODUCTION — i.e. this copies the
 * live Railway volume down into the working tree. The write side is a
 * plain local-FS write to `volume_backup/` (NOT the volume), so the
 * snapshot lands in the repo where the user can review / commit it.
 *
 * Dev-only: on prod the volume IS the local FS and there's no point
 * (and no desire) to write the live image's source tree.
 *
 * Strategy: recursive depth-1 walk (the volume GET returns one level at
 * a time). Files are overwritten in place; this is an additive copy, not
 * a destructive mirror — a file deleted on the volume since the last
 * backup lingers in the snapshot until the user clears it.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { promises as fsp } from 'node:fs';
import { resolve, dirname, sep } from 'node:path';
import { dev } from '$app/environment';

// Repo-root (NOT src/) so a local snapshot never pollutes the source tree / treemap.
// Gitignored; the volume is normally an external resource so this is an opt-in copy.
const BACKUP_ROOT = resolve(process.cwd(), 'volume_backup');

/** Dirs we never want in the snapshot even if they somehow appear at the
 *  volume root (matters only when the local root is the project cwd). */
const SKIP = new Set(['node_modules', '.svelte-kit', '.git', 'lost+found', 'volume_backup']);

interface FileNode { name: string; type: 'file'; id: string; size: number | null }
interface DirNode { name: string; type: 'dir'; id: string; children: Record<string, FileNode | DirNode> }

export const POST: RequestHandler = async ({ fetch }) => {
  if (!dev) throw error(403, 'Volume backup is a dev-only operation.');

  let files = 0;
  let dirs = 0;
  let bytes = 0;
  const errors: string[] = [];

  /** Resolve a volume-relative path under the backup root, rejecting escapes. */
  function destFor(rel: string): string {
    const abs = resolve(BACKUP_ROOT, rel);
    if (abs !== BACKUP_ROOT && !abs.startsWith(BACKUP_ROOT + sep)) {
      throw new Error(`path "${rel}" escapes the backup root`);
    }
    return abs;
  }

  async function walk(rel: string): Promise<void> {
    const r = await fetch(`/api/volume?path=${encodeURIComponent(rel)}`, { cache: 'no-store' });
    if (!r.ok) {
      errors.push(`list ${rel || '/'}: ${r.status}`);
      return;
    }
    const node = (await r.json()) as DirNode;
    if (node?.type !== 'dir') return;

    for (const child of Object.values(node.children)) {
      if (child.name.startsWith('.') || SKIP.has(child.name)) continue;
      if (child.type === 'dir') {
        try {
          await fsp.mkdir(destFor(child.id), { recursive: true });
          dirs++;
        } catch (e: any) {
          errors.push(`mkdir ${child.id}: ${e?.message ?? e}`);
          continue;
        }
        await walk(child.id);
      } else {
        try {
          const fr = await fetch(`/api/volume?path=${encodeURIComponent(child.id)}`, { cache: 'no-store' });
          if (!fr.ok) {
            errors.push(`get ${child.id}: ${fr.status}`);
            continue;
          }
          const buf = Buffer.from(await fr.arrayBuffer());
          const abs = destFor(child.id);
          await fsp.mkdir(dirname(abs), { recursive: true });
          await fsp.writeFile(abs, buf);
          files++;
          bytes += buf.length;
        } catch (e: any) {
          errors.push(`write ${child.id}: ${e?.message ?? e}`);
        }
      }
    }
  }

  await fsp.mkdir(BACKUP_ROOT, { recursive: true });
  try {
    await walk('');
  } catch (e: any) {
    throw error(500, `Backup failed: ${e?.message ?? e}`);
  }

  return json({
    ok: errors.length === 0,
    dest: 'volume_backup',
    dirs,
    files,
    bytes,
    ...(errors.length ? { errors: errors.slice(0, 20), errorCount: errors.length } : {}),
  });
};
