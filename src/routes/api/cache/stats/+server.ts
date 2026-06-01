/**
 * /api/cache/stats — Railway healthcheck endpoint.
 *
 * Historically returned training-cache statistics (the RAG cache for
 * /api/identify). After the 2026-06-01 cleanup moved the training/
 * identify pipeline into archive/, this endpoint is kept ONLY as the
 * lightweight healthcheck — `railway.toml` pins it as
 * `healthcheckPath = "/api/cache/stats"` and removing it kills prod
 * because Railway can't reach the healthcheck and serves 502 on
 * everything.
 *
 * Returns a small JSON body with `ok: true` and the server timestamp.
 * Cheap enough that Railway can probe it on every health interval.
 */
import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  return json({
    ok: true,
    service: 'cadtrain',
    ts: Date.now(),
  });
};
