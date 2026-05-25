import { json, error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

// GET /api/primitives/profiles/source?id=<id>
//   → { id, label, set, tags, params, source }  (source = the build() source.ts)
// Backs the ProfileFnEditor EDIT-EXISTING flow (K.22 D): load a saved function
// profile back into the editor to update it. The list endpoint returns params +
// resolved points but NOT the source body, so this fetches it lazily.
// Proxied to prod via VOLUME_PROXY_PATHS (reads the prod volume).
const ID_RE = /^[a-z][a-z0-9_]*$/;

export const GET = async ({ url }) => {
  const id = url.searchParams.get('id') ?? '';
  if (!ID_RE.test(id)) throw error(400, `bad id "${id}"`);
  const dir = volumePath(join('primitives', 'profiles', id));
  let meta: any = {};
  try { meta = JSON.parse(await readFile(join(dir, 'profile.json'), 'utf8')); }
  catch { throw error(404, `no profile "${id}"`); }
  let source = '';
  try { source = await readFile(join(dir, 'source.ts'), 'utf8'); }
  catch { /* configured/drawn profile — no source */ }
  return json({ id, label: meta.label ?? id, description: meta.description ?? '', set: meta.set ?? 'revolve', tags: meta.tags ?? [], params: meta.params ?? {}, source });
};
