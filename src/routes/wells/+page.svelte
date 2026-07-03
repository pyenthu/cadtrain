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
  // Active file + its condensed summary — drive the workspace header (well
  // name + type chips) at the top of the main area, WsonApp-style.
  const activeFile = $derived(activeId ? fileById(activeId) : undefined);
  const activeSummary = $derived(activeFile && !activeFile.error ? summarise(activeFile.doc) : null);
  const fmtM = (v: number | null) => (v == null ? '—' : `${v} m`);

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
      onSelect={openTab}
      onOpenFiles={handleOpenFiles}
      onClearWorkspace={clearWorkspace}
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

    <!-- Workspace header — active well name + type chips + counts. Mirrors
         WsonApp's header row at the top of the diagram workspace. -->
    {#if activeSummary}
      <header class="wells-header">
        <div class="wells-title">
          <span class="wells-title-ic">◍</span>
          <h1>{activeSummary.wellName}</h1>
        </div>
        <div class="wells-chips">
          <span class="wells-chip wells-chip-kind">
            {activeSummary.deviated ? '⟋ deviated' : '│ vertical'}
          </span>
          {#if activeSummary.wellType}<span class="wells-chip">{activeSummary.wellType}</span>{/if}
          <span class="wells-chip">TD {fmtM(activeSummary.td)}</span>
          <span class="wells-chip">PBTD {fmtM(activeSummary.pbtd)}</span>
        </div>
        <div class="wells-metrics">
          <span class="wells-metric"><b>{activeSummary.counts.casing}</b> csg</span>
          <span class="wells-metric"><b>{activeSummary.counts.completions}</b> comp</span>
          <span class="wells-metric"><b>{activeSummary.counts.perforations}</b> perf</span>
          <span class="wells-metric"><b>{activeSummary.counts.survey}</b> svy</span>
        </div>
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

  /* ── Workspace header (active well name + chips + counts) ─────────────────── */
  .wells-header {
    flex: none;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 8px 16px;
    background: #16161f;
    border-bottom: 1px solid #2a2a3e;
  }
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
  .wells-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    min-width: 0;
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
