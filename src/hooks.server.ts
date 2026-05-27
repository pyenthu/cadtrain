import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { checkRateLimit } from '$lib/rate_limit';
import { maybeProxy } from '$lib/server/volume';

/**
 * Volume-DATA endpoints that route to the single live store (prod) when
 * `CADTRAIN_VOLUME_REMOTE_URL` is set — i.e. in local dev. EXACT-path
 * allowlist (not a prefix) so stateless compute endpoints
 * (primitives/{preview,bake-preview}) and the VLM endpoints
 * (components/refine, identify, refine, wells) stay LOCAL.
 *
 * `/api/volume` + `/api/kb/*` are intentionally absent: they self-proxy
 * in-endpoint via maybeProxy() (battle-tested, interleaves with their
 * own checkVolumeAuth). The `X-Volume-Local: 1` escape (honored inside
 * maybeProxy) forces local FS for e2e tests.
 *
 * Reverses the old "authoring is dev-local, a save shouldn't silently
 * mutate prod" stance — the user chose prod as the single store
 * (2026-05-20).
 */
const VOLUME_PROXY_PATHS = new Set([
  '/api/primitives/list',
  '/api/primitives/save',
  '/api/primitives/source',
  '/api/primitives/delete',
  '/api/primitives/move',
  '/api/primitives/restore',
  '/api/primitives/prompts',
  '/api/primitives/instructions',
  '/api/primitives/profiles/list',
  '/api/primitives/profiles/save',
  '/api/primitives/profiles/delete',
  '/api/primitives/profiles/resolve',
  '/api/primitives/profiles/source',
  '/api/components/list',
  '/api/components/save',
  '/api/components/move',
  '/api/components/delete',
  '/api/components/instructions',
  '/api/components/picture',
  '/api/components/prompts',
  '/api/components/rename',
  '/api/components/glb',
  '/api/components/geom',
  '/api/components/bake-preview',
]);

/** Routes subject to rate limiting (prefix match). */
const RATE_LIMITED_PREFIXES = [
  '/api/identify',
  '/api/refine',
  '/api/wells/extract',
];
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/** Routes that require Bearer auth when AUTH_TOKEN env var is set. */
const AUTH_PROTECTED_PREFIX = '/api/';

/**
 * Request middleware: optional auth + rate limiting + logging.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const start = Date.now();
  const path = event.url.pathname;

  // Single-store proxy: forward volume-data endpoints to prod when
  // CADTRAIN_VOLUME_REMOTE_URL is set (local dev). maybeProxy returns
  // null when no remote is configured (prod) or X-Volume-Local:1 is set
  // (e2e) — fall through to the local handler in that case.
  if (VOLUME_PROXY_PATHS.has(path)) {
    const proxied = await maybeProxy(event.request, event.url);
    if (proxied) {
      console.log(`[${proxied.status}] ${event.request.method} ${path} — proxied → prod`);
      return proxied;
    }
  }

  // Optional AUTH_TOKEN gate on API routes.
  // If env.AUTH_TOKEN is unset, API is public (for demo mode).
  // If set, Authorization: Bearer <token> required on /api/*.
  if (env.AUTH_TOKEN && path.startsWith(AUTH_PROTECTED_PREFIX)) {
    const header = event.request.headers.get('authorization') || '';
    const presented = header.replace(/^Bearer\s+/i, '');
    if (presented !== env.AUTH_TOKEN) {
      console.log(`[401] ${event.request.method} ${path} — auth failed`);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Rate limit on sensitive API routes
  if (RATE_LIMITED_PREFIXES.some((p) => path.startsWith(p))) {
    const ip =
      event.getClientAddress?.() ||
      event.request.headers.get('x-forwarded-for')?.split(',')[0].trim() ||
      'unknown';
    if (!checkRateLimit(ip, RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS)) {
      console.log(`[429] ${event.request.method} ${path} — rate limited (${ip})`);
      return new Response(
        JSON.stringify({ error: 'Rate limit exceeded. Try again later.' }),
        {
          status: 429,
          headers: { 'Content-Type': 'application/json' },
        }
      );
    }
  }

  const response = await resolve(event);
  const duration = Date.now() - start;
  console.log(
    `[${response.status}] ${event.request.method} ${path} — ${duration}ms`
  );
  return response;
};
