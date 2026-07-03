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
  import FolderTreeSidebar, { type FolderTree } from '$lib/shared/FolderTreeSidebar.svelte';
  import WellToolbar from './WellToolbar.svelte';
  import WellViewPlaceholder from './WellViewPlaceholder.svelte';
  import { wsonFiles, fileBySlug, summarise } from './wson-summary';

  // Far-left placement-tool rail state (scaffold — see WellToolbar).
  let activeTool = $state('select');

  // ── File tree ──────────────────────────────────────────────────────────────
  // One "Samples" folder holding the bundled `.wson` files. When the volume
  // store lands this becomes a fetched tree; the sidebar is data-driven so only
  // this builder changes.
  const tree = $derived<FolderTree>({
    name: 'wells',
    path: '',
    files: [],
    folders: [
      {
        name: 'samples',
        path: 'samples',
        folders: [],
        files: wsonFiles.map((f) => {
          const s = summarise(f.doc);
          return {
            id: f.slug,
            name: f.name,
            tag: f.error ? 'err' : s?.deviated ? 'dev' : undefined,
          };
        }),
      },
    ],
  });

  // ── Tabs (the /primitives multi-tab pattern) ────────────────────────────────
  interface Tab {
    slug: string;
    key: number;
  }
  let tabs = $state<Tab[]>([]);
  let activeKey = $state<number | null>(null);
  let nextKey = 1;

  const activeSlug = $derived(tabs.find((t) => t.key === activeKey)?.slug ?? null);

  function openTab(slug: string) {
    const existing = tabs.find((t) => t.slug === slug);
    if (existing) {
      activeKey = existing.key;
      return;
    }
    const key = nextKey++;
    tabs = [...tabs, { slug, key }];
    activeKey = key;
  }
  function closeTab(key: number, ev: Event) {
    ev.stopPropagation();
    const idx = tabs.findIndex((t) => t.key === key);
    if (idx < 0) return;
    tabs = tabs.filter((t) => t.key !== key);
    if (activeKey === key) activeKey = tabs[Math.max(0, idx - 1)]?.key ?? null;
  }
  function activate(key: number) {
    activeKey = key;
  }

  // Open the first sample on mount so the shell isn't blank on landing.
  $effect(() => {
    if (tabs.length === 0 && wsonFiles.length && activeKey === null) {
      tick().then(() => openTab(wsonFiles[0].slug));
    }
  });
</script>

<div class="wells-app">
  <!-- Far-left editor tool rail (SVTC-style icon toolbar). -->
  <WellToolbar bind:active={activeTool} />

  <!-- Left file/folder sidebar — reused shared folder tree, lists `.wson`. -->
  <div class="wells-sidebar">
    <FolderTreeSidebar
      {tree}
      title="Wells"
      subtitle="well schematics · .wson"
      storageKey="wells-tree"
      defaultExpanded={['samples']}
      activeId={activeSlug}
      openIds={tabs.map((t) => t.slug)}
      onSelect={openTab}
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
        <div class="wells-tab-wrap" class:active={activeKey === t.key}>
          <button class="wells-tab" type="button" onclick={() => activate(t.key)}>
            <span class="wells-tab-ic">◍</span>
            <span class="wells-tab-label">{t.slug}</span>
          </button>
          <button
            class="wells-tab-close"
            type="button"
            title="Close tab"
            aria-label="Close {t.slug}"
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
          {@const file = fileBySlug(t.slug)}
          <div class="wells-pane" class:visible={activeKey === t.key}>
            <WellViewPlaceholder wson={file?.doc ?? null} error={file?.error ?? null} fileName={file?.name ?? t.slug} />
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
