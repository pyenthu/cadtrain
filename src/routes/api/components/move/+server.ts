/**
 * POST /api/components/move
 *
 * Move a library part from one category to another — the explicit
 * "promote out of the holding pen" gate. A newly created / AI-trained
 * part lives in `library/test/<id>/`; the user reviews it, then moves it
 * to `basic` / `parts` / `assemblies`.
 *
 * Body: { id, category, family?, level? }
 *   - category — target: 'test' | 'basic' | 'parts' | 'assemblies'
 *   - family   — written into the moved part's meta.json (Parts axis)
 *   - level    — written into the moved part's meta.json (Basic axis)
 *
 * Effect: an atomic `rename` of the entire part directory
 * (`library/<from>/<id>/` → `library/<to>/<id>/`). Every file —
 * component.ts, picture.png, mesh.glb, instructions.md, prompts.json —
 * travels with it. Then `meta.json` in the moved directory is updated
 * with the family/level tags.
 *
 * NOT proxied — authoring is dev-local.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { rename, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { invalidateRunesListCache } from '../list/cache';
import { invalidateVolumeComponent } from '$lib/server/component-loader';
import {
  resolvePart,
  partDirIn,
  ensureLibrary,
  isLibraryCategory,
  PART_FILES,
  type PartMeta,
} from '$lib/server/library';
import { checkVolumeAuth } from '$lib/server/volume';

export const POST: RequestHandler = async ({ request, url }) => {
  checkVolumeAuth(request, url);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const { id, category, family, level } = body as {
    id?: unknown;
    category?: unknown;
    family?: unknown;
    level?: unknown;
  };

  if (typeof id !== 'string' || !/^[a-z][a-z0-9_]*$/.test(id)) {
    throw error(400, `Invalid or missing component id "${String(id)}"`);
  }
  if (!isLibraryCategory(category)) {
    throw error(400, `Invalid category "${String(category)}" — must be test | basic | parts | assemblies`);
  }

  const part = await resolvePart(id);
  if (!part) throw error(404, `"${id}" is not a library part — nothing to move.`);
  if (part.category === category) {
    // Same category — treat as a meta-only update (re-tag family/level).
  }

  // Build the meta.json the moved part should carry.
  const meta: PartMeta = {};
  if (category === 'parts') {
    if (typeof family !== 'string' || !family) throw error(400, 'category "parts" requires a family');
    meta.family = family;
  } else if (category === 'basic') {
    const lv = Number(level);
    if (!Number.isInteger(lv) || lv < 1) throw error(400, 'category "basic" requires an integer level (1 or 2)');
    meta.level = lv;
  }
  // (test / assemblies carry no fine-axis tag.)

  await ensureLibrary();
  const targetDir = await partDirIn(category, id);

  if (part.category !== category) {
    if (existsSync(targetDir)) {
      throw error(409, `"${id}" already exists in "${category}" — resolve the collision first.`);
    }
    try {
      await rename(part.dir, targetDir);
    } catch (e: any) {
      throw error(500, `Failed to move "${id}" → ${category}: ${e?.message ?? e}`);
    }
  }

  // Write meta.json into the (now) target directory. Empty meta for
  // test/assemblies still writes `{}` so a stale tag from a prior
  // category doesn't linger.
  try {
    await writeFile(join(targetDir, PART_FILES.meta), JSON.stringify(meta, null, 2), 'utf8');
  } catch (e: any) {
    throw error(500, `Moved "${id}" but writing meta.json failed: ${e?.message ?? e}`);
  }

  invalidateRunesListCache();
  invalidateVolumeComponent(id);
  return json({ ok: true, id, category, meta });
};
