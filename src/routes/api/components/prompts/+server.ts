/**
 * /api/components/prompts — per-component AI prompt history.
 *
 *   GET /api/components/prompts?id=<id>  → { id, history: [...] }
 *   PUT /api/components/prompts?id=<id>  body { history: [...] } → { ok }
 *
 * Each refine the user runs against a component is recorded so the AI
 * tab's History sub-tab can show what was asked, when, and whether the
 * proposal was accepted — and so the trail survives a page reload.
 *
 * Storage: `prompts.json` inside the part's own directory
 * (`<volume>/library/<category>/<id>/prompts.json`). It travels with the
 * part on a move, like every other artifact in the directory.
 *
 * History is only persisted for LIBRARY parts. The 26 bundle primitives
 * have no part directory — GET returns an empty history, PUT 404s (the
 * client's save is best-effort and swallows it).
 *
 * NOT proxied — authoring data, dev-local.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { resolvePart, PART_FILES } from '$lib/server/library';
import { checkVolumeAuth } from '$lib/server/volume';

const MAX_ENTRIES = 500;

/** One recorded refine. Mirrors the in-memory `tab.ai.history` shape. */
interface HistoryEntry {
  prompt: string;
  ts: number;
  accepted?: boolean;
}

function idFrom(url: URL): string {
  const id = url.searchParams.get('id') ?? '';
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw error(400, `Invalid or missing component id "${id}"`);
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

export const GET: RequestHandler = async ({ request, url }) => {
  checkVolumeAuth(request, url);
  const id = idFrom(url);
  const part = await resolvePart(id);
  if (!part) return json({ id, history: [] });
  const path = join(part.dir, PART_FILES.prompts);
  if (!existsSync(path)) return json({ id, history: [] });
  try {
    return json({ id, history: sanitizeHistory(JSON.parse(await readFile(path, 'utf8'))) });
  } catch {
    return json({ id, history: [] });
  }
};

export const PUT: RequestHandler = async ({ request, url }) => {
  checkVolumeAuth(request, url);
  const id = idFrom(url);
  const part = await resolvePart(id);
  if (!part) {
    // Bundle primitive (no part directory) — nothing to persist to.
    throw error(404, `"${id}" is not a library part — prompt history isn't persisted for bundle primitives.`);
  }
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const history = sanitizeHistory((body as any).history);
  const path = join(part.dir, PART_FILES.prompts);
  try {
    await writeFile(path, JSON.stringify(history, null, 2), 'utf8');
  } catch (e: any) {
    throw error(500, `Write failed: ${e?.message ?? e}`);
  }
  return json({ ok: true, id, count: history.length });
};
