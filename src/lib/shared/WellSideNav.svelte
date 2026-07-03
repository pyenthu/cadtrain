<script lang="ts" module>
  /**
   * WellSideNav — the SVTC-style file-explorer side rail for /wells.
   *
   * Mirrors the layout of SVTC's `src/lib/components/Sidebar/Sidebar.svelte`
   * (the ewells.app explorer), re-skinned for cadtrain's dark subsurface chrome:
   *
   *   ┌────────────────────────────┐
   *   │ [ 📂 Open Folder ][ 📄 ]   │  ← local-workspace controls (top, like
   *   │ ⌂ my-wells · 4  ✕          │     ewells' top-left "open folder")
   *   │ WELLS · schematics (header)│
   *   │  ▾ Samples (3)             │  ← Samples + Workspace sections, via the
   *   │     01-vertical …          │     shared FolderTreeSidebar (chevron +
   *   │  ▾ Workspace (4)           │     folder icon + count + live filter)
   *   │     my-field-A.wson        │
   *   └────────────────────────────┘
   *
   * Owns ONLY the local-workspace affordance (the File System Access API picker
   * + `<input type=file>` fallback) and the SVTC-style chrome; the tree render +
   * expand/collapse + filter are delegated to the existing `FolderTreeSidebar`
   * (no fork). WSON-agnostic: emits RAW loaded blobs (`{ name, relPath, text }`)
   * via `onOpenFiles` and lets the route parse them (route turf owns the `.wson`
   * model) — a generic "open local files into a workspace" rail.
   */

  /** A raw file blob loaded from the user's machine (pre-parse). */
  export interface LoadedFile {
    name: string;
    /** Relative path inside an opened folder; '' for a flat file pick. */
    relPath: string;
    text: string;
  }

  /** Optional metadata for a load (e.g. the picked folder's name). */
  export interface LoadMeta {
    folderName?: string;
    /** The picked directory handle (File System Access API) — lets the route
     *  cache it (IndexedDB) so the workspace can be restored on the next visit.
     *  Absent for the `<input>` fallback (no handle available there). */
    dirHandle?: FileSystemDirectoryHandle;
  }
</script>

