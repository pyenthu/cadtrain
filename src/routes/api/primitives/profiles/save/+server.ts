import { json, error } from '@sveltejs/kit';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { buildProfileFromSource, composeProfileModule } from '$lib/server/profile-fn';
import { profileFilePath, legacyProfileDir } from '$lib/server/primitive-paths';

// POST /api/primitives/profiles/save
//   { id, label?, description?, set, tags?, kind?, params?, points?, source? }
// FUNCTION profile (source + build) → the new merged module
//   <volume>/primitives/profiles/<id>.prvl.ts | .prex.ts  (meta + build in one
//   file). A function save validates build(defaults) in the sandbox first — a
//   broken build never lands on disk — then drops any legacy folder it migrates.
// Configured (kind) / hand-drawn (points) profiles keep the legacy folder write
// (profile.json) — these flavours are being retired (function-first, P3).
// Proxied to prod via VOLUME_PROXY_PATHS.
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

  const meta = {
    id,
    label: typeof label === 'string' && label.trim() ? label.trim() : id,
    description: typeof description === 'string' ? description.trim() : '',
    set: set as 'cartesian' | 'revolve',
    tags: Array.isArray(tags) ? tags.filter((t) => typeof t === 'string') : [],
    params: (params && typeof params === 'object') ? params : {},
  };

  // FUNCTION profile → merged module (new flat file).
  if (hasSource) {
    // Fail fast: build() must resolve on its own defaults before it persists.
    try { buildProfileFromSource(source, defaultsOf(meta.params)); }
    catch (e) { throw error(400, `build() failed on defaults: ${(e as Error)?.message ?? e}`); }
    const filePath = profileFilePath(id, set);
    await mkdir(volumePath(join('primitives', 'profiles')), { recursive: true });
    await writeFile(filePath, composeProfileModule(meta, source), 'utf8');
    // Migrate-on-save: drop the legacy folder if this id used to live there.
    const legacy = legacyProfileDir(id);
    if (existsSync(legacy)) { try { await rm(legacy, { recursive: true, force: true }); } catch { /* best-effort */ } }
    return json({ ok: true, id, path: filePath });
  }

  // Configured (kind) / hand-drawn (points) → legacy folder profile.json.
  const rec: any = { id: meta.id, label: meta.label, description: meta.description, set: meta.set, tags: meta.tags };
  if (hasKind) { rec.kind = kind; rec.params = meta.params; }
  if (hasPoints) rec.points = points;
  const dir = legacyProfileDir(id);
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'profile.json'), JSON.stringify(rec, null, 2), 'utf8');
  return json({ ok: true, id, path: dir });
};
