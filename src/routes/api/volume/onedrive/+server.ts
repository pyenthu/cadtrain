/**
 * POST /api/volume/onedrive   { dryRun?: boolean }
 *
 * Dev-only. Spawns scripts/volume2onedrive.sh --prod, which pulls the
 * PRODUCTION volume (the source of truth) over /api/volume into a staging
 * dir and rclone-syncs it up to onedrive:APPS/cadtrain — replaced/deleted
 * files are preserved under APPS/cadtrain-prev/<ts>, never lost.
 *
 * Same dev-only stance as /api/volume/backup: on prod there's no rclone /
 * secrets and the volume there IS the local FS, so this only makes sense
 * from a dev machine pulling the live volume down and up to OneDrive.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { promisify } from 'node:util';
import { execFile as _execFile } from 'node:child_process';
import { resolve } from 'node:path';

const execFile = promisify(_execFile);
const SCRIPT = resolve(process.cwd(), 'scripts', 'volume2onedrive.sh');

const tail = (s: string, n = 2000): string => (s.length > n ? s.slice(-n) : s);

export const POST: RequestHandler = async ({ request }) => {
  if (!dev) throw error(403, 'Volume → OneDrive is a dev-only operation.');

  let body: any = null;
  try { body = await request.json(); } catch { /* body is optional */ }
  const args = ['--prod'];
  if (body?.dryRun === true) args.push('--dry-run');

  try {
    const { stdout, stderr } = await execFile('bash', [SCRIPT, ...args], {
      cwd: process.cwd(),
      env: process.env,
      timeout: 15 * 60_000,
      maxBuffer: 16 * 1024 * 1024,
    });
    const out = `${stdout}${stderr}`;
    const m = out.match(/pulled (\d+) files/);
    const summary = m
      ? `Synced ${m[1]} files → onedrive:APPS/cadtrain`
      : 'Synced → onedrive:APPS/cadtrain';
    return json({ ok: true, summary, output: tail(out) });
  } catch (e: any) {
    // execFile rejects on non-zero exit / timeout; surface its captured output.
    const out = `${e?.stdout ?? ''}${e?.stderr ?? ''}`.trim();
    return json({ ok: false, message: e?.message ?? String(e), output: tail(out) }, { status: 500 });
  }
};
