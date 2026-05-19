import { json, error } from '@sveltejs/kit';
import { rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';

// POST /api/primitives/restore?id=<id>
// Moves <volume>/primitives/archive/<id>/ → <volume>/primitives/<id>/.
// Pairs with DELETE /api/primitives/delete (which moves the other way).
// 404s if no archived copy exists. If an active copy already exists at
// the destination it's overwritten — the archived snapshot wins, which
// matches the "restore = treat archive as authoritative" intent.

const ID_RE = /^[a-z][a-z0-9_]*$/i;

export const POST = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id || !ID_RE.test(id)) throw error(400, 'id query param required');
  const archived = volumePath(join('primitives', 'archive', id));
  const active = volumePath(join('primitives', id));
  if (!existsSync(archived)) throw error(404, `archived primitive "${id}" not found`);
  if (existsSync(active)) await rm(active, { recursive: true, force: true });
  await rename(archived, active);
  return json({ ok: true, id, action: 'restore' });
};
