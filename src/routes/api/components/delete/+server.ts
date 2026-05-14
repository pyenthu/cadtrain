/**
 * POST /api/components/delete
 *
 * Removes a component. Two cases:
 *   - **library part** — deletes the whole part directory
 *     (`<volume>/library/<category>/<id>/`) — component.ts, picture,
 *     glb, instructions, prompts, meta all go together.
 *   - **bundle primitive (dev)** — deletes `src/lib/cad/components/<id>.ts`
 *     + its `.md` sibling + the baked `static/components/<id>.glb`.
 *
 * Refuses if any authored component in training_data/authored_cache.jsonl
 * references the primitive by id — deleting it would silently break
 * those compositions on next render.
 *
 * Body: { id: string }
 *
 * Status codes:
 *   200 — deleted (returns { ok: true, removed })
 *   400 — bad id / unknown id / bundle primitive in prod (no on-disk src)
 *   409 — id is referenced by N authored components
 *
 * NOT proxied — authoring is dev-local.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unlink, readFile, access, rm } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { dev } from '$app/environment';
import { COMPONENT_REGISTRY } from '$lib/cad/components';
import { invalidateRunesListCache } from '../list/cache';
import { invalidateVolumeComponent } from '$lib/server/component-loader';
import { resolvePart } from '$lib/server/library';
import { checkVolumeAuth } from '$lib/server/volume';

const SRC_DIR = join(process.cwd(), 'src', 'lib', 'cad', 'components');
const STATIC_DIR = join(process.cwd(), 'static', 'components');
const AUTHORED_PATH = join(process.cwd(), 'training_data', 'authored_cache.jsonl');

interface AuthoredReference {
  id: string;
  name: string;
  parts: string[];
}

/** Scan authored_cache.jsonl for any record whose parts reference `primId`. */
async function findAuthoredReferences(primId: string): Promise<AuthoredReference[]> {
  try {
    await access(AUTHORED_PATH);
  } catch {
    return [];
  }
  const text = await readFile(AUTHORED_PATH, 'utf8');
  const refs: AuthoredReference[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let rec: any;
    try { rec = JSON.parse(trimmed); } catch { continue; }
    if (!rec || !Array.isArray(rec.parts)) continue;
    const matchedParts: string[] = [];
    for (const p of rec.parts) {
      const kind = p?.kind ?? 'primitive';
      if (kind === 'primitive' && p?.prim === primId) {
        matchedParts.push(String(p?.id ?? '?'));
      }
    }
    if (matchedParts.length > 0) {
      refs.push({
        id: String(rec.id ?? '?'),
        name: String(rec.name ?? rec.id ?? '?'),
        parts: matchedParts,
      });
    }
  }
  return refs;
}

export const DELETE: RequestHandler = async ({ request, url }) => {
  checkVolumeAuth(request, url);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const { id } = body as { id?: unknown };
  if (typeof id !== 'string') throw error(400, 'Missing id (string)');
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw error(400, `Invalid id format "${id}"`);

  // Reference check first — refuse if any authored composition uses it.
  const references = await findAuthoredReferences(id);
  if (references.length > 0) {
    return json({
      ok: false,
      reason: `"${id}" is used by ${references.length} authored component${references.length === 1 ? '' : 's'}. Remove or re-bind those parts before deleting.`,
      references,
    }, { status: 409 });
  }

  const part = await resolvePart(id);
  if (part) {
    // Library part — remove the whole directory; everything travels.
    try {
      await rm(part.dir, { recursive: true, force: true });
    } catch (e: any) {
      throw error(500, `Failed to delete library part: ${e?.message ?? e}`);
    }
    invalidateVolumeComponent(id);
    invalidateRunesListCache();
    return json({ ok: true, removed: { dir: part.dir, category: part.category } });
  }

  // Bundle primitive — dev only (in prod there's no on-disk src file).
  const tsPath = join(SRC_DIR, `${id}.ts`);
  if (!existsSync(tsPath)) {
    if (COMPONENT_REGISTRY.some((e) => e.meta.id === id)) {
      return json({
        ok: false,
        reason: `"${id}" is a bundled baseline primitive — delete it from src/lib/cad/components and redeploy.`,
      }, { status: 400 });
    }
    throw error(400, `Unknown component id "${id}".`);
  }

  let tsRemoved = false;
  let mdRemoved = false;
  let glbRemoved = false;
  try {
    await unlink(tsPath);
    tsRemoved = true;
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw error(500, `Failed to delete source: ${e?.message ?? e}`);
  }
  try {
    await unlink(join(SRC_DIR, `${id}.md`));
    mdRemoved = true;
  } catch { /* no .md — fine */ }
  try {
    await unlink(join(STATIC_DIR, `${id}.glb`));
    glbRemoved = true;
  } catch { /* no .glb — fine */ }

  invalidateRunesListCache();
  return json({ ok: true, removed: { ts: tsRemoved, md: mdRemoved, glb: glbRemoved } });
};
