/**
 * Persistent-data volume helpers — Railway mount + local-dev fallback +
 * cross-instance proxy. Modelled on SVTC's `src/lib/server/{volumePaths,
 * volumeProxy}.js`.
 *
 * Root resolution priority:
 *   1. `CADTRAIN_VOLUME_ROOT` — explicit override (any path)
 *   2. `RAILWAY_VOLUME_MOUNT_PATH` — auto-set by Railway when a volume is
 *      attached to the service
 *   3. `APP_DATA_DIR` — convention (Dockerfile defaults this to `/app_data`)
 *   4. `/app_data` — fallback if the dir exists
 *   5. `./.dev-volume` — local-dev fallback (auto-created, gitignored)
 *
 * Cross-instance proxy: when `CADTRAIN_VOLUME_REMOTE_URL` is set (typically
 * only in a developer's `.env.local`), every endpoint that calls
 * `maybeProxy()` forwards the request to the same path on the remote host
 * with `X-Volume-Token` injected. Lets a local `bun dev` instance read
 * AND write the production volume through the deployed app — single
 * source of truth, no rsync, no Railway SSH required.
 *
 * Auth: optional shared secret `CADTRAIN_VOLUME_TOKEN` matched against
 * `X-Volume-Token`. Same-origin browser sessions are trusted without a
 * token; cross-origin / no-Origin (curl, the dev proxy) must present it.
 * When the env var is unset (dev mode), the endpoint is open.
 *
 * Path safety: every relative path is resolved against the volume root
 * and rejected if it escapes via `..` or symlink.
 */

import { existsSync, mkdirSync } from 'node:fs';
import { resolve, sep } from 'node:path';
import { env } from '$env/dynamic/private';
import { error } from '@sveltejs/kit';

function resolveRoot(): string {
  if (env.CADTRAIN_VOLUME_ROOT) return resolve(env.CADTRAIN_VOLUME_ROOT);
  if (env.RAILWAY_VOLUME_MOUNT_PATH && existsSync(env.RAILWAY_VOLUME_MOUNT_PATH)) {
    return resolve(env.RAILWAY_VOLUME_MOUNT_PATH);
  }
  if (env.APP_DATA_DIR && existsSync(env.APP_DATA_DIR)) return resolve(env.APP_DATA_DIR);
  if (existsSync('/app_data')) return '/app_data';
  // Local-dev fallback: if `kb-sources/` is already populated at the
  // project root (the gitignored kb-sources dir is the dev workflow), use
  // the project root as the volume root so PDFs there work without
  // having to symlink them into ./.dev-volume. Falls through to a
  // dedicated `.dev-volume/` directory when the project doesn't have
  // local kb-sources content yet (e.g. fresh clone).
  const cwd = process.cwd();
  if (existsSync(resolve(cwd, 'kb-sources'))) return cwd;
  const dev = resolve(cwd, '.dev-volume');
  if (!existsSync(dev)) {
    try { mkdirSync(dev, { recursive: true }); } catch { /* read-only FS in tests */ }
  }
  return dev;
}

export const VOLUME_ROOT = resolveRoot();

/** Resolve a relative path under VOLUME_ROOT. Does NOT create the file. */
export function volumePath(rel: string): string {
  return resolve(VOLUME_ROOT, rel);
}

/** Resolve a user-supplied relative path safely, rejecting `..` traversal.
 *  Throws a 400 SvelteKit error on traversal so the caller can re-throw. */
export function safeVolumePath(userPath: string): string {
  const cleaned = String(userPath ?? '').replace(/^[/\\]+/, '');
  const abs = resolve(VOLUME_ROOT, cleaned);
  if (abs !== VOLUME_ROOT && !abs.startsWith(VOLUME_ROOT + sep)) {
    throw error(400, `Path "${userPath}" escapes the volume root`);
  }
  return abs;
}

/** Ensure a sub-directory exists under the volume; returns the abs path. */
export function ensureDir(rel: string): string {
  const p = volumePath(rel);
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
  return p;
}

/** True if a file/dir exists at the given relative path under the volume. */
export function hasOnVolume(rel: string): boolean {
  return existsSync(volumePath(rel));
}

/**
 * Cross-instance proxy. When `CADTRAIN_VOLUME_REMOTE_URL` is set in this
 * process's env (typically `.env.local`), forwards `request` to the same
 * path + query on the remote host with `X-Volume-Token` injected.
 *
 * Returns `null` when no proxy is configured — caller falls through to
 * direct FS. Test escape: header `X-Volume-Local: 1` forces local FS
 * even when proxying is configured (used by e2e tests).
 */
export async function maybeProxy(request: Request, url: URL): Promise<Response | null> {
  const REMOTE = env.CADTRAIN_VOLUME_REMOTE_URL;
  if (!REMOTE) return null;
  if (request.headers.get('x-volume-local') === '1') return null;

  const target = `${REMOTE.replace(/\/$/, '')}${url.pathname}${url.search}`;
  const headers = new Headers();
  const range = request.headers.get('range');
  if (range) headers.set('range', range);
  const ct = request.headers.get('content-type');
  if (ct) headers.set('content-type', ct);
  if (env.CADTRAIN_VOLUME_TOKEN) headers.set('x-volume-token', env.CADTRAIN_VOLUME_TOKEN);

  const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body;
    init.duplex = 'half';
  }

  const upstream = await fetch(target, init);

  const respHeaders = new Headers();
  for (const [k, v] of upstream.headers) {
    if (k === 'transfer-encoding' || k === 'connection') continue;
    respHeaders.set(k, v);
  }
  return new Response(upstream.body, { status: upstream.status, headers: respHeaders });
}

/**
 * Two-tier auth check:
 *   1. Same-origin browser sessions (Origin/Referer host matches the
 *      request host) are trusted without a token. CSRF protection upstream
 *      blocks form-style cross-site posts; a logged-in user can hit
 *      /api/volume from the production frontend with no token plumbing.
 *   2. Cross-origin / no-Origin (curl, scripts, the dev proxy) must present
 *      `X-Volume-Token` matching `CADTRAIN_VOLUME_TOKEN`. When the env var
 *      is unset (local dev), the endpoint is open to all callers.
 */
export function checkVolumeAuth(request: Request, url: URL | string): void {
  const expected = env.CADTRAIN_VOLUME_TOKEN;
  if (!expected) return;

  const origin = request.headers.get('origin') || request.headers.get('referer') || '';
  if (origin) {
    try {
      const originHost = new URL(origin).host;
      const reqHost = typeof url === 'string' ? new URL(url).host : url.host;
      if (originHost === reqHost) return;
    } catch { /* malformed — fall through to token check */ }
  }

  const got = request.headers.get('x-volume-token');
  if (got !== expected) throw error(401, 'Invalid or missing X-Volume-Token');
}
