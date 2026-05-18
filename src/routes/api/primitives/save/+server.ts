import { json, error } from '@sveltejs/kit';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

// POST /api/primitives/save
//   { id: string, source: string, meta: { name, description?, tags?, params } }
// Writes <volume>/primitives/<id>/{source.ts, meta.json}. If the id is
// new, the directory is created. Overwrites any existing files at that
// path — saves are atomic-per-file (temp + rename omitted for now;
// good-enough for a single-user authoring workflow).
//
// Stage G v4 — see ~/.claude/plans/components-primitives-split.md.

const ID_RE = /^[a-z][a-z0-9_]*$/i;

export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); }
  catch { throw error(400, 'invalid JSON body'); }
  const { id, source, meta } = body ?? {};
  if (typeof id !== 'string' || !ID_RE.test(id)) {
    throw error(400, `bad id "${id}" — must match [a-z_][a-z0-9_]*`);
  }
  if (typeof source !== 'string' || !source.trim()) {
    throw error(400, 'source required (non-empty string)');
  }
  if (!meta || typeof meta !== 'object' || !meta.params || typeof meta.params !== 'object') {
    throw error(400, 'meta.params is required (object)');
  }
  const dir = volumePath(join('primitives', id));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'source.ts'), source, 'utf8');
  // Strip undefined keys + lock down the meta shape we persist
  const metaToWrite = {
    id,
    name: meta.name ?? id,
    description: meta.description ?? '',
    tags: Array.isArray(meta.tags) ? meta.tags : [],
    params: meta.params,
  };
  await writeFile(join(dir, 'meta.json'), JSON.stringify(metaToWrite, null, 2) + '\n', 'utf8');
  return json({ ok: true, id, path: dir });
};
