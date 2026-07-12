import { json, error } from '@sveltejs/kit';
import { rename, mkdir, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';
import { findPrim, primFilePath, removeIdForms } from '$lib/server/primitive-paths';
import { isStdlib } from '$lib/server/stdlib';

// Move a volume primitive from one category folder to another.
//   POST /api/primitives/move?id=<id>&to=<category>
// where <category> ∈ { basic, archive } or completions/<family>. Since the
// /primitives sidebar groups by on-volume location (location IS category,
// Rule 16), moving the file IS the regroup. The id is unchanged — findPrim
// resolves it by id from wherever it now lives, so cross-references still work.
//
// Stdlib primitives (src/lib/graph/stdlib/) can't be moved — they're git-tracked.
// Proxied to prod via hooks.server.ts (single live store).

const ID_RE = /^[a-z][a-z0-9_]*$/i;
// Any user-created folder is a valid destination (Rule 16 — location IS
// category), matching the mkdir PATH_RE: 1–3 segments of [a-z][a-z0-9_]*.
// Reserved top-level names (profiles store, stdlib/stdstale read-only src
// engines) are excluded. Kept in sync with primitives-tree.ts MOVE_TARGET_RE.
const CAT_RE = /^(?!(?:profiles|stdlib|stdstale)(?:\/|$))[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*){0,2}$/i;

export const POST = async ({ url }) => {
  const id = url.searchParams.get('id');
  const to = (url.searchParams.get('to') || '').replace(/\/+$/, '');
  if (!id || !ID_RE.test(id)) throw error(400, 'id query param required');
  if (!to || !CAT_RE.test(to)) throw error(400, 'to must be a 1–3 segment volume folder path of [a-z][a-z0-9_]* (e.g. "basic", "completions/drill_pipe", or a custom folder) — not profiles/stdlib/stdstale');
  if (isStdlib(id)) {
    throw error(403, `"${id}" is a built-in (src) primitive — it can't be moved; it lives in src/lib/graph/stdlib/.`);
  }

  // Resolve where it currently lives (active only — don't fish parts out of
  // archive/ unless that's explicitly the target).
  const includeArchive = /^archive$/i.test(to);
  let hit = await findPrim(id, { includeArchive });
  // The part may itself live in archive/ (archive → active move). When the
  // active-only search came up empty, retry including archive. The first
  // search already covered every active dir, so this can only resolve to the
  // archived copy — it can never shadow an active part of the same id.
  if (!hit && !includeArchive) hit = await findPrim(id, { includeArchive: true });
  if (!hit) throw error(404, `primitive "${id}" not found on volume`);

  const destDir = volumePath(join('primitives', to));
  if (destDir === hit.dir) return json({ ok: true, id, to, note: 'already there' });

  await mkdir(destDir, { recursive: true });

  if (hit.legacy) {
    // Legacy <id>/source.ts folder — move the whole folder.
    const destFolder = join(destDir, id);
    if (existsSync(destFolder)) await rm(destFolder, { recursive: true, force: true });
    await rename(join(hit.dir, id), destFolder);
    return json({ ok: true, id, to, kind: hit.kind, legacy: true });
  }

  // New flat file — move <id>.<kind>.ts into destDir. Clear any same-id copy
  // already there first (flat or legacy) so we never end up with two.
  const destPath = primFilePath(destDir, id, hit.kind);
  await removeIdForms(destDir, id);
  try {
    await rename(hit.path, destPath);
  } catch {
    // Cross-device fallback (rename can EXDEV across mounts): copy + unlink.
    const src = await readFile(hit.path, 'utf8');
    await writeFile(destPath, src, 'utf8');
    await rm(hit.path, { force: true });
  }
  return json({ ok: true, id, to, kind: hit.kind });
};
