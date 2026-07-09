<script lang="ts">
  /**
   * /wells — ewells.app-style well-schematic APP SHELL.
   *
   * Layout (dark subsurface-visualisation chrome):
   *   [ WellToolbar ] [ FolderTreeSidebar ] [ tab strip + central well view ]
   *   far-left icons   left .wson file tree   top tabs, one pane per open doc
   *
   * REUSE:
   *   - LEFT FILE TREE: `$lib/shared/FolderTreeSidebar.svelte` — the parameterised
   *     distillation of the /primitives VS-Code folder tree (chevron + folder
   *     icon + count + live filter). It lists the bundled `.wson` files.
   *   - TAB SYSTEM: the /primitives multi-tab pattern (a `Tab[]` + `activeKey`,
   *     open/activate/close, all panes stay mounted so switching is instant).
   *   - FAR-LEFT ICON RAIL: the existing route-owned `WellToolbar.svelte`.
   *
   * MAIN VIEW SEAM: each tab mounts `WellViewPlaceholder.svelte` (route-owned).
   * A parallel session ports the 3D engine into `src/lib/wells/` and exposes
   * `$lib/wells/WellSchematic3D.svelte` (prop `wson`); the placeholder carries
   * the `<!-- MOUNT: ... -->` marker where that real view slots in at merge.
   * This shell imports NOTHING from `$lib/wells/**` so it builds standalone.
   */
  import { tick } from 'svelte';
  import { type FolderTree } from '$lib/shared/FolderTreeSidebar.svelte';
  import WellSideNav, { type LoadedFile, type LoadMeta } from '$lib/shared/WellSideNav.svelte';
  import WellToolbar from './WellToolbar.svelte';
  import WellViewPlaceholder from './WellViewPlaceholder.svelte';
  import { wsonFiles, parseWsonFile, summarise, type WsonFile, type WsonDoc } from './wson-summary';
  import * as wsCache from './workspace-cache';
  import { defaultViewSettings } from './view-settings';
  import { applyCompletionPatch, removeCompletion, type CompletionPatch } from '$lib/wells/wson-mutate';

  // Far-left placement-tool rail state (scaffold — see WellToolbar).
  let activeTool = $state('select');

  // ── Shared display / view state (the single source of truth) ────────────────
  // One WellViewSettings object drives the control bar, the 3D view, and the
  // depth ruler for the ACTIVE well. All panes stay mounted (the /primitives
  // pattern) but only the visible one is interacted with, so a single shared
  // object is the right granularity — no per-tab drift.
  const view = $state(defaultViewSettings());

  // Collapsible detail header (SVTC schematic style) — expanded by default.
  let headerOpen = $state(true);

  // ── Resizable explorer sidebar (VS-Code / WsonApp-style splitter) ───────────
  // Width persists to localStorage; drag the splitter between the sidebar and
  // the main workspace to resize. Clamped so the tree stays usable.
  const SIDEBAR_W_KEY = 'wells-sidebar-w';
  const SIDEBAR_MIN = 200;
  const SIDEBAR_MAX = 460;
  let sidebarW = $state(250);
  let resizing = $state(false);

  $effect(() => {
    if (typeof localStorage === 'undefined') return;
    const saved = Number(localStorage.getItem(SIDEBAR_W_KEY));
    if (Number.isFinite(saved) && saved >= SIDEBAR_MIN && saved <= SIDEBAR_MAX) {
      sidebarW = saved;
    }
  });

  function startResize(ev: PointerEvent) {
    ev.preventDefault();
    resizing = true;
    const startX = ev.clientX;
    const startW = sidebarW;
    const onMove = (e: PointerEvent) => {
      sidebarW = Math.max(SIDEBAR_MIN, Math.min(SIDEBAR_MAX, startW + (e.clientX - startX)));
    };
    const onUp = () => {
      resizing = false;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(SIDEBAR_W_KEY, String(Math.round(sidebarW)));
        } catch {
          /* ignore quota / privacy-mode failures */
        }
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  // ── Local workspace (client-side only — File System Access API / <input>) ──
  // Files the user opens from their own machine become a "Workspace" section,
  // distinct from the bundled Samples. Nothing is written server-side. The last
  // workspace LABEL persists to localStorage (a legacy hint), and — the real
  // restore — the picked directory HANDLE is cached in IndexedDB + the open tabs
  // in localStorage (see workspace-cache.ts), so the workspace comes back on the
  // next visit (silently if permission is still granted, else via a Reopen click).
  const LAST_WS_KEY = 'wells-last-workspace';
  let workspaceFiles = $state<WsonFile[]>([]);
  let workspaceLabel = $state<string | null>(null);
  let lastWorkspaceLabel = $state<string | null>(null);
  // Cached folder handle from a previous visit + the reopen affordance state.
  let dirHandle = $state<FileSystemDirectoryHandle | null>(null);
  let reopenLabel = $state<string | null>(null);
  let restoringWorkspace = $state(false);

  $effect(() => {
    if (typeof localStorage !== 'undefined' && lastWorkspaceLabel === null) {
      lastWorkspaceLabel = localStorage.getItem(LAST_WS_KEY) || null;
    }
  });

  /**
   * Merge a batch of loaded files into the Workspace section. `autoOpenFirst`
   * opens the first file (fresh user pick); restore/reopen pass false so cached
   * tabs drive what's open instead.
   */
  function ingestWorkspace(loaded: LoadedFile[], meta: LoadMeta | undefined, autoOpenFirst: boolean) {
    const parsed = loaded.map((f) => parseWsonFile(f.name, f.text, 'workspace', f.relPath));
    // Merge into the workspace, de-duping by id (relative path) — re-opening a
    // folder replaces stale copies rather than stacking duplicates.
    const byId = new Map(workspaceFiles.map((f) => [f.id, f]));
    for (const f of parsed) byId.set(f.id, f);
    workspaceFiles = [...byId.values()].sort((a, b) => (a.relPath || a.name).localeCompare(b.relPath || b.name));
    const label = meta?.folderName ?? `${parsed.length} file${parsed.length === 1 ? '' : 's'}`;
    workspaceLabel = label;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(LAST_WS_KEY, label);
      } catch {
        /* ignore quota / privacy-mode failures */
      }
    }
    lastWorkspaceLabel = label;
    // A folder handle (FSA pick) → cache it so we can restore next visit.
    if (meta?.dirHandle) {
      dirHandle = meta.dirHandle;
      reopenLabel = null;
      void wsCache.saveDirHandle(meta.dirHandle);
    }
    if (autoOpenFirst && parsed[0]) openTab(parsed[0].id);
  }

  function handleOpenFiles(loaded: LoadedFile[], meta?: LoadMeta) {
    ingestWorkspace(loaded, meta, true);
  }

  function clearWorkspace() {
    // Close any open workspace tabs, then drop the workspace section + cache.
    for (const t of [...tabs]) {
      if (t.id.startsWith('ws:')) closeTabByKey(t.key);
    }
    workspaceFiles = [];
    workspaceLabel = null;
    dirHandle = null;
    reopenLabel = null;
    void wsCache.clearDirHandle();
  }

  // Re-list a restored folder handle (permission assumed granted) into the
  // workspace, hydrating any placeholder `ws:` tabs. Never disturbs open tabs.
  async function hydrateFromHandle(handle: FileSystemDirectoryHandle) {
    restoringWorkspace = true;
    try {
      const loaded = await wsCache.listWsonFromDir(handle);
      if (loaded.length) ingestWorkspace(loaded, { folderName: handle.name, dirHandle: handle }, false);
      reopenLabel = null;
    } finally {
      restoringWorkspace = false;
    }
  }

  // "Reopen" click — requires a user gesture to re-grant FSA permission.
  async function reopenWorkspace() {
    if (!dirHandle) return;
    const ok = await wsCache.requestDirPermission(dirHandle);
    if (ok) await hydrateFromHandle(dirHandle);
  }

  // ── Combined lookup: bundled samples + workspace files ──────────────────────
  const allFiles = $derived<WsonFile[]>([...wsonFiles, ...workspaceFiles]);
  function fileById(id: string): WsonFile | undefined {
    return allFiles.find((f) => f.id === id);
  }

  // ── Sectioned file tree (Samples + Workspace), fed to the shared tree ───────
  function fileRow(f: WsonFile) {
    const s = summarise(f.doc);
    // Nested folder picks show their relative path so structure is legible.
    const label = f.relPath && f.relPath.includes('/') ? f.relPath : f.name;
    return { id: f.id, name: label, tag: f.error ? 'err' : s?.deviated ? 'dev' : undefined };
  }

  const tree = $derived<FolderTree>({
    name: 'wells',
    path: '',
    files: [],
    folders: [
      { name: 'Samples', path: 'samples', folders: [], files: wsonFiles.map(fileRow) },
      ...(workspaceFiles.length
        ? [{ name: 'Workspace', path: 'workspace', folders: [], files: workspaceFiles.map(fileRow) }]
        : []),
    ],
  });

  // ── Tabs (the /primitives multi-tab pattern) ────────────────────────────────
  interface Tab {
    id: string;
    key: number;
  }
  let tabs = $state<Tab[]>([]);
  let activeKey = $state<number | null>(null);
  let nextKey = 1;

  const activeId = $derived(tabs.find((t) => t.key === activeKey)?.id ?? null);
  // Active file + its condensed summary — drive the workspace header (well
  // name + type chips) at the top of the main area, WsonApp-style.
  const activeFile = $derived(activeId ? fileById(activeId) : undefined);
  const activeSummary = $derived(
    activeFile && !activeFile.error ? summarise(activeId ? docForTab(activeId) : activeFile.doc) : null,
  );
  const fmtM = (v: number | null) => (v == null ? '—' : `${v} m`);

  // ── Edit-the-diagram mutation layer (in-session, per tab) ────────────────────
  // The parsed `file.doc`s are module-level plain objects (shared, non-reactive).
  // For "double-click → edit → re-render" we keep a MUTABLE `$state` working copy
  // per open tab: a deep clone that Svelte proxies, so field/array writes trip
  // deep reactivity and the derived 2D scene recomputes. The SAME proxy ref is
  // passed to both the 2D and 3D surfaces (mutated in place, never re-assigned),
  // so no changing-identity prop remounts the 3D scene (avoids the re-bake loop).
  // No file write — edits live for the session only; undo is deferred.
  let workingDocs = $state<Record<string, WsonDoc>>({});

  // Lazily seed a working copy for each open tab once its file has parsed. The
  // `=== undefined` guard makes this a one-shot per id — it writes once then
  // settles, so it can't loop (memory `fresh_array_props_effect_loops`).
  $effect(() => {
    for (const t of tabs) {
      const f = fileById(t.id);
      if (f?.doc && workingDocs[t.id] === undefined) {
        // JSON round-trip, NOT structuredClone — f.doc is a Svelte $state proxy
        // and structuredClone(proxy) throws DataCloneError (crashed the whole
        // /wells page → "3D not opening"). WSON is plain JSON, so this is safe.
        workingDocs[t.id] = JSON.parse(JSON.stringify(f.doc));
      }
    }
  });

  /** The doc actually rendered for a tab — the mutable working copy once seeded,
   *  else the read-only parsed doc (shown for the tick before the effect runs). */
  function docForTab(id: string): WsonDoc | null {
    return workingDocs[id] ?? fileById(id)?.doc ?? null;
  }

  /** Apply a completion patch to the ACTIVE well's working doc (mutates in place
   *  → the 2D scene re-derives). `srcIndex` = index into `doc.completions[]`. */
  function updateComponent(srcIndex: number, patch: CompletionPatch) {
    const doc = activeId ? workingDocs[activeId] : null;
    if (doc) applyCompletionPatch(doc, srcIndex, patch);
  }
  /** Remove a completion from the ACTIVE well's working doc (in place). */
  function deleteComponent(srcIndex: number) {
    const doc = activeId ? workingDocs[activeId] : null;
    if (doc) removeCompletion(doc, srcIndex);
  }

  function openTab(id: string) {
    const existing = tabs.find((t) => t.id === id);
    if (existing) {
      activeKey = existing.key;
      return;
    }
    const key = nextKey++;
    tabs = [...tabs, { id, key }];
    activeKey = key;
  }
  function closeTabByKey(key: number) {
    const idx = tabs.findIndex((t) => t.key === key);
    if (idx < 0) return;
    tabs = tabs.filter((t) => t.key !== key);
    if (activeKey === key) activeKey = tabs[Math.max(0, idx - 1)]?.key ?? null;
  }
  function closeTab(key: number, ev: Event) {
    ev.stopPropagation();
    closeTabByKey(key);
  }
  function activate(key: number) {
    activeKey = key;
  }

  // Label for a tab whose file may not be hydrated yet (a restored `ws:` tab
  // before its folder is reopened). Falls back to a pretty basename of the id.
  function tabLabel(id: string): string {
    const f = fileById(id);
    if (f) return f.name;
    const path = id.startsWith('ws:') ? id.slice(3) : id;
    return path.split('/').pop() || path;
  }

  // ── Workspace restore + persistence ─────────────────────────────────────────
  // On mount: restore the cached folder handle (silent iff permission is still
  // granted, else surface a Reopen affordance) + the open tabs. After boot, any
  // tab change is persisted. All defensive — a blocked IndexedDB / revoked handle
  // degrades to the empty-workspace default (open the first sample).
  let booted = false; // non-reactive one-shot guard
  let bootDone = $state(false);

  async function bootWorkspace() {
    const cached = wsCache.loadTabs();

    // 1. Restore the last-opened folder handle if we still have permission.
    try {
      const handle = await wsCache.loadDirHandle();
      if (handle) {
        dirHandle = handle;
        const perm = await wsCache.queryDirPermission(handle);
        if (perm === 'granted') {
          await hydrateFromHandle(handle); // silent restore
        } else {
          // Can't auto-prompt without a user gesture — offer a Reopen button.
          reopenLabel = handle.name || lastWorkspaceLabel || 'folder';
        }
      }
    } catch {
      /* IndexedDB blocked / handle unusable → empty-workspace behaviour */
    }

    // 2. Restore the open tabs (samples resolve now; ws: tabs hydrate on reopen).
    if (cached && cached.ids.length) {
      for (const id of cached.ids) openTab(id);
      const target = tabs[cached.activeIdx] ?? tabs[0];
      if (target) activeKey = target.key;
    } else if (tabs.length === 0 && activeKey === null) {
      const first = wsonFiles[0];
      if (first) openTab(first.id); // no cache → default: first sample
    }

    bootDone = true;
  }

  $effect(() => {
    if (booted) return;
    booted = true;
    tick().then(bootWorkspace);
  });

  // Persist the open-tab list after boot completes (and on every change since).
  $effect(() => {
    if (!bootDone) return;
    const ids = tabs.map((t) => t.id);
    const activeIdx = Math.max(0, tabs.findIndex((t) => t.key === activeKey));
    wsCache.saveTabs(ids, activeIdx);
  });
