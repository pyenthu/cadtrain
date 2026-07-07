/**
 * GET /api/design/graphify-graph — DEV ONLY.
 *
 * Reads graphify-out/graph.json (produced by POST /api/design/graphify) and
 * returns the node-link graph as JSON. If the file doesn't exist yet, returns
 * { ok:false, reason } so the UI can show its empty state. Pure filesystem
 * read — zero tokens. 403 in prod.
 */
import { json, error } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  if (!dev) throw error(403, 'graphify-graph is only available in dev mode');

  const path = join(process.cwd(), 'graphify-out', 'graph.json');
  if (!existsSync(path)) {
    return json({ ok: false, reason: 'no graph yet — run graphify first' });
  }
  try {
    const raw = await readFile(path, 'utf8');
    const graph = JSON.parse(raw);
    return json({ ok: true, graph });
  } catch (e) {
    return json({ ok: false, reason: `failed to read graph.json: ${(e as Error).message}` });
  }
};
