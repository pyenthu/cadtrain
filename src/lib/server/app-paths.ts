// src/lib/server/app-paths.ts — resolve the LOCAL directory that holds .app files
// (the AppStore `local` backend, server side). Runtime-dynamic: .app files are
// read/written at request time, so editing one shows live with no rebuild.
//
// NOT the volume (user 2026-07-29: no apps/ volume dir) — a local-dir loader for the
// dynamic .app structure. Default dir = the bundled examples (dev); override with
// CADTRAIN_APPS_DIR for a real data dir in prod.
import { env } from '$env/dynamic/private';
import { join, resolve } from 'node:path';
import { readdir, readFile } from 'node:fs/promises';

const DEFAULT_DIR = 'src/lib/appkit/manifest/examples';

export function appsDir(): string {
  return resolve(env.CADTRAIN_APPS_DIR || DEFAULT_DIR);
}

/** Sanitize an app id → a safe `<dir>/<id>.app` path (no traversal). Throws on a
 *  bad id so the endpoint can 400 it. */
export function appFilePath(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`invalid app id "${id}"`);
  return join(appsDir(), `${id}.app`);
}

/** List the .app files in the dir → [{id, title}]. Empty if the dir is missing. */
export async function listApps(): Promise<Array<{ id: string; title?: string }>> {
  let names: string[];
  try {
    names = await readdir(appsDir());
  } catch {
    return [];
  }
  const out: Array<{ id: string; title?: string }> = [];
  for (const n of names) {
    if (!n.endsWith('.app')) continue;
    const id = n.slice(0, -'.app'.length);
    let title: string | undefined;
    try {
      title = JSON.parse(await readFile(join(appsDir(), n), 'utf8'))?.title;
    } catch {
      /* skip an unreadable/invalid .app in the listing */
    }
    out.push({ id, title });
  }
  return out;
}
