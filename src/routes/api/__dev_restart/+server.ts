/**
 * /api/__dev_restart — dev-only endpoint that restarts the SvelteKit dev
 * server so the user doesn't have to drop to a terminal and `pkill`.
 *
 * Why this exists: Vite HMR silently skips server modules
 * (primitive-loader, composition-graph, composition-emit) so after edits
 * to those files the dev server keeps running the cached old version →
 * bakes fail with "parameter 0 has unknown type" or "memory access out
 * of bounds". The proper fix is `pkill -f 'bun run dev' && bun run dev`,
 * which is exactly what this endpoint automates.
 *
 * Strategy: spawn a DETACHED bash subprocess that
 *   1. waits 800 ms (gives this POST response time to return)
 *   2. pkill's all `bun run dev` matches
 *   3. nohup-spawns a new dev server in the background
 *
 * The detached child keeps running after the parent SvelteKit process
 * dies. The new dev server uses /tmp/cadtrain-dev.log so the user can
 * tail it if anything goes wrong.
 *
 * Gated on dev mode — returns 403 in production. The endpoint is path-
 * gated by the __ prefix (Vite + SvelteKit don't ship private routes,
 * but defence in depth via the env check too).
 */
import { json, error } from '@sveltejs/kit';
import { spawn } from 'node:child_process';
import { dev } from '$app/environment';

export const POST = async () => {
  if (!dev) {
    throw error(403, 'dev-restart is only available in dev mode');
  }
  // Detached + unref so the child outlives this process. SIGTERM the
  // current `bun run dev` is fired by pkill INSIDE the script, AFTER the
  // sleep, AFTER this response is in flight to the browser.
  const child = spawn(
    'bash',
    [
      '-c',
      [
        'sleep 0.8',
        "pkill -f 'bun run dev' 2>&1",
        // Don't pkill ourselves before the response is flushed.
        // The new dev server replaces the killed one.
        'nohup bun run dev > /tmp/cadtrain-dev.log 2>&1 &',
      ].join(' && '),
    ],
    { detached: true, stdio: 'ignore' },
  );
  child.unref();
  return json({ ok: true, scheduledIn: 800, log: '/tmp/cadtrain-dev.log' });
};
