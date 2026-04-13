import type { Handle } from '@sveltejs/kit';
import { checkRateLimit } from '$lib/rate_limit';

/** Routes subject to rate limiting (prefix match). */
const RATE_LIMITED_PREFIXES = ['/api/identify', '/api/refine'];
const RATE_LIMIT_MAX = 20;
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

/**
 * Request middleware: rate limiting + logging.
 */
export const handle: Handle = async ({ event, resolve }) => {
  const start = Date.now();
  const path = event.url.pathname;

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
