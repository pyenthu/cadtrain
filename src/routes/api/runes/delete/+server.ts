/**
 * DELETE /api/runes/delete
 *
 * Removes a runes primitive: deletes the .ts source under
 * src/lib/components/runes/ and the matching baked .glb under
 * static/runes/. Refuses if any authored component in
 * training_data/authored_cache.jsonl references the primitive by id —
 * deleting it would silently break those compositions on next render.
 *
 * Body: { id: string }
 *
 * Status codes:
 *   200 — deleted (returns { ok: true, removed: { ts, glb } })
 *   400 — bad id format / unknown id
 *   409 — id is referenced by N authored components (returns { ok: false,
 *         reason, references: [{ id, name, parts: [partId,...] }] })
 *   503 — production (overlay deletion not wired yet)
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { unlink, readFile, access } from 'fs/promises';
import { join } from 'path';
import { dev } from '$app/environment';
import { RUNES_REGISTRY } from '$lib/components/runes';
import { invalidateRunesListCache } from '../list/cache';

const SRC_DIR = join(process.cwd(), 'src', 'lib', 'components', 'runes');
const STATIC_DIR = join(process.cwd(), 'static', 'runes');
const AUTHORED_PATH = join(process.cwd(), 'training_data', 'authored_cache.jsonl');

interface AuthoredReference {
  id: string;
  name: string;
  parts: string[]; // local part ids (p0, p1...) referencing the primitive
}

/** Scan authored_cache.jsonl for any record whose parts reference `primId`.
 *  Returns an empty array if the cache file doesn't exist or no record
 *  references it. Tolerant of legacy records (no `kind` field on parts). */
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
      // Legacy records omit `kind` — treat as 'primitive' (matches schema.ts
      // getPartKind() default). Connection / body parts don't have a `prim`
      // field so they can't match.
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

export const DELETE: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const { id } = body as { id?: unknown };
  if (typeof id !== 'string') throw error(400, 'Missing id (string)');
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw error(400, `Invalid id format "${id}"`);
  }

  if (!dev) {
    return json({
      ok: false,
      reason: 'Production overlay loader not wired yet — delete disabled.',
    }, { status: 503 });
  }

  // Defense: refuse if id isn't currently in the build-time registry. The
  // registry is the source of truth for what's installed; if the user is
  // trying to delete something that doesn't exist there, either the file
  // was already removed or the id was typo'd — surface as a 400.
  if (!RUNES_REGISTRY.find((e) => e.meta.id === id)) {
    throw error(400, `Unknown runes id "${id}" — not in registry.`);
  }

  // Reference check: scan authored_cache.jsonl for any composition that
  // would break if we removed this primitive.
  const references = await findAuthoredReferences(id);
  if (references.length > 0) {
    return json({
      ok: false,
      reason: `"${id}" is used by ${references.length} authored component${references.length === 1 ? '' : 's'}. Remove or re-bind those parts before deleting.`,
      references,
    }, { status: 409 });
  }

  const tsPath = join(SRC_DIR, `${id}.ts`);
  const glbPath = join(STATIC_DIR, `${id}.glb`);
  let tsRemoved = false;
  let glbRemoved = false;
  try {
    await unlink(tsPath);
    tsRemoved = true;
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw error(500, `Failed to delete source: ${e?.message ?? e}`);
  }
  try {
    await unlink(glbPath);
    glbRemoved = true;
  } catch (e: any) {
    if (e?.code !== 'ENOENT') {
      // Source already gone but GLB delete failed — log via response, don't
      // roll back the source delete.
    }
  }

  invalidateRunesListCache();

  return json({
    ok: true,
    removed: { ts: tsRemoved, glb: glbRemoved },
  });
};
