<script lang="ts">
  /**
   * /primitives — multi-tab wrapper around /graph-editor.
   *
   * Two surfaces, one editor:
   *   /graph-editor          — single primitive, full-screen.
   *   /primitives            — sidebar of primitives + N tabs; each tab is
   *                            an iframe of /graph-editor?id=<id>&embed=1.
   *
   * Why iframes instead of mounting a Svelte component N times: the editor
   * is a 2500+ LOC +page.svelte that holds WASM/Manifold state in module-
   * scope helpers. Each instance needs an isolated `pickerRecent`, `bake`,
   * `graph`, etc. — iframe isolation is the cheapest correctness win.
   * Once we extract a `<GraphEditorPane>` component (#107) the iframe goes
   * away and tabs mount the component directly. Until then this is good
   * enough — and the user can still use /graph-editor for single-tab work.
   *
   * Sidebar replicates the old /primitives groups (basic / completions /
   * stdlib / stdstale / archived) but stripped to the minimum: click an
   * id → opens (or activates) a tab. No inline edit, no rename / move /
   * delete (those live inside the graph editor itself).
   */
  import { onMount, tick } from 'svelte';
  import GraphEditorPane from '$lib/shared/GraphEditorPane.svelte';

  interface Entry {
    id: string;
    source: 'bundle' | 'volume' | 'stdlib' | 'stdstale';
  }

  // Live primitive lists, by group.
  let basic: Entry[] = $state([]);
  let stdlib: Entry[] = $state([]);
  let stdstale: Entry[] = $state([]);
  let archived: Entry[] = $state([]);
  /** completions is nested by family: { drill_pipe: [...], … }. Empty family
   *  dirs surface as keys with empty arrays so the user sees the slot. */
  let completions: Record<string, Entry[]> = $state({});

  let listLoading = $state(false);
  let listError = $state<string | null>(null);

  /** Delete a primitive. Two paths sharing one server endpoint:
   *   * `archive` (default) — moves the file to primitives/archive/ as
   *     a soft delete (recoverable: shows up under the Archived group,
   *     can be restored or hard-deleted).
   *   * `permanent` — hard delete with `?permanent=true`. The file is
   *     `fs.unlink`ed from the volume — irreversible. Used for cleaning
   *     up the Archived group when a user is sure they don't want a part
   *     anymore.
   *  Stdlib + stdstale entries reject server-side; we hide the trash
   *  for them in the UI to skip a wasted round-trip. */
  let deleteBusy = $state<string | null>(null);
  async function deletePrim(id: string, source: string, mode: 'archive' | 'permanent' = 'archive') {
    if (source === 'stdlib' || source === 'stdstale' || source === 'bundle') return;
    const prompt = mode === 'permanent'
      ? `Permanently delete "${id}"? The file is removed from the volume — this CANNOT be undone.`
      : `Archive "${id}"? It moves to primitives/archive/ — soft delete (recoverable).`;
    const ok = typeof confirm === 'function' ? confirm(prompt) : true;
    if (!ok) return;
    deleteBusy = id;
    try {
      const qs = mode === 'permanent' ? '&permanent=true' : '';
      const r = await fetch(`/api/primitives/delete?id=${encodeURIComponent(id)}${qs}`, { method: 'DELETE' });
      if (!r.ok) {
        const t = await r.text();
        if (typeof alert === 'function') alert(`Delete failed (${r.status}): ${t.slice(0, 200)}`);
        return;
      }
      // Close any open tabs for the deleted id.
      tabs = tabs.filter((t) => t.id !== id);
      if (tabs.length === 0) activeKey = null;
      persistTabs();
      await loadList();
    } catch (e: any) {
      if (typeof alert === 'function') alert(`Delete error: ${e?.message ?? e}`);
    } finally {
      deleteBusy = null;
    }
  }

  async function loadList() {
    listLoading = true;
    listError = null;
    try {
      const r = await fetch('/api/primitives/list', { cache: 'no-store' });
      const d = await r.json() as any;
      basic     = Array.isArray(d.basic)     ? d.basic     : [];
      stdlib    = Array.isArray(d.stdlib)    ? d.stdlib    : [];
      stdstale  = Array.isArray(d.stdstale)  ? d.stdstale  : [];
      archived  = Array.isArray(d.archived)  ? d.archived  : [];
      completions = (d.completions && typeof d.completions === 'object') ? d.completions : {};
    } catch (e: any) {
      listError = e?.message ?? String(e);
    } finally {
      listLoading = false;
    }
  }

  // Search filter — narrows EVERY group in place. Empty = no filter.
  let filter = $state('');
  function pass(e: Entry): boolean {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return e.id.toLowerCase().includes(q);
  }
  // Expand/collapse per group. Persisted to localStorage.
  let openGroups = $state<Record<string, boolean>>({
    basic: true, stdlib: true, stdstale: false, completions: true, archived: false,
  });
  let openFamilies = $state<Record<string, boolean>>({});
  onMount(() => {
    try {
      const og = localStorage.getItem('prim-open-groups');
      if (og) openGroups = { ...openGroups, ...JSON.parse(og) };
      const of = localStorage.getItem('prim-open-families');
      if (of) openFamilies = JSON.parse(of);
    } catch { /* ignore */ }
  });
  function toggleGroup(k: string) {
    openGroups = { ...openGroups, [k]: !openGroups[k] };
    try { localStorage.setItem('prim-open-groups', JSON.stringify(openGroups)); } catch { /* ignore */ }
  }
  function toggleFamily(fam: string) {
    openFamilies = { ...openFamilies, [fam]: !openFamilies[fam] };
    try { localStorage.setItem('prim-open-families', JSON.stringify(openFamilies)); } catch { /* ignore */ }
  }

  // ─── Tab strip ────────────────────────────────────────────────────────────
  interface Tab { id: string; key: number }
  let tabs: Tab[] = $state([]);
  let activeKey: number | null = $state(null);
  let nextKey = 1;

  /** Open `id` in a tab — activates the existing tab if one is already open,
   *  otherwise creates a new one. The iframe's `src` is set ONCE per tab
   *  (using the stable `key`) so flipping the active tab doesn't re-init
   *  WASM. Tabs stay loaded in the background until closed. */
  async function openTab(id: string) {
    const existing = tabs.find((t) => t.id === id);
    if (existing) { activeKey = existing.key; return; }
    const key = nextKey++;
    tabs = [...tabs, { id, key }];
    activeKey = key;
    await tick();
    persistTabs();
  }
  function closeTab(key: number, ev: Event) {
    ev.stopPropagation();
    const idx = tabs.findIndex((t) => t.key === key);
    if (idx < 0) return;
    tabs = tabs.filter((t) => t.key !== key);
    // Re-activate a neighbour if we closed the active one.
    if (activeKey === key) activeKey = tabs[Math.max(0, idx - 1)]?.key ?? null;
    persistTabs();
  }
  function activate(key: number) { activeKey = key; }
  function persistTabs() {
    try {
      localStorage.setItem('prim-open-tabs', JSON.stringify(tabs.map((t) => t.id)));
      localStorage.setItem('prim-active-tab-id', String(activeKey != null ? tabs.find((t) => t.key === activeKey)?.id ?? '' : ''));
    } catch { /* ignore */ }
  }

  // ─── Rail width (drag-resizable) ─────────────────────────────────────────
  let railWidth = $state(240);
  let railResizing = false;
  function startRailResize(ev: PointerEvent) {
    railResizing = true;
    const start = ev.clientX;
    const start0 = railWidth;
    const move = (e: PointerEvent) => {
      if (!railResizing) return;
      railWidth = Math.max(180, Math.min(480, start0 + (e.clientX - start)));
    };
    const stop = () => {
      railResizing = false;
      try { localStorage.setItem('prim-rail-width', String(railWidth)); } catch { /* ignore */ }
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  }

  // ─── Mount: load list, restore session ───────────────────────────────────
  onMount(async () => {
    try {
      const rw = Number(localStorage.getItem('prim-rail-width'));
      if (rw >= 180 && rw <= 480) railWidth = rw;
    } catch { /* ignore */ }
    await loadList();
    // Restore previously-open tabs from this browser's last session.
    try {
      const saved = JSON.parse(localStorage.getItem('prim-open-tabs') ?? '[]') as string[];
      const activeId = localStorage.getItem('prim-active-tab-id') ?? '';
      for (const id of saved) {
        const key = nextKey++;
        tabs = [...tabs, { id, key }];
        if (id === activeId) activeKey = key;
      }
      if (activeKey == null && tabs.length > 0) activeKey = tabs[0].key;
    } catch { /* ignore */ }
    // ?id=<id> in the URL forces a tab open on landing — matches the legacy
    // /primitives?id=X bookmark behaviour the old redirect handled.
    try {
      const u = new URL(window.location.href);
      const id = u.searchParams.get('id') ?? u.searchParams.get('open');
      if (id) openTab(id);
    } catch { /* ignore */ }
  });
</script>

<svelte:head>
  <title>Primitives · CAD Train</title>
</svelte:head>

<!-- Bind the rail width into a CSS custom property so the grid track
     references it explicitly. `grid-template-columns: auto …` was
     sizing the rail column to max-content of the longest primitive
     name (with `white-space: nowrap` the min-content is the full
     name), blowing the rail out to 600 px+ when any row had a long id.
     A fixed first track from --rail-w pins it to the resize handle. -->
<div class="prim-root" style="--rail-w: {railWidth}px">
  <aside class="prim-rail">
    <header>
      <h2>Primitives</h2>
      <a class="rail-newtab" href="/graph-editor" target="_blank" rel="noopener" title="Open the standalone graph editor in a new tab">↗ open</a>
    </header>
    <input class="prim-filter" type="text" placeholder="filter…" bind:value={filter}/>

    <!-- Everything below the header + filter scrolls inside this wrapper.
         The rail itself stays anchored — title stays put, filter stays
         visible while the groups scroll past underneath. -->
    <div class="prim-rail-scroll">

    {#if listLoading}<div class="prim-empty">loading…</div>{/if}
    {#if listError}<div class="prim-error">list failed: {listError}</div>{/if}

    <!-- Basic — `<volume>/primitives/basic/*.{prim,asm}.ts`. -->
    <div class="prim-group">
      <button class="prim-group-head" type="button" onclick={() => toggleGroup('basic')}>
        <span class="prim-caret">{openGroups.basic ? '▾' : '▸'}</span>
        Basic <span class="prim-count">({basic.filter(pass).length})</span>
      </button>
      {#if openGroups.basic}
        {#each basic.filter(pass) as e (e.id)}
          <div class="prim-row-wrap" class:active={tabs.some((t) => t.id === e.id)}>
            <button class="prim-row" type="button" onclick={() => openTab(e.id)}>
              <span class="prim-name">{e.id}</span>
              <span class="prim-tag vol">vol</span>
            </button>
            {#if e.source === 'volume'}
              <button class="prim-trash" type="button"
                title="Archive — soft delete (recoverable from primitives/archive/)"
                disabled={deleteBusy === e.id}
                onclick={() => deletePrim(e.id, e.source)}>{deleteBusy === e.id ? '…' : '🗑'}</button>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    <!-- Completions — nested by family. Each family is its own collapsible
         sub-group so a single drill_pipe family with 30 parts doesn't drown
         the smaller families. -->
    <div class="prim-group">
      <button class="prim-group-head" type="button" onclick={() => toggleGroup('completions')}>
        <span class="prim-caret">{openGroups.completions ? '▾' : '▸'}</span>
        Completions
      </button>
      {#if openGroups.completions}
        {#each Object.entries(completions) as [fam, items] (fam)}
          {@const filtered = items.filter(pass)}
          {#if filtered.length > 0 || !filter.trim()}
            <button class="prim-family-head" type="button" onclick={() => toggleFamily(fam)}>
              <span class="prim-caret">{openFamilies[fam] ? '▾' : '▸'}</span>
              {fam} <span class="prim-count">({filtered.length})</span>
            </button>
            {#if openFamilies[fam]}
              {#each filtered as e (e.id)}
                <div class="prim-row-wrap indent" class:active={tabs.some((t) => t.id === e.id)}>
                  <button class="prim-row indent" type="button" onclick={() => openTab(e.id)}>
                    <span class="prim-name">{e.id}</span>
                    <span class="prim-tag vol">vol</span>
                  </button>
                  {#if e.source === 'volume'}
                    <button class="prim-trash" type="button"
                      title="Archive — soft delete (recoverable from primitives/archive/)"
                      disabled={deleteBusy === e.id}
                      onclick={() => deletePrim(e.id, e.source)}>{deleteBusy === e.id ? '…' : '🗑'}</button>
                  {/if}
                </div>
              {/each}
            {/if}
          {/if}
        {/each}
      {/if}
    </div>

    <!-- stdlib — git-tracked r_* canonical building blocks (read-only). -->
    <div class="prim-group">
      <button class="prim-group-head" type="button" onclick={() => toggleGroup('stdlib')}>
        <span class="prim-caret">{openGroups.stdlib ? '▾' : '▸'}</span>
        stdlib <span class="prim-count">({stdlib.filter(pass).length})</span>
      </button>
      {#if openGroups.stdlib}
        {#each stdlib.filter(pass) as e (e.id)}
          <div class="prim-row-wrap" class:active={tabs.some((t) => t.id === e.id)}>
            <button class="prim-row" type="button" onclick={() => openTab(e.id)}>
              <span class="prim-name">{e.id}</span>
              <span class="prim-tag src" title="from src/lib/cad/stdlib — read-only">src</span>
            </button>
            <!-- stdlib lives in git-tracked src/ — no trash, refused server-side anyway. -->
          </div>
        {/each}
      {/if}
    </div>

    <!-- stdstale — deprecated stdlib engines kept resolvable for legacy parts. -->
    <div class="prim-group">
      <button class="prim-group-head" type="button" onclick={() => toggleGroup('stdstale')}>
        <span class="prim-caret">{openGroups.stdstale ? '▾' : '▸'}</span>
        stdstale <span class="prim-count">({stdstale.filter(pass).length})</span>
      </button>
      {#if openGroups.stdstale}
        {#each stdstale.filter(pass) as e (e.id)}
          <div class="prim-row-wrap" class:active={tabs.some((t) => t.id === e.id)}>
            <button class="prim-row" type="button" onclick={() => openTab(e.id)}>
              <span class="prim-name">{e.id}</span>
              <span class="prim-tag stale" title="Deprecated engine — kept resolvable for legacy parts">stale</span>
            </button>
            <!-- stdstale also lives in git-tracked src/ — no trash. -->
          </div>
        {/each}
      {/if}
    </div>

    <!-- Archived — soft-deleted. Collapsed by default. -->
    <div class="prim-group">
      <button class="prim-group-head" type="button" onclick={() => toggleGroup('archived')}>
        <span class="prim-caret">{openGroups.archived ? '▾' : '▸'}</span>
        Archived <span class="prim-count">({archived.filter(pass).length})</span>
      </button>
      {#if openGroups.archived}
        {#each archived.filter(pass) as e (e.id)}
          <div class="prim-row-wrap" class:active={tabs.some((t) => t.id === e.id)}>
            <button class="prim-row" type="button" onclick={() => openTab(e.id)}>
              <span class="prim-name">{e.id}</span>
              <span class="prim-tag arch">arch</span>
            </button>
            {#if e.source === 'volume'}
              <button class="prim-trash perm" type="button"
                title="Permanent delete — removes the file from the volume (irreversible)"
                disabled={deleteBusy === e.id}
                onclick={() => deletePrim(e.id, e.source, 'permanent')}
                aria-label="Permanently delete {e.id}">
                {#if deleteBusy === e.id}
                  …
                {:else}
                  <!-- Heroicons outline / trash — 1.6 stroke, black currentColor,
                       16 px square inside the 24 px row gutter so it reads as
                       a real icon rather than emoji noise. -->
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"
                    viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"
                    aria-hidden="true">
                    <path d="M3 6h18"/>
                    <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                    <path d="M19 6l-1.2 13.2A2 2 0 0 1 15.8 21H8.2a2 2 0 0 1-2-1.8L5 6"/>
                    <path d="M10 11v6"/>
                    <path d="M14 11v6"/>
                  </svg>
                {/if}
              </button>
            {/if}
          </div>
        {/each}
      {/if}
    </div>

    </div><!-- /.prim-rail-scroll -->
  </aside>

  <!-- Drag handle between rail and the tabbed area. Doesn't render its own
       cursor inside the rail — let the divider's hover style do that. -->
  <div class="prim-rail-divider"
    role="separator" aria-label="Resize sidebar"
    onpointerdown={startRailResize}
    ondblclick={() => { railWidth = 240; try { localStorage.setItem('prim-rail-width', '240'); } catch { /* ignore */ } }}></div>

  <main class="prim-main">
    {#if tabs.length === 0}
      <div class="prim-empty-state">
        <p>No primitives open.</p>
        <p>Click a primitive in the sidebar to open it in a tab. Each tab embeds the graph editor.</p>
      </div>
    {:else}
      <!-- Tab strip — clicking flips activeKey without unmounting the iframe.
           The iframe stays loaded so flipping back to a tab is instant. -->
      <div class="prim-tabs">
        {#each tabs as t (t.key)}
          <!-- Tab + close-button as siblings inside a wrapper div (can't
               nest <button> in <button>). Click anywhere on the tab body
               activates; the ✕ stops propagation and closes. -->
          <div class="prim-tab-wrap" class:active={activeKey === t.key}>
            <button class="prim-tab" type="button" onclick={() => activate(t.key)}>
              <span class="prim-tab-label">{t.id}</span>
            </button>
            <button class="prim-tab-close" type="button" title="Close tab" onclick={(ev) => closeTab(t.key, ev)}>×</button>
          </div>
        {/each}
      </div>
      <!-- All editor instances stay mounted; only the active one is :visible.
           This preserves the editor's in-memory state across tab switches
           (graph, bake cache, zoom level, etc.). Mounts the same
           GraphEditorPane component as /graph-editor — one source of truth,
           no iframe overhead. -->
      <div class="prim-stage">
        {#each tabs as t (t.key)}
          <div class="prim-pane" class:visible={activeKey === t.key}>
            <GraphEditorPane id={t.id} embed={true} />
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>

<style>
  .prim-root {
    display: grid;
    /* `--rail-w` set on the root element from the rail-resize state.
       Fixed first track (not `auto`) so a long primitive name with
       `white-space: nowrap` can't blow the column out to its min-
       content — the rail stays pinned to the resize handle. */
    grid-template-columns: var(--rail-w, 240px) 6px minmax(0, 1fr);
    /* `minmax(0, 1fr)` (not `1fr`, which defaults to `minmax(auto, 1fr)`)
       so the row clamps to the parent's height — required for the rail's
       `overflow-y: auto` to actually scroll when there are 100+ entries.
       Without it the row sized to max-content of the rail and the rail
       grew the page instead of scrolling. */
    grid-template-rows: minmax(0, 1fr);
    height: 100%;
    min-height: 0;
    overflow: hidden;
    font-family: Arial;
    color: #1f2937;
  }

  /* ─── Sidebar ──────────────────────────────────────────────────────── */
  /* The rail itself NO LONGER scrolls — it's a flex column holding three
     siblings: header (auto), filter (auto), and the scroll wrapper
     (flex:1). Only the inner wrapper scrolls. This keeps the "Primitives"
     title + the filter input pinned at the top while the groups scroll
     past underneath. */
  .prim-rail {
    display: flex; flex-direction: column;
    background: #fafaf9; border-right: 1px solid #e5e7eb;
    overflow: hidden;
    /* `min-height: 0` is required on a flex column inside a clamped
       grid track so the inner scroll wrapper can shrink + scroll —
       same pattern as the rail's parent (.prim-root). `min-width: 0`
       lets the rail shrink to its grid track (var(--rail-w)) instead
       of expanding to the longest primitive name's min-content. */
    min-height: 0;
    min-width: 0;
  }
  /* Scroll wrapper inside the rail — owns the vertical scrollbar.
     `flex: 1 1 0` so it fills the remaining rail height after the
     header + filter take their natural size. `overflow-y: scroll`
     (not auto) keeps the track always reserved so the rail width
     doesn't jump when content overflow appears/disappears. */
  .prim-rail-scroll {
    flex: 1 1 0; min-height: 0;
    overflow-y: scroll; overflow-x: hidden;
    /* Firefox / standards-track thin scrollbar with cadtrain palette. */
    scrollbar-width: thin;
    scrollbar-color: #94a3b8 #f1f5f9;
  }
  /* Webkit (Chrome/Safari/Edge): always-visible thin vertical track
     with a slate thumb. macOS otherwise auto-hides the scrollbar even
     under `overflow: scroll`. */
  .prim-rail-scroll::-webkit-scrollbar { width: 10px; }
  .prim-rail-scroll::-webkit-scrollbar-track { background: #f1f5f9; }
  .prim-rail-scroll::-webkit-scrollbar-thumb {
    background: #94a3b8; border-radius: 5px;
    border: 2px solid #f1f5f9;
  }
  .prim-rail-scroll::-webkit-scrollbar-thumb:hover { background: #64748b; }
  .prim-rail header {
    display: flex; align-items: center; gap: 8px;
    padding: 10px 14px 4px;
    border-bottom: 1px solid #e5e7eb; background: #f3f4f6;
  }
  .prim-rail h2 { font: 700 14px Arial; margin: 0; color: #0c4a6e; flex: 1; }
  .rail-newtab { font: 11px Arial; color: #0369a1; text-decoration: none; }
  .rail-newtab:hover { text-decoration: underline; }
  .prim-filter {
    margin: 6px 12px;
    padding: 4px 10px; font: 12px ui-monospace, monospace;
    border: 1px solid #d6d3d1; border-radius: 4px;
  }

  .prim-group { padding: 4px 0; border-bottom: 1px solid #f3f4f6; }
  .prim-group-head {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 6px 12px; background: transparent; border: 0; cursor: pointer;
    text-align: left; font: 600 11px Arial; color: #44403c;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  .prim-group-head:hover { background: #f3f4f6; }
  .prim-caret { color: #78716c; font-size: 9px; width: 10px; }
  .prim-count { color: #a8a29e; font-weight: 400; font-size: 10px; }

  .prim-family-head {
    display: flex; align-items: center; gap: 6px; width: 100%;
    padding: 4px 12px 4px 22px; background: transparent; border: 0; cursor: pointer;
    text-align: left; font: 500 11px Arial; color: #57534e;
  }
  .prim-family-head:hover { background: #f3f4f6; }

  /* Row wrapper carries the active-tab highlight + hosts the trash button
     beside the row's open button. Two siblings, can't be nested <button>s. */
  .prim-row-wrap {
    display: flex; align-items: stretch; position: relative;
  }
  .prim-row-wrap.active { background: #dbeafe; }
  .prim-row-wrap.active .prim-row { color: #1e40af; font-weight: 600; }
  .prim-row-wrap:hover .prim-trash { opacity: 0.85; }
  .prim-row {
    display: flex; align-items: center; gap: 8px; flex: 1 1 auto; min-width: 0;
    padding: 4px 12px 4px 22px; background: transparent; border: 0; cursor: pointer;
    text-align: left; font: 12px ui-monospace, monospace; color: #1f2937;
  }
  .prim-row.indent { padding-left: 32px; }
  .prim-row:hover { background: #e7e5e4; }
  /* Trash button — hidden by default, revealed on row hover. Hover the
     button itself amplifies + tints red. Disabled state for in-flight. */
  .prim-trash {
    flex: 0 0 auto;
    width: 24px; padding: 0; background: transparent; border: 0; cursor: pointer;
    font-size: 12px; color: #b91c1c; opacity: 0;
    transition: opacity 100ms, background 100ms;
  }
  .prim-trash:hover { opacity: 1 !important; background: #fee2e2; }
  .prim-trash:disabled { cursor: wait; opacity: 0.4 !important; }
  /* Permanent-delete variant for the Archived group — black outline
     icon, ALWAYS visible (not hover-revealed like the soft-delete
     trash). Conspicuous because this is the irreversible path; users
     should see they have a delete option without having to hover.
     Square box (24×24) keeps the icon centred + gives a clear hit
     target. Red wash + tinted icon stroke on hover/focus so the
     irreversibility reads on intent, not by default. */
  .prim-trash.perm {
    opacity: 1;
    width: 28px; height: 24px;
    display: inline-flex; align-items: center; justify-content: center;
    color: #111827;
    background: transparent;
    border: 1px solid #d1d5db; border-radius: 4px;
    margin: 2px 6px 2px 0;
  }
  .prim-trash.perm:hover {
    background: #fee2e2; color: #991b1b; border-color: #fca5a5;
  }
  .prim-trash.perm:focus-visible {
    outline: 2px solid #991b1b; outline-offset: 1px;
  }
  .prim-trash.perm svg { display: block; }
  .prim-name { flex: 1; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .prim-tag {
    font: 9px ui-monospace, monospace; padding: 1px 5px; border-radius: 3px;
    text-transform: lowercase;
  }
  .prim-tag.vol { background: #f5f5f4; color: #44403c; }
  .prim-tag.src { background: #dbeafe; color: #1e40af; }
  .prim-tag.stale { background: #fee2e2; color: #991b1b; }
  .prim-tag.arch { background: #f5f5f4; color: #78716c; }

  .prim-empty { padding: 12px; font: 11px Arial; color: #78716c; }
  .prim-error { padding: 12px; font: 11px Arial; color: #b91c1c; }

  /* ─── Divider ──────────────────────────────────────────────────────── */
  .prim-rail-divider {
    background: #e5e7eb; cursor: col-resize;
    transition: background 120ms;
  }
  .prim-rail-divider:hover { background: #cbd5e1; }

  /* ─── Tabbed main area ────────────────────────────────────────────── */
  .prim-main { display: flex; flex-direction: column; overflow: hidden; }
  .prim-empty-state {
    flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; color: #78716c; font: 13px Arial;
  }
  .prim-empty-state p { margin: 0; }
  .prim-tabs {
    display: flex; flex-wrap: nowrap; overflow-x: auto;
    border-bottom: 1px solid #e5e7eb; background: #f8fafc;
    padding: 4px 4px 0;
  }
  .prim-tab-wrap {
    display: flex; align-items: center; gap: 0;
    background: #fff; border: 1px solid #e5e7eb; border-bottom: 0;
    border-radius: 5px 5px 0 0; margin-right: 2px;
    padding: 0 6px 0 10px;
  }
  .prim-tab-wrap:hover { background: #f5f5f4; }
  .prim-tab-wrap.active {
    background: #fff;
    border-bottom: 1px solid #fff; margin-bottom: -1px;
  }
  .prim-tab-wrap.active .prim-tab { color: #0c4a6e; font-weight: 600; }
  .prim-tab {
    display: flex; align-items: center; padding: 6px 4px;
    background: transparent; border: 0; cursor: pointer;
    font: 12px ui-monospace, monospace; color: #44403c;
    white-space: nowrap;
  }
  .prim-tab-close {
    padding: 0 4px; background: transparent; border: 0;
    color: #78716c; cursor: pointer; font-size: 14px; line-height: 1; border-radius: 3px;
  }
  .prim-tab-close:hover { background: #fee2e2; color: #991b1b; }

  .prim-stage { flex: 1; position: relative; overflow: hidden; }
  /* Each tab's editor instance sits absolutely-positioned and stays mounted;
     only the active one toggles to display:block. Preserves graph state +
     bake cache + zoom across tab switches without iframe overhead. */
  .prim-pane {
    position: absolute; inset: 0; overflow: hidden;
    display: none;
  }
  .prim-pane.visible { display: block; }
</style>