<script lang="ts">
  import FolderTreeSidebar, { type FolderTree } from './FolderTreeSidebar.svelte';

  let {
    tree,
    activeId = null,
    openIds = [],
    title = 'Wells',
    subtitle = 'well schematics · .wson',
    storageKey = 'wells-tree',
    defaultExpanded = [],
    /** Human label for the currently-loaded workspace (folder name or "N files"). */
    workspaceLabel = null,
    /** Count of files currently in the workspace section. */
    workspaceCount = 0,
    /** Persisted label of the last workspace (localStorage hint; not auto-opened). */
    lastWorkspaceLabel = null,
    /** Name of a cached folder whose permission needs a click to re-grant. When
     *  set (and no workspace is open) a "Reopen" affordance shows. */
    reopenLabel = null,
    /** True while a restored folder is being re-listed (disables the buttons). */
    restoring = false,
    onSelect = (_id: string) => {},
    onOpenFiles = (_f: LoadedFile[], _m?: LoadMeta) => {},
    onClearWorkspace = () => {},
    onReopen = () => {},
  }: {
    tree: FolderTree | null;
    activeId?: string | null;
    openIds?: string[];
    title?: string;
    subtitle?: string;
    storageKey?: string;
    defaultExpanded?: string[];
    workspaceLabel?: string | null;
    workspaceCount?: number;
    lastWorkspaceLabel?: string | null;
    reopenLabel?: string | null;
    restoring?: boolean;
    onSelect?: (id: string) => void;
    onOpenFiles?: (files: LoadedFile[], meta?: LoadMeta) => void;
    onClearWorkspace?: () => void;
    onReopen?: () => void;
  } = $props();

  // Capability probes — File System Access API is Chromium-desktop only.
  const canPickFiles = typeof window !== 'undefined' && 'showOpenFilePicker' in window;
  const canPickDir = typeof window !== 'undefined' && 'showDirectoryPicker' in window;

  let busy = $state(false);
  let error = $state('');

  // Fallback hidden inputs (browsers without the FSA API).
  let filesInput = $state<HTMLInputElement | null>(null);
  let folderInput = $state<HTMLInputElement | null>(null);

  const isWson = (name: string) => /\.wson$/i.test(name);

  function emitFiles(loaded: LoadedFile[], meta?: LoadMeta) {
    if (loaded.length === 0) {
      error = 'No .wson files found.';
      return;
    }
    error = '';
    onOpenFiles(loaded, meta);
  }

  // ── Open individual .wson files ─────────────────────────────────────────
  async function openFiles() {
    if (busy) return;
    error = '';
    if (!canPickFiles) {
      filesInput?.click(); // fallback: <input type=file multiple>
      return;
    }
    busy = true;
    try {
      // NEVER called on load — only from this click (user gesture required).
      const handles = await (window as any).showOpenFilePicker({
        multiple: true,
        types: [
          { description: 'WSON well schematic', accept: { 'application/json': ['.wson'] } },
        ],
      });
      const loaded: LoadedFile[] = [];
      for (const h of handles) {
        const file = await h.getFile();
        loaded.push({ name: file.name, relPath: file.name, text: await file.text() });
      }
      emitFiles(loaded);
    } catch (e: any) {
      if (e?.name !== 'AbortError') error = e?.message ?? String(e);
    } finally {
      busy = false;
    }
  }

  // ── Open a folder of .wson files ────────────────────────────────────────
  async function walkDir(dir: any, prefix: string, out: LoadedFile[], depth = 0): Promise<void> {
    if (depth > 8) return; // guard pathological nesting
    for await (const [name, handle] of dir.entries()) {
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

  async function openFolder() {
    if (busy) return;
    error = '';
    if (!canPickDir) {
      folderInput?.click(); // fallback: <input webkitdirectory>
      return;
    }
    busy = true;
    try {
      const dir = await (window as any).showDirectoryPicker();
      const loaded: LoadedFile[] = [];
      await walkDir(dir, '', loaded);
      loaded.sort((a, b) => a.relPath.localeCompare(b.relPath));
      // Pass the handle up so the route can cache it (IndexedDB) for restore.
      emitFiles(loaded, { folderName: dir.name, dirHandle: dir as FileSystemDirectoryHandle });
    } catch (e: any) {
      if (e?.name !== 'AbortError') error = e?.message ?? String(e);
    } finally {
      busy = false;
    }
  }

  // ── Fallback <input> handlers ───────────────────────────────────────────
  async function onFilesInput(ev: Event) {
    const input = ev.target as HTMLInputElement;
    const picked = Array.from(input.files ?? []).filter((f) => isWson(f.name));
    // A webkitdirectory pick carries the folder name as the first path segment.
    const first = picked[0] as any;
    const folderName: string | undefined =
      first?.webkitRelativePath?.includes('/')
        ? first.webkitRelativePath.split('/')[0]
        : undefined;
    const loaded: LoadedFile[] = [];
    for (const f of picked) {
      loaded.push({
        name: f.name,
        relPath: (f as any).webkitRelativePath || f.name,
        text: await f.text(),
      });
    }
    loaded.sort((a, b) => a.relPath.localeCompare(b.relPath));
    input.value = ''; // allow re-picking the same file
    emitFiles(loaded, folderName ? { folderName } : undefined);
  }
</script>

<div class="wsn">
  <!-- SVTC-style local-workspace controls, pinned above the tree. -->
  <div class="wsn-ws">
    <div class="wsn-ws-btns">
      <button
        class="wsn-btn wsn-btn-primary"
        type="button"
        onclick={openFolder}
        disabled={busy || restoring}
        title={canPickDir ? 'Open a folder of .wson files' : 'Open a folder (browser fallback)'}
      >
        <span class="wsn-btn-ic">📂</span>
        <span>{busy ? 'Opening…' : 'Open Folder'}</span>
      </button>
      <button
        class="wsn-btn"
        type="button"
        onclick={openFiles}
        disabled={busy || restoring}
        title="Open individual .wson files"
        aria-label="Open files"
      >
        <span class="wsn-btn-ic">📄</span>
      </button>
    </div>

    {#if workspaceLabel}
      <div class="wsn-ws-row" title={workspaceLabel}>
        <span class="wsn-ws-ic">⌂</span>
        <span class="wsn-ws-name">{workspaceLabel}</span>
        <span class="wsn-ws-count">{workspaceCount}</span>
        <button
          class="wsn-ws-clear"
          type="button"
          title="Close workspace"
          aria-label="Close workspace"
          onclick={onClearWorkspace}>×</button>
      </div>
    {:else if reopenLabel}
      <!-- Cached folder from a previous visit — re-granting FSA permission needs
           a user gesture, so we can't auto-open on load. This click does it. -->
      <button
        class="wsn-reopen"
        type="button"
        onclick={onReopen}
        disabled={restoring}
        title="Re-grant access to {reopenLabel} and restore your workspace"
      >
        <span class="wsn-ws-ic">↺</span>
        <span class="wsn-ws-name">{restoring ? 'Reopening…' : `Reopen ${reopenLabel}`}</span>
      </button>
    {:else if lastWorkspaceLabel}
      <div class="wsn-ws-last" title="Reopen requires picking the folder again">
        last: {lastWorkspaceLabel}
      </div>
    {/if}

    {#if !canPickDir && !canPickFiles}
      <div class="wsn-note">Using file-input fallback (no File System Access API).</div>
    {/if}
    {#if error}
      <div class="wsn-err">
        <span>{error}</span>
        <button type="button" aria-label="Dismiss" onclick={() => (error = '')}>×</button>
      </div>
    {/if}
  </div>

  <!-- Sectioned file tree — reuses the shared FolderTreeSidebar (no fork). -->
  <div class="wsn-tree">
    <FolderTreeSidebar
      {tree}
      {title}
      {subtitle}
      {storageKey}
      {defaultExpanded}
      {activeId}
      {openIds}
      fileIcon="◍"
      {onSelect}
    />
  </div>

  <!-- Hidden fallbacks for browsers without the File System Access API. -->
  <input
    bind:this={filesInput}
    class="wsn-hidden"
    type="file"
    accept=".wson"
    multiple
    onchange={onFilesInput}
  />
  <input
    bind:this={folderInput}
    class="wsn-hidden"
    type="file"
    accept=".wson"
    webkitdirectory
    onchange={onFilesInput}
  />
</div>

<style>
  .wsn {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    background: #16161f;
  }

  /* ── Workspace controls ─────────────────────────────────────────────── */
  .wsn-ws {
    flex: none;
    padding: 8px;
    border-bottom: 1px solid #2a2a3e;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .wsn-ws-btns {
    display: flex;
    gap: 6px;
  }
  .wsn-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    background: #1e1e2e;
    border: 1px solid #2a2a3e;
    border-radius: 5px;
    color: #d8d8ef;
    cursor: pointer;
    font: 700 11px Arial;
    padding: 6px 8px;
    transition:
      background 0.12s,
      border-color 0.12s,
      color 0.12s;
  }
  .wsn-btn:hover:not(:disabled) {
    background: #24243a;
    border-color: #cc3333;
    color: #fff;
  }
  .wsn-btn:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .wsn-btn-primary {
    flex: 1;
    border-style: dashed;
  }
  .wsn-btn-ic {
    font-size: 13px;
    line-height: 1;
  }

  .wsn-ws-row {
    display: flex;
    align-items: center;
    gap: 6px;
    background: #1b1b2c;
    border: 1px solid #2a2a3e;
    border-radius: 5px;
    padding: 4px 8px;
    font: 11px ui-monospace, monospace;
    color: #cdd;
  }
  .wsn-ws-ic {
    color: #cc9944;
    flex: none;
  }
  .wsn-ws-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wsn-ws-count {
    flex: none;
    color: #55556a;
  }
  .wsn-ws-clear {
    flex: none;
    background: none;
    border: none;
    color: #6a6a80;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    padding: 0 0 0 2px;
  }
  .wsn-ws-clear:hover {
    color: #ff6666;
  }
  .wsn-ws-last {
    font: 10px ui-monospace, monospace;
    color: #55556a;
    padding: 0 2px;
  }
  /* Reopen affordance — a cached folder from a previous visit awaiting a click
     to re-grant File System Access permission. */
  .wsn-reopen {
    display: flex;
    align-items: center;
    gap: 6px;
    width: 100%;
    background: #1b1b2c;
    border: 1px dashed #4a4a2a;
    border-radius: 5px;
    padding: 5px 8px;
    color: #ffb;
    cursor: pointer;
    font: 700 11px Arial;
    text-align: left;
    transition:
      background 0.12s,
      border-color 0.12s;
  }
  .wsn-reopen:hover:not(:disabled) {
    background: #24243a;
    border-color: #cc9944;
  }
  .wsn-reopen:disabled {
    opacity: 0.5;
    cursor: wait;
  }
  .wsn-reopen .wsn-ws-name {
    color: inherit;
  }
  .wsn-note {
    font: 10px ui-monospace, monospace;
    color: #667;
    line-height: 1.3;
  }
  .wsn-err {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    background: #2a1620;
    border: 1px solid #cc3333;
    border-radius: 5px;
    color: #ff9a9a;
    font: 10px ui-monospace, monospace;
    padding: 5px 8px;
    line-height: 1.35;
  }
  .wsn-err span {
    flex: 1;
  }
  .wsn-err button {
    background: none;
    border: none;
    color: #ff9a9a;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
  }

  .wsn-tree {
    flex: 1;
    min-height: 0;
  }
  .wsn-tree :global(.ft-rail) {
    border-right: none;
  }
  .wsn-hidden {
    display: none;
  }
</style>
