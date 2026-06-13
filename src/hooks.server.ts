import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { checkRateLimit } from '$lib/rate_limit';
import { maybeProxy } from '$lib/server/volume';
import { isStdlib } from '$lib/server/stdlib';

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
  '/api/primitives/rename',
  '/api/primitives/restore',
  '/api/primitives/prompts',
  '/api/primitives/instructions',
  '/api/primitives/profiles/list',
  '/api/primitives/profiles/save',
  '/api/primitives/profiles/delete',
  // /resolve runs build(source, params) — pure code path, no volume read
  // beyond an optional id fetch. Keep it local so debug logs surface here
  // and so the dev box can iterate without a prod redeploy.
  // '/api/primitives/profiles/resolve',
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
  // RAG (Phase 1, docs/plans/rag-prompt-builder.md): the rebuild walks
  // the on-volume primitives tree + writes ai/rag/parts.jsonl — single
  // live store, so a local-dev rebuild proxies to prod. stats is a cheap
  // read of the same file; proxy it too so the sidebar's "last refreshed
  // Xm ago" reflects prod state (instead of the empty local .dev-volume).
  '/api/rag/rebuild',
  '/api/rag/stats',
  // #165 — scan-refs walks the on-volume primitives tree (every
  // <id>.{prim,asm,prvl,prex,rev,exp}.ts) to find dependents of a renamed
  // primitive. Repair mode rewrites those files in place. Single live
  // store → proxy to prod so a local rename + repair sweep ends up where
  // the prod app reads from.
  '/api/rag/scan-refs',
  // Phase 2 — BM25 over the same on-volume corpus + a Claude call. The
  // corpus AND ANTHROPIC_API_KEY both live prod-side, so the local-dev
  // generate button proxies like rebuild/stats. X-Volume-Local: 1 forces
  // the local handler (needs a local .env key + corpus).
  '/api/rag/prompt',
]);

/** Routes subject to rate limiting (prefix match).
 *  The identify/refine/wells endpoints were archived 2026-06-01 — the
 *  prefix list is empty now; kept as a stable extension point. */
const RATE_LIMITED_PREFIXES: string[] = [];
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/** Routes that require Bearer auth when AUTH_TOKEN env var is set. */
const AUTH_PROTECTED_PREFIX = '/api/';

/**
 * CORS for external apps (e.g. a third-party Svelte app with its OWN RAG +
 * LLM that consumes our volume + bake operations cross-origin). A browser
 * can't call /api/* from another origin without these headers.
 *
 * Disabled by default. Set `CORS_ORIGINS` to a comma-separated allowlist of
 * origins (e.g. `https://their-app.com`) — or `*` for any. Pair with
 * `AUTH_TOKEN` so the open surface still needs a Bearer token (the token is
 * NOT a cookie credential, so `*` + Authorization is valid without
 * Allow-Credentials). The external app sends `Authorization: Bearer <token>`.
 */
function corsHeadersFor(origin: string | null): Record<string, string> {
  const allowed = (env.CORS_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return {};
  const allowOrigin = allowed.includes('*') ? '*' : (origin && allowed.includes(origin) ? origin : '');
  if (!allowOrigin) return {};
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Volume-Local',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}
/** Return a copy of `res` with CORS headers merged in (headers may be immutable). */
function applyCors(res: Response, cors: Record<string, string>): Response {
  if (!Object.keys(cors).length) return res;
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(cors)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/**
 * Request middleware: optional auth + rate limiting + logging.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const start = Date.now();
  const path = event.url.pathname;

  // CORS for external apps. Compute once; apply to every /api/* response
  // (including the proxy + error early-returns) so the browser sees them.
  const isApi = path.startsWith('/api/');
  const cors = isApi ? corsHeadersFor(event.request.headers.get('origin')) : {};
  // Preflight: answer OPTIONS before auth so the browser can probe the surface.
  if (isApi && event.request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: cors });
  }

  // Single-store proxy: forward volume-data endpoints to prod when
  // CADTRAIN_VOLUME_REMOTE_URL is set (local dev). maybeProxy returns
  // null when no remote is configured (prod) or X-Volume-Local:1 is set
  // (e2e) — fall through to the local handler in that case.
  if (VOLUME_PROXY_PATHS.has(path)) {
    // STDLIB BYPASS — stdlib primitives (src/lib/cad/stdlib/*.ts) live in src,
    // are baked into the LOCAL build by import.meta.glob('?raw'), and have
    // nothing to do with the volume. Proxying them to prod silently masked
    // local edits — see memory `stdlib_source_proxy_masks_local_edits`. The
    // /source endpoint already prefers stdlib first when it runs, so we just
    // skip the proxy when the queried name is a stdlib id and let the
    // handler serve the local copy.
    if (path === '/api/primitives/source') {
      const name = event.url.searchParams.get('name') ?? '';
      if (isStdlib(name)) {
        // fall through to local handler — local stdlib wins.
      } else {
        const proxied = await maybeProxy(event.request, event.url);
        if (proxied) {
          console.log(`[${proxied.status}] ${event.request.method} ${path} — proxied → prod`);
          return applyCors(proxied, cors);
        }
      }
    } else {
      const proxied = await maybeProxy(event.request, event.url);
      if (proxied) {
        console.log(`[${proxied.status}] ${event.request.method} ${path} — proxied → prod`);
        return proxied;
      }
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
        headers: { 'Content-Type': 'application/json', ...cors },
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
          headers: { 'Content-Type': 'application/json', ...cors },
        }
      );
    }
  }

  const response = await resolve(event);
  const duration = Date.now() - start;
  console.log(
    `[${response.status}] ${event.request.method} ${path} — ${duration}ms`
  );
  return applyCors(response, cors);
};
