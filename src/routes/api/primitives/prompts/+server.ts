/**
 * /api/primitives/prompts — per-primitive AI prompt history.
 *
 *   GET /api/primitives/prompts?id=<id>  → { history: [...] }
 *   PUT /api/primitives/prompts          body { id, history } → { ok, id, count }
 *
 * Each refine the user runs against a volume primitive is recorded so the
 * /primitives inspector AI tab's History sub-tab can show what was asked,
 * when, and whether the proposal was accepted — and so the trail survives
 * a page reload.
 *
 * Storage: `prompts.json` inside the primitive's own directory
 * (`<volume>/primitives/<id>/prompts.json`). It travels with the primitive
 * like every other artifact in the directory.
 *
 * Touches the volume → this endpoint should be added to the
 * VOLUME_PROXY_PATHS allowlist in src/hooks.server.ts.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { volumePath, checkVolumeAuth } from '$lib/server/volume';

const MAX_ENTRIES = 500;
const ID_RE = /^[a-z][a-z0-9_]*$/i;

/** One recorded refine. Mirrors the in-memory `tab.ai.history` shape. */
interface HistoryEntry {
  prompt: string;
  ts: number;
  accepted?: boolean;
}

function validId(id: unknown): string {
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw error(400, `Invalid or missing primitive id "${id}"`);
  }
  return id;
}

function sanitizeHistory(raw: unknown): HistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  const out: HistoryEntry[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const prompt = (e as any).prompt;
    const ts = (e as any).ts;
    if (typeof prompt !== 'string') continue;
    const entry: HistoryEntry = {
      prompt: prompt.slice(0, 4000),
      ts: typeof ts === 'number' && isFinite(ts) ? ts : Date.now(),
    };
    const accepted = (e as any).accepted;
    if (typeof accepted === 'boolean') entry.accepted = accepted;
    out.push(entry);
  }
  return out.slice(-MAX_ENTRIES);
}

function promptsPathFor(id: string): string {
  return volumePath(join('primitives', id, 'prompts.json'));
}

export const GET: RequestHandler = async ({ request, url }) => {
  checkVolumeAuth(request, url);
  const id = validId(url.searchParams.get('id'));
  const path = promptsPathFor(id);
  if (!existsSync(path)) return json({ history: [] });
  try {
    return json({ history: sanitizeHistory(JSON.parse(await readFile(path, 'utf8'))) });
  } catch {
    return json({ history: [] });
  }
};

export const PUT: RequestHandler = async ({ request, url }) => {
  checkVolumeAuth(request, url);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const id = validId((body as any).id);
  const history = sanitizeHistory((body as any).history);
  const path = promptsPathFor(id);
  try {
    await mkdir(dirname(path), { recursive: true });
    // Atomic-ish: write to a temp sibling, then rename over the target so
    // a partial write can never leave a corrupt prompts.json.
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(history, null, 2), 'utf8');
    await rename(tmp, path);
  } catch (e: any) {
    throw error(500, `Write failed: ${e?.message ?? e}`);
  }
  return json({ ok: true, id, count: history.length });
};
