import { json, error } from '@sveltejs/kit';
import { rename, rm, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';

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

  const active = volumePath(join('primitives', id));
  const archived = volumePath(join('primitives', ARCHIVE, id));

  if (permanent) {
    // Hard delete from wherever the primitive currently lives.
    const target = existsSync(archived) ? archived : existsSync(active) ? active : null;
    if (!target) throw error(404, `primitive "${id}" not found (neither active nor archived)`);
    await rm(target, { recursive: true, force: true });
    return json({ ok: true, id, action: 'permanent-delete', removed: target });
  }

  // Default: archive — move from active → archive/. If already archived
  // (e.g. duplicate delete click) treat as success.
  if (!existsSync(active)) {
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
