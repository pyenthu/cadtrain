import { json, error } from '@sveltejs/kit';
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';
import { findPrim, removeIdForms } from '$lib/server/primitive-paths';
import { isStdlib } from '$lib/server/stdlib';

// Two-step deletion for volume primitives (file-based layout):
//   DELETE /api/primitives/delete?id=<id>
//     → ARCHIVE: copy the part's source to <volume>/primitives/archive/
//       <id>.<kind>.ts, then remove the active original (flat file or legacy
//       folder). Survives in archive/ until a permanent delete.
//   DELETE /api/primitives/delete?id=<id>&permanent=true
//     → HARD DELETE every on-disk form of <id> wherever it currently lives
//       (active OR archived).
//
// Bundle primitives cannot be deleted (they live in git-tracked src/). The
// /primitives UI hides delete + archive for non-volume entries.

const ID_RE = /^[a-z][a-z0-9_]*$/i;
const ARCHIVE = 'archive';

export const DELETE = async ({ url }) => {
  const id = url.searchParams.get('id');
  const permanent = url.searchParams.get('permanent') === 'true';
  if (!id || !ID_RE.test(id)) throw error(400, 'id query param required');
  if (id === ARCHIVE) throw error(400, 'cannot operate on the archive directory itself');
  // Stdlib primitives live in git-tracked src/ — they can't be archived or
  // deleted from the volume. Remove the file in src + redeploy instead.
  if (isStdlib(id)) {
    throw error(403, `"${id}" is a built-in (src) primitive — it can't be deleted from the volume; remove src/lib/graph/stdlib/${id}.ts and redeploy.`);
  }

  const archiveDir = volumePath(join('primitives', ARCHIVE));

  if (permanent) {
    // Hard delete wherever it lives (active or archived).
    const hit = await findPrim(id, { includeArchive: true });
    if (!hit) throw error(404, `primitive "${id}" not found (neither active nor archived)`);
    if (hit.legacy) await rm(join(hit.dir, id), { recursive: true, force: true });
    else await rm(hit.path, { force: true });
    return json({ ok: true, id, action: 'permanent-delete', removed: hit.path });
  }

  // Default: archive — move active → archive/. Excludes the archive subtree.
  const active = await findPrim(id, { includeArchive: false });
  if (!active) {
    // Idempotent: a duplicate archive click when it's already archived succeeds.
    if (await findPrim(id, { includeArchive: true })) {
      return json({ ok: true, id, action: 'archive', note: 'already archived' });
    }
    throw error(404, `primitive "${id}" not found on volume`);
  }
  const src = await readFile(active.path, 'utf8');
  await mkdir(archiveDir, { recursive: true });
  // Clear any prior archived copy of this id (new file or legacy folder), then
  // write the current source as the archived flat file.
  await removeIdForms(archiveDir, id);
  await writeFile(join(archiveDir, `${id}.${active.kind}.ts`), src, 'utf8');
  // Remove the active original.
  if (active.legacy) await rm(join(active.dir, id), { recursive: true, force: true });
  else await rm(active.path, { force: true });
  return json({ ok: true, id, action: 'archive' });
};
