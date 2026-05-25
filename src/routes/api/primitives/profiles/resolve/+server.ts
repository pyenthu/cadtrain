import { json, error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';
import { buildProfileFromSource } from '$lib/server/profile-fn';

// POST /api/primitives/profiles/resolve
//   { source, params }   → run raw build() source (live authoring preview), OR
//   { id, params }        → resolve a saved volume function profile by id.
// → { points: [[r,z],…] }.  A `build` is server-side (the points-only sandbox),
// so this is how the GUI re-resolves on param change — `resolveProfile` (sync,
// client) can only do the curated `kind`s. Proxied to prod (the {id} branch
// reads the prod volume source; {source} travels in the body either way).
const ID_RE = /^[a-z][a-z0-9_]*$/;

export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { throw error(400, 'invalid JSON body'); }
  const { source, id, params } = body ?? {};
  const p = (params && typeof params === 'object') ? params : {};

  let src: string;
  if (typeof source === 'string' && source.trim()) {
    src = source;
  } else if (typeof id === 'string' && ID_RE.test(id)) {
    try { src = await readFile(volumePath(join('primitives', 'profiles', id, 'source.ts')), 'utf8'); }
    catch { throw error(404, `no function profile "${id}" (missing source.ts)`); }
  } else {
    throw error(400, 'resolve needs a `source` string or a valid `id`');
  }

  try {
    return json({ points: buildProfileFromSource(src, p) });
  } catch (e) {
    throw error(400, `build() failed: ${(e as Error)?.message ?? e}`);
  }
};
