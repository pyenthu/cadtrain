import { json } from '@sveltejs/kit';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';
import { buildProfileFromSource } from '$lib/server/profile-fn';

// Default param vector from a profile.json params schema.
function defaultsOf(params: any): Record<string, number> {
  const out: Record<string, number> = {};
  if (params && typeof params === 'object') {
    for (const [k, def] of Object.entries<any>(params)) out[k] = Number(def?.default ?? 0);
  }
  return out;
}

// GET /api/primitives/profiles/list → { profiles: ProfileRecord[] }
//
// Volume-saved profiles (profile-system.md P2). Each lives in its own dir
// <volume>/primitives/profiles/<id>/profile.json (directory-per-part, Rule 18),
// optionally with a source.ts (P3 custom-fn). This dir is INVISIBLE to the
// primitives list/source resolvers (they only recurse archive/basic/industrial/
// completions and require a source.ts), so it never pollutes the sidebar.
//
// Proxied to prod via VOLUME_PROXY_PATHS (hooks.server.ts) → single live store.
export const GET = async () => {
  const dir = volumePath(join('primitives', 'profiles'));
  let ents;
  try { ents = await readdir(dir, { withFileTypes: true }); } catch { return json({ profiles: [] }); }
  const profiles: any[] = [];
  for (const e of ents) {
    if (!e.isDirectory()) continue;
    try {
      const raw = await readFile(join(dir, e.name, 'profile.json'), 'utf8');
      const p = JSON.parse(raw);
      if (p && typeof p.id === 'string' && (p.set === 'cartesian' || p.set === 'revolve')) {
        const srcPath = join(dir, e.name, 'source.ts');
        const hasSource = existsSync(srcPath);
        const rec: any = { ...p, hasSource };
        if (hasSource) {
          // P3: resolve the function profile's build(defaults) → preview points so
          // the catalog carries geometry. A broken build() degrades to no preview,
          // not a 500 — the dropdown can still list it.
          try {
            const src = await readFile(srcPath, 'utf8');
            rec.points = buildProfileFromSource(src, defaultsOf(p.params));
          } catch (err) {
            rec.buildError = String((err as Error)?.message ?? err);
          }
        }
        profiles.push(rec);
      }
    } catch { /* skip malformed */ }
  }
  return json({ profiles });
};
