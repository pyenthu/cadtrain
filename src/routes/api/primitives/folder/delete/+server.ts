import { json, error } from '@sveltejs/kit';
import { readFile, writeFile, mkdir, rm, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';
import { listEntitiesIn, removeIdForms } from '$lib/server/primitive-paths';

// DELETE /api/primitives/folder/delete?path=<path>
// Delete a folder, ARCHIVING every part inside it (recursively) to
// primitives/archive/<id>.<kind>.ts FIRST — recoverable via /api/primitives/
// restore — then removing the now-empty directory. Matches the part trash-to-
// archive convention (Rule 16). Canonical roots are protected. Proxied (Rule 13).

const PATH_RE = /^[a-z][a-z0-9_]*(\/[a-z][a-z0-9_]*){0,2}$/i;
const PROTECTED = new Set(['basic', 'completions', 'archive', 'profiles']);

type PartHit = { dir: string; id: string; kind: string; legacy: boolean };

/** Every part {dir,id,kind,legacy} under `abs`, recursing into subfolders
 *  (but NOT into a legacy `<id>/source.ts` part folder). */
async function collectParts(abs: string): Promise<PartHit[]> {
  const here = await listEntitiesIn(abs);
  const out: PartHit[] = here.map((e) => ({ dir: abs, id: e.id, kind: e.kind, legacy: e.legacy }));
  const legacyIds = new Set(here.filter((e) => e.legacy).map((e) => e.id));
  let ents;
  try { ents = await readdir(abs, { withFileTypes: true }); } catch { return out; }
  for (const e of ents) {
    if (e.isDirectory() && !legacyIds.has(e.name)) out.push(...(await collectParts(join(abs, e.name))));
  }
  return out;
}

export const DELETE = async ({ url }) => {
  const path = (url.searchParams.get('path') || '').replace(/\/+$/, '');
  if (!path || !PATH_RE.test(path)) throw error(400, 'path must be 1–3 segments of [a-z][a-z0-9_]*');
  if (PROTECTED.has(path)) throw error(400, `"${path}" is a built-in folder and can't be deleted`);

  const abs = volumePath(join('primitives', path));
  if (!existsSync(abs)) throw error(404, `folder "${path}" not found`);

  const parts = await collectParts(abs);
  const archiveDir = volumePath(join('primitives', 'archive'));
  await mkdir(archiveDir, { recursive: true });
  const archived: string[] = [];
  for (const p of parts) {
    try {
      const srcPath = p.legacy ? join(p.dir, p.id, 'source.ts') : join(p.dir, `${p.id}.${p.kind}.ts`);
      const src = await readFile(srcPath, 'utf8');
      await removeIdForms(archiveDir, p.id); // clear any prior archived copy
      await writeFile(join(archiveDir, `${p.id}.${p.kind}.ts`), src, 'utf8');
      archived.push(p.id);
    } catch { /* best-effort per part — a read/write failure shouldn't strand the rest */ }
  }
  await rm(abs, { recursive: true, force: true });
  return json({ ok: true, path, archived });
};
