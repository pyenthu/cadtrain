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
  import { wsonFiles, parseWsonFile, summarise, type WsonFile } from './wson-summary';

  // Far-left placement-tool rail state (scaffold — see WellToolbar).
  let activeTool = $state('select');

  // ── Local workspace (client-side only — File System Access API / <input>) ──
  // Files the user opens from their own machine become a "Workspace" section,
  // distinct from the bundled Samples. Nothing is written server-side; the last
  // workspace LABEL persists to localStorage (handles aren't serialisable, so we
  // don't try to auto-reopen — we just show the name as a hint).
  const LAST_WS_KEY = 'wells-last-workspace';
  let workspaceFiles = $state<WsonFile[]>([]);
  let workspaceLabel = $state<string | null>(null);
  let lastWorkspaceLabel = $state<string | null>(null);

  $effect(() => {
    if (typeof localStorage !== 'undefined' && lastWorkspaceLabel === null) {
      lastWorkspaceLabel = localStorage.getItem(LAST_WS_KEY) || null;
    }
  });

  function handleOpenFiles(loaded: LoadedFile[], meta?: LoadMeta) {
    const parsed = loaded.map((f) => parseWsonFile(f.name, f.text, 'workspace', f.relPath));
    // Merge into the workspace, de-duping by id (relative path) — re-opening a
    // folder replaces stale copies rather than stacking duplicates.
    const byId = new Map(workspaceFiles.map((f) => [f.id, f]));
    for (const f of parsed) byId.set(f.id, f);
    workspaceFiles = [...byId.values()].sort((a, b) => (a.relPath || a.name).localeCompare(b.relPath || b.name));
    workspaceLabel = meta?.folderName ?? `${parsed.length} file${parsed.length === 1 ? '' : 's'}`;
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(LAST_WS_KEY, workspaceLabel);
      } catch {
        /* ignore quota / privacy-mode failures */
      }
    }
    lastWorkspaceLabel = workspaceLabel;
    // Auto-open the first freshly-loaded file so the workspace isn't silent.
    if (parsed[0]) openTab(parsed[0].id);
  }

  function clearWorkspace() {
    // Close any open workspace tabs, then drop the workspace section.
    for (const t of [...tabs]) {
      if (t.id.startsWith('ws:')) closeTabByKey(t.key);
    }
    workspaceFiles = [];
    workspaceLabel = null;
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

  // Open the first sample on mount so the shell isn't blank on landing.
  $effect(() => {
    if (tabs.length === 0 && wsonFiles.length && activeKey === null) {
      tick().then(() => openTab(wsonFiles[0].id));
    }
  });
</script>

<div class="wells-app">
  <!-- Far-left editor tool rail (SVTC-style icon toolbar). -->
  <WellToolbar bind:active={activeTool} />

  <!-- Left file/folder sidebar — SVTC-style explorer (Samples + local Workspace)
       wrapping the shared folder tree, plus the local-file open affordance. -->
  <div class="wells-sidebar">
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
      onSelect={openTab}
      onOpenFiles={handleOpenFiles}
      onClearWorkspace={clearWorkspace}
    />
    <a href="/" class="wells-home">← Home</a>
  </div>

  <!-- Main area: tab strip + central well view. -->
  <main class="wells-main">
    <div class="wells-tabs">
      {#if tabs.length === 0}
        <span class="wells-tabs-hint">select a .wson file →</span>
      {/if}
      {#each tabs as t (t.key)}
        {@const tf = fileById(t.id)}
        <div class="wells-tab-wrap" class:active={activeKey === t.key}>
          <button class="wells-tab" type="button" onclick={() => activate(t.key)}>
            <span class="wells-tab-ic">◍</span>
            <span class="wells-tab-label">{tf?.name ?? t.id}</span>
          </button>
          <button
            class="wells-tab-close"
            type="button"
            title="Close tab"
            aria-label="Close {tf?.name ?? t.id}"
            onclick={(ev) => closeTab(t.key, ev)}>×</button>
        </div>
      {/each}
    </div>

    <div class="wells-stage">
      {#if tabs.length === 0}
        <div class="wells-empty">
          <p>No well open.</p>
          <p>Pick a <code>.wson</code> file in the sidebar to open it in a tab.</p>
        </div>
      {:else}
        <!-- All panes stay mounted; only the active one is visible (the
             /primitives pattern) so switching tabs preserves per-view state. -->
        {#each tabs as t (t.key)}
          {@const file = fileById(t.id)}
          <div class="wells-pane" class:visible={activeKey === t.key}>
            <WellViewPlaceholder wson={file?.doc ?? null} error={file?.error ?? null} fileName={file?.name ?? t.id} />
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

  .wells-sidebar {
    width: 250px;
    flex: none;
    display: flex;
    flex-direction: column;
    min-height: 0;
    border-right: 1px solid #2a2a3e;
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
    gap: 4px;
    color: #55556a;
    font: 13px ui-monospace, monospace;
  }
  .wells-empty code {
    color: #7fa;
  }
</style>
