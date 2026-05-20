/**
 * POST /api/primitives/instructions
 *
 * Persist the AI instructions doc for a VOLUME PRIMITIVE. The AI Refine
 * endpoint (/api/primitives/refine) reads this file and includes it in
 * every Claude prompt, so editing it is how the user "trains" the AI's
 * understanding of what the primitive should be.
 *
 * Storage: `instructions.md` inside the primitive's own directory
 * (`<volume>/primitives/<id>/instructions.md`). It travels with the
 * primitive like every other artifact in the directory. An empty string
 * deletes the file (resets to "no instructions").
 *
 * Body: { id, instructions }
 * Returns: { ok: true } on success.
 *
 * Touches the volume → this endpoint should be added to the
 * VOLUME_PROXY_PATHS allowlist in src/hooks.server.ts.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, mkdir, unlink } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { volumePath, checkVolumeAuth } from '$lib/server/volume';

const MAX_BYTES = 256 * 1024;
const ID_RE = /^[a-z][a-z0-9_]*$/i;

export const POST: RequestHandler = async ({ request, url }) => {
  checkVolumeAuth(request, url);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const { id, instructions } = body as { id?: unknown; instructions?: unknown };
  if (typeof id !== 'string' || typeof instructions !== 'string') {
    throw error(400, 'Missing id (string) or instructions (string).');
  }
  if (!ID_RE.test(id)) throw error(400, `Invalid id "${id}"`);
  if (Buffer.byteLength(instructions, 'utf8') > MAX_BYTES) {
    throw error(413, `Instructions too large (> ${MAX_BYTES} bytes).`);
  }

  const path = volumePath(join('primitives', id, 'instructions.md'));
  try {
    if (instructions.trim() === '') {
      // Empty = remove the file — resets to "no instructions" without
      // leaving a stray empty sidecar.
      await unlink(path).catch(() => {});
    } else {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, instructions, 'utf8');
    }
  } catch (e: any) {
    throw error(500, `Write failed: ${e?.message ?? e}`);
  }

  return json({ ok: true });
};
