import { json, error } from '@sveltejs/kit';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { extractMetaFromSource } from '$lib/server/primitives-meta';

// POST /api/primitives/save
//   { id: string, source: string }
// Writes <volume>/primitives/<id>/source.ts. The meta schema is
// embedded inside source.ts as `export const meta = {...}` (single
// source of truth) — no separate meta.json. If a legacy meta.json
// exists at the target path, it's removed on save so list/preview
// only ever reads from source.

const ID_RE = /^[a-z][a-z0-9_]*$/i;

export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }
  const { id, source } = body ?? {};
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw error(400, `bad id "${id}" — must match [a-z_][a-z0-9_]*`);
  }
  if (typeof source !== 'string' || !source.trim()) {
    throw error(400, 'source required (non-empty string)');
  }
  // Validate meta extracts cleanly before touching disk — a save that
  // would render the primitive invisible in /list should fail loudly.
  try { extractMetaFromSource(source); }
  catch (e: any) { throw error(400, `source missing valid meta: ${e?.message ?? e}`); }

  // Write back into the part's CURRENT location. If it already lives in the
  // tests/ sub-category, save THERE — otherwise editing a test primitive via
  // the GUI would silently fork a flat duplicate (it'd then show in both the
  // main list and the Tests folder). New ids default to the flat location.
  const testsDir = volumePath(join('primitives', 'tests', id));
  const dir = existsSync(join(testsDir, 'source.ts'))
    ? testsDir
    : volumePath(join('primitives', id));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'source.ts'), source, 'utf8');
  // Clear any legacy meta.json — source.ts is now canonical.
  const legacyMeta = join(dir, 'meta.json');
  if (existsSync(legacyMeta)) {
    try { await unlink(legacyMeta); } catch { /* best-effort */ }
  }
  return json({ ok: true, id, path: dir });
};
