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

  // ─── Folder tree (vertical-tab sidebar) ───────────────────────────────────
  /** A directory under primitives/. The sidebar's top-level tabs are the
   *  tree root's children (each a volume folder); nested dirs are navigable
   *  subfolders. Sourced from /api/primitives/list `tree` so it always
   *  mirrors the on-volume dirs incl. user-created ones (Rule 16). */
  interface FolderNode { name: string; path: string; parts: Entry[]; children: FolderNode[]; }
  let tree = $state<FolderNode | null>(null);
  let topFolders = $derived(tree?.children ?? []);
  /** Active top-level tab: a volume folder name OR a fixed src group
   *  ('stdlib' | 'stdstale'). */
  let activeTab = $state<string>('basic');
  /** Current navigation path within the active VOLUME tab — relative to
   *  primitives/, always rooted at the tab name (e.g. 'completions/drill_pipe'). */
  let navPath = $state<string>('basic');
  /** Remember the last subfolder visited per tab so switching away + back
   *  returns to where you were (in-memory; only activeTab/navPath persist). */
  let navByTab: Record<string, string> = {};
  let isSrcTab = $derived(activeTab === 'stdlib' || activeTab === 'stdstale');
  let isArchiveTab = $derived(activeTab === 'archive');

  function tabLabel(name: string): string {
    if (name === 'archive') return 'Archived';
    if (name === 'stdlib' || name === 'stdstale') return name;
    return name.charAt(0).toUpperCase() + name.slice(1);
  }
  /** Walk the tree to the node at a relative path ('' → root, else by name). */
  function nodeAt(path: string): FolderNode | null {
    if (!tree) return null;
    if (!path) return tree;
    let n: FolderNode = tree;
    for (const seg of path.split('/')) {
      const c = n.children.find((x) => x.name === seg);
      if (!c) return null;
      n = c;
    }
    return n;
  }
  let currentNode = $derived(nodeAt(navPath));
  /** Breadcrumb segments for navPath, each with its cumulative path. */
  let crumbs = $derived(
    navPath
      ? navPath.split('/').map((seg, i, arr) => ({ seg, path: arr.slice(0, i + 1).join('/') }))
      : [],
  );

  function persistNav() {
    try {
      localStorage.setItem('prim-active-tab', activeTab);
      localStorage.setItem('prim-nav-path', navPath);
    } catch { /* ignore */ }
  }
  function selectTab(name: string) {
    activeTab = name;
    navPath = (name === 'stdlib' || name === 'stdstale') ? name : (navByTab[name] ?? name);
    persistNav();
  }
  function descend(path: string) {
    navPath = path;
    navByTab[activeTab] = path;
    persistNav();
  }

  // ─── Create folder (folder-tab + nested subfolder) ────────────────────────
  let folderBusy = $state(false);
  async function mkFolder(path: string): Promise<boolean> {
    folderBusy = true;
    try {
      const r = await fetch(`/api/primitives/mkdir?path=${encodeURIComponent(path)}`, { method: 'POST' });
      if (!r.ok) {
        if (typeof alert === 'function') alert(`Create folder failed (${r.status}): ${(await r.text()).slice(0, 160)}`);
        return false;
      }
      await loadList();
      return true;
    } catch (e: any) {
      if (typeof alert === 'function') alert(`Create folder error: ${e?.message ?? e}`);
      return false;
    } finally {
      folderBusy = false;
    }
  }
  async function addTopFolder() {
    const raw = typeof window !== 'undefined' ? window.prompt?.('New folder-tab name (lowercase, _ allowed)', '') : null;
    if (!raw) return;
    const name = raw.trim();
    if (!ID_RE.test(name)) { alert(`bad name "${name}" — must match [a-z][a-z0-9_]*`); return; }
    if (await mkFolder(name)) selectTab(name);
  }
  async function addSubfolder() {
    if (isSrcTab) return;
    const raw = typeof window !== 'undefined' ? window.prompt?.('New subfolder name (lowercase, _ allowed)', '') : null;
    if (!raw) return;
    const name = raw.trim();
    if (!ID_RE.test(name)) { alert(`bad name "${name}" — must match [a-z][a-z0-9_]*`); return; }
    const path = `${navPath}/${name}`;
    if (path.split('/').length > 3) { alert('Max folder depth is 3 (cat / family / subfolder)'); return; }
    if (await mkFolder(path)) descend(path);
  }

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

  /** Build a FolderNode tree from the legacy flat groups (fallback when the
   *  proxied /list has no recursive `tree` — old prod). */
  function legacyTree(pr: any): FolderNode {
    const n = (name: string, path: string, parts: any[], children: FolderNode[]): FolderNode =>
      ({ name, path, parts: parts ?? [], children: children ?? [] });
    const children: FolderNode[] = [];
    const basicSubs: FolderNode[] = (Array.isArray(pr.basicSubfolders) ? pr.basicSubfolders : [])
      .map((s: string) => n(s, `basic/${s}`, [], []));
    children.push(n('basic', 'basic', Array.isArray(pr.basic) ? pr.basic : [], basicSubs));
    const comp = (pr.completions && typeof pr.completions === 'object') ? pr.completions : {};
    const compSubs = (pr.completionSubfolders && typeof pr.completionSubfolders === 'object') ? pr.completionSubfolders : {};
    const compChildren: FolderNode[] = Object.entries(comp).map(([fam, parts]: [string, any]) =>
      n(fam, `completions/${fam}`, Array.isArray(parts) ? parts : [],
        (Array.isArray(compSubs[fam]) ? compSubs[fam] : []).map((s: string) => n(s, `completions/${fam}/${s}`, [], []))));
    children.push(n('completions', 'completions', [], compChildren));
    children.push(n('archive', 'archive', Array.isArray(pr.archived) ? pr.archived : [], []));
    return n('', '', [], children);
  }
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
      // Prefer the server's recursive `tree` (new /list). When it's absent —
      // e.g. the list is PROXIED to a prod that hasn't redeployed the tree
      // endpoint yet (Rule 13) — rebuild an equivalent tree from the legacy
      // flat groups so the folder-tabs populate against real prod data instead
      // of showing empty (completions families carry their parts; deeper
      // subfolders fill in once prod serves the real tree).
      tree = (pr.tree && typeof pr.tree === 'object' && Array.isArray(pr.tree.children) && pr.tree.children.length)
        ? pr.tree
        : legacyTree(pr);
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
    const raw = prompt(`new part id in ${navPath}/ (lowercase, _ allowed)`, '');
    if (!raw) return;
    const id = raw.trim();
    if (!ID_RE.test(id)) { alert(`bad id "${id}" — must match [a-z][a-z0-9_]*`); return; }
    // First Save lands the .prim.ts in the active folder-tab / subfolder
    // (location IS category, Rule 16). The pane carries `createDir`.
    void openTab(id, navPath);
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
    /** Target folder for a brand-new part's first Save (the folder-tab the
     *  user created it from). Undefined for parts opened from the list. */
    createDir?: string;
  }
  let tabs: Tab[] = $state([]);
  let activeKey: number | null = $state(null);
  let nextKey = 1;

  /** Open `id` in a tab — activates the existing tab if one is already
   *  open, otherwise creates a new one. Tabs stay loaded in the background
   *  until closed (graph state + bake cache + zoom survive switches). */
  async function openTab(id: string, createDir?: string) {
    const existing = tabs.find((t) => t.id === id);
    if (existing) { activeKey = existing.key; return; }
    const key = nextKey++;
    tabs = [...tabs, { id, key, createDir }];
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
   *  user saves). Retained for the empty-canvas / future "open as new"
   *  path; the in-editor ✨ now generates into the CURRENT tab instead. */
  function openGeneratedTab(id: string, seedGraph: any) {
    let unique = id;
    let n = 2;
    while (tabs.some((t) => t.id === unique)) unique = `${id}_${n++}`;
    const key = nextKey++;
    tabs = [...tabs, { id: unique, key, seedGraph }];
    activeKey = key;
  }
  /** In-place AI generation (2026-06-12) — the pane already hydrated the
   *  proposed graph into the ACTIVE tab; this just relabels that tab to
   *  the suggested id. props.id only seeds the pane on mount, so changing
   *  it here is a safe relabel (no remount, no refetch). */
  function renameActiveTab(id: string) {
    if (activeKey == null || !id) return;
    tabs = tabs.map((t) => (t.key === activeKey ? { ...t, id } : t));
    persistTabs();
  }
  function activate(key: number) { activeKey = key; }
  function persistTabs() {
    try {
      localStorage.setItem('prim-open-tabs', JSON.stringify(tabs.filter((t) => !t.seedGraph).map((t) => t.id)));
      const act = activeKey != null ? tabs.find((t) => t.key === activeKey) : null;
      localStorage.setItem('prim-active-tab-id', act ? act.id : '');
    } catch { /* ignore */ }
  }

  // ─── Rail width (drag-resizable) + collapse ──────────────────────────────
  let railWidth = $state(240);
  // Sidebar collapse — available on ALL viewports (persisted). When true the
  // rail column collapses to 0 and a floating ☰ expand button appears.
  let sidebarCollapsed = $state(false);
  try { sidebarCollapsed = localStorage.getItem('prim-rail-collapsed') === '1'; } catch { /* SSR/off */ }
  // Touch devices: `draggable=true` on the row buttons can swallow the TAP
  // (the drag system intercepts it) so a part never opens. Disable drag on
  // coarse pointers — tap-to-open then works; drag-to-canvas stays on desktop.
  let isCoarsePointer = $state(false);
  try { isCoarsePointer = window.matchMedia('(pointer: coarse)').matches; } catch { /* SSR/off */ }
  function toggleSidebar() {
    sidebarCollapsed = !sidebarCollapsed;
    try { localStorage.setItem('prim-rail-collapsed', sidebarCollapsed ? '1' : '0'); } catch { /* ignore */ }
  }
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
    // Restore the active folder-tab + nav path. Validate against the freshly
    // loaded tree — a stored path whose dir was deleted falls back to the tab
    // root, then to the first available folder-tab, so the sidebar never lands
    // on a blank (null) node.
    try {
      const at = localStorage.getItem('prim-active-tab');
      if (at) activeTab = at;
      const np = localStorage.getItem('prim-nav-path');
      if (np) navPath = np;
    } catch { /* ignore */ }
    if (!isSrcTab) {
      if (!nodeAt(navPath)) navPath = nodeAt(activeTab) ? activeTab : '';
      if (!nodeAt(navPath)) {
        const first = topFolders[0];
        if (first) { activeTab = first.name; navPath = first.name; }
      }
      navByTab[activeTab] = navPath;
    }
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
<div class="prim-root" class:collapsed={sidebarCollapsed} class:no-tabs={tabs.length === 0} style="--rail-w: {sidebarCollapsed ? 0 : railWidth}px">
  <!-- Floating expand handle — only when collapsed AND no tabs are open
       (empty state has no tab strip to host the inline ☰). With tabs open the
       ☰ lives inside the tab strip instead, so it can't overlap a tab. -->
  {#if sidebarCollapsed && tabs.length === 0}
    <button class="prim-rail-expand" type="button" title="Show the primitives sidebar" onclick={toggleSidebar}>☰</button>
  {/if}
  <aside class="prim-rail">
    <header>
      <h2>Primitives</h2>
      <button class="prim-rail-collapse" type="button" title="Collapse the sidebar" onclick={toggleSidebar}>«</button>
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

    <!-- Vertical tab rail — one tab per top-level volume folder (sourced from
         the /list `tree`, so user-created dirs appear automatically; Rule 16),
         plus the two fixed read-only SRC groups (stdlib / stdstale) which are
         git-tracked src, NOT volume folders → not addable. The trailing ＋
         creates a new folder-tab on the volume. Tabs are PINNED (outside the
         scroll); only the active tab's content scrolls. -->
    <div class="prim-tabrail" role="tablist" aria-label="Primitive folders">
      {#each topFolders as f (f.path)}
        <button class="prim-tabbtn" class:active={activeTab === f.name}
          role="tab" type="button" aria-selected={activeTab === f.name}
          title={`${tabLabel(f.name)} — primitives/${f.name}/`}
          onclick={() => selectTab(f.name)}>{tabLabel(f.name)}</button>
      {/each}
      <button class="prim-tabbtn src" class:active={activeTab === 'stdlib'}
        role="tab" type="button" aria-selected={activeTab === 'stdlib'}
        title="Built-in engines (src/lib/cad/stdlib — read-only)"
        onclick={() => selectTab('stdlib')}>stdlib</button>
      <button class="prim-tabbtn src" class:active={activeTab === 'stdstale'}
        role="tab" type="button" aria-selected={activeTab === 'stdstale'}
        title="Deprecated engines (src/lib/cad/stdstale — read-only)"
        onclick={() => selectTab('stdstale')}>stdstale</button>
      <button class="prim-tabadd" type="button"
        title="New folder-tab — creates primitives/<name>/ on the volume"
        disabled={folderBusy} onclick={addTopFolder}>＋ folder</button>
    </div>

    <!-- Reusable part row — open / drag / rename / trash. `tag` is the source
         badge; `trashKind` picks soft-delete (🗑 → archive/), permanent
         (irreversible, Archived tab) or none (read-only src). -->
    {#snippet partRow(e: Entry, tag: string, canRename: boolean, trashKind: 'none' | 'soft' | 'perm')}
      <div class="prim-row-wrap" class:active={tabs.some((t) => t.id === e.id)} class:renaming={renamingId === e.id}>
        {#if renamingId === e.id}
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
            draggable={!isCoarsePointer}
            ondragstart={(ev) => {
              if (ev.dataTransfer) {
                ev.dataTransfer.setData('application/x-cadtrain-prim', e.id);
                ev.dataTransfer.effectAllowed = 'copy';
              }
            }}
            onclick={() => openTab(e.id)}>
            <span class="prim-name">{e.id}</span>
            <span class="prim-tag {tag}">{tag}</span>
          </button>
          {#if canRename}
            <button class="prim-rename" type="button"
              title="Rename — type a new id, Enter to commit"
              aria-label="Rename {e.id}"
              onclick={() => startRename(e.id, e.source)}>✎</button>
          {/if}
          {#if trashKind === 'soft'}
            <button class="prim-trash" type="button"
              title="Archive — soft delete (recoverable from primitives/archive/)"
              disabled={deleteBusy === e.id}
              onclick={() => deletePrim(e.id, e.source)}>{deleteBusy === e.id ? '…' : '🗑'}</button>
          {:else if trashKind === 'perm'}
            <button class="prim-trash perm" type="button"
              title="Permanent delete — removes the file from the volume (irreversible)"
              disabled={deleteBusy === e.id}
              onclick={() => deletePrim(e.id, e.source, 'permanent')}
              aria-label="Permanently delete {e.id}">
              {#if deleteBusy === e.id}
                …
              {:else}
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
        {/if}
      </div>
    {/snippet}

    <!-- Active tab's content scrolls here. Only ONE pane is rendered (the
         active tab), so there's no display:none grid/track phantom to blank
         the next pane (memory grid_display_none_auto_placement). -->
    <div class="prim-rail-scroll">

    {#if listLoading}<div class="prim-empty">loading…</div>{/if}
    {#if listError}<div class="prim-error">list failed: {listError}</div>{/if}

    {#if isSrcTab}
      <!-- Fixed SRC group — flat, read-only (no create / rename / trash). -->
      {@const srcList = activeTab === 'stdlib' ? stdlibSorted : stdstaleSorted}
      {@const srcTag = activeTab === 'stdlib' ? 'src' : 'stale'}
      {#each srcList.filter(pass) as e (e.id)}
        {@render partRow(e, srcTag, false, 'none')}
      {/each}
      {#if srcList.filter(pass).length === 0}<div class="prim-empty">no entries</div>{/if}
    {:else}
      <!-- Breadcrumb — descend by clicking a child folder, climb by clicking a
           crumb. Each segment is a real on-volume dir. -->
      <div class="prim-crumbs">
        {#each crumbs as c, i (c.path)}
          {#if i > 0}<span class="prim-crumb-sep">/</span>{/if}
          <button class="prim-crumb" class:current={c.path === navPath} type="button"
            onclick={() => descend(c.path)}>{i === 0 ? tabLabel(c.seg) : c.seg}</button>
        {/each}
      </div>
      <!-- Folder-level actions: new part (writes into THIS dir — location IS
           category) + new subfolder (mkdir on the volume). Hidden where they
           don't apply (no new parts into the archive graveyard). -->
      <div class="prim-folder-actions">
        {#if !isArchiveTab}
          <button class="prim-mini" type="button"
            title={`Create a new part in primitives/${navPath}/ — opens a fresh tab; first save writes the file`}
            onclick={createNewEntry}>＋ part</button>
        {/if}
        <button class="prim-mini" type="button"
          title={`Create a subfolder in primitives/${navPath}/`}
          disabled={folderBusy} onclick={addSubfolder}>＋ subfolder</button>
      </div>

      {#if currentNode}
        {#each currentNode.children as c (c.path)}
          <button class="prim-folder-row" type="button"
            title={`Open primitives/${c.path}/`}
            onclick={() => descend(c.path)}>
            <span class="prim-folder-ic">📁</span>
            <span class="prim-name">{c.name}</span>
            <span class="prim-count">({c.parts.length})</span>
          </button>
        {/each}
        {#each sortBy(currentNode.parts).filter(pass) as e (e.id)}
          {@render partRow(e, isArchiveTab ? 'arch' : 'vol', !isArchiveTab, isArchiveTab ? 'perm' : 'soft')}
        {/each}
        {#if currentNode.children.length === 0 && currentNode.parts.filter(pass).length === 0}
          <div class="prim-empty">{filter.trim() ? 'no matches' : 'empty folder'}</div>
        {/if}
      {:else}
        <div class="prim-empty">folder not found</div>
      {/if}
    {/if}

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
        {#if sidebarCollapsed}
          <button class="prim-rail-expand inline" type="button" title="Show the primitives sidebar" onclick={toggleSidebar}>☰</button>
        {/if}
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
              createDir={t.createDir}
              onGenerated={(id) => renameActiveTab(id)} />
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
    position: relative;
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

  /* ─── Vertical tab rail (folder-tabs) ────────────────────────────────── */
  /* A pinned column of folder-tabs above the scrolling content. Each tab is
     a full-width button; the active one is inverted (slate) so it reads as
     "selected". Wraps to multiple rows when there are many folders. */
  /* Vertical-tab strip — tabs sit side-by-side, each label rotated to read
     vertically (filing-cabinet style). Horizontal scroll if they overflow. */
  .prim-tabrail {
    display: flex; flex-direction: row; gap: 3px;
    padding: 6px 8px;
    border-bottom: 1px solid #e5e7eb; background: #f3f4f6;
    overflow-x: auto; overflow-y: hidden;
    scrollbar-width: thin; scrollbar-color: #cbd5e1 #f3f4f6;
  }
  .prim-tabbtn {
    flex: 0 0 auto;
    writing-mode: vertical-rl;            /* text runs top→bottom */
    display: flex; align-items: center; justify-content: center;
    padding: 10px 5px; border: 1px solid transparent; border-radius: 5px;
    background: transparent; cursor: pointer;
    font: 600 11px Arial; color: #44403c;
    text-transform: uppercase; letter-spacing: 0.6px;
    white-space: nowrap; min-height: 96px;
    transition: background 100ms, color 100ms, border-color 100ms;
  }
  .prim-tabbtn:hover { background: #e7e5e4; }
  .prim-tabbtn.active {
    background: #0c4a6e; color: #fff; border-color: #0c4a6e;
  }
  /* SRC tabs (stdlib / stdstale) — blue tint so their read-only provenance
     reads at a glance; still inverts when active. */
  .prim-tabbtn.src { color: #1e40af; }
  .prim-tabbtn.src.active { background: #1e3a8a; color: #fff; border-color: #1e3a8a; }
  /* + folder-tab — dashed green affordance, set apart from the real tabs. */
  .prim-tabadd {
    flex: 0 0 auto;
    writing-mode: vertical-rl;
    display: flex; align-items: center; justify-content: center;
    padding: 8px 5px;
    border: 1px dashed #86efac; border-radius: 5px;
    background: transparent; cursor: pointer; min-height: 96px;
    font: 600 10px Arial; color: #15803d; letter-spacing: 0.4px;
  }
  .prim-tabadd:hover:not(:disabled) { background: #d1fae5; border-color: #4ade80; color: #166534; }
  .prim-tabadd:disabled { cursor: wait; opacity: 0.5; }

  /* ─── Breadcrumb + folder-level actions ──────────────────────────────── */
  .prim-crumbs {
    display: flex; flex-wrap: wrap; align-items: center; gap: 1px;
    padding: 6px 12px 2px; font: 11px Arial;
  }
  .prim-crumb {
    padding: 1px 4px; border: 0; border-radius: 3px; background: transparent;
    cursor: pointer; color: #0369a1; font: 600 11px Arial;
  }
  .prim-crumb:hover { background: #e0f2fe; }
  .prim-crumb.current { color: #44403c; cursor: default; }
  .prim-crumb.current:hover { background: transparent; }
  .prim-crumb-sep { color: #a8a29e; font-size: 10px; }
  .prim-folder-actions {
    display: flex; gap: 6px; padding: 2px 12px 6px;
    border-bottom: 1px solid #f3f4f6;
  }
  .prim-mini {
    padding: 3px 8px; border: 1px solid #d6d3d1; border-radius: 4px;
    background: #fff; cursor: pointer; font: 11px Arial; color: #44403c;
  }
  .prim-mini:hover:not(:disabled) { background: #d1fae5; border-color: #86efac; color: #166534; }
  .prim-mini:disabled { cursor: wait; opacity: 0.5; }

  /* Subfolder row — clicking descends into it. Folder icon + count badge. */
  .prim-folder-row {
    display: flex; align-items: center; gap: 8px; width: 100%;
    padding: 5px 12px; background: transparent; border: 0; cursor: pointer;
    text-align: left; font: 12px Arial; color: #1f2937;
  }
  .prim-folder-row:hover { background: #e7e5e4; }
  .prim-folder-ic { font-size: 13px; flex: 0 0 auto; }

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

  /* ─── Sidebar collapse (all viewports) ───────────────────────────────── */
  .prim-rail-collapse {
    margin-left: auto; width: 22px; height: 22px; padding: 0;
    background: #fff; border: 1px solid #cbd5e1; border-radius: 4px;
    font: 13px Arial; color: #475569; cursor: pointer; line-height: 1;
  }
  .prim-rail-collapse:hover { background: #f1f5f9; color: #1e293b; }
  .prim-root.collapsed .prim-rail,
  .prim-root.collapsed .prim-rail-divider { display: none; }
  /* Collapsed (desktop + mobile LANDSCAPE): rail + divider are display:none,
     so .prim-main is the only grid item left. The base three-column template
     would auto-place it onto the leading `var(--rail-w)` (0px when collapsed)
     → blank screen. Collapse to a SINGLE column so main fills the width.
     Portrait overrides this with its own row template (!important). */
  .prim-root.collapsed { grid-template-columns: minmax(0, 1fr); }
  .prim-rail-expand {
    position: absolute; top: 8px; left: 8px; z-index: 30;
    width: 30px; height: 30px; padding: 0;
    background: #fff; border: 1px solid #cbd5e1; border-radius: 6px;
    font: 15px Arial; color: #334155; cursor: pointer;
    box-shadow: 0 1px 3px rgba(0,0,0,0.12);
  }
  .prim-rail-expand:hover { background: #f1f5f9; }
  /* Inline variant — lives as the first item in the tab strip when collapsed,
     so the ☰ sits LEFT of the tabs instead of floating over them. */
  .prim-rail-expand.inline {
    position: static; z-index: auto;
    width: 26px; height: 24px; align-self: center;
    margin: 0 6px 4px 2px; box-shadow: none; font-size: 13px;
    flex: 0 0 auto;
  }

  /* ─── Mobile PORTRAIT — stack the sidebar ABOVE the editor (K.53) ─────── */
  /* Landscape keeps the sidebar on the left (wide enough). Portrait stacks:
     a capped, scrollable sidebar on top, the editor below. */
  @media (max-width: 820px) and (orientation: portrait) {
    /* The divider is display:none here, so it leaves the grid entirely —
       only TWO items auto-place (rail, main). The row template must have
       exactly two tracks; a phantom middle `0` row would drop .prim-main
       onto it and collapse the editor to zero height (the "blank, no tabs"
       bug). Rows: [sidebar] [editor]. */
    .prim-root {
      grid-template-columns: 1fr !important;
      grid-template-rows: minmax(90px, 38vh) minmax(0, 1fr) !important;
    }
    .prim-rail-divider { display: none; }
    .prim-rail { border-right: none; border-bottom: 1px solid #e5e7eb; }
    /* Collapsed: the rail is also display:none, so .prim-main is the ONLY
       grid item left — it must land on a SINGLE 1fr track. A two-track
       `0 1fr` would auto-place the lone main onto the leading `0` and blank
       the whole screen (the "collapse blanks everything" bug). */
    .prim-root.collapsed { grid-template-rows: minmax(0, 1fr) !important; }
    /* Nothing open yet → let the sidebar fill the screen (the empty editor
       below would otherwise be wasted white space). Splits once a part opens. */
    .prim-root.no-tabs { grid-template-rows: minmax(0, 1fr) 0 !important; }
    .prim-root.no-tabs.collapsed { grid-template-rows: minmax(0, 1fr) !important; }
  }

  /* ─── Tabbed main area ────────────────────────────────────────────── */
  .prim-main { display: flex; flex-direction: column; overflow: hidden; min-height: 0; min-width: 0; }
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
