import { json } from '@sveltejs/kit';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { buildProfileFromSource, splitProfileModule } from '$lib/server/profile-fn';
import { profileIdFromFile } from '$lib/server/primitive-paths';

// Default param vector from a params schema.
function defaultsOf(params: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (params && typeof params === 'object') {
    for (const [k, def] of Object.entries<any>(params)) out[k] = Number(def?.default ?? 0);
  }
  return out;
}

// GET /api/primitives/profiles/list → { profiles: ProfileRecord[] }
//
// File-based layout: each profile is a single merged module
// <volume>/primitives/profiles/<id>.prvl.ts (revolve) or .prex.ts (extrude) —
// meta (params schema + axis) + build(). Legacy <id>/{profile.json, source.ts}
// folders are still listed (until migrated). This dir is invisible to the
// primitives list/source resolvers, so it never pollutes the sidebar.
// Proxied to prod via VOLUME_PROXY_PATHS.
export const GET = async () => {
  const dir = volumePath(join('primitives', 'profiles'));
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); } catch { return json({ profiles: [] }); }

  const byId = new Map<string, any>();

  // New merged modules (<id>.prvl.ts / .prex.ts) — win over legacy folders.
  for (const e of ents) {
    if (!e.isFile() || !profileIdFromFile(e.name)) continue;
    try {
      const mod = await readFile(join(dir, e.name), 'utf8');
      const { meta } = splitProfileModule(mod);
      if (meta.set !== 'cartesian' && meta.set !== 'revolve') continue;
      const rec: any = { ...meta, hasSource: true };
      try { rec.points = buildProfileFromSource(mod, defaultsOf(meta.params)); }
      catch (err) { rec.buildError = String((err as Error)?.message ?? err); }
      byId.set(meta.id, rec);
    } catch { /* skip malformed module */ }
  }

  // Legacy folder profiles (profile.json + optional source.ts).
  for (const e of ents) {
    if (!e.isDirectory() || byId.has(e.name)) continue;
    try {
      const p = JSON.parse(await readFile(join(dir, e.name, 'profile.json'), 'utf8'));
      if (!(p && typeof p.id === 'string' && (p.set === 'cartesian' || p.set === 'revolve'))) continue;
      const srcPath = join(dir, e.name, 'source.ts');
      const hasSource = existsSync(srcPath);
      const rec: any = { ...p, hasSource };
      if (hasSource) {
        try { rec.points = buildProfileFromSource(await readFile(srcPath, 'utf8'), defaultsOf(p.params)); }
        catch (err) { rec.buildError = String((err as Error)?.message ?? err); }
      }
      byId.set(p.id, rec);
    } catch { /* skip malformed */ }
  }

  return json({ profiles: [...byId.values()] });
};
