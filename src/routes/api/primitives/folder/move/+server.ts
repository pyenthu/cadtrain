import { json, error } from '@sveltejs/kit';
import { rename, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { volumePath } from '$lib/server/volume';

// POST /api/primitives/folder/move?from=<path>&to=<path>
// Relocate a folder (and everything inside it) from one parent to another —
// the on-volume move behind the /primitives sidebar "Move to <other tab>"
// action (BASIC ↔ WELL). Unlike folder/rename (which only renames the LAST
// segment in place), `to` is a FULL destination path, so the folder's parent
// changes (e.g. basic/<f> → completions/<f>, or completions/<family> →
// basic/<family>). Parts inside KEEP their ids — findPrim resolves by id from
// wherever the folder now lives (location IS category, Rule 16), so no
// meta.uses references break.
//
// INTERNAL is excluded structurally: neither `from` nor `to` may live under
// archive / stdlib / stdstale / profiles, and the structural roots themselves
// (basic / completions / archive) can't be moved. Proxied to prod via
// VOLUME_PROXY_PATHS (single live store, Rule 13).

// 1–3 segments, each [a-z][a-z0-9_]* — no '.', no leading slash → no traversal.
const PATH_RE = /^[a-z][a-z0-9_]*(\/[a-z][a-z0-9_]*){0,2}$/i;
// Structural roots the sidebar depends on — not movable as a whole.
const PROTECTED = new Set(['basic', 'completions', 'archive', 'profiles']);
// INTERNAL / reserved top-level buckets — never a valid move source OR target.
const INTERNAL = new Set(['archive', 'stdlib', 'stdstale', 'profiles']);

export const POST = async ({ url }) => {
  const from = (url.searchParams.get('from') || '').replace(/\/+$/, '');
  const to = (url.searchParams.get('to') || '').replace(/\/+$/, '');
  if (!from || !PATH_RE.test(from)) throw error(400, 'from must be 1–3 segments of [a-z][a-z0-9_]*');
  if (!to || !PATH_RE.test(to)) throw error(400, 'to must be 1–3 segments of [a-z][a-z0-9_]*');
  if (PROTECTED.has(from)) throw error(400, `"${from}" is a built-in folder and can't be moved`);
  const fromTop = from.split('/')[0].toLowerCase();
  const toTop = to.split('/')[0].toLowerCase();
  if (INTERNAL.has(fromTop)) throw error(400, `"${from}" is an internal folder (archive / stdlib / stale) and can't be moved`);
  if (INTERNAL.has(toTop)) throw error(400, `"${to}" targets an internal bucket — move there is not allowed`);
  if (to === from) return json({ ok: true, from, to, note: 'unchanged' });

  const fromAbs = volumePath(join('primitives', from));
  const toAbs = volumePath(join('primitives', to));
  if (!existsSync(fromAbs)) throw error(404, `folder "${from}" not found`);
  if (existsSync(toAbs)) throw error(409, `a folder "${to}" already exists`);

  await mkdir(dirname(toAbs), { recursive: true });
  await rename(fromAbs, toAbs);
  return json({ ok: true, from, to });
};
