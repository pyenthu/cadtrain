/**
 * POST /api/components/instructions
 *
 * Persist the AI instructions doc for a component. The AI Refine
 * endpoint reads this file and includes it in every Claude prompt, so
 * editing it is how the user "trains" the AI's understanding of what
 * the component should be.
 *
 * Body: { id, instructions }
 * Returns: { ok: true, path } on success.
 *
 * Write destination, by where the component lives:
 *   - library part → `<volume>/library/<category>/<id>/instructions.md`
 *   - bundle primitive in dev → `src/lib/cad/components/<id>.md`
 * An empty string deletes the file (resets to "no instructions").
 *
 * NOT proxied — authoring is dev-local.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { existsSync } from 'fs';
import { join } from 'path';
import { dev } from '$app/environment';
import { COMPONENT_REGISTRY } from '$lib/cad/components';
import { invalidateRunesListCache } from '../list/cache';
import { invalidateVolumeComponent } from '$lib/server/component-loader';
import { resolvePart, PART_FILES } from '$lib/server/library';
import { checkVolumeAuth } from '$lib/server/volume';

const MAX_BYTES = 256 * 1024;
const SRC_DIR = join(process.cwd(), 'src', 'lib', 'cad', 'components');

export const POST: RequestHandler = async ({ request, url }) => {
  checkVolumeAuth(request, url);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const { id, instructions } = body as { id?: unknown; instructions?: unknown };
  if (typeof id !== 'string' || typeof instructions !== 'string') {
    throw error(400, 'Missing id (string) or instructions (string).');
  }
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw error(400, `Invalid id "${id}"`);
  if (Buffer.byteLength(instructions, 'utf8') > MAX_BYTES) {
    throw error(413, `Instructions too large (> ${MAX_BYTES} bytes).`);
  }

  // Resolve the write target.
  const part = await resolvePart(id);
  let path: string;
  let isLibrary: boolean;
  if (part) {
    path = join(part.dir, PART_FILES.instructions);
    isLibrary = true;
  } else if (dev && existsSync(join(SRC_DIR, `${id}.ts`))) {
    path = join(SRC_DIR, `${id}.md`);
    isLibrary = false;
  } else if (COMPONENT_REGISTRY.some((e) => e.meta.id === id)) {
    throw error(400, `"${id}" is a bundle primitive with no on-disk source here — can't write instructions.`);
  } else {
    throw error(400, `Unknown component id "${id}".`);
  }

  try {
    if (instructions.trim() === '') {
      // Empty = remove the file — resets to "no instructions" without
      // leaving a stray empty sidecar.
      await unlink(path).catch(() => {});
    } else {
      if (!isLibrary) await mkdir(SRC_DIR, { recursive: true });
      await writeFile(path, instructions, 'utf8');
    }
  } catch (e: any) {
    throw error(500, `Write failed: ${e?.message ?? e}`);
  }

  invalidateRunesListCache();
  if (isLibrary) invalidateVolumeComponent(id);
  return json({ ok: true, path });
};
