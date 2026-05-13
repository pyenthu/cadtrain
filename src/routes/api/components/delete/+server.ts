/**
 * DELETE /api/components/delete
 *
 * Removes a single-file component: deletes the .ts source under
 * src/lib/cad/components/ and the matching baked .glb under
 * static/components/. Refuses if any authored component in
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
import { existsSync } from 'fs';
import { join } from 'path';
import { dev } from '$app/environment';
import { COMPONENT_REGISTRY } from '$lib/cad/components';
import { invalidateRunesListCache } from '../list/cache';
import { volumePath, maybeProxy, checkVolumeAuth } from '$lib/server/volume';

const SRC_DIR = join(process.cwd(), 'src', 'lib', 'cad', 'components');
const VOLUME_DIR = volumePath('components');
const STATIC_DIR = join(process.cwd(), 'static', 'components');
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

export const DELETE: RequestHandler = async ({ request, url }) => {
  // Forward to prod when CADTRAIN_VOLUME_REMOTE_URL is set in env.
  const proxied = await maybeProxy(request, url);
  if (proxied) return proxied;
  checkVolumeAuth(request, url);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const { id } = body as { id?: unknown };
  if (typeof id !== 'string') throw error(400, 'Missing id (string)');
  if (!/^[a-z][a-z0-9_]*$/.test(id)) {
    throw error(400, `Invalid id format "${id}"`);
  }

  // Decide which target dir holds the file. In prod we ONLY delete from
  // the volume overlay — never the bundle (the bundle is read-only at
  // runtime and a delete request against a bundle-only id is a 400). In
  // dev we delete from src/ as before. When a volume overlay exists in
  // prod, the delete removes the overlay and the bundle entry "comes
  // back" automatically on the next list request.
  const targetDir = dev ? SRC_DIR : VOLUME_DIR;
  const tsPath = join(targetDir, `${id}.ts`);
  const mdPath = join(targetDir, `${id}.md`);

  if (!dev && !existsSync(tsPath)) {
    // No volume overlay for this id. Either it's a bundle-only baseline
    // (refuse — that's a deploy-time action, not a runtime delete) or
    // the id is unknown entirely.
    if (COMPONENT_REGISTRY.find((e) => e.meta.id === id)) {
      return json({
        ok: false,
        reason: `"${id}" is a bundled baseline component — delete it from src/lib/cad/components and redeploy. Runtime delete only removes volume overlays.`,
      }, { status: 400 });
    }
    throw error(400, `Unknown component id "${id}" — no overlay and not in bundle.`);
  }

  // In dev: id must be in the build-time registry (Vite has it). In prod:
  // we already checked the overlay exists above, so accept that path.
  if (dev && !COMPONENT_REGISTRY.find((e) => e.meta.id === id)) {
    throw error(400, `Unknown component id "${id}" — not in registry.`);
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

  const glbPath = join(STATIC_DIR, `${id}.glb`);
  let tsRemoved = false;
  let mdRemoved = false;
  let glbRemoved = false;
  try {
    await unlink(tsPath);
    tsRemoved = true;
  } catch (e: any) {
    if (e?.code !== 'ENOENT') throw error(500, `Failed to delete source: ${e?.message ?? e}`);
  }
  // .md sibling — only delete from the same dir we just deleted the .ts
  // from. Missing .md is fine.
  try {
    await unlink(mdPath);
    mdRemoved = true;
  } catch { /* no .md or already gone — fine */ }
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
    removed: { ts: tsRemoved, md: mdRemoved, glb: glbRemoved },
  });
};
