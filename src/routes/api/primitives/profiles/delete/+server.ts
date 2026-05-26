import { json, error } from '@sveltejs/kit';
import { rm } from 'node:fs/promises';
import { findProfile, legacyProfileDir } from '$lib/server/primitive-paths';

// DELETE /api/primitives/profiles/delete?id=<id>
// Permanently removes a VOLUME profile — the new flat module (<id>.prvl.ts /
// .prex.ts) or, until migrated, the legacy <id>/ folder. Curated built-ins live
// in src (PROFILE_REGISTRY), not on the volume, so they can't be deleted here.
// Proxied to prod via VOLUME_PROXY_PATHS (hooks.server.ts).
const ID_RE = /^[a-z][a-z0-9_]*$/;

export const DELETE = async ({ url }) => {
  const id = url.searchParams.get('id') ?? '';
  if (!ID_RE.test(id)) throw error(400, `bad id "${id}"`);
  const hit = findProfile(id);
  if (!hit) throw error(404, `no volume profile "${id}" (built-ins can't be deleted)`);
  if (hit.legacy) await rm(legacyProfileDir(id), { recursive: true, force: true });
  else await rm(hit.path, { force: true });
  return json({ ok: true, id, action: 'delete', removed: hit.path });
};
