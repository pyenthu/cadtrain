/**
 * POST /api/components/instructions
 *
 * Persist the AI instructions doc for a single-file component — written to
 * src/lib/cad/components/<id>.md alongside the .ts. The AI Refine
 * endpoint reads this file (via the component registry) and includes it in
 * every Claude system prompt, so editing it is how the user "trains"
 * the AI's understanding of what this primitive should be.
 *
 * Body: { id, instructions }
 * Returns: { ok: true, path } on success.
 *
 * Mirrors /api/components/save but writes the .md sibling rather than the
 * .ts source. Production overlay path is /data/components/<id>.md (not yet
 * wired — same status as save.ts).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { dev } from '$app/environment';
import { COMPONENT_REGISTRY } from '$lib/cad/components';
import { invalidateRunesListCache } from '../list/cache';
import { volumePath, checkVolumeAuth, ensureDir } from '$lib/server/volume';

const MAX_BYTES = 256 * 1024;
const SRC_DIR = join(process.cwd(), 'src', 'lib', 'cad', 'components');
const VOLUME_DIR = volumePath('components');

export const POST: RequestHandler = async ({ request, url }) => {
  // NOT proxied — like /api/components/save, the <id>.md sidecar is
  // dev-local project code. In dev it writes to src/, on prod the
  // volume overlay (same-origin). Proxying would strand it off the
  // local tree.
  checkVolumeAuth(request, url);

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const { id, instructions } = body as { id?: unknown; instructions?: unknown };
  if (typeof id !== 'string' || typeof instructions !== 'string') {
    throw error(400, 'Missing id (string) or instructions (string).');
  }
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw error(400, `Invalid id "${id}"`);
  // In dev, COMPONENT_REGISTRY is the source of truth. In prod, a saved
  // volume overlay (without a bundle id) is a legitimate edit target —
  // skip the registry whitelist check there. The volume write path
  // sanitizes id so there's no path-traversal risk.
  if (dev && !COMPONENT_REGISTRY.find((e) => e.meta.id === id)) {
    throw error(400, `Unknown component id "${id}" — not in registry.`);
  }
  if (Buffer.byteLength(instructions, 'utf8') > MAX_BYTES) {
    throw error(413, `Instructions too large (> ${MAX_BYTES} bytes).`);
  }

  // Dev writes to src/<id>.md (so HMR picks it up + a commit makes it
  // permanent). Prod writes to <volume>/components/<id>.md — the list
  // endpoint then surfaces the volume .md over the bundled one.
  const targetDir = dev ? SRC_DIR : VOLUME_DIR;
  const path = join(targetDir, `${id}.md`);
  try {
    if (dev) {
      await mkdir(targetDir, { recursive: true });
    } else {
      ensureDir('components');
    }
    if (instructions.trim() === '') {
      // Empty = remove the file. Keeps the source tree tidy and lets the
      // user reset back to "no instructions" without leaving stray .md
      // stubs.
      await unlink(path).catch(() => {});
    } else {
      await writeFile(path, instructions, 'utf8');
    }
  } catch (e: any) {
    throw error(500, `Write failed: ${e?.message ?? e}`);
  }

  invalidateRunesListCache();
  return json({ ok: true, path });
};
