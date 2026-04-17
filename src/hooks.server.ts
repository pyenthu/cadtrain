import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { checkRateLimit } from '$lib/rate_limit';

/** Routes subject to rate limiting (prefix match). */
const RATE_LIMITED_PREFIXES = ['/api/identify', '/api/refine', '/api/author/chat'];
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
