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
  const { id, source, dir: targetDir, kind: requestedKind } = body ?? {};
  // Optional kind override — when provided AND different from the existing
  // file's kind, this re-types the part (e.g. .prim.ts → .exp.ts). Used by the
  // typed-builder upgrade path: scaffolding a new Extrude Part via the picker
  // writes kind:'exp'; converting an existing .prim.ts template to .exp.ts
  // writes the new file + removes the old one to avoid double-listing. Must be
  // one of the PrimKind values; bad values are rejected before any disk ops.
  const KIND_RE = /^(prim|exp|rev|asm)$/;
  if (requestedKind != null && (typeof requestedKind !== 'string' || !KIND_RE.test(requestedKind))) {
    throw error(400, `bad kind "${requestedKind}" — must be prim | exp | rev | asm`);
  }
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
  // Any 1–3-segment folder under primitives/ (each segment [a-z][a-z0-9_]*) —
  // matches the vertical-tab sidebar's dynamic folder-tabs + subfolders and the
  // 3-level resolver depth (primitive-paths.ts findPrim). No traversal (no '.',
  // no leading slash); `profiles` is reserved.
  const TARGET_RE = /^[a-z][a-z0-9_]*(\/[a-z][a-z0-9_]*){0,2}$/i;
  if (targetDir != null && (typeof targetDir !== 'string' || !TARGET_RE.test(targetDir) || targetDir.split('/')[0].toLowerCase() === 'profiles')) {
    throw error(400, `bad dir "${targetDir}" — must be 1–3 segments of [a-z][a-z0-9_]* under primitives/ (not profiles)`);
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
  // Kind precedence: explicit override > existing file's kind > default 'prim'.
  // The override path re-types the file (writes <id>.<newKind>.ts + removes the
  // old <id>.<existingKind>.ts) so the part appears as exactly ONE entry.
  const kind = (requestedKind as any) ?? existing?.kind ?? 'prim';
  const reTyping = existing && requestedKind && existing.kind !== requestedKind;
  await mkdir(dir, { recursive: true });
  const filePath = primFilePath(dir, id, kind);
  await writeFile(filePath, source, 'utf8');
  // Migrate-on-save: if the part still lived in the legacy <id>/ folder, the
  // flat file now supersedes it — drop the folder so it isn't double-listed.
  if (existing?.legacy) {
    try { await rm(join(dir, id), { recursive: true, force: true }); } catch { /* best-effort */ }
  }
  // Re-typing: drop the OLD typed file so the same id doesn't show up twice
  // (once as .prim.ts and once as .exp.ts). hitInDir would prefer the new
  // extension via PRIM_KINDS order, but listEntitiesIn dedupes by id so a
  // stale old file would still hide the new one if we left it.
  if (reTyping && existing) {
    try { await rm(existing.path, { force: true }); } catch { /* best-effort */ }
  }
  return json({ ok: true, id, path: filePath, kind });
};
