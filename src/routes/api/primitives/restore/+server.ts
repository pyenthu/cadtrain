import { json, error } from '@sveltejs/kit';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { removeIdForms } from '$lib/server/primitive-paths';

// POST /api/primitives/restore?id=<id>
// Moves an archived part out of <volume>/primitives/archive/ back to the flat
// active location <volume>/primitives/<id>.<kind>.ts (archive flattens, so the
// original category is not recoverable — re-categorize via the editor). Pairs
// with DELETE /api/primitives/delete. 404s if no archived copy exists.

const ID_RE = /^[a-z][a-z0-9_]*$/i;

export const POST = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id || !ID_RE.test(id)) throw error(400, 'id query param required');

  const archiveDir = volumePath(join('primitives', 'archive'));
  // Locate the archived form: new flat file, then legacy folder.
  let src: string | null = null;
  let kind: 'prim' | 'asm' = 'prim';
  let legacyFolder: string | null = null;
  for (const k of ['prim', 'asm'] as const) {
    const p = join(archiveDir, `${id}.${k}.ts`);
    if (existsSync(p)) { src = await readFile(p, 'utf8'); kind = k; break; }
  }
  if (src == null) {
    const lf = join(archiveDir, id, 'source.ts');
    if (existsSync(lf)) { src = await readFile(lf, 'utf8'); legacyFolder = join(archiveDir, id); }
  }
  if (src == null) throw error(404, `archived primitive "${id}" not found`);

  // Clear any active copy at the flat root, then write the restored flat file.
  const root = volumePath('primitives');
  await removeIdForms(root, id);
  await writeFile(join(root, `${id}.${kind}.ts`), src, 'utf8');
  // Remove the archived original.
  if (legacyFolder) await rm(legacyFolder, { recursive: true, force: true });
  else await rm(join(archiveDir, `${id}.${kind}.ts`), { force: true });
  return json({ ok: true, id, action: 'restore' });
};
