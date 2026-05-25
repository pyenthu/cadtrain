import { json, error } from '@sveltejs/kit';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { buildProfileFromSource } from '$lib/server/profile-fn';

// POST /api/primitives/profiles/save
//   { id, label?, set, tags?, kind?, params?, points?, source? }
// Writes <volume>/primitives/profiles/<id>/profile.json. Three flavours:
//   • configured  → { kind, params }          (params = VALUES for the kind)
//   • hand-drawn  → { points }
//   • FUNCTION    → source.ts with build(p) + { params } (params = SCHEMA:
//                   {label,min,max,step,default,unit}).  P3.
// A function save validates build(defaults) in the sandbox first — a broken
// build never lands on disk. Proxied to prod via VOLUME_PROXY_PATHS.
const ID_RE = /^[a-z][a-z0-9_]*$/;

function defaultsOf(params: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (params && typeof params === 'object') {
    for (const [k, def] of Object.entries<any>(params)) out[k] = Number(def?.default ?? 0);
  }
  return out;
}

export const POST = async ({ request }) => {
  let body: any;
  try { body = await request.json(); } catch { throw error(400, 'invalid JSON body'); }
  const { id, label, description, set, tags, kind, params, points, source } = body ?? {};
  if (typeof id !== 'string' || !ID_RE.test(id)) throw error(400, `bad id "${id}" — must match [a-z][a-z0-9_]*`);
  if (set !== 'cartesian' && set !== 'revolve') throw error(400, 'set must be "cartesian" | "revolve"');
  const hasKind = typeof kind === 'string' && kind.length > 0;
  const hasPoints = Array.isArray(points) && points.length >= 3;
  const hasSource = typeof source === 'string' && /\bfunction\s+build\b/.test(source);
  if (!hasKind && !hasPoints && !hasSource) throw error(400, 'profile needs a kind, points (>= 3), or a build() source');

  const rec: any = {
    id,
    label: typeof label === 'string' && label.trim() ? label.trim() : id,
    description: typeof description === 'string' ? description.trim() : '',
    set,
    tags: Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [],
  };
  if (hasKind) { rec.kind = kind; rec.params = (params && typeof params === 'object') ? params : {}; }
  if (hasPoints) rec.points = points;
  if (hasSource) {
    rec.params = (params && typeof params === 'object') ? params : {};
    // Fail fast: the build() must resolve on its own defaults before it persists.
    try { buildProfileFromSource(source, defaultsOf(rec.params)); }
    catch (e) { throw error(400, `build() failed on defaults: ${(e as Error)?.message ?? e}`); }
  }

  const dir = volumePath(join('primitives', 'profiles', id));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'profile.json'), JSON.stringify(rec, null, 2), 'utf8');
  if (hasSource) await writeFile(join(dir, 'source.ts'), source, 'utf8');
  // Switching a function profile back to configured/drawn: drop the stale source.
  else if (existsSync(join(dir, 'source.ts'))) await rm(join(dir, 'source.ts'));
  return json({ ok: true, id, path: dir });
};
