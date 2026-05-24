import { json, error } from '@sveltejs/kit';
import { rename, rm, mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';

// Find a primitive's CURRENT directory anywhere in the tree — flat
// (primitives/<id>/), one level (primitives/<cat>/<id>/), or two
// (primitives/<cat>/<family>/<id>/). Mirrors the save/source resolvers; the
// old flat-only lookup 404'd on basic/industrial/completions parts (so they
// couldn't be archived). Excludes the archive/ subtree.
async function findActiveDir(id: string): Promise<string | null> {
  const root = volumePath('primitives');
  const flat = join(root, id);
  if (existsSync(join(flat, 'source.ts'))) return flat;
  let lvl1;
  try { lvl1 = await readdir(root, { withFileTypes: true }); } catch { return null; }
  for (const cat of lvl1) {
    if (!cat.isDirectory() || cat.name === 'archive') continue;
    const p1 = join(root, cat.name, id);
    if (existsSync(join(p1, 'source.ts'))) return p1;
    let lvl2;
    try { lvl2 = await readdir(join(root, cat.name), { withFileTypes: true }); } catch { continue; }
    for (const fam of lvl2) {
      if (!fam.isDirectory()) continue;
      const p2 = join(root, cat.name, fam.name, id);
      if (existsSync(join(p2, 'source.ts'))) return p2;
    }
  }
  return null;
}

// Two-step deletion for volume primitives:
//   DELETE /api/primitives/delete?id=<id>
//     → MOVE <volume>/primitives/<id>/ into <volume>/primitives/archive/<id>/.
//     This is the default action triggered by the trash button in the
//     active list. Survives in `archive/` until a permanent delete.
//   DELETE /api/primitives/delete?id=<id>&permanent=true
//     → RECURSIVELY DELETE either <volume>/primitives/<id>/ or
//     <volume>/primitives/archive/<id>/, whichever exists. Used by
//     the archive view's permanent-delete button.
//
// Bundle primitives cannot be deleted (they live in git-tracked src/).
// The /primitives UI hides delete + archive UI for non-volume entries.

const ID_RE = /^[a-z][a-z0-9_]*$/i;
const ARCHIVE = 'archive';

export const DELETE = async ({ url }) => {
  const id = url.searchParams.get('id');
  const permanent = url.searchParams.get('permanent') === 'true';
  if (!id || !ID_RE.test(id)) throw error(400, 'id query param required');
  if (id === ARCHIVE) throw error(400, 'cannot operate on the archive directory itself');

  const active = await findActiveDir(id);
  const archived = volumePath(join('primitives', ARCHIVE, id));

  if (permanent) {
    // Hard delete from wherever the primitive currently lives.
    const target = existsSync(archived) ? archived : active;
    if (!target) throw error(404, `primitive "${id}" not found (neither active nor archived)`);
    await rm(target, { recursive: true, force: true });
    return json({ ok: true, id, action: 'permanent-delete', removed: target });
  }

  // Default: archive — move from active → archive/. If already archived
  // (e.g. duplicate delete click) treat as success.
  if (!active) {
    if (existsSync(archived)) return json({ ok: true, id, action: 'archive', note: 'already archived' });
    throw error(404, `primitive "${id}" not found on volume`);
  }
  // Collision: archive/<id> already exists from a prior archive of the
  // same id. Overwrite with the current copy so the user's last action
  // is what's preserved.
  if (existsSync(archived)) await rm(archived, { recursive: true, force: true });
  await mkdir(volumePath(join('primitives', ARCHIVE)), { recursive: true });
  await rename(active, archived);
  return json({ ok: true, id, action: 'archive' });
};
