/**
 * workspace-cache.ts — restore the /wells local workspace across visits.
 *
 * Two pieces of state survive a reload:
 *   1. The last-opened LOCAL FOLDER handle (`FileSystemDirectoryHandle`). A
 *      handle is NOT JSON-serialisable, so it can't live in localStorage — but
 *      it IS structured-cloneable, so we stash it in **IndexedDB** under a fixed
 *      key. On the next visit we read it back and check its permission: browsers
 *      only regrant folder access after a user gesture, so if it isn't already
 *      'granted' we DON'T auto-prompt on load — the shell surfaces a "Reopen"
 *      affordance that calls `requestPermission()` from a click.
 *   2. The open `.wson` TAB list (ids + active index) → plain JSON in
 *      **localStorage**. Sample tabs rehydrate immediately; workspace (`ws:…`)
 *      tabs rehydrate once the folder handle is reopened.
 *
 * Everything here is DEFENSIVE + SSR-safe: a missing/blocked IndexedDB, a
 * revoked handle, or private-mode localStorage all degrade to today's
 * empty-workspace behaviour — nothing throws on load.
 */

import type { LoadedFile } from '$lib/shared/WellSideNav.svelte';

const DB_NAME = 'cadtrain-wells';
const DB_VERSION = 1;
const STORE = 'workspace';
const HANDLE_KEY = 'last-folder-handle';
const TABS_KEY = 'wells-open-tabs';
const TABS_VERSION = 1;

// ── Environment guards (evaluated at CALL time — SSR-safe + testable) ────────
const hasWindow = () => typeof window !== 'undefined';
const hasIndexedDb = () => hasWindow() && typeof indexedDB !== 'undefined';
const hasLocalStorage = () => hasWindow() && typeof localStorage !== 'undefined';

/**
 * The FSA permission methods (`queryPermission`/`requestPermission`) are not yet
 * in the TS DOM lib, so intersect them on when we need them.
 */
type WithPermission = {
  queryPermission?(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
  requestPermission?(desc?: { mode?: 'read' | 'readwrite' }): Promise<PermissionState>;
};
type DirHandleWithPerm = FileSystemDirectoryHandle & WithPermission;

// ── IndexedDB: persist the directory handle (structured clone) ───────────────
function openDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Store the last-opened directory handle. Never throws. */
export async function saveDirHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

/** Read back the last-opened directory handle, or null if none/blocked. */
export async function loadDirHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  if (!db) return null;
  const result = await new Promise<FileSystemDirectoryHandle | null>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(HANDLE_KEY);
      req.onsuccess = () => resolve((req.result as FileSystemDirectoryHandle) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  db.close();
  return result;
}

/** Forget the persisted directory handle (called when the workspace is closed). */
export async function clearDirHandle(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
  db.close();
}

// ── Permissions ──────────────────────────────────────────────────────────────
/**
 * Current read-permission state for a handle. Returns 'unsupported' when the
 * (non-standard) permission API is absent — callers should treat anything other
 * than 'granted' as "needs a user gesture to reopen".
 */
export async function queryDirPermission(
  handle: FileSystemDirectoryHandle,
): Promise<PermissionState | 'unsupported'> {
  const h = handle as DirHandleWithPerm;
  if (typeof h.queryPermission !== 'function') return 'unsupported';
  try {
    return await h.queryPermission({ mode: 'read' });
  } catch {
    return 'denied';
  }
}

/**
 * Request read permission for a handle — MUST be called from a user gesture.
 * Resolves true when access is (re)granted. If the permission API is absent we
 * optimistically return true (older FSA builds grant at pick time).
 */
export async function requestDirPermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  const h = handle as DirHandleWithPerm;
  if (typeof h.requestPermission !== 'function') return true;
  try {
    return (await h.requestPermission({ mode: 'read' })) === 'granted';
  } catch {
    return false;
  }
}

// ── Folder walk (self-contained; mirrors WellSideNav's picker walk) ──────────
const isWson = (name: string) => /\.wson$/i.test(name);

async function walkDir(
  dir: FileSystemDirectoryHandle,
  prefix: string,
  out: LoadedFile[],
  depth = 0,
): Promise<void> {
  if (depth > 8) return; // guard pathological nesting
  for await (const [name, handle] of (dir as FileSystemDirectoryHandle).entries()) {
    const rel = prefix ? `${prefix}/${name}` : name;
    try {
      if (handle.kind === 'directory') {
        await walkDir(handle, rel, out, depth + 1);
      } else if (isWson(name)) {
        const file = await handle.getFile();
        out.push({ name, relPath: rel, text: await file.text() });
      }
    } catch {
      /* skip unreadable entry, keep walking */
    }
  }
}

/**
 * Re-list every `.wson` file under a restored directory handle. Assumes read
 * permission is already granted. Never throws — a revoked handle yields [].
 */
export async function listWsonFromDir(
  handle: FileSystemDirectoryHandle,
): Promise<LoadedFile[]> {
  const out: LoadedFile[] = [];
  try {
    await walkDir(handle, '', out);
  } catch {
    /* handle revoked / unreadable → empty list, degrade gracefully */
  }
  out.sort((a, b) => a.relPath.localeCompare(b.relPath));
  return out;
}

// ── Open-tabs persistence (localStorage JSON) ────────────────────────────────
export interface CachedTabs {
  /** Ordered tab ids (sample slugs + `ws:<relpath>` workspace ids). */
  ids: string[];
  /** Index into `ids` of the active tab. */
  activeIdx: number;
}

/** Pure: encode the open-tab state to a JSON string. */
export function serializeTabs(ids: string[], activeIdx: number): string {
  return JSON.stringify({ v: TABS_VERSION, ids, activeIdx });
}

/**
 * Pure: decode a persisted tab-state string. Returns null for empty/garbage
 * input, and clamps a bad `activeIdx` into range. Never throws.
 */
export function restoreTabs(raw: string | null | undefined): CachedTabs | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { ids?: unknown; activeIdx?: unknown };
    if (!parsed || !Array.isArray(parsed.ids)) return null;
    const ids = parsed.ids.filter((x): x is string => typeof x === 'string');
    if (ids.length === 0) return null;
    let activeIdx = Number(parsed.activeIdx);
    if (!Number.isInteger(activeIdx) || activeIdx < 0 || activeIdx >= ids.length) {
      activeIdx = 0;
    }
    return { ids, activeIdx };
  } catch {
    return null;
  }
}

/** Persist the open-tab state. Never throws (quota / private mode safe). */
export function saveTabs(ids: string[], activeIdx: number): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.setItem(TABS_KEY, serializeTabs(ids, activeIdx));
  } catch {
    /* ignore quota / privacy-mode failures */
  }
}

/** Read back the open-tab state, or null when absent/blocked. */
export function loadTabs(): CachedTabs | null {
  if (!hasLocalStorage()) return null;
  try {
    return restoreTabs(localStorage.getItem(TABS_KEY));
  } catch {
    return null;
  }
}

/** Forget the persisted open-tab state. */
export function clearTabs(): void {
  if (!hasLocalStorage()) return;
  try {
    localStorage.removeItem(TABS_KEY);
  } catch {
    /* ignore */
  }
}
