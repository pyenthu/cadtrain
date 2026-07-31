// src/lib/server/app-paths.ts — resolve the LOCAL directory that holds .app files
// (the AppStore `local` backend, server side). Runtime-dynamic: .app files are
// read/written at request time, so editing one shows live with no rebuild.
//
// NOT the volume (user 2026-07-29: no apps/ volume dir) — a local-dir loader for the
// dynamic .app structure. Default dir = the bundled examples (dev); override with
// CADTRAIN_APPS_DIR for a real data dir in prod.
import { env } from '$env/dynamic/private';
import { join, resolve } from 'node:path';
import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';

const DEFAULT_DIR = 'src/lib/appkit/manifest/examples';

// `.app.json` is the canonical extension (mobile file pickers grey out bare `.app` — iOS maps
// it to an app-bundle UTI). `.app` stays supported for back-compat; reads prefer `.app.json`.
const APP_EXTS = ['.app.json', '.app'] as const;

export function appsDir(): string {
  return resolve(env.CADTRAIN_APPS_DIR || DEFAULT_DIR);
}

/** Sanitize an app id → a safe `<dir>/<id>.app(.json)` path (no traversal). Returns the EXISTING
 *  file (preferring `.app.json`, else `.app`); for a NEW file returns the canonical `.app.json`
 *  path — so reads resolve either extension and writes default to `.app.json`. Throws on a bad id. */
export function appFilePath(id: string): string {
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`invalid app id "${id}"`);
  for (const ext of APP_EXTS) {
    const p = join(appsDir(), `${id}${ext}`);
    if (existsSync(p)) return p;
  }
  return join(appsDir(), `${id}.app.json`); // new file → canonical extension
}

/** The id for a filename ('plan.app.json' | 'plan.app' → 'plan'), or null if not an app file. */
export function appIdFromName(name: string): string | null {
  for (const ext of APP_EXTS) if (name.endsWith(ext)) return name.slice(0, -ext.length);
  return null;
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
  const seen = new Set<string>();
  for (const n of names) {
    const id = appIdFromName(n);
    if (!id || seen.has(id)) continue; // .app.json wins over a same-id .app (APP_EXTS order)
    seen.add(id);
    let title: string | undefined;
    try {
      title = JSON.parse(await readFile(appFilePath(id), 'utf8'))?.title; // reads the preferred ext
    } catch {
      /* skip an unreadable/invalid .app in the listing */
    }
    out.push({ id, title });
  }
  return out;
}
