import { json, error } from '@sveltejs/kit';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { volumePath } from '$lib/server/volume';

// DELETE /api/primitives/delete?id=<id>
// Removes <volume>/primitives/<id>/ recursively. Refuses if id is missing
// or doesn't match a real volume primitive directory.
//
// Bundle primitives cannot be deleted (they live in git-tracked src/);
// the /primitives UI hides the Delete button for those.

const ID_RE = /^[a-z][a-z0-9_]*$/i;

export const DELETE = async ({ url }) => {
  const id = url.searchParams.get('id');
  if (!id || !ID_RE.test(id)) throw error(400, 'id query param required');
  const dir = volumePath(join('primitives', id));
  if (!existsSync(dir)) throw error(404, `primitive "${id}" not found on volume`);
  await rm(dir, { recursive: true, force: true });
  return json({ ok: true, id });
};
