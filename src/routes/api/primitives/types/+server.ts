import { json, error } from '@sveltejs/kit';
import { readdir, readFile, writeFile, rename, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

/**
 * Volume TYPE LIBRARY (typed-ports L2c) — the global, shared store for
 * user-defined composite record types (Point{r,z}, Casing{…}). One flat JSON
 * file per type at <volume>/types/<id>.json (top-level, NOT under primitives/,
 * so it never shows in the parts sidebar). Atomic writes (.tmp + rename, Rule 4).
 * Proxied to prod via VOLUME_PROXY_PATHS so local dev shares one library.
 *
 *   GET    → { types: TypeDef[] }                 list the library
 *   POST   { id, label?, fields:[{name,typeId,list?}] }   save one (atomic)
 *   DELETE ?id=Casing                             remove one
 *
 * A TypeDef on disk is the EDITABLE form { id, label, fields:[{name,typeId,list}] }
 * (list as a flag, not baked into typeId) so the definer round-trips it.
 */

const ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const typesDir = () => volumePath('types');

export const GET = async () => {
  let ents;
  try { ents = await readdir(typesDir(), { withFileTypes: true }); }
  catch { return json({ types: [] }); } // dir not created yet
  const types: any[] = [];
  for (const e of ents) {
    if (!e.isFile() || !e.name.endsWith('.json')) continue;
    try { types.push(JSON.parse(await readFile(join(typesDir(), e.name), 'utf8'))); }
    catch { /* skip malformed */ }
  }
  types.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return json({ types });
};

export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { throw error(400, 'invalid JSON body'); }
  const { id, label, fields } = body ?? {};
  if (typeof id !== 'string' || !ID_RE.test(id)) throw error(400, `bad id "${id}" — must match [A-Za-z][A-Za-z0-9_]*`);
  if (!Array.isArray(fields)) throw error(400, 'fields must be an array');
  const rec = {
    id,
    label: typeof label === 'string' && label.trim() ? label.trim() : id,
    fields: fields
      .filter((f: any) => f && typeof f.name === 'string' && f.name.trim() && typeof f.typeId === 'string')
      .map((f: any) => ({ name: String(f.name).trim(), typeId: String(f.typeId), list: !!f.list })),
  };
  await mkdir(typesDir(), { recursive: true });
  const target = join(typesDir(), `${id}.json`);
  const tmp = `${target}.tmp`;
  await writeFile(tmp, JSON.stringify(rec, null, 2), 'utf8');
  await rename(tmp, target); // atomic
  return json({ ok: true, id });
};

export const DELETE = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id || !ID_RE.test(id)) throw error(400, 'bad or missing id');
  try { await rm(join(typesDir(), `${id}.json`)); } catch { /* already gone */ }
  return json({ ok: true, id });
};
