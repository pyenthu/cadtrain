/**
 * POST /api/volume/onedrive/sync-paths   { paths: string[], dryRun?: boolean }
 *
 * Dev-only. SELECTIVE upload: pushes ONLY the given paths from the
 * PRODUCTION volume up to OneDrive (onedrive:APPS/cadtrain) — the
 * per-file / per-folder counterpart to /api/volume/onedrive (which
 * mirrors the whole volume).
 *
 *   1. each path is pulled from the prod /api/volume tree into a staging
 *      dir, preserving its relative layout. A path that resolves to a
 *      directory is walked recursively (so a folder checkbox in the UI
 *      can pass the folder itself, or its expanded file list).
 *   2. `rclone copy <stage> <dest> --files-from <list>` uploads just the
 *      staged subset. COPY (not sync) is NON-DESTRUCTIVE — nothing on
 *      OneDrive is deleted; with --backup-dir any file that would be
 *      OVERWRITTEN is first moved to <dest>-prev/<ts>, same safety as the
 *      full backup. dryRun adds --dry-run (previews, writes nothing).
 *
 * Same dev-only + run-locally stance as the sibling onedrive endpoints
 * (NOT in VOLUME_PROXY_PATHS — rclone + secrets only exist on the dev box).
 *
 * Returns { ok, dest, dryRun, staged, requested, summary, output } or
 *         { ok:false, message, output } on failure.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';
import { promisify } from 'node:util';
import { execFile as _execFile } from 'node:child_process';
import { promises as fsp } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';

const execFile = promisify(_execFile);

const DEST = env.ONEDRIVE_DEST || 'onedrive:APPS/cadtrain';
const BASE_URL = env.CADTRAIN_VOLUME_REMOTE_URL || 'https://cadtrain.up.railway.app';
const TOKEN = env.CADTRAIN_VOLUME_TOKEN || '';
const SKIP = new Set(['node_modules', '.git', 'volume_backup']);

const tail = (s: string, n = 4000): string => (s.length > n ? s.slice(-n) : s);

type VolNode = {
  name: string;
  type: 'file' | 'dir';
  id: string;
  size?: number | null;
  children?: Record<string, VolNode>;
};

function volHeaders(): Record<string, string> {
  return TOKEN ? { 'X-Volume-Token': TOKEN } : {};
}

/** Stat a single path on the prod volume → its node (dir listing or file meta). */
async function statPath(rel: string): Promise<VolNode | null> {
  // A dir GET returns JSON; a file GET streams bytes. Probe the parent's
  // listing so we always learn the type without downloading file content.
  const parent = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
  const name = rel.includes('/') ? rel.slice(rel.lastIndexOf('/') + 1) : rel;
  const r = await fetch(`${BASE_URL}/api/volume?path=${encodeURIComponent(parent)}`, { headers: volHeaders() });
  if (!r.ok) throw new Error(`volume GET ${parent || '/'} → ${r.status}`);
  const node = (await r.json()) as VolNode;
  if (node.type !== 'dir') return null;
  return node.children?.[name] ?? null;
}

/** Expand a path to the concrete file paths it covers (recurse dirs). */
async function expandToFiles(rel: string, acc: Set<string>): Promise<void> {
  const node = await statPath(rel);
  if (!node) return; // gone from the volume — skip silently
  if (node.type === 'file') {
    acc.add(rel);
    return;
  }
  // directory → walk its listing
  const r = await fetch(`${BASE_URL}/api/volume?path=${encodeURIComponent(rel)}`, { headers: volHeaders() });
  if (!r.ok) throw new Error(`volume GET ${rel} → ${r.status}`);
  const dir = (await r.json()) as VolNode;
  for (const c of Object.values(dir.children ?? {})) {
    const base = c.name;
    if (base.startsWith('.') || SKIP.has(base)) continue;
    if (c.type === 'dir') await expandToFiles(c.id, acc);
    else acc.add(c.id);
  }
}

