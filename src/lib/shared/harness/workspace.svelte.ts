// src/lib/shared/harness/workspace.svelte.ts — the BROWSER workspace store (File System
// Access + IndexedDB). Persists ONE directory handle (the app's data folder) to IndexedDB
// and silently re-grants it on reload, then walks it into a FileNode tree (each node holds
// its live handle). This is the single anchor SVTC uses: refs in the .app resolve against
// THIS tree — no per-file picker on reload. Pure matching lives in ./workspace-tree.ts.
//
// Runes store (a `.svelte.ts` singleton) so the studio's Persistent-data / Data-files tabs
// react to the tree + status. Every browser-only call is guarded (typeof window /
// showDirectoryPicker / indexedDB) so build + Node tests never touch a real API.
import {
  resolveRefNode,
  type FileNode,
  type FileRef,
} from './workspace-tree';

const DB = 'cadtrain-app-workspaces';
const STORE = 'handles';
const KEY = 'last'; // one workspace at a time — the app's data folder is the single anchor.

const hasWindow = (): boolean => typeof window !== 'undefined';
const hasFSA = (): boolean => hasWindow() && 'showDirectoryPicker' in window;
const hasIDB = (): boolean => typeof indexedDB !== 'undefined';

// ── IndexedDB — a FileSystemDirectoryHandle is structured-cloneable, so it round-trips ──
function idbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

async function idbPut(handle: unknown): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put({ handle, savedAt: Date.now() }, KEY);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

async function idbGet(): Promise<{ handle: any; savedAt: number } | null> {
  const db = await idbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => res(req.result ?? null);
    req.onerror = () => rej(req.error);
  });
}

async function idbClear(): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(KEY);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

// ── Walk a directory handle into the FileNode tree (each node keeps its live handle) ──
async function populate(node: FileNode, dir: any, prefix: string): Promise<void> {
  try {
    for await (const [name, handle] of dir.entries()) {
      // Skip iCloud-evicted placeholders + dotfiles — neither is real openable data.
      if (name.startsWith('.')) continue;
      const path = prefix ? `${prefix}/${name}` : name;
      if (handle.kind === 'directory') {
        const child: FileNode = { name, kind: 'dir', path, handle, children: [] };
        node.children!.push(child);
        await populate(child, handle, path);
      } else {
        node.children!.push({ name, kind: 'file', path, handle });
      }
    }
  } catch {
    /* stale/unreadable sub-handle — keep whatever we collected, don't abort the walk. */
  }
}

export async function buildTreeFromHandle(dir: any): Promise<FileNode> {
  const root: FileNode = { name: dir.name, kind: 'dir', path: '', handle: dir, children: [] };
  await populate(root, dir, '');
  return root;
}

/** <input type=file> fallback picker — a one-off import when there's no workspace (or no FSA).
 *  Resolves the picked File, or null if cancelled. */
export function pickFileFallback(accept?: string): Promise<File | null> {
  if (!hasWindow()) return Promise.resolve(null);
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

export type WorkspaceStatus = 'none' | 'granted' | 'prompt' | 'denied' | 'unsupported';

class WorkspaceState {
  /** Name of the linked folder (shown even before permission is re-granted). */
  dirName = $state('');
  /** The walked tree (reactive) — refs resolve against this. Null until a folder is loaded. */
  tree = $state<FileNode | null>(null);
  /** Permission / link state for the UI badge. */
  status = $state<WorkspaceStatus>(hasFSA() ? 'none' : 'unsupported');
  /** Whether folder linking is available in this browser (Chrome/Edge desktop). */
  readonly supported = hasFSA();
  /** The live dir handle — NON-reactive (a handle isn't a value the UI renders). */
  private handle: any = null;

  /** Prompt the user to pick a workspace folder → walk it → persist the handle. */
  async pickWorkspace(): Promise<boolean> {
    if (!hasFSA()) {
      this.status = 'unsupported';
      return false;
    }
    let h: any;
    try {
      h = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
    } catch {
      return false; // user cancelled
    }
    await this.adopt(h, true);
    return true;
  }

  /** Silent restore on load — queryPermission never shows UI. Loads only if already granted;
   *  otherwise stashes the handle + sets status 'prompt' so a later gesture can reconnect(). */
  async autoReopen(): Promise<boolean> {
    if (this.tree) return true; // already have one
    if (!hasFSA() || !hasIDB()) return false;
    let rec: { handle: any } | null = null;
    try {
      rec = await idbGet();
    } catch {
      return false;
    }
    const h = rec?.handle;
    if (!h) return false;
    this.handle = h;
    this.dirName = h.name ?? '';
    let perm: string = 'prompt';
    try {
      perm = await h.queryPermission({ mode: 'readwrite' });
    } catch {
      /* older engine — leave as prompt */
    }
    if (perm === 'granted') {
      await this.adopt(h, false);
      return true;
    }
    this.status = perm === 'denied' ? 'denied' : 'prompt';
    return false;
  }

  /** User-gesture reconnect after autoReopen left status 'prompt' (requestPermission shows UI). */
  async reconnect(): Promise<boolean> {
    if (!this.handle) return this.pickWorkspace();
    let perm = 'denied';
    try {
      perm = await this.handle.requestPermission({ mode: 'readwrite' });
    } catch {
      /* fall through */
    }
    if (perm !== 'granted') {
      this.status = 'denied';
      return false;
    }
    await this.adopt(this.handle, true);
    return true;
  }

  /** Re-walk the current folder (after files were added/removed on disk). */
  async refresh(): Promise<void> {
    if (!this.handle) return;
    this.tree = await buildTreeFromHandle(this.handle);
  }

  /** Resolve a stored ref → a live File (getFile), or null if unmatched / the read failed.
   *  This is the "no picker on reload" path: match by path→name, then read the bytes. */
  async resolveFile(ref: FileRef | null | undefined): Promise<File | null> {
    const node = resolveRefNode(this.tree, ref);
    if (!node?.handle) return null;
    try {
      return await (node.handle as any).getFile();
    } catch {
      return null;
    }
  }

  /** Forget the workspace (the studio "Unlink folder" button). */
  async forget(): Promise<void> {
    this.handle = null;
    this.tree = null;
    this.dirName = '';
    this.status = this.supported ? 'none' : 'unsupported';
    if (hasIDB()) await idbClear().catch(() => {});
  }

  private async adopt(handle: any, persist: boolean): Promise<void> {
    this.handle = handle;
    this.dirName = handle.name ?? '';
    this.status = 'granted';
    this.tree = await buildTreeFromHandle(handle);
    if (persist && hasIDB()) await idbPut(handle).catch(() => {});
  }
}

/** Module singleton — one linked workspace shared across the studio + the runtime harness
 *  (same origin → same IndexedDB, so a folder linked in /app_design is silently re-granted in
 *  the /app/local preview + /app/[id] launch). */
export const workspace = new WorkspaceState();
