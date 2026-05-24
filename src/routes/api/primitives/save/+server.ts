import { json, error } from '@sveltejs/kit';
import { mkdir, writeFile, unlink, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { extractMetaFromSource } from '$lib/server/primitives-meta';

// Find a primitive's CURRENT directory anywhere in the primitives tree —
// flat (primitives/<id>/), one level (primitives/<cat>/<id>/, e.g. basic/
// industrial/archive), or two (primitives/completions/<family>/<id>/). Mirrors
// the source endpoint's resolver. Returns null for a genuinely new id.
async function findExistingDir(id: string): Promise<string | null> {
  const root = volumePath('primitives');
  const flat = volumePath(join('primitives', id));
  if (existsSync(join(flat, 'source.ts'))) return flat;
  let lvl1;
  try { lvl1 = await readdir(root, { withFileTypes: true }); } catch { return null; }
  for (const cat of lvl1) {
    if (!cat.isDirectory()) continue;
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
  const { id, source, dir: targetDir } = body ?? {};
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw error(400, `bad id "${id}" — must match [a-z_][a-z0-9_]*`);
  }
  // Optional target folder for a NEW primitive (the sidebar "+ add" affordance).
  // Allowlisted to the known group folders — no traversal. Ignored when the id
  // already exists (updates always write back in place).
  const TARGET_RE = /^(basic|industrial|archive|completions\/[a-z][a-z0-9_]*)$/;
  if (targetDir != null && (typeof targetDir !== 'string' || !TARGET_RE.test(targetDir))) {
    throw error(400, `bad dir "${targetDir}" — must be basic | industrial | archive | completions/<family>`);
  }
  if (typeof source !== 'string' || !source.trim()) {
    throw error(400, 'source required (non-empty string)');
  }
  // Validate meta extracts cleanly before touching disk — a save that
  // would render the primitive invisible in /list should fail loudly.
  try { extractMetaFromSource(source); }
  catch (e: any) { throw error(400, `source missing valid meta: ${e?.message ?? e}`); }

  // Write back into the part's CURRENT location — search the whole tree
  // (basic/, industrial/, completions/<family>/, archive/, or flat). The old
  // code only checked the pre-restructure `tests/` path, so saving an edit to
  // a primitive that lives in a category sub-folder silently FORKED a flat
  // top-level duplicate (it then showed twice in the list — and a duplicate id
  // crashed the inspector). New ids default to the flat location.
  const existing = await findExistingDir(id);
  const dir = existing
    ?? (targetDir ? volumePath(join('primitives', targetDir, id)) : volumePath(join('primitives', id)));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'source.ts'), source, 'utf8');
  // Clear any legacy meta.json — source.ts is now canonical.
  const legacyMeta = join(dir, 'meta.json');
  if (existsSync(legacyMeta)) {
    try { await unlink(legacyMeta); } catch { /* best-effort */ }
  }
  return json({ ok: true, id, path: dir });
};
