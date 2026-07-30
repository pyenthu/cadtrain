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

/** Park an app; returns a random token to render it by. */
export function putApp(app: unknown): string {
  const now = Date.now();
  sweep(now);
  const token = crypto.randomUUID();
  store.set(token, { app, exp: now + TTL_MS });
  return token;
}

/** Fetch a parked app by token (undefined if unknown/expired). */
export function getApp(token: string): unknown | undefined {
  const now = Date.now();
  sweep(now);
  return store.get(token)?.app;
}