/** Download one file from the prod volume into the staging dir. */
async function stageFile(rel: string, stageRoot: string): Promise<void> {
  const r = await fetch(`${BASE_URL}/api/volume?path=${encodeURIComponent(rel)}`, { headers: volHeaders() });
  if (!r.ok) throw new Error(`download ${rel} → ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  const abs = join(stageRoot, rel);
  await fsp.mkdir(dirname(abs), { recursive: true });
  await fsp.writeFile(abs, buf);
}

export const POST: RequestHandler = async ({ request }) => {
  if (!dev) throw error(403, 'Selective Volume → OneDrive sync is a dev-only operation.');

  let body: any = null;
  try { body = await request.json(); } catch { /* handled below */ }
  const requested: string[] = Array.isArray(body?.paths)
    ? body.paths.filter((p: unknown) => typeof p === 'string' && p.trim()).map((p: string) => p.trim().replace(/^\/+/, ''))
    : [];
  const dryRun = body?.dryRun === true;
  if (requested.length === 0) {
    return json({ ok: false, message: 'No paths given to sync.' }, { status: 400 });
  }

  // Guard against rclone treating bad input as a path traversal.
  for (const p of requested) {
    if (p.includes('..') || p.startsWith('/')) {
      return json({ ok: false, message: `Refusing unsafe path: ${p}` }, { status: 400 });
    }
  }

  const stageRoot = await fsp.mkdtemp(join(tmpdir(), 'cadtrain-onedrive-sel-'));
  let listFile = '';
  try {
    // 1. expand folders → concrete file list
    const files = new Set<string>();
    for (const p of requested) await expandToFiles(p, files);
    const fileList = [...files].sort();
    if (fileList.length === 0) {
      return json({ ok: false, message: 'Nothing to sync — selected paths matched no files on the volume.' }, { status: 400 });
    }

    // 2. stage each file (bounded concurrency)
    const queue = [...fileList];
    const workers = Array.from({ length: Math.min(8, queue.length) }, async () => {
      let next: string | undefined;
      while ((next = queue.shift()) !== undefined) await stageFile(next, stageRoot);
    });
    await Promise.all(workers);

    // 3. rclone copy the staged subset (non-destructive; backup overwrites)
    listFile = join(stageRoot, '.files-from.txt');
    await fsp.writeFile(listFile, fileList.join('\n') + '\n', 'utf8');

    const ts = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15); // YYYYMMDD-HHMMSS-ish
    const remote = DEST.slice(0, DEST.indexOf(':'));
    const pathPart = DEST.slice(DEST.indexOf(':') + 1);
    const backupDir = `${remote}:${pathPart}-prev/${ts}`;

    const args = [
      'copy', stageRoot, DEST,
      '--files-from', listFile,
      '--checksum',
      '--create-empty-src-dirs',
      '--backup-dir', backupDir,
      '--stats-one-line',
    ];
    if (dryRun) args.push('--dry-run');

    const { stdout, stderr } = await execFile('rclone', args, {
      timeout: 15 * 60_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const out = `${stdout}${stderr}`.trim();
    const verb = dryRun ? 'Would upload' : 'Uploaded';
    return json({
      ok: true,
      dest: DEST,
      dryRun,
      requested: requested.length,
      staged: fileList.length,
      summary: `${verb} ${fileList.length} file${fileList.length === 1 ? '' : 's'} → ${DEST}${dryRun ? ' (dry run — nothing written)' : ''}`,
      output: tail(out) || '(rclone produced no output)',
    });
  } catch (e: any) {
    const out = `${e?.stdout ?? ''}${e?.stderr ?? ''}`.trim();
    return json({ ok: false, message: tail(out) || (e?.message ?? String(e)), output: tail(out) }, { status: 500 });
  } finally {
    await fsp.rm(stageRoot, { recursive: true, force: true }).catch(() => {});
  }
};
