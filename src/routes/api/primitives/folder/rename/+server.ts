import { json, error } from '@sveltejs/kit';
import { rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

// POST /api/primitives/folder/rename?from=<path>&to=<newLeaf>
// Rename a folder's LAST segment on the volume (from `…/<old>` to `…/<new>`).
// Parts inside KEEP their ids — ids are filename-based and resolved by findPrim
// regardless of which folder they sit in (location IS category, Rule 16), so no
// meta.uses references break. The canonical roots and name collisions are
// refused. Proxied to prod via VOLUME_PROXY_PATHS (single live store, Rule 13).

const SEG = /^[a-z][a-z0-9_]*$/i;
const PATH_RE = /^[a-z][a-z0-9_]*(\/[a-z][a-z0-9_]*){0,2}$/i;
// Structural roots the sidebar depends on — not user-renamable.
const PROTECTED = new Set(['basic', 'completions', 'archive', 'profiles']);

export const POST = async ({ url }) => {
  const from = (url.searchParams.get('from') || '').replace(/\/+$/, '');
  const to = (url.searchParams.get('to') || '').trim();
  if (!from || !PATH_RE.test(from)) throw error(400, 'from must be 1–3 segments of [a-z][a-z0-9_]*');
  if (!to || !SEG.test(to)) throw error(400, 'to must be a single folder name [a-z][a-z0-9_]*');
  if (PROTECTED.has(from)) throw error(400, `"${from}" is a built-in folder and can't be renamed`);

  const segs = from.split('/');
  segs[segs.length - 1] = to;
  const toPath = segs.join('/');
  if (toPath === from) return json({ ok: true, from, to: toPath, note: 'unchanged' });

  const fromAbs = volumePath(join('primitives', from));
  const toAbs = volumePath(join('primitives', toPath));
  if (!existsSync(fromAbs)) throw error(404, `folder "${from}" not found`);
  if (existsSync(toAbs)) throw error(409, `a folder "${toPath}" already exists`);

  await rename(fromAbs, toAbs);
  return json({ ok: true, from, to: toPath });
};
