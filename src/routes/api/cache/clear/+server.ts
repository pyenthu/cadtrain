/**
 * POST /api/cache/clear
 *   ?id=<part_id>     — wipe just that part's cache entries
 *   ?id=<part_id>&hash=<hash>  — wipe a single entry
 *   (no params)       — wipe the whole bake cache (Phase 3 will gate this)
 *
 * Returns { ok, cleared, bytes }.
 *
 * Phase 1.5 of docs/plans/bake-cache.md. The 🔄 Rebuild button in the
 * graph-editor's bake panel calls this with the current exemplar id,
 * then triggers a fresh /api/primitives/preview that rebuilds the
 * cache on the cold path.
 */
import { json } from '@sveltejs/kit';
import { clearBakeCache } from '$lib/server/bake-cache';

export const POST = async ({ url }) => {
  const id = url.searchParams.get('id') ?? undefined;
  const hash = url.searchParams.get('hash') ?? undefined;
  const result = await clearBakeCache({ partId: id, hash });
  return json({ ok: true, ...result });
};
