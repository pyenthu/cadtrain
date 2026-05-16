/**
 * POST /api/components/rename
 *
 * Rename a library part — change its directory + id slug. The display
 * name (`meta.name`) is editable through a plain source edit; this
 * endpoint is for the structural id change.
 *
 * Body: { oldId, newId }
 *
 * Steps:
 *   1. Validate `newId` (slug regex) and refuse if it collides with any
 *      existing library part OR bundle primitive.
 *   2. Refuse if `oldId` is a bundle primitive — bundle parts live in
 *      git-tracked `src/`, not the volume; renaming them here would
 *      desync the working tree.
 *   3. Atomic `rename` of the part directory.
 *   4. Rewrite `meta.id: '<oldId>'` → `meta.id: '<newId>'` inside the
 *      moved component.ts.
 *   5. Walk every OTHER library part's component.ts and rewrite
 *      `from './<oldId>'` imports to `'./<newId>'` so cross-references
 *      survive the rename.
 *   6. Invalidate caches for both ids.
 *
 * NOT proxied — authoring is dev-local.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readFile, rename, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { invalidateRunesListCache } from '../list/cache';
import { invalidateVolumeComponent } from '$lib/server/component-loader';
import { metaById } from '$lib/cad/components';
import {
  resolvePart,
  listLibraryParts,
  partDirIn,
  PART_FILES,
} from '$lib/server/library';
import { checkVolumeAuth } from '$lib/server/volume';

const SLUG_RE = /^[a-z][a-z0-9_]*$/;

export const POST: RequestHandler = async ({ request, url }) => {
  checkVolumeAuth(request, url);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const { oldId, newId } = body as { oldId?: unknown; newId?: unknown };

  if (typeof oldId !== 'string' || !SLUG_RE.test(oldId)) {
    throw error(400, `Invalid oldId "${String(oldId)}"`);
  }
  if (typeof newId !== 'string' || !SLUG_RE.test(newId)) {
    throw error(400, `Invalid newId "${String(newId)}" — must match ${SLUG_RE}`);
  }
  if (oldId === newId) return json({ ok: true, oldId, newId, noop: true });

  // Bundle parts (compiled into src/) — refuse. They're git-tracked
  // and changing the path would require a code edit + Vite reload.
  if (metaById(oldId)) {
    throw error(400, `"${oldId}" is a bundle primitive — rename it by editing src/lib/cad/components/.`);
  }
  if (metaById(newId)) {
    throw error(409, `"${newId}" collides with bundle primitive of the same id.`);
  }

  const part = await resolvePart(oldId);
  if (!part) throw error(404, `Library part "${oldId}" not found.`);

  // Collision check across ALL categories — newId must not exist anywhere.
  const collision = await resolvePart(newId);
  if (collision) {
    throw error(409, `"${newId}" already exists in category "${collision.category}".`);
  }

  const targetDir = await partDirIn(part.category, newId);
  if (existsSync(targetDir)) {
    throw error(409, `Target directory ${targetDir} already exists.`);
  }

  // 3. Rename the directory.
  try {
    await rename(part.dir, targetDir);
  } catch (e: any) {
    throw error(500, `Failed to rename "${oldId}" → "${newId}": ${e?.message ?? e}`);
  }

  // 4. Rewrite meta.id inside the moved component.ts.
  const componentPath = join(targetDir, PART_FILES.component);
  try {
    const src = await readFile(componentPath, 'utf8');
    const next = rewriteMetaId(src, oldId, newId);
    if (next !== src) await writeFile(componentPath, next, 'utf8');
  } catch (e: any) {
    throw error(500, `Renamed directory but failed to rewrite meta.id: ${e?.message ?? e}`);
  }

  // 5. Walk other library parts and rewrite './oldId' import specifiers.
  let updatedRefs = 0;
  try {
    const allParts = await listLibraryParts();
    for (const other of allParts) {
      if (other.id === newId) continue; // skip the just-renamed part (already done)
      const otherSrc = await readFile(other.componentPath, 'utf8').catch(() => '');
      if (!otherSrc) continue;
      const rewritten = rewriteImportSpecifier(otherSrc, oldId, newId);
      if (rewritten !== otherSrc) {
        await writeFile(other.componentPath, rewritten, 'utf8');
        updatedRefs++;
        invalidateVolumeComponent(other.id);
      }
    }
  } catch (e: any) {
    // The rename + meta.id rewrite already succeeded — log + continue
    // rather than aborting (the cross-ref update is best-effort).
    console.error(`[rename] cross-ref scan failed: ${e?.message ?? e}`);
  }

  invalidateRunesListCache();
  invalidateVolumeComponent(oldId);
  invalidateVolumeComponent(newId);

  return json({ ok: true, oldId, newId, updatedRefs });
};

/** Rewrite `id: '<oldId>'` (with single OR double quotes) inside the
 *  `export const meta = { ... }` block. Leaves the rest of the source
 *  alone — `name`, params, derived, etc. all survive. */
function rewriteMetaId(src: string, oldId: string, newId: string): string {
  const metaRe = /\bexport\s+const\s+meta\s*=\s*\{/;
  const mm = metaRe.exec(src);
  if (!mm) return src;
  const rel = src.slice(mm.index);
  const idRe = new RegExp(`\\bid\\s*:\\s*(['"])${escapeReg(oldId)}\\1`);
  const im = idRe.exec(rel);
  if (!im) return src;
  const start = mm.index + im.index;
  return src.slice(0, start) + `id: '${newId}'` + src.slice(start + im[0].length);
}

/** Rewrite every `from './<oldId>'` import specifier (single or double
 *  quotes) to `from './<newId>'`. Only touches direct sibling imports
 *  — anything else (`../helpers`, bare specifiers) is unchanged. */
function rewriteImportSpecifier(src: string, oldId: string, newId: string): string {
  const re = new RegExp(`(from\\s*)(['"])\\.\\/${escapeReg(oldId)}\\2`, 'g');
  return src.replace(re, (_full, lead, q) => `${lead}${q}./${newId}${q}`);
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
