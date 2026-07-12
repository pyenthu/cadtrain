/**
 * /api/primitives/rename — rename a volume primitive in place.
 *   POST /api/primitives/rename?id=<oldId>&to=<newId>
 *
 * Renames the file (<oldId>.<kind>.ts → <newId>.<kind>.ts) in the same
 * category folder, and rewrites the source: meta.id, meta.name, and the
 * exported function name. The category dir is unchanged — pair with
 * /api/primitives/move if the user wants to relocate too.
 *
 * Refuses:
 *   - stdlib ids (read-only, src-tracked).
 *   - the new id colliding with an existing primitive (active or stdlib).
 *   - invalid id characters.
 *
 * Cross-references in OTHER assemblies (meta.uses, imports.src) are NOT
 * rewritten — anything depending on the old id breaks until the user
 * updates it. We surface a counted dependents list in the response so
 * the client can warn.
 *
 * Proxied to prod via hooks.server.ts (single live store, Rule 13).
 */

import { json, error } from '@sveltejs/kit';
import { rename, readFile, writeFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';
import { findPrim, primFilePath, removeIdForms } from '$lib/server/primitive-paths';
import { isStdlib } from '$lib/server/stdlib';

const ID_RE = /^[a-z][a-z0-9_]*$/i;

/** Rewrite meta.id, meta.name, and `export function <oldId>` → <newId>
 *  inside a primitive source. Only the canonical declaration sites — we
 *  don't blindly rewrite every occurrence (the body might legitimately
 *  reference the OLD id as a string for some debug purpose). */
function rewriteSource(source: string, oldId: string, newId: string): string {
  const reEscape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  let out = source;
  // meta.id: 'oldId'  →  meta.id: 'newId'
  out = out.replace(
    new RegExp(`(\\bid\\s*:\\s*)(['"])${reEscape(oldId)}\\2`),
    `$1$2${newId}$2`,
  );
  // meta.name: 'oldId'  →  meta.name: 'newId'  (only when it WAS the id; if the
  // user customized the name, leave it alone)
  out = out.replace(
    new RegExp(`(\\bname\\s*:\\s*)(['"])${reEscape(oldId)}\\2`),
    `$1$2${newId}$2`,
  );
  // export function oldId(  →  export function newId(
  out = out.replace(
    new RegExp(`(\\bexport\\s+function\\s+)${reEscape(oldId)}(\\s*\\()`),
    `$1${newId}$2`,
  );
  return out;
}

/** Count assemblies that still reference oldId via meta.uses or imports. */
async function countDependents(oldId: string): Promise<string[]> {
  const dependents: string[] = [];
  const reUses = new RegExp(`\\buses\\s*:\\s*\\[[^\\]]*\\b${oldId}\\b`);
  const reImport = new RegExp(`\\bsrc\\s*:\\s*['"]${oldId}['"]`);
  const root = volumePath('primitives');
  async function walk(dir: string): Promise<void> {
    let entries: import('node:fs').Dirent[] = [];
    try { entries = await readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = join(dir, e.name);
      if (e.isDirectory()) { await walk(p); continue; }
      // Only inspect .prim.ts / .asm.ts
      if (!/\.(prim|asm)\.ts$/.test(e.name)) continue;
      let src = ''; try { src = await readFile(p, 'utf8'); } catch { continue; }
      if (reUses.test(src) || reImport.test(src)) {
        // Derive the id from filename: <id>.<kind>.ts
        const m = e.name.match(/^([a-z][a-z0-9_]*)\.(prim|asm)\.ts$/i);
        if (m && m[1] !== oldId) dependents.push(m[1]);
      }
    }
  }
  try { await walk(root); } catch { /* tolerate */ }
  return dependents;
}

export const POST = async ({ url }) => {
  const oldId = url.searchParams.get('id');
  const newId = url.searchParams.get('to');
  if (!oldId || !ID_RE.test(oldId)) throw error(400, 'id query param required');
  if (!newId || !ID_RE.test(newId)) throw error(400, 'to (new id) required: lowercase letters, digits, underscore');
  if (oldId === newId) return json({ ok: true, oldId, newId, note: 'no change' });
  if (isStdlib(oldId)) throw error(403, `"${oldId}" is a built-in stdlib primitive — rename in src/lib/graph/stdlib/ + redeploy.`);
  if (isStdlib(newId)) throw error(409, `"${newId}" collides with a stdlib primitive — pick a different name.`);

  const hit = await findPrim(oldId, { includeArchive: true });
  if (!hit) throw error(404, `primitive "${oldId}" not found on volume`);
  if (hit.legacy) {
    throw error(409, `"${oldId}" still uses the legacy <id>/source.ts folder layout — migrate to the flat <id>.<kind>.ts file first (any save converts it).`);
  }

  // Collision: is newId already taken anywhere on the volume?
  const collide = await findPrim(newId, { includeArchive: true });
  if (collide) throw error(409, `primitive "${newId}" already exists at ${collide.path}`);

  // Read source, rewrite, write to the new flat path, remove the old file.
  const oldSrc = await readFile(hit.path, 'utf8');
  const newSrc = rewriteSource(oldSrc, oldId, newId);
  const destPath = primFilePath(hit.dir, newId, hit.kind);
  try {
    await writeFile(destPath, newSrc, 'utf8');
    await rename(hit.path, destPath).catch(async () => {
      // Already written via writeFile — safe to just remove the old file.
      await removeIdForms(hit.dir, oldId);
    });
    // Sanity sweep — `removeIdForms` also cleans any stray legacy folder
    // with the OLD id should one exist.
    await removeIdForms(hit.dir, oldId);
  } catch (e: any) {
    throw error(500, `rename write failed: ${e?.message || e}`);
  }

  const dependents = await countDependents(oldId);
  return json({ ok: true, oldId, newId, kind: hit.kind, dependents });
};
