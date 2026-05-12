/**
 * POST /api/runes/instructions
 *
 * Persist the AI instructions doc for a runes primitive — written to
 * src/lib/components/runes/<id>.md alongside the .ts. The AI Refine
 * endpoint reads this file (via the runes registry) and includes it in
 * every Claude system prompt, so editing it is how the user "trains"
 * the AI's understanding of what this primitive should be.
 *
 * Body: { id, instructions }
 * Returns: { ok: true, path } on success.
 *
 * Mirrors /api/runes/save but writes the .md sibling rather than the
 * .ts source. Production overlay path is /data/runes/<id>.md (not yet
 * wired — same status as save.ts).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { join } from 'path';
import { dev } from '$app/environment';
import { RUNES_REGISTRY } from '$lib/components/runes';
import { invalidateRunesListCache } from '../list/cache';

const MAX_BYTES = 256 * 1024;
const SRC_DIR = join(process.cwd(), 'src', 'lib', 'components', 'runes');

export const POST: RequestHandler = async ({ request }) => {
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') throw error(400, 'Invalid JSON body');
  const { id, instructions } = body as { id?: unknown; instructions?: unknown };
  if (typeof id !== 'string' || typeof instructions !== 'string') {
    throw error(400, 'Missing id (string) or instructions (string).');
  }
  if (!/^[a-z][a-z0-9_]*$/.test(id)) throw error(400, `Invalid id "${id}"`);
  if (!RUNES_REGISTRY.find((e) => e.meta.id === id)) {
    throw error(400, `Unknown runes id "${id}" — not in registry.`);
  }
  if (Buffer.byteLength(instructions, 'utf8') > MAX_BYTES) {
    throw error(413, `Instructions too large (> ${MAX_BYTES} bytes).`);
  }

  if (!dev) {
    return json({
      ok: false,
      reason: 'Production overlay loader not wired yet — instructions edits disabled.',
    }, { status: 503 });
  }

  const path = join(SRC_DIR, `${id}.md`);
  try {
    await mkdir(SRC_DIR, { recursive: true });
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
