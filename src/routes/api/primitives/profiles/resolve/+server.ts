import { json, error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { findProfile } from '$lib/server/primitive-paths';
import { buildProfileFromSource } from '$lib/server/profile-fn';

// POST /api/primitives/profiles/resolve
//   { source, params }   → run raw build() source (live authoring preview), OR
//   { id, params }        → resolve a saved volume profile by id.
// → { points: [[r,z],…] }. buildProfileFromSource strips imports + finds the
// `build` export, so it accepts either a bare build body OR the full merged
// module (meta + build). Proxied to prod (the {id} branch reads the prod volume).
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
    const hit = findProfile(id);
    if (!hit) throw error(404, `no function profile "${id}"`);
    src = await readFile(hit.path, 'utf8');
  } else {
    throw error(400, 'resolve needs a `source` string or a valid `id`');
  }

  try {
    return json({ points: buildProfileFromSource(src, p) });
  } catch (e) {
    throw error(400, `build() failed: ${(e as Error)?.message ?? e}`);
  }
};