</script>

<div class="wells-app" class:resizing>
  <!-- Far-left editor tool rail (SVTC-style icon toolbar). -->
  <WellToolbar bind:active={activeTool} />

  <!-- Left file/folder sidebar — SVTC-style explorer (Samples + local Workspace)
       wrapping the shared folder tree, plus the local-file open affordance. -->
  <div class="wells-sidebar" style="width: {sidebarW}px">
    <WellSideNav
      {tree}
      title="Wells"
      subtitle="well schematics · .wson"
      storageKey="wells-tree"
      defaultExpanded={['samples', 'workspace']}
      {activeId}
      openIds={tabs.map((t) => t.id)}
      {workspaceLabel}
      workspaceCount={workspaceFiles.length}
      {lastWorkspaceLabel}
      {reopenLabel}
      restoring={restoringWorkspace}
      onSelect={openTab}
      onOpenFiles={handleOpenFiles}
      onClearWorkspace={clearWorkspace}
      onReopen={reopenWorkspace}
    />
    <a href="/" class="wells-home">← Home</a>
  </div>

  <!-- Drag splitter — resize the explorer, WsonApp/VS-Code style. -->
  <div
    class="wells-splitter"
    role="separator"
    aria-orientation="vertical"
    aria-label="Resize sidebar"
    onpointerdown={startResize}
  ></div>

  <!-- Main area: tab strip · workspace header · central well view. -->
  <main class="wells-main">
    <div class="wells-tabs">
      {#if tabs.length === 0}
        <span class="wells-tabs-hint">select a .wson file →</span>
      {/if}
      {#each tabs as t (t.key)}
        {@const label = tabLabel(t.id)}
        <div class="wells-tab-wrap" class:active={activeKey === t.key}>
          <button class="wells-tab" type="button" onclick={() => activate(t.key)}>
            <span class="wells-tab-ic">◍</span>
            <span class="wells-tab-label">{label}</span>
          </button>
          <button
            class="wells-tab-close"
            type="button"
            title="Close tab"
            aria-label="Close {label}"
            onclick={(ev) => closeTab(t.key, ev)}>×</button>
        </div>
      {/each}
    </div>

    <!-- Workspace detail header — collapsible (SVTC schematic style). Collapsed:
         a one-line summary (name + kind + TD). Expanded: description, type, TD,
         PBTD + casing/completion/perf/survey counts. -->
    {#if activeSummary}
      <header class="wells-header" class:collapsed={!headerOpen}>
        <div class="wells-header-bar">
          <button
            class="wells-header-toggle"
            type="button"
            aria-expanded={headerOpen}
            aria-label={headerOpen ? 'Collapse well details' : 'Expand well details'}
            title={headerOpen ? 'Collapse details' : 'Expand details'}
            onclick={() => (headerOpen = !headerOpen)}
          >
            <span class="wells-chev" class:open={headerOpen}>▸</span>
          </button>
          <div class="wells-title">
            <span class="wells-title-ic">◍</span>
            <h1>{activeSummary.wellName}</h1>
          </div>
          <span class="wells-chip wells-chip-kind">
            {activeSummary.deviated ? '⟋ deviated' : '│ vertical'}
          </span>
          {#if activeSummary.wellType}<span class="wells-chip">{activeSummary.wellType}</span>{/if}
          {#if !headerOpen}
            <!-- Condensed peek while collapsed. -->
            <span class="wells-chip">TD {fmtM(activeSummary.td)}</span>
            <span class="wells-metrics wells-metrics-peek">
              <span class="wells-metric"><b>{activeSummary.counts.casing}</b> csg</span>
              <span class="wells-metric"><b>{activeSummary.counts.perforations}</b> perf</span>
            </span>
          {/if}
        </div>

        {#if headerOpen}
          <div class="wells-header-detail">
            {#if activeSummary.description}
              <p class="wells-desc">{activeSummary.description}</p>
            {/if}
            <div class="wells-facts">
              <span class="wells-fact"><span class="wells-fact-k">Type</span>
                {activeSummary.wellType ?? '—'} · {activeSummary.deviated ? 'deviated' : 'vertical'}</span>
              <span class="wells-fact"><span class="wells-fact-k">TD</span> {fmtM(activeSummary.td)}</span>
              <span class="wells-fact"><span class="wells-fact-k">PBTD</span> {fmtM(activeSummary.pbtd)}</span>
              <span class="wells-fact"><span class="wells-fact-k">Casing</span> {activeSummary.counts.casing}</span>
              <span class="wells-fact"><span class="wells-fact-k">Completions</span> {activeSummary.counts.completions}</span>
              <span class="wells-fact"><span class="wells-fact-k">Perfs</span> {activeSummary.counts.perforations}</span>
              <span class="wells-fact"><span class="wells-fact-k">Survey</span> {activeSummary.counts.survey}</span>
            </div>
          </div>
        {/if}
      </header>
    {/if}

    <div class="wells-stage">
      {#if tabs.length === 0}
        <div class="wells-empty">
          <div class="wells-empty-ic">◍</div>
          <p class="wells-empty-title">No well open</p>
          <p class="wells-empty-sub">
            Pick a <code>.wson</code> file in the sidebar, or
            <strong>Open Folder</strong> to load your own workspace.
          </p>
        </div>
      {:else}
        <!-- All panes stay mounted; only the active one is visible (the
             /primitives pattern) so switching tabs preserves per-view state. -->
        {#each tabs as t (t.key)}
          {@const file = fileById(t.id)}
          <div class="wells-pane" class:visible={activeKey === t.key}>
            <WellViewPlaceholder
              wson={docForTab(t.id)}
              error={file?.error ?? null}
              fileName={file?.name ?? tabLabel(t.id)}
              {view}
              paneActive={activeKey === t.key}
              onUpdateCompletion={updateComponent}
              onDeleteCompletion={deleteComponent}
            />
          </div>
        {/each}
      {/if}
    </div>
  </main>
</div>

<style>
  .wells-app {
    height: 100%;
    display: flex;
    background: #14141f;
    color: #e8e8ef;
    overflow: hidden;
    font-family: Arial, sans-serif;
  }

  /* While dragging the splitter, kill text selection + hint the cursor. */
  .wells-app.resizing {
    user-select: none;
    cursor: col-resize;
  }

  .wells-sidebar {
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid #2a2a3e;
  }

  /* ── Resize splitter ─────────────────────────────────────────────────────── */
  .wells-splitter {
    flex: none;
    width: 5px;
    margin: 0 -3px 0 -2px; /* widen the grab target without shifting layout */
    z-index: 5;
    cursor: col-resize;
    background: transparent;
    transition: background 0.12s ease;
  }
  .wells-splitter:hover,
  .wells-app.resizing .wells-splitter {
    background: #cc3333;
  }
  /* FolderTreeSidebar owns its own border; drop the wrapper's so they don't
     double up. The Home link sits pinned below the tree. */
  .wells-sidebar :global(.ft-rail) {
    flex: 1;
    min-height: 0;
    border-right: none;
  }
  .wells-home {
    flex: none;
    display: block;
    padding: 8px 12px;
    background: #16161f;
    border-top: 1px solid #2a2a3e;
    color: #cc4444;
    text-decoration: none;
    font: 700 11px Arial;
  }
  .wells-home:hover {
    color: #ff6666;
  }

  .wells-main {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }

  /* ── Workspace detail header (collapsible) ────────────────────────────────── */
  .wells-header {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 8px 16px;
    background: #16161f;
    border-bottom: 1px solid #2a2a3e;
  }
  .wells-header.collapsed {
    padding-bottom: 8px;
  }
  .wells-header-bar {
    display: flex;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  .wells-header-toggle {
    flex: none;
    background: none;
    border: none;
    color: #889;
    cursor: pointer;
    padding: 2px;
    display: flex;
    align-items: center;
  }
  .wells-header-toggle:hover { color: #fff; }
  .wells-chev {
    display: inline-block;
    font-size: 11px;
    transition: transform 0.12s ease;
  }
  .wells-chev.open { transform: rotate(90deg); }
  .wells-header-detail {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding-left: 24px;
  }
  .wells-desc {
    margin: 0;
    font: 12px Arial;
    color: #99a;
    line-height: 1.45;
    max-width: 900px;
  }
  .wells-facts {
    display: flex;
    flex-wrap: wrap;
    gap: 6px 18px;
  }
  .wells-fact {
    font: 12px ui-monospace, monospace;
    color: #cdd;
    white-space: nowrap;
  }
  .wells-fact-k {
    color: #667;
    margin-right: 5px;
    text-transform: uppercase;
    font-size: 10px;
    letter-spacing: 0.4px;
  }
  .wells-metrics-peek { margin-left: 4px; }
  .wells-title {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
  }
  .wells-title-ic {
    color: #cc3333;
    font-size: 14px;
    flex: none;
  }
  .wells-title h1 {
    margin: 0;
    font: 700 15px Arial;
    color: #fff;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wells-chip {
    font: 600 11px ui-monospace, monospace;
    background: #232340;
    border: 1px solid #34345a;
    border-radius: 9999px;
    padding: 2px 10px;
    color: #aab;
    white-space: nowrap;
  }
  .wells-chip-kind {
    color: #ffb;
    border-color: #4a4a2a;
  }
  .wells-metrics {
    display: flex;
    gap: 12px;
    margin-left: auto;
    flex: none;
  }
  .wells-metric {
    font: 11px ui-monospace, monospace;
    color: #778;
    white-space: nowrap;
  }
  .wells-metric b {
    color: #fff;
    font-size: 13px;
  }

  /* ── Tab strip ─────────────────────────────────────────────────────────── */
  .wells-tabs {
    flex: none;
    display: flex;
    align-items: stretch;
    gap: 2px;
    height: 36px;
    background: #10101a;
    border-bottom: 1px solid #2a2a3e;
    padding: 0 6px;
    overflow-x: auto;
  }
  .wells-tabs-hint {
    align-self: center;
    color: #55556a;
    font: 11px ui-monospace, monospace;
    padding: 0 8px;
  }
  .wells-tab-wrap {
    display: flex;
    align-items: center;
    align-self: flex-end;
    background: #1a1a2a;
    border: 1px solid #2a2a3e;
    border-bottom: none;
    border-radius: 6px 6px 0 0;
    margin-top: 4px;
    max-width: 200px;
  }
  .wells-tab-wrap.active {
    background: #232340;
    border-color: #cc3333;
  }
  .wells-tab {
    display: flex;
    align-items: center;
    gap: 6px;
    background: none;
    border: none;
    color: #aab;
    cursor: pointer;
    padding: 6px 4px 6px 10px;
    font: 12px ui-monospace, monospace;
    overflow: hidden;
  }
  .wells-tab-wrap.active .wells-tab {
    color: #fff;
  }
  .wells-tab-ic {
    color: #cc3333;
    flex: none;
  }
  .wells-tab-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wells-tab-close {
    background: none;
    border: none;
    color: #6a6a80;
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
    padding: 0 8px 0 2px;
  }
  .wells-tab-close:hover {
    color: #ff6666;
  }

  /* ── Stage ─────────────────────────────────────────────────────────────── */
  .wells-stage {
    flex: 1;
    min-height: 0;
    position: relative;
  }
  /* Panes overlap; the active one is shown. Using visibility (not removing the
     pane from flow with display:none) keeps mounted panes cheap and sidesteps
     the grid-track phantom-column gotcha (CLAUDE.md). */
  .wells-pane {
    position: absolute;
    inset: 0;
    visibility: hidden;
    pointer-events: none;
  }
  .wells-pane.visible {
    visibility: visible;
    pointer-events: auto;
  }
  .wells-empty {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 6px;
    color: #55556a;
    text-align: center;
    padding: 0 24px;
  }
  .wells-empty-ic {
    font-size: 44px;
    color: #cc3333;
    opacity: 0.4;
    line-height: 1;
    margin-bottom: 4px;
  }
  .wells-empty-title {
    margin: 0;
    font: 600 14px Arial;
    color: #aab;
  }
  .wells-empty-sub {
    margin: 0;
    max-width: 340px;
    font: 12px ui-monospace, monospace;
    color: #667;
    line-height: 1.5;
  }
  .wells-empty-sub strong {
    color: #aab;
    font-weight: 700;
  }
  .wells-empty code {
    color: #7fa;
  }
</style>
