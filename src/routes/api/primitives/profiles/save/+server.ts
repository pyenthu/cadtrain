import { json, error } from '@sveltejs/kit';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

// POST /api/primitives/profiles/save
//   { id, label?, set, tags?, kind?, params?, points? }
// Writes <volume>/primitives/profiles/<id>/profile.json. A configured profile
// stores { kind, params }; a hand-drawn one stores { points }. Custom-function
// profiles (P3) additionally get a source.ts via a later endpoint.
//
// Proxied to prod via VOLUME_PROXY_PATHS → single live store.
const ID_RE = /^[a-z][a-z0-9_]*$/;

export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { throw error(400, 'invalid JSON body'); }
  const { id, label, set, tags, kind, params, points } = body ?? {};
  if (typeof id !== 'string' || !ID_RE.test(id)) throw error(400, `bad id "${id}" — must match [a-z][a-z0-9_]*`);
  if (set !== 'cartesian' && set !== 'revolve') throw error(400, 'set must be "cartesian" | "revolve"');
  const hasKind = typeof kind === 'string' && kind.length > 0;
  const hasPoints = Array.isArray(points) && points.length >= 3;
  if (!hasKind && !hasPoints) throw error(400, 'profile needs a kind or points (>= 3)');

  const rec: any = {
    id,
    label: typeof label === 'string' && label.trim() ? label.trim() : id,
    set,
    tags: Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [],
  };
  if (hasKind) { rec.kind = kind; rec.params = (params && typeof params === 'object') ? params : {}; }
  if (hasPoints) rec.points = points;

  const dir = volumePath(join('primitives', 'profiles', id));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'profile.json'), JSON.stringify(rec, null, 2), 'utf8');
  return json({ ok: true, id, path: dir });
};
