// src/lib/server/app-session.ts — short-lived server store for LOCAL .app files the client
// POSTs to be SERVER-rendered (app-server-render.md Phase 2). The browser can't hand the
// server a filesystem path, so the small .app rides along, is parked under a random token,
// and /app/local/[token] SSRs it. TTL-expired + swept on access.
//
// In-memory: fine for local dev / a single instance. A multi-instance prod would back this
// with the volume (or redis); the interface stays the same.
type Entry = { app: unknown; exp: number };

const store = new Map<string, Entry>();
const TTL_MS = 10 * 60 * 1000; // 10 minutes — a launch is immediate; this is generous

function sweep(now: number): void {
  for (const [k, v] of store) if (v.exp < now) store.delete(k);
}

/** A readable slug for the route — prefer the opened FILE NAME, then the app title/id. */
function slugOf(name: string | undefined, app: unknown): string {
  const a = app as { title?: string; app?: string } | null;
  const raw = name || a?.title || a?.app || 'app';
  return (
    String(raw)
      .replace(/\.app$/i, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'app'
  );
}

/** Park an app; returns a READABLE token `<slug>-<short>` (route shows what it points to).
 *  `name` is the opened file name (e.g. "wells.app") — preferred for the slug. */
export function putApp(app: unknown, name?: string): string {
  const now = Date.now();
  sweep(now);
  const token = `${slugOf(name, app)}-${crypto.randomUUID().slice(0, 8)}`;
  store.set(token, { app, exp: now + TTL_MS });
  return token;
}

/** Fetch a parked app by token (undefined if unknown/expired). */
export function getApp(token: string): unknown | undefined {
  const now = Date.now();
  sweep(now);
  return store.get(token)?.app;
}
