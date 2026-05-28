import { json, error } from '@sveltejs/kit';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';
import { extractMetaFromSource } from '$lib/server/primitives-meta';
import { findPrim, primFilePath } from '$lib/server/primitive-paths';
import { isStdlib } from '$lib/server/stdlib';

// POST /api/primitives/save
//   { id: string, source: string, dir?: string }
// Writes the part's source to the new flat file <volume>/primitives/<cat>/
// <id>.prim.ts (file-based layout — docs/plans/file-based-architecture.md).
// The meta schema is embedded inside the source as `export const meta = {...}`
// (single source of truth) — no sidecars. Updates write back IN PLACE (the
// part's resolved category); a brand-new id lands in `dir` (or flat). When the
// part still exists in the LEGACY <id>/source.ts folder, the save supersedes
// it as a flat file and removes the old folder (migrate-on-save).

const ID_RE = /^[a-z][a-z0-9_]*$/i;

export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }
  const { id, source, dir: targetDir } = body ?? {};
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw error(400, `bad id "${id}" — must match [a-z_][a-z0-9_]*`);
  }
  // Stdlib primitives are canonical in git-tracked src/ and read-only here —
  // refuse to fork one onto the volume (where it would shadow nothing and just
  // drift). Edit src/lib/cad/stdlib/<id>.ts and redeploy instead.
  if (isStdlib(id)) {
    throw error(403, `"${id}" is a built-in (src) primitive — edit src/lib/cad/stdlib/${id}.ts and redeploy; it can't be saved to the volume.`);
  }
  // Optional target folder for a NEW primitive (the sidebar "+ add" affordance).
  // Allowlisted to the known group folders — no traversal. Ignored when the id
  // already exists (updates always write back in place).
  // basic | archive | completions/<family> | completions/<family>/<subfolder>
  const TARGET_RE = /^(basic|archive|completions\/[a-z][a-z0-9_]*(?:\/[a-z][a-z0-9_]*)?)$/;
  if (targetDir != null && (typeof targetDir !== 'string' || !TARGET_RE.test(targetDir))) {
    throw error(400, `bad dir "${targetDir}" — must be basic | archive | completions/<family> | completions/<family>/<subfolder>`);
  }
  if (typeof source !== 'string' || !source.trim()) {
    throw error(400, 'source required (non-empty string)');
  }
  // Validate meta extracts cleanly before touching disk — a save that
  // would render the primitive invisible in /list should fail loudly.
  try { extractMetaFromSource(source); }
  catch (e: any) { throw error(400, `source missing valid meta: ${e?.message ?? e}`); }

  // Write back into the part's CURRENT ACTIVE category dir — findPrim searches
  // basic/, completions/<family>/, or flat (NOT archive/) so an
  // edit never FORKS a flat duplicate. A new id lands in `dir` (or flat).
  // includeArchive:false is load-bearing: a NEW part whose id collides with an
  // ARCHIVED part (e.g. creating dp_new when archive/dp_new exists) must NOT
  // resolve to the archived copy and silently save into archive/ (where it's
  // invisible in the active sidebar — "it's not saving").
  const existing = await findPrim(id, { includeArchive: false });
  const dir = existing
    ? existing.dir
    : (targetDir ? volumePath(join('primitives', targetDir)) : volumePath('primitives'));
  const kind = existing?.kind ?? 'prim';
  await mkdir(dir, { recursive: true });
  const filePath = primFilePath(dir, id, kind);
  await writeFile(filePath, source, 'utf8');
  // Migrate-on-save: if the part still lived in the legacy <id>/ folder, the
  // flat file now supersedes it — drop the folder so it isn't double-listed.
  if (existing?.legacy) {
    try { await rm(join(dir, id), { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  return json({ ok: true, id, path: filePath });
};
