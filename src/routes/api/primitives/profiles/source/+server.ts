import { json, error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { findProfile, legacyProfileDir } from '$lib/server/primitive-paths';
import { splitProfileModule } from '$lib/server/profile-fn';

// GET /api/primitives/profiles/source?id=<id>
//   → { id, label, description, set, tags, params, source }
//     source = the build() body (so the ProfileFnEditor can edit it).
// Reads the new merged module <volume>/primitives/profiles/<id>.prvl.ts (or
// .prex.ts) — meta + build() in one file — and splits it back. Falls back to
// the legacy <id>/{profile.json, source.ts} pair until migrated.
// Proxied to prod via VOLUME_PROXY_PATHS.
const ID_RE = /^[a-z][a-z0-9_]*$/;

export const GET = async ({ url }) => {
  const id = url.searchParams.get('id') ?? '';
  if (!ID_RE.test(id)) throw error(400, `bad id "${id}"`);

  const hit = findProfile(id);
  if (!hit) throw error(404, `no profile "${id}"`);

  if (!hit.legacy) {
    const mod = await readFile(hit.path, 'utf8');
    const { meta, buildSource } = splitProfileModule(mod);
    return json({
      id, label: meta.label, description: meta.description, set: meta.set,
      tags: meta.tags, params: meta.params, source: buildSource,
      // Optional graph block — present on profiles authored via the
      // /primitives editor's polygon node. When present, the editor
      // hydrates the canvas state from it instead of falling into
      // legacy mode.
      graph: (meta as any).graph,
    });
  }

  // Legacy folder: profile.json (meta) + source.ts (build).
  const dir = legacyProfileDir(id);
  let meta: any = {};
  try { meta = JSON.parse(await readFile(join(dir, 'profile.json'), 'utf8')); }
  catch { throw error(404, `no profile "${id}"`); }
  let source = '';
  try { source = await readFile(join(dir, 'source.ts'), 'utf8'); }
  catch { /* configured/drawn profile — no source */ }
  return json({
    id, label: meta.label ?? id, description: meta.description ?? '',
    set: meta.set ?? 'revolve', tags: meta.tags ?? [], params: meta.params ?? {}, source,
  });
};
