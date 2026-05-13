/**
 * Shared in-memory cache for the component registry. Lives in its own module
 * because SvelteKit's +server.ts files can't export arbitrary helpers
 * (only HTTP-method handlers and a fixed set of config exports).
 *
 * The GET endpoint populates this; the /save endpoint calls
 * `invalidateRunesListCache()` after a successful write so the next list
 * request re-scans the directory.
 */

interface CacheRecord {
  signature: string;
  payload: unknown[];
}

let cache: CacheRecord | null = null;

export function getCachedList(): CacheRecord | null {
  return cache;
}

export function setCachedList(rec: CacheRecord): void {
  cache = rec;
}

export function invalidateRunesListCache(): void {
  cache = null;
}
