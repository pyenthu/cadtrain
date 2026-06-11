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

  /** Same regex the server uses for primitive ids — keep them in sync.
   *  Server: src/routes/api/primitives/rename/+server.ts ID_RE. */
  const ID_RE = /^[a-z][a-z0-9_]*$/i;

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

  /** Profile entries — `.prvl.ts` (revolve) and `.prex.ts` (extrude) files
   *  living under `<volume>/primitives/profiles/`. Loaded from a sister
   *  endpoint (the profile list is shaped differently from the primitive
   *  list — it carries `set: 'revolve' | 'cartesian'` + pre-built `points`).
   *  Surface as a top-level PROFILES group in the sidebar so the user can
   *  browse + open them as their own tabs (Phase 1 — placeholder editor
   *  for now; the 2D-mode graph editor for profiles is Phase 2). */
  interface ProfileEntry { id: string; set: 'revolve' | 'cartesian'; hasSource: boolean }
  let profiles: ProfileEntry[] = $state([]);

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

  // ─── Inline rename (#164) ─────────────────────────────────────────────────
  // Clicking ✎ on a row puts the row into rename mode: the .prim-name span
  // is swapped for an <input> prefilled with the current id (auto-selected,
  // autofocused). Enter commits via POST /api/primitives/rename?id=<old>&to=<new>;
  // Escape cancels. Validation mirrors the server regex so a typo doesn't
  // even bother the server (and we can show a red-tooltip hint inline).
  let renamingId = $state<string | null>(null);
  let renameValue = $state<string>('');
  let renameError = $state<string | null>(null);
  let renameBusy = $state<boolean>(false);

  // Toast pinned to the bottom-right of the rail surfaces broken-ref info
  // (#165). Shows up after a successful rename when scan-refs returns >0
  // affected files; user can click Repair all or Skip.
  let refToast = $state<null | {
    oldId: string;
    newId: string;
    affected: string[];
    repairing: boolean;
    note?: string;
  }>(null);

  function startRename(id: string, source: string) {
    if (source !== 'volume') return; // stdlib + stdstale + archived already excluded by caller
    renamingId = id;
    renameValue = id;
    renameError = null;
  }
  function cancelRename() {
    renamingId = null;
    renameValue = '';
    renameError = null;
  }
  /** Auto-focus + select the rename input the moment it mounts. Svelte
   *  `use:` action — runs once after the node enters the DOM. */
  function focusRenameInput(node: HTMLInputElement) {
    queueMicrotask(() => { node.focus(); node.select(); });
  }
  async function commitRename(oldId: string) {
    const newId = renameValue.trim();
    if (newId === oldId) { cancelRename(); return; }
    if (!ID_RE.test(newId)) {
      renameError = `bad id "${newId}" — must match [a-z][a-z0-9_]*`;
      return;
    }
    renameBusy = true;
    renameError = null;
    try {
      const r = await fetch(
        `/api/primitives/rename?id=${encodeURIComponent(oldId)}&to=${encodeURIComponent(newId)}`,
        { method: 'POST' },
      );
      if (!r.ok) {
        const t = await r.text();
        renameError = `rename failed (${r.status}): ${t.slice(0, 200)}`;
        return;
      }
      // Success — close any open tab for the old id (openTab will recreate
      // for the new one). Then refresh the sidebar list and open the new id.
      tabs = tabs.filter((t) => t.id !== oldId);
      if (tabs.length === 0) activeKey = null;
      persistTabs();
      renamingId = null;
      renameValue = '';
      await loadList();
      await openTab(newId);
      // Fire-and-forget the broken-refs scan. The rename endpoint already
      // returns its own `dependents` list, but scan-refs is the path the
      // user can REPAIR through (rewrite each dependent's `src:'<old>'` →
      // `src:'<new>'` and re-save) — do it via the dedicated endpoint so
      // both code paths stay testable independently.
      void scanRefs(oldId, newId);
    } catch (e: any) {
      renameError = `rename error: ${e?.message ?? e}`;
    } finally {
      renameBusy = false;
    }
  }

  // ─── Broken-refs scan (#165) ──────────────────────────────────────────────
  /** Ask the server for the list of primitives still referencing oldId.
   *  Surfaces a toast IF the list is non-empty. The server runs a regex
   *  walk of every <id>.{prim,asm,prvl,prex,rev,exp}.ts under primitives/
   *  and returns the affected ids (report-only by default). */
  async function scanRefs(oldId: string, newId: string) {
    try {
      const r = await fetch(
        `/api/rag/scan-refs?old=${encodeURIComponent(oldId)}&new=${encodeURIComponent(newId)}`,
        { method: 'POST' },
      );
      if (!r.ok) {
        // Quiet failure — the rename itself succeeded, just couldn't scan.
        // Surface only when something interesting comes back.
        return;
      }
      const j = await r.json() as { affected?: string[] };
      const affected = Array.isArray(j.affected) ? j.affected : [];
      if (affected.length === 0) return; // silent — nothing references the old id
      refToast = { oldId, newId, affected, repairing: false };
    } catch { /* ignore — see above */ }
  }
  async function repairAllRefs() {
    if (!refToast || refToast.repairing) return;
    refToast = { ...refToast, repairing: true };
    try {
      const r = await fetch(
        `/api/rag/scan-refs?old=${encodeURIComponent(refToast.oldId)}&new=${encodeURIComponent(refToast.newId)}&repair=1`,
        { method: 'POST' },
      );
      if (!r.ok) {
        const t = await r.text();
        refToast = { ...refToast, repairing: false, note: `repair failed (${r.status}): ${t.slice(0, 200)}` };
        return;
      }
      const j = await r.json() as { repaired?: string[] };
      const n = Array.isArray(j.repaired) ? j.repaired.length : 0;
      refToast = { ...refToast, repairing: false, note: `Repaired ${n} file${n === 1 ? '' : 's'}.` };
      await loadList();
      // Auto-dismiss 2.5s after a successful repair.
      setTimeout(() => { refToast = null; }, 2500);
    } catch (e: any) {
      if (refToast) refToast = { ...refToast, repairing: false, note: `repair error: ${e?.message ?? e}` };
    }
  }
  function dismissRefToast() { refToast = null; }

  async function loadList() {
    listLoading = true;
    listError = null;
    try {
      // Pull primitives + profiles in parallel — they hit different
      // endpoints + different on-volume directories, but the sidebar
      // shows them side-by-side and one shouldn't block the other.
      const [pr, pf] = await Promise.all([
        fetch('/api/primitives/list', { cache: 'no-store' }).then((r) => r.json() as any),
        fetch('/api/primitives/profiles/list', { cache: 'no-store' }).then((r) => r.json() as any).catch(() => ({ profiles: [] })),
      ]);
      basic     = Array.isArray(pr.basic)     ? pr.basic     : [];
      stdlib    = Array.isArray(pr.stdlib)    ? pr.stdlib    : [];
      stdstale  = Array.isArray(pr.stdstale)  ? pr.stdstale  : [];
      archived  = Array.isArray(pr.archived)  ? pr.archived  : [];
      completions = (pr.completions && typeof pr.completions === 'object') ? pr.completions : {};
      profiles  = Array.isArray(pf.profiles)
        ? pf.profiles.map((p: any) => ({ id: p.id, set: p.set, hasSource: !!p.hasSource }))
        : [];
    } catch (e: any) {
      listError = e?.message ?? String(e);
    } finally {
      listLoading = false;
    }
  }

  // ─── RAG corpus rebuild (Phase 1 — docs/plans/rag-prompt-builder.md) ─────
  // Tiny stateful chip: one ↻ button next to the filter input + a quiet
  // "last refreshed Xm ago" footnote underneath. POSTs /api/rag/rebuild;
  // reads /api/rag/stats on mount + after each rebuild. No new sidebar
  // section — minimal surface area until Phase 2 lands the prompt UI.
  let ragLastRebuiltAt = $state<string | null>(null);
  let ragCount = $state<number>(0);
  let ragBusy = $state<boolean>(false);
  let ragError = $state<string | null>(null);
  // Drives the "Xm ago" label without forcing a parent re-render.
  let ragNowTick = $state<number>(Date.now());

  async function loadRagStats() {
    try {
      const r = await fetch('/api/rag/stats', { cache: 'no-store' });
      if (!r.ok) return;
      const j = await r.json();
      ragLastRebuiltAt = typeof j?.lastRebuiltAt === 'string' ? j.lastRebuiltAt : null;
      ragCount = typeof j?.count === 'number' ? j.count : 0;
    } catch { /* keep prior state silently */ }
  }

  async function rebuildRag() {
    if (ragBusy) return;
    ragBusy = true;
    ragError = null;
    try {
      const r = await fetch('/api/rag/rebuild', { method: 'POST' });
      if (!r.ok) {
        const t = await r.text();
        ragError = `rebuild failed (${r.status}): ${t.slice(0, 200)}`;
        return;
      }
      const j = await r.json();
      ragCount = typeof j?.count === 'number' ? j.count : ragCount;
      // Authoritative timestamp comes from the next stats read — the
      // file mtime is what the label is based on, so the two stay in
      // sync regardless of client clock skew.
      await loadRagStats();
    } catch (e: any) {
      ragError = e?.message ?? String(e);
    } finally {
      ragBusy = false;
    }
  }

  /** Format an ISO timestamp as a short "Xm ago" / "Xh ago" / "Xd ago"
   *  string. Re-reads `ragNowTick` so it ticks live. */
  function formatAgo(iso: string | null, now: number): string {
    if (!iso) return 'never refreshed';
    const t = Date.parse(iso);
    if (!Number.isFinite(t)) return 'never refreshed';
    const sec = Math.max(0, Math.floor((now - t) / 1000));
    if (sec < 5) return 'refreshed just now';
    if (sec < 60) return `refreshed ${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `refreshed ${min}m ago`;
    const hr = Math.floor(min / 60);
    if (hr < 24) return `refreshed ${hr}h ago`;
    const day = Math.floor(hr / 24);
    return `refreshed ${day}d ago`;
  }

  let ragLabel = $derived(formatAgo(ragLastRebuiltAt, ragNowTick));

  // Search filter — narrows EVERY group in place. Empty = no filter.
  let filter = $state('');
  function pass(e: Entry): boolean {
    const q = filter.trim().toLowerCase();
    if (!q) return true;
    return e.id.toLowerCase().includes(q);
  }

  // Sort toggle (#163) — one global preference, applied across every group.
  // 'default' keeps the insertion order from /api/primitives/list (which is
  // already the on-disk readdir order); 'alpha' sorts each group A→Z by id.
  // Persisted to localStorage so a refresh keeps the user's choice. The
  // sorted views are $derived (not mutating the source arrays) so toggling
  // back to 'default' doesn't require a re-fetch.
  let sortMode = $state<'default' | 'alpha'>('default');
  const sortBy = (xs: Entry[]) =>
    sortMode === 'alpha' ? [...xs].sort((a, b) => a.id.localeCompare(b.id)) : xs;
  let basicSorted     = $derived(sortBy(basic));
  let stdlibSorted    = $derived(sortBy(stdlib));
  let stdstaleSorted  = $derived(sortBy(stdstale));
  let archivedSorted  = $derived(sortBy(archived));
  // For completions, sort the entries inside each family but leave the
  // family-name order unchanged (families come back from /list in a deliberate
  // order and shouldn't get re-shuffled). Object.entries() iteration order is
  // the insertion order of the keys.
  let completionsSorted = $derived(
    Object.fromEntries(Object.entries(completions).map(([fam, items]) => [fam, sortBy(items)]))
  );
  function toggleSortMode() {
    sortMode = sortMode === 'alpha' ? 'default' : 'alpha';
    try { localStorage.setItem('prim-sidebar-sort', sortMode); } catch { /* ignore */ }
  }
  // Expand/collapse per group. Persisted to localStorage.
  let openGroups = $state<Record<string, boolean>>({
    profiles: true, basic: true, stdlib: true, stdstale: false, completions: true, archived: false,
  });
  let openFamilies = $state<Record<string, boolean>>({});
  onMount(() => {
    try {
      const og = localStorage.getItem('prim-open-groups');
      if (og) openGroups = { ...openGroups, ...JSON.parse(og) };
      const of = localStorage.getItem('prim-open-families');
      if (of) openFamilies = JSON.parse(of);
      const sm = localStorage.getItem('prim-sidebar-sort');
      if (sm === 'alpha' || sm === 'default') sortMode = sm;
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

  /** Create a new entry by opening a fresh tab with the typed id. The
   *  file isn't written until the user clicks Save inside the editor —
   *  fetching /source for an id that doesn't exist 404s, GraphEditorPane
   *  treats that as a fresh graph + lets the first save create the file. */
  function createNewEntry() {
    const prompt = typeof window !== 'undefined' ? window.prompt : null;
    if (!prompt) return;
    const raw = prompt('new entry id (lowercase, _ allowed)', '');
    if (!raw) return;
    const id = raw.trim();
    if (!ID_RE.test(id)) { alert(`bad id "${id}" — must match [a-z][a-z0-9_]*`); return; }
    void openTab(id);
  }

  // ─── Tab strip ────────────────────────────────────────────────────────────
  /** UNIFIED tab — every tab mounts the same GraphEditorPane. The graph's
   *  output type (polygon vs manifold) decides what gets rendered in the
   *  right pane. No mode flag. */
  interface Tab {
    id: string;
    key: number;
    /** RAG Phase 2 — an AI-generated graph for a part that doesn't exist
     *  on the volume yet. The pane hydrates this instead of fetching by
     *  id; the user's first Save creates the file. Seeded tabs are NOT
     *  persisted across reloads (nothing on disk to restore from). */
    seedGraph?: any;
  }
  let tabs: Tab[] = $state([]);
  let activeKey: number | null = $state(null);
  let nextKey = 1;

  /** Open `id` in a tab — activates the existing tab if one is already
   *  open, otherwise creates a new one. Tabs stay loaded in the background
   *  until closed (graph state + bake cache + zoom survive switches). */
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
  /** Open an AI-generated graph in a fresh tab. The suggested id is
   *  de-duped against already-open tabs so two generations with the same
   *  suggestion don't collide (the volume itself is untouched until the
   *  user saves). */
  function openGeneratedTab(id: string, seedGraph: any) {
    let unique = id;
    let n = 2;
    while (tabs.some((t) => t.id === unique)) unique = `${id}_${n++}`;
    const key = nextKey++;
    tabs = [...tabs, { id: unique, key, seedGraph }];
    activeKey = key;
  }
  function activate(key: number) { activeKey = key; }
  function persistTabs() {
    try {
      localStorage.setItem('prim-open-tabs', JSON.stringify(tabs.filter((t) => !t.seedGraph).map((t) => t.id)));
      const act = activeKey != null ? tabs.find((t) => t.key === activeKey) : null;
      localStorage.setItem('prim-active-tab-id', act ? act.id : '');
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
    // New format: `id|kind` per entry; legacy entries (no `|`) default to
    // 'part' so old saves keep working.
    try {
      const saved = JSON.parse(localStorage.getItem('prim-open-tabs') ?? '[]') as string[];
      const activeRef = localStorage.getItem('prim-active-tab-id') ?? '';
      for (const ref of saved) {
        // Back-compat: old `id|kind` entries split to drop the kind half.
        const id = ref.includes('|') ? ref.split('|')[0] : ref;
        const key = nextKey++;
        tabs = [...tabs, { id, key }];
        if (ref === activeRef || id === activeRef) activeKey = key;
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
    // RAG stats (Phase 1 — docs/plans/rag-prompt-builder.md). One-shot
    // read for the "last refreshed Xm ago" label + a minute-cadence
    // re-tick so the label updates while the page sits open.
    void loadRagStats();
    const tickId = setInterval(() => { ragNowTick = Date.now(); }, 60_000);
    return () => clearInterval(tickId);
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
    <div class="prim-filter-row">
      <input class="prim-filter" type="text" placeholder="filter…" bind:value={filter}/>
      <!-- A↓ sort toggle (#163) — flips every group between insertion order
           (the readdir order from /api/primitives/list) and alphabetical
           A→Z by id. One global mode covers Basic + completions + stdlib +
           stdstale + Archived; family names inside Completions stay in
           their original order (only entries inside each family re-sort).
           Active state mirrors the .prim-rag-rebuild:hover styling so the
           "currently sorted alpha" cue is unambiguous. -->
      <button class="prim-rag-rebuild"
        class:active={sortMode === 'alpha'}
        type="button"
        title={sortMode === 'alpha' ? 'Sorted A→Z — click to restore insertion order' : 'Sort all groups A→Z'}
        onclick={toggleSortMode}>A↓</button>
      <!-- RAG corpus rebuild — Phase 1 of docs/plans/rag-prompt-builder.md.
           POSTs /api/rag/rebuild → walks primitives/ → writes ai/rag/parts.jsonl.
           Phase 2 will turn this corpus into a prompt-driven part suggester. -->
      <button class="prim-rag-rebuild"
        type="button"
        title={ragBusy ? 'Rebuilding RAG corpus…' : `Rebuild RAG corpus (${ragCount} parts, ${ragLabel})`}
        disabled={ragBusy}
        onclick={rebuildRag}>{ragBusy ? '…' : '↻'}</button>
    </div>
    <!-- The ✨ AI generate flow lives on the graph editor's vertical rail
         (GraphEditorPane, via the onGenerated prop) — instructions +
         prompt are in its popover, not a sidebar row. -->
    <div class="prim-rag-foot" title={ragError ?? `${ragCount} parts`}>
      {#if ragError}
        <span class="prim-rag-err">rebuild failed — hover for detail</span>
      {:else}
        RAG corpus · {ragCount} parts · {ragLabel}
      {/if}
    </div>

    <!-- Everything below the header + filter scrolls inside this wrapper.
         The rail itself stays anchored — title stays put, filter stays
         visible while the groups scroll past underneath. -->
    <div class="prim-rail-scroll">

    {#if listLoading}<div class="prim-empty">loading…</div>{/if}
    {#if listError}<div class="prim-error">list failed: {listError}</div>{/if}

    <!-- PROFILES section removed in the K.72 unify — every saved file
         is now .prim.ts in basic/. Existing .prvl.ts / .prex.ts files
         were archived; the volume's primitives/profiles/ directory is
         dormant. Recreate any needed profiles via Basic's + new. -->

    <!-- Basic — `<volume>/primitives/basic/*.{prim,asm}.ts`. -->
    <div class="prim-group">
      <div class="prim-group-row">
        <button class="prim-group-head" type="button" onclick={() => toggleGroup('basic')}>
          <span class="prim-caret">{openGroups.basic ? '▾' : '▸'}</span>
          Basic <span class="prim-count">({basicSorted.filter(pass).length})</span>
        </button>
        <button class="prim-group-new" type="button"
          title="Create a new graph — opens a fresh tab; first save creates the .prim.ts file in basic/"
          onclick={(ev) => { ev.stopPropagation(); createNewEntry(); }}>+</button>
      </div>
      {#if openGroups.basic}
        {#each basicSorted.filter(pass) as e (e.id)}
          <div class="prim-row-wrap" class:active={tabs.some((t) => t.id === e.id)} class:renaming={renamingId === e.id}>
            {#if renamingId === e.id}
              <!-- Rename mode (#164): the row body becomes an input prefilled
                   with the current id. Enter commits, Escape cancels, blur
                   cancels too (avoid stranded inputs from accidental clicks
                   elsewhere). Errors land in a tooltip-style chip beneath. -->
              <div class="prim-row prim-row-rename">
                <input class="prim-rename-input" type="text" use:focusRenameInput
                  bind:value={renameValue}
                  disabled={renameBusy}
                  onkeydown={(ev) => {
                    if (ev.key === 'Enter') { ev.preventDefault(); void commitRename(e.id); }
                    else if (ev.key === 'Escape') { ev.preventDefault(); cancelRename(); }
                  }}
                  onblur={() => { if (!renameError && !renameBusy) cancelRename(); }} />
                {#if renameError}<span class="prim-rename-err" title={renameError}>{renameError}</span>{/if}
              </div>
            {:else}
              <button class="prim-row" type="button"
                draggable="true"
                ondragstart={(ev) => {
                  if (ev.dataTransfer) {
                    ev.dataTransfer.setData('application/x-cadtrain-prim', e.id);
                    ev.dataTransfer.effectAllowed = 'copy';
                  }
                }}
                onclick={() => openTab(e.id)}>
                <span class="prim-name">{e.id}</span>
                <span class="prim-tag vol">vol</span>
              </button>
              {#if e.source === 'volume'}
                <button class="prim-rename" type="button"
                  title="Rename — type a new id, Enter to commit"
                  aria-label="Rename {e.id}"
                  onclick={() => startRename(e.id, e.source)}>✎</button>
                <button class="prim-trash" type="button"
                  title="Archive — soft delete (recoverable from primitives/archive/)"
                  disabled={deleteBusy === e.id}
                  onclick={() => deletePrim(e.id, e.source)}>{deleteBusy === e.id ? '…' : '🗑'}</button>
              {/if}
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
        {#each Object.entries(completionsSorted) as [fam, items] (fam)}
          {@const filtered = items.filter(pass)}
          {#if filtered.length > 0 || !filter.trim()}
            <button class="prim-family-head" type="button" onclick={() => toggleFamily(fam)}>
              <span class="prim-caret">{openFamilies[fam] ? '▾' : '▸'}</span>
              {fam} <span class="prim-count">({filtered.length})</span>
            </button>
            {#if openFamilies[fam]}
              {#each filtered as e (e.id)}
                <div class="prim-row-wrap indent" class:active={tabs.some((t) => t.id === e.id)} class:renaming={renamingId === e.id}>
                  {#if renamingId === e.id}
                    <div class="prim-row indent prim-row-rename">
                      <input class="prim-rename-input" type="text" use:focusRenameInput
                        bind:value={renameValue}
                        disabled={renameBusy}
                        onkeydown={(ev) => {
                          if (ev.key === 'Enter') { ev.preventDefault(); void commitRename(e.id); }
                          else if (ev.key === 'Escape') { ev.preventDefault(); cancelRename(); }
                        }}
                        onblur={() => { if (!renameError && !renameBusy) cancelRename(); }} />
                      {#if renameError}<span class="prim-rename-err" title={renameError}>{renameError}</span>{/if}
                    </div>
                  {:else}
                    <button class="prim-row indent" type="button"
                      draggable="true"
                      ondragstart={(ev) => {
                        if (ev.dataTransfer) {
                          ev.dataTransfer.setData('application/x-cadtrain-prim', e.id);
                          ev.dataTransfer.effectAllowed = 'copy';
                        }
                      }}
                      onclick={() => openTab(e.id)}>
                      <span class="prim-name">{e.id}</span>
                      <span class="prim-tag vol">vol</span>
                    </button>
                    {#if e.source === 'volume'}
                      <button class="prim-rename" type="button"
                        title="Rename — type a new id, Enter to commit"
                        aria-label="Rename {e.id}"
                        onclick={() => startRename(e.id, e.source)}>✎</button>
                      <button class="prim-trash" type="button"
                        title="Archive — soft delete (recoverable from primitives/archive/)"
                        disabled={deleteBusy === e.id}
                        onclick={() => deletePrim(e.id, e.source)}>{deleteBusy === e.id ? '…' : '🗑'}</button>
                    {/if}
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
        stdlib <span class="prim-count">({stdlibSorted.filter(pass).length})</span>
      </button>
      {#if openGroups.stdlib}
        {#each stdlibSorted.filter(pass) as e (e.id)}
          <div class="prim-row-wrap" class:active={tabs.some((t) => t.id === e.id)}>
            <button class="prim-row" type="button"
              draggable="true"
              ondragstart={(ev) => {
                if (ev.dataTransfer) {
                  ev.dataTransfer.setData('application/x-cadtrain-prim', e.id);
                  ev.dataTransfer.effectAllowed = 'copy';
                }
              }}
              onclick={() => openTab(e.id)}>
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
        stdstale <span class="prim-count">({stdstaleSorted.filter(pass).length})</span>
      </button>
      {#if openGroups.stdstale}
        {#each stdstaleSorted.filter(pass) as e (e.id)}
          <div class="prim-row-wrap" class:active={tabs.some((t) => t.id === e.id)}>
            <button class="prim-row" type="button"
              draggable="true"
              ondragstart={(ev) => {
                if (ev.dataTransfer) {
                  ev.dataTransfer.setData('application/x-cadtrain-prim', e.id);
                  ev.dataTransfer.effectAllowed = 'copy';
                }
              }}
              onclick={() => openTab(e.id)}>
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
        Archived <span class="prim-count">({archivedSorted.filter(pass).length})</span>
      </button>
      {#if openGroups.archived}
        {#each archivedSorted.filter(pass) as e (e.id)}
          <div class="prim-row-wrap" class:active={tabs.some((t) => t.id === e.id)}>
            <button class="prim-row" type="button"
              draggable="true"
              ondragstart={(ev) => {
                if (ev.dataTransfer) {
                  ev.dataTransfer.setData('application/x-cadtrain-prim', e.id);
                  ev.dataTransfer.effectAllowed = 'copy';
                }
              }}
              onclick={() => openTab(e.id)}>
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

    <!-- Broken-refs toast (#165) — surfaced when a rename leaves OTHER
         primitives' meta.graph still pointing at the old id. Lets the user
         repair-all (rewrite each dependent file's `src:'<old>'` →
         `src:'<new>'` and re-save) or dismiss. Pinned to the bottom of the
         rail, not the viewport, so it disappears with the surface it
         belongs to. -->
    {#if refToast}
      <div class="prim-ref-toast" role="status" aria-live="polite">
        <div>
          <strong>{refToast.affected.length}</strong>
          part{refToast.affected.length === 1 ? '' : 's'} reference
          <code>{refToast.oldId}</code>.
        </div>
        {#if refToast.note}
          <div class="prim-ref-toast-note">{refToast.note}</div>
        {/if}
        <div class="prim-ref-toast-actions">
          <button type="button"
            disabled={refToast.repairing}
            onclick={repairAllRefs}>
            {refToast.repairing ? 'Repairing…' : 'Repair all'}
          </button>
          <button type="button" class="skip"
            onclick={dismissRefToast}>Skip</button>
        </div>
      </div>
    {/if}
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
            <!-- One unified graph editor — output type (polygon vs
                 manifold) decides the right-pane render. No more
                 part/profile mode flag. -->
            <!-- active gates the 3D canvas: only the visible tab holds a
                 WebGL context (browser cap ~16). Inactive tabs keep all
                 editor state mounted; their canvas remounts on activate. -->
            <GraphEditorPane id={t.id} embed={true} onOpenTab={openTab} active={activeKey === t.key} seedGraph={t.seedGraph}
              onGenerated={(id, graph) => openGeneratedTab(id, graph)} />
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
    /* position:relative so the broken-refs toast (#165) can anchor to
       the rail rather than the viewport. */
    position: relative;
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
  /* Filter input + RAG rebuild button share a single row. The input
     stretches; the ↻ button is a fixed-width chip on the right. */
  .prim-filter-row {
    display: flex; align-items: center; gap: 6px;
    margin: 6px 12px 0;
  }
  .prim-filter {
    flex: 1 1 auto; min-width: 0;
    padding: 4px 10px; font: 12px ui-monospace, monospace;
    border: 1px solid #d6d3d1; border-radius: 4px;
  }
  /* ↻ rebuild button — same vertical height as the filter input, square,
     muted so it doesn't compete with the filter. Hover hits a darker bg
     + the cadtrain accent colour. Spinning when busy. */
  .prim-rag-rebuild {
    flex: 0 0 auto;
    width: 26px; height: 26px;
    padding: 0; line-height: 1;
    background: #f3f4f6; border: 1px solid #d6d3d1; border-radius: 4px;
    color: #44403c; font: 14px Arial; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center;
    transition: background 100ms, color 100ms, border-color 100ms;
  }
  .prim-rag-rebuild:hover:not(:disabled) {
    background: #e0f2fe; border-color: #7dd3fc; color: #0369a1;
  }
  /* Sort toggle (#163): "currently sorted A→Z" reads as a steady accent —
     same palette as :hover so the button doesn't have to fight for a
     second colour, just locks in the hover look while the mode is on. */
  .prim-rag-rebuild.active {
    background: #e0f2fe; border-color: #7dd3fc; color: #0369a1;
    font-weight: 600;
  }
  .prim-rag-rebuild:disabled { cursor: wait; color: #a8a29e; }
  /* Quiet footnote under the filter row — count + last refreshed Xm ago.
     Pulls the eye only when something's wrong (error state goes red). */
  .prim-rag-foot {
    margin: 2px 14px 6px;
    font: 10px Arial; color: #78716c;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .prim-rag-err { color: #b91c1c; }

  .prim-group { padding: 4px 0; border-bottom: 1px solid #f3f4f6; }
  /* Row wrapping the group toggle + the trailing + button so they share
     a single hover region without nesting buttons. */
  .prim-group-row { display: flex; align-items: stretch; }
  .prim-group-row:hover .prim-group-head,
  .prim-group-row:hover .prim-group-new { background: #f3f4f6; }
  .prim-group-head {
    display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0;
    padding: 6px 12px; background: transparent; border: 0; cursor: pointer;
    text-align: left; font: 600 11px Arial; color: #44403c;
    text-transform: uppercase; letter-spacing: 0.5px;
  }
  /* + new entry button — hover-revealed at the right edge of the group row.
     Click opens a name prompt + a fresh tab. The file is created on the
     editor's first Save, so there's no risk of dangling empty files. */
  .prim-group-new {
    width: 28px; padding: 0; background: transparent; border: 0;
    color: #15803d; cursor: pointer;
    font: 600 16px Arial; line-height: 1;
    opacity: 0; transition: opacity 100ms;
    display: flex; align-items: center; justify-content: center;
  }
  .prim-group-row:hover .prim-group-new { opacity: 0.85; }
  .prim-group-new:hover { opacity: 1 !important; background: #d1fae5; color: #166534; }
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
  /* Drag-to-canvas affordance (#161, 2026-06-11) — cursor:grab on hover
     hints the row is draggable; grabbing during the drag. Visual cue
     so users discover the feature. */
  .prim-row[draggable="true"] { cursor: grab; }
  .prim-row[draggable="true"]:active { cursor: grabbing; }
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
  /* Rename button (#164) — same hidden-by-default-then-hover-revealed
     pattern as .prim-trash, but blue tinted so it reads as "edit" rather
     than "delete". Sits LEFT of the trash so the rename pencil is the
     first row-action a user reaches; the trash stays at the end of the
     row where its destructive intent is the visual stop. */
  .prim-row-wrap:hover .prim-rename { opacity: 0.85; }
  .prim-rename {
    flex: 0 0 auto;
    width: 22px; padding: 0; background: transparent; border: 0; cursor: pointer;
    font-size: 13px; color: #2563eb; opacity: 0;
    transition: opacity 100ms, background 100ms;
  }
  .prim-rename:hover { opacity: 1 !important; background: #dbeafe; }
  /* Renaming row: the inline input replaces the .prim-row button entirely.
     Use display:flex so the input stretches and the error chip can sit
     to its right. The whole row stays the same height as a static row so
     the sidebar doesn't reflow while the user types. */
  .prim-row-wrap.renaming { background: #eff6ff; }
  .prim-row-rename {
    display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0;
    padding: 2px 12px 2px 22px; cursor: text;
  }
  .prim-row.indent.prim-row-rename { padding-left: 32px; }
  .prim-rename-input {
    flex: 1 1 auto; min-width: 0;
    padding: 2px 6px; font: 12px ui-monospace, monospace;
    border: 1px solid #3b82f6; border-radius: 3px;
    background: #fff; color: #1e3a8a;
    outline: none;
  }
  .prim-rename-input:focus { box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25); }
  /* Validation error chip — flat red text, hover for the full message in
     a native tooltip. Lives inside the row so it doesn't trigger a
     layout shift. */
  .prim-rename-err {
    flex: 0 0 auto;
    font: 10px Arial; color: #b91c1c;
    max-width: 12em; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  /* Broken-refs toast (#165) — pinned bottom-right of the rail, slides in
     after a rename that affected dependents. Two states: report (default,
     with [Repair all] [Skip]) and repairing (busy spinner). */
  .prim-ref-toast {
    position: absolute; bottom: 12px; left: 12px; right: 12px;
    background: #1e293b; color: #f8fafc;
    border-radius: 6px; padding: 8px 10px;
    font: 11px Arial; line-height: 1.4;
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.25);
    z-index: 10;
  }
  .prim-ref-toast strong { color: #fde68a; font-weight: 600; }
  .prim-ref-toast code {
    font: 10px ui-monospace, monospace; background: rgba(248, 250, 252, 0.1);
    padding: 1px 4px; border-radius: 3px;
  }
  .prim-ref-toast-actions {
    display: flex; gap: 6px; margin-top: 6px;
  }
  .prim-ref-toast button {
    padding: 3px 10px; font: 11px Arial; cursor: pointer;
    background: #f8fafc; color: #1e293b; border: 0; border-radius: 3px;
  }
  .prim-ref-toast button.skip { background: transparent; color: #cbd5e1; border: 1px solid #475569; }
  .prim-ref-toast button:hover { background: #fde68a; color: #1e293b; }
  .prim-ref-toast button.skip:hover { background: rgba(248, 250, 252, 0.1); color: #f8fafc; }
  .prim-ref-toast button:disabled { cursor: wait; opacity: 0.6; }
  .prim-ref-toast-note { margin-top: 4px; color: #cbd5e1; font-size: 10px; }
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
  /* PROFILES tag — amber to differentiate from .vol/.src; matches the
     ProfilePane head badge so the tab title carries the same colour. */
  .prim-tag.prof { background: #fef3c7; color: #92400e; }
  /* Static sub-header (revolve / extrude inside PROFILES) — not clickable. */
  .prim-family-head.static { cursor: default; }
  .prim-family-head.static:hover { background: transparent; }

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
  /* Inactive tabs: dimmed grey-on-grey so the active tab pops by contrast. */
  .prim-tab-wrap {
    display: flex; align-items: center; gap: 0;
    background: #e7e5e4; border: 1px solid #d6d3d1; border-bottom: 0;
    border-radius: 5px 5px 0 0; margin-right: 2px;
    padding: 0 6px 0 10px;
    transition: background 120ms;
  }
  .prim-tab-wrap:hover { background: #f5f5f4; }
  /* Active tab: INVERTED — dark slate background, white text. Stands out
     against the grey unselected tabs even with 8+ open. The bottom border
     overrides the strip's divider so the active tab visually "merges" with
     the editor pane below it. */
  .prim-tab-wrap.active {
    background: #0c4a6e;
    border-color: #0c4a6e;
    border-bottom: 1px solid #0c4a6e; margin-bottom: -1px;
    box-shadow: 0 -1px 2px rgba(12, 74, 110, 0.18);
  }
  .prim-tab-wrap.active .prim-tab { color: #fff; font-weight: 600; }
  .prim-tab-wrap.active .prim-tab-close { color: rgba(255, 255, 255, 0.7); }
  .prim-tab-wrap.active .prim-tab-close:hover { background: rgba(255, 255, 255, 0.15); color: #fff; }
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
