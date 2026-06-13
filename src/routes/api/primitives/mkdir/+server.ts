import { json, error } from '@sveltejs/kit';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { volumePath } from '$lib/server/volume';

// POST /api/primitives/mkdir?path=<rel>
// Create a primitives folder (a folder-tab or a nested subfolder) on the
// volume. <rel> is 1–3 path segments under primitives/, each matching
// [a-z][a-z0-9_]* — the same depth the 3-level resolver (primitive-paths.ts
// findPrim: cat/family/subfolder) walks, so the sidebar can never offer an
// unresolvable nesting. mkdir is recursive + idempotent (already-exists is a
// no-op), so it's effectively atomic for our purposes.
//
// Proxied to prod via hooks.server.ts VOLUME_PROXY_PATHS (single live store,
// Rule 13). `profiles` is reserved for the profile-function store.

// 1–3 segments, each [a-z][a-z0-9_]* — no '.', no leading slash → no traversal.
const PATH_RE = /^[a-z][a-z0-9_]*(\/[a-z][a-z0-9_]*){0,2}$/i;

export const POST = async ({ url }) => {
  const path = (url.searchParams.get('path') || '').replace(/\/+$/, '');
  if (!path || !PATH_RE.test(path)) {
    throw error(400, 'path must be 1–3 segments of [a-z][a-z0-9_]* (e.g. "completions/drill_pipe")');
  }
  if (path.split('/')[0] === 'profiles') {
    throw error(400, '"profiles" is reserved for the profile-function store');
  }
  const abs = volumePath(join('primitives', path));
  await mkdir(abs, { recursive: true });
  return json({ ok: true, path });
};
