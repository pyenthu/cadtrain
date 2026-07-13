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
  import GraphEditorPane from '$lib/shared/graph-editor/GraphEditorPane.svelte';
  import AiMenu from '$lib/shared/graph-editor/AiMenu.svelte';
  import CacheBrowser from '$lib/shared/volume/CacheBrowser.svelte';
  import { resolveEmbedConfig, parseEmbedFromSearch, type EmbedConfig } from '$lib/shared/graph-editor/embed-config';
  import {
    type Entry, type FolderNode, MOVE_TARGET_RE,
    tabLabel, subtreeCount, subtreeMatches, sortFolders, nodeAt, findPartDir,
    isMoveTarget, topLevelOf, ensureFolderPath, insertPartIntoTree,
    folderMoveInto, FOLDER_PROTECTED_ROOTS, resolveDropTargetFolder,
  } from './primitives-tree';

  /** Same regex the server uses for primitive ids — keep them in sync.
   *  Server: src/routes/api/primitives/rename/+server.ts ID_RE. */
  const ID_RE = /^[a-z][a-z0-9_]*$/i;

  // ─── Embed feature-flags (embed-config.ts) ────────────────────────────────
  // An external host can iframe /primitives?sidebar=0&tabs=…&engines=… to embed
  // the multi-tab editor with its own chrome. Parse the query once at init
  // (SSR is off, so `window` exists); `undefined` when no embed param is present
  // → the sidebar shows + GEP gets the legacy `embed={true}`, i.e. the current
  // UI unchanged. `embedCfg` is a stable const (the URL doesn't change) so it
  // won't re-fire identity-tracked effects.
  const embedPartial: Partial<EmbedConfig> | undefined = (() => {
    try {
      return typeof window !== 'undefined'
        ? parseEmbedFromSearch(new URL(window.location.href).searchParams)
        : undefined;
    } catch { return undefined; }
  })();
  const embedCfg = resolveEmbedConfig(embedPartial);

  // Entry / FolderNode types + the pure tree helpers → ./primitives-tree.

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
  let tree = $state<FolderNode | null>(null);
  let topFolders = $derived(tree?.children ?? []);

  // ─── Single expand/collapse FILE TREE (Windows-Explorer / VS-Code style) ──
  /** Expanded folders keyed by tree path ('basic', 'completions/svtc', plus
   *  the synthetic src roots '__stdlib'/'__stdstale'). Persisted to
   *  localStorage. `basic` + `completions` default-expand on first load. */
  let expanded = $state<Record<string, boolean>>({});
  function isExpanded(path: string): boolean {
    return expanded[path] ?? (path === 'basic' || path === 'completions');
  }
  function persistExpanded() {
    try { localStorage.setItem('prim-tree-expanded', JSON.stringify(expanded)); } catch { /* ignore */ }
  }
  function toggleExpand(path: string) {
    expanded = { ...expanded, [path]: !isExpanded(path) };
    persistExpanded();
  }
  function ensureExpanded(path: string) {
    if (!isExpanded(path)) { expanded = { ...expanded, [path]: true }; persistExpanded(); }
  }
  /** Active vertical-tab — scopes the tree to ONE top-level branch. A volume
   *  folder name ('basic' | 'completions' | 'archive' | …) OR a synthetic src
   *  root ('__stdlib' | '__stdstale'). The tree below shows only that branch's
   *  contents; subfolders within it still expand/collapse in place. */
  let activeTab = $state<string>('basic');
  function selectTab(name: string) {
    activeTab = name;
    try { localStorage.setItem('prim-active-tab', name); } catch { /* ignore */ }
    // When the rail is collapsed to its thin vertical-tab strip the scoped
    // tree is hidden, so picking a folder tab also expands the rail to reveal
    // that branch's contents (the tabs are the only visible control then).
    if (sidebarCollapsed) {
      sidebarCollapsed = false;
      try { localStorage.setItem('prim-rail-collapsed', '0'); } catch { /* ignore */ }
    }
  }
  /** Sidebar reorg (docs/plans/sidebar-reorg.md): the rail collapses to THREE
   *  fixed main tabs. `activeTab` is now one of these sentinels:
   *    '__internal' → ARCHIVED + STDLIB + STALE folders (system / read-only / trash)
   *    'basic'      → the volume basic/ branch (+ any other user top folder)
   *    'completions'→ the WELL branch (completions/<family>/…)
   *  BASIC = 'basic' and WELL = 'completions' keep real dir names so drag-drop
   *  `to=` paths + the create target stay valid on-volume dirs (Rule 16). */
  const INTERNAL_TAB = '__internal';
  type RowKind = 'volume' | 'archive' | 'stdlib' | 'stdstale';
  interface RenderFolder { node: FolderNode; kind: RowKind; }
  interface RenderFile { entry: Entry; dir: string; kind: RowKind; }
  /** The volume `archive/` folder (soft-deleted parts). Falls back to an empty
   *  synthetic node so INTERNAL still renders the ARCHIVED row before /list lands. */
  let archiveNode = $derived<FolderNode>(
    topFolders.find((f) => f.name === 'archive') ?? { name: 'archive', path: 'archive', parts: [], children: [] },
  );
  let basicNode = $derived<FolderNode | null>(topFolders.find((f) => f.name === 'basic') ?? null);
  let completionsNode = $derived<FolderNode | null>(topFolders.find((f) => f.name === 'completions') ?? null);
  /** Extra user-created top-level volume folders (anything that isn't a known
   *  bucket) surface UNDER Basic so nothing becomes unreachable. */
  let extraFolders = $derived(topFolders.filter((f) => !['basic', 'completions', 'archive'].includes(f.name)));
  /** What the active main tab renders: folder rows (each with its own kind) +
   *  direct file rows + the create-target dir (null = no create in this tab). */
  let activeView = $derived.by<{ folders: RenderFolder[]; files: RenderFile[]; createPath: string | null }>(() => {
    if (activeTab === INTERNAL_TAB) {
      return {
        folders: [
          { node: archiveNode, kind: 'archive' },
          { node: stdlibNode, kind: 'stdlib' },
          { node: stdstaleNode, kind: 'stdstale' },
        ],
        files: [],
        createPath: null,
      };
    }
    if (activeTab === 'completions') {
      const n = completionsNode;
      return {
        folders: (n?.children ?? []).map((c) => ({ node: c, kind: 'volume' as const })),
        files: (n?.parts ?? []).map((e) => ({ entry: e, dir: 'completions', kind: 'volume' as const })),
        createPath: n ? 'completions' : null,
      };
    }
    // BASIC (default) — basic's own subtree PLUS any other user top folder.
    const n = basicNode;
    return {
      folders: [
        ...(n?.children ?? []).map((c) => ({ node: c, kind: 'volume' as const })),
        ...extraFolders.map((f) => ({ node: f, kind: 'volume' as const })),
      ],
      files: (n?.parts ?? []).map((e) => ({ entry: e, dir: 'basic', kind: 'volume' as const })),
      createPath: 'basic',
    };
  });
  /** Apply the global sort mode to a render-folder / render-file list. */
  const sortRenderFolders = (xs: RenderFolder[]) =>
    sortMode === 'alpha' ? [...xs].sort((a, b) => a.node.name.localeCompare(b.node.name)) : xs;
  const sortRenderFiles = (xs: RenderFile[]) =>
    sortMode === 'alpha' ? [...xs].sort((a, b) => a.entry.id.localeCompare(b.entry.id)) : xs;
  /** ⛁ Cache inspector — when on, the MAIN area shows <CacheBrowser/> instead
   *  of the per-part editor tabs. Toggled from a footer row in the tree. */
  let showCache = $state(false);

  // tabLabel / subtreeCount / subtreeMatches / sortFolders / nodeAt → ./primitives-tree
  // (pure; called with `tree` / `sortMode` / `pass` passed in at the call sites).

  // Optimistic-insert for brand-new parts: the proxied /list lags writes by
  // seconds (memory prod_list_staleness), so a just-saved part wouldn't appear
  // until a later refresh. Track pending ids → merge them into the tree after
  // every loadList until the real list catches up, then drop them.
  let pendingCreated = $state<Map<string, string>>(new Map());
  function treeHasId(node: FolderNode, id: string): boolean {
    return node.parts.some((p) => p.id === id) || node.children.some((c) => treeHasId(c, id));
  }
  function mergePending() {
    if (!tree || pendingCreated.size === 0) return;
    let changed = false;
    for (const [id, dir] of [...pendingCreated]) {
      if (treeHasId(tree, id)) { pendingCreated.delete(id); changed = true; continue; }
      if (insertPartIntoTree(tree, id, dir)) changed = true;
    }
    if (changed) pendingCreated = new Map(pendingCreated);
  }
  /** Fired by a tab's editor after a successful Save — surface the part now
   *  (optimistic) and reconcile against the server. */
  function onPartSaved(id: string, dir: string) {
    pendingCreated.set(id, dir);
    pendingCreated = new Map(pendingCreated);
    mergePending();
    void loadList();
  }
  // Optimistic-insert for brand-new FOLDERS — the folder analogue of
  // pendingCreated. A just-mkdir'd folder is empty, and the proxied /list lags
  // writes by seconds (memory prod_list_staleness), so relying on the refetch
  // alone made "create folder" look like it did nothing until a later refresh.
  // Track pending folder paths → re-insert them into the tree after every
  // loadList until the server tree carries them, then drop them.
  let pendingFolders = $state<Set<string>>(new Set());
  function mergePendingFolders() {
    if (!tree || pendingFolders.size === 0) return;
    let changed = false;
    for (const p of [...pendingFolders]) {
      if (nodeAt(tree, p)) { pendingFolders.delete(p); changed = true; continue; }
      if (ensureFolderPath(tree, p)) changed = true;
    }
    if (changed) pendingFolders = new Set(pendingFolders);
  }
  // ─── Create folder (top-level + nested subfolder) ─────────────────────────
  let folderBusy = $state(false);
  async function mkFolder(path: string): Promise<boolean> {
    folderBusy = true;
    try {
      const r = await fetch(`/api/primitives/mkdir?path=${encodeURIComponent(path)}`, { method: 'POST' });
      if (!r.ok) {
        if (typeof alert === 'function') alert(`Create folder failed (${r.status}): ${(await r.text()).slice(0, 160)}`);
        return false;
      }
      // Optimistic: surface the new (empty) folder NOW — don't wait for the
      // lagging proxied /list (see pendingFolders / mergePendingFolders).
      pendingFolders.add(path);
      pendingFolders = new Set(pendingFolders);
      if (tree) ensureFolderPath(tree, path);
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
    const raw = typeof window !== 'undefined' ? window.prompt?.('New top-level folder name (lowercase, _ allowed)', '') : null;
    if (!raw) return;
    const name = raw.trim();
    if (!ID_RE.test(name)) { alert(`bad name "${name}" — must match [a-z][a-z0-9_]*`); return; }
    if (await mkFolder(name)) {
      // A new top-level user folder renders UNDER the Basic tab (extraFolders),
      // so switch there or it looks like nothing happened when created from
      // another tab.
      selectTab('basic');
      ensureExpanded(name);
    }
  }
  /** Create a subfolder under `parent` (a tree path). Expands both so the
   *  new folder is visible in place. */
  async function createSubfolderIn(parent: string) {
    const raw = typeof window !== 'undefined' ? window.prompt?.('New subfolder name (lowercase, _ allowed)', '') : null;
    if (!raw) return;
    const name = raw.trim();
    if (!ID_RE.test(name)) { alert(`bad name "${name}" — must match [a-z][a-z0-9_]*`); return; }
    const path = `${parent}/${name}`;
    if (path.split('/').length > 3) { alert('Max folder depth is 3 (cat / family / subfolder)'); return; }
    if (await mkFolder(path)) {
      // Switch to the tab that owns the parent branch so the new subfolder is
      // in view (completions → Well; everything else → Basic).
      selectTab(topLevelOf(parent) === 'completions' ? 'completions' : 'basic');
      ensureExpanded(parent);
      ensureExpanded(path);
    }
  }

  // Structural roots the sidebar depends on — not user-renamable/deletable.
  const PROTECTED_FOLDERS = new Set(['basic', 'completions', 'archive', 'profiles']);
  function isEditableFolder(path: string): boolean {
    return !!path && !PROTECTED_FOLDERS.has(path);
  }
  /** Rename a folder's leaf name (parts inside keep their ids). */
  async function renameFolderPath(path: string) {
    const leaf = path.split('/').pop() ?? path;
    const raw = typeof window !== 'undefined' ? window.prompt?.(`Rename folder "${path}" to:`, leaf) : null;
    if (!raw) return;
    const name = raw.trim();
    if (!ID_RE.test(name)) { alert(`bad name "${name}" — must match [a-z][a-z0-9_]*`); return; }
    if (name === leaf) return;
    folderBusy = true;
    try {
      const r = await fetch(`/api/primitives/folder/rename?from=${encodeURIComponent(path)}&to=${encodeURIComponent(name)}`, { method: 'POST' });
      if (!r.ok) { alert(`Rename failed (${r.status}): ${(await r.text()).slice(0, 160)}`); return; }
      const parent = path.split('/').slice(0, -1).join('/');
      const newPath = parent ? `${parent}/${name}` : name;
      await loadList();
      ensureExpanded(newPath);
    } catch (e: any) { alert(`Rename error: ${e?.message ?? e}`); }
    finally { folderBusy = false; }
  }
  /** Delete a folder — archives every part inside (recoverable from Archived),
   *  then removes the empty dir. */
  async function deleteFolderPath(path: string) {
    const ok = typeof window !== 'undefined'
      ? window.confirm?.(`Delete folder "${path}"?\n\nAny parts inside are moved to Archived (recoverable). The folder is then removed.`)
      : false;
    if (!ok) return;
    folderBusy = true;
    try {
      const r = await fetch(`/api/primitives/folder/delete?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
      if (!r.ok) { alert(`Delete failed (${r.status}): ${(await r.text()).slice(0, 160)}`); return; }
      const body = await r.json().catch(() => ({ archived: [] as string[] }));
      await loadList();
      if (body.archived?.length) alert(`Folder deleted. ${body.archived.length} part(s) moved to Archived.`);
    } catch (e: any) { alert(`Delete error: ${e?.message ?? e}`); }
    finally { folderBusy = false; }
  }
  function menuRenameFolder() { const p = createMenu?.path; closeCreateMenu(); if (p != null) void renameFolderPath(p); }
  function menuDeleteFolder() { const p = createMenu?.path; closeCreateMenu(); if (p != null) void deleteFolderPath(p); }

  /** Move a folder between the two USER tabs (BASIC ↔ WELL). A WELL folder
   *  (`completions/<family>`) moves to `basic/<leaf>`; any BASIC folder (a
   *  top-level user folder or `basic/<f>`) moves to `completions/<leaf>`. The
   *  folder + its parts travel together as a real dir relocation (Rule 16);
   *  the tree re-groups it under the new tab on the next /list. INTERNAL
   *  (Archived / Stdlib / Stale) is excluded — those rows never expose the ⋯
   *  menu, and `completions`/`basic` roots aren't editable (PROTECTED). */
  function moveFolderDestFor(path: string): { label: string; dest: string } | null {
    if (!isEditableFolder(path)) return null;
    const leaf = path.split('/').pop() ?? path;
    return path.startsWith('completions/')
      ? { label: 'Basic', dest: `basic/${leaf}` }
      : { label: 'Well', dest: `completions/${leaf}` };
  }
  async function moveFolderToTab(from: string, dest: string) {
    folderBusy = true;
    try {
      const r = await fetch(`/api/primitives/folder/move?from=${encodeURIComponent(from)}&to=${encodeURIComponent(dest)}`, { method: 'POST' });
      if (!r.ok) { alert(`Move folder failed (${r.status}): ${(await r.text()).slice(0, 160)}`); return; }
      // Switch to the destination tab so the moved folder is visible right away.
      selectTab(dest.startsWith('completions/') ? 'completions' : 'basic');
      await loadList();
      ensureExpanded(dest);
    } catch (e: any) { alert(`Move folder error: ${e?.message ?? e}`); }
    finally { folderBusy = false; }
  }
  function menuMoveFolder() {
    const p = createMenu?.path; closeCreateMenu();
    if (p == null) return;
    const t = moveFolderDestFor(p);
    if (t) void moveFolderToTab(p, t.dest);
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

  // ─── Move to another folder (#5 — drag-drop + "Move to…" dialog) ──────────
  // Moving changes ONLY a part's DIRECTORY (its category, Rule 16). The id is
  // unchanged, so meta.uses refs (by id) stay valid — no broken-ref handling
  // (unlike rename). Server: POST /api/primitives/move?id=<id>&to=<category>
  // where <category> ∈ basic | basic/<sub> | archive | completions/<fam>(/<sub>).
  // MOVE_TARGET_RE → ./primitives-tree. findPartDir(tree, id) likewise.
  const PRIM_DND = 'application/x-cadtrain-prim';       // payload = the part id (also read by the canvas drop)
  const PRIM_DND_FROM = 'application/x-cadtrain-prim-from'; // payload = JSON { kind, dir } source meta
  const FOLDER_DND = 'application/x-cadtrain-folder';   // payload = the dragged folder's path (nest-into-folder)

  let moveBusy = $state<string | null>(null);
  /** Folder/tab path currently under a part- OR folder-drag (drop-target highlight). */
  let dragOverPath = $state<string | null>(null);
  /** The folder path currently being dragged. `dataTransfer.getData` is empty
   *  during `dragover` (only readable on `drop`), so we stash the source here on
   *  dragstart to validate the highlight live. Cleared on dragend/drop. */
  let folderDragFrom = $state<string | null>(null);
  /** Folder-move in flight (source path) — disables its ⋯ while moving. */
  let folderMoveBusy = $state<string | null>(null);

  /** Optimistically relocate the entry between tree nodes (the proxied /list
   *  lags writes — memory prod_list_staleness). loadList reconciles after. */
  function moveEntryInTree(id: string, fromDir: string, toPath: string) {
    const from = nodeAt(tree, fromDir);
    const to = nodeAt(tree, toPath);
    if (!from || !to || from === to) return;
    const entry = from.parts.find((p) => p.id === id);
    from.parts = from.parts.filter((p) => p.id !== id);
    if (entry && !to.parts.some((p) => p.id === id)) to.parts = [...to.parts, entry];
  }

  /** POST the move, then optimistically reflect it + refresh the list. `kind`
   *  is the moved part's provenance — only volume/archive parts can move (the
   *  src groups are read-only and reject server-side). */
  async function movePart(id: string, kind: string, fromDir: string, toPath: string) {
    if (kind !== 'volume' && kind !== 'archive') return;
    const to = toPath.replace(/\/+$/, '');
    if (!MOVE_TARGET_RE.test(to)) {
      if (typeof alert === 'function') alert(`"${to}" isn't a valid destination (basic | archive | completions/<family>).`);
      return;
    }
    if (to === fromDir) return; // no-op — already in this folder
    moveBusy = id;
    try {
      const r = await fetch(`/api/primitives/move?id=${encodeURIComponent(id)}&to=${encodeURIComponent(to)}`, { method: 'POST' });
      if (!r.ok) {
        const t = await r.text();
        if (typeof alert === 'function') alert(`Move failed (${r.status}): ${t.slice(0, 200)}`);
        return;
      }
      moveEntryInTree(id, fromDir, to);  // optimistic — surface it in the new folder now
      ensureExpanded(to);
      await loadList();                  // reconcile against the server
    } catch (e: any) {
      if (typeof alert === 'function') alert(`Move error: ${e?.message ?? e}`);
    } finally {
      moveBusy = null;
    }
  }

  /** COPY a part: fetch its source, rewrite the id (meta.id / meta.name / the
   *  `export function <id>` — the only places a part's OWN id appears; deps in
   *  meta.graph are referenced by their own ids, untouched), and save the dup
   *  under a NEW id in `toPath`. Prompts for the new id (part ids are unique, so
   *  a copy can't reuse the source id). */
  async function copyPart(id: string, kind: string, toPath: string) {
    if (kind !== 'volume' && kind !== 'archive') return;
    const to = toPath.replace(/\/+$/, '');
    if (!MOVE_TARGET_RE.test(to)) { alert(`"${to}" isn't a valid destination.`); return; }
    const prompt = typeof window !== 'undefined' ? window.prompt : null;
    if (!prompt) return;
    const raw = prompt(`Copy "${id}" into ${to}/ as (new id, lowercase, _ allowed):`, `${id}_copy`);
    if (!raw) return;
    const newId = raw.trim();
    if (!ID_RE.test(newId)) { alert(`bad id "${newId}" — must match [a-z][a-z0-9_]*`); return; }
    if (newId === id) { alert('Pick a different id for the copy.'); return; }
    moveBusy = id;
    try {
      const sr = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`, { cache: 'no-store' });
      if (!sr.ok) { alert(`Copy failed: couldn't read ${id} (${sr.status}).`); return; }
      const src = (await sr.json())?.source as string;
      if (typeof src !== 'string') { alert('Copy failed: no source.'); return; }
      const esc = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const dup = src
        .replace(new RegExp(`(\\bid:\\s*['"])${esc}(['"])`), `$1${newId}$2`)
        .replace(new RegExp(`(\\bname:\\s*['"])${esc}(['"])`), `$1${newId}$2`)
        .replace(new RegExp(`(export\\s+function\\s+)${esc}\\b`), `$1${newId}`);
      const r = await fetch('/api/primitives/save', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: newId, source: dup, dir: to }),
      });
      if (!r.ok) { alert(`Copy failed (${r.status}): ${(await r.text()).slice(0, 200)}`); return; }
      // Optimistic: surface the new copy in `to/` NOW. The proxied /list lags
      // writes by seconds (memory prod_list_staleness), so relying on loadList
      // alone made a fresh copy invisible until a later refresh/reload. Track it
      // as pending + merge so a later /list that finally carries it reconciles
      // (dedupe by id — no double entry). Same mechanism as onPartSaved.
      pendingCreated.set(newId, to);
      pendingCreated = new Map(pendingCreated);
      ensureExpanded(to);
      mergePending();
      await loadList();
    } catch (e: any) {
      alert(`Copy error: ${e?.message ?? e}`);
    } finally {
      moveBusy = null;
    }
  }

  // Drag-and-drop: part rows carry { id, kind, dir } in the dataTransfer;
  // folder rows + the basic/archive top tabs accept the drop.
  /** True when a folder/tab at `path` can RECEIVE a dropped part. Excludes the
   *  bare `completions` container + arbitrary top folders (server only accepts
   *  basic | archive | completions/<family>). */
  function isDropTarget(path: string, kind: string): boolean {
    return (kind === 'volume' || kind === 'archive') && MOVE_TARGET_RE.test(path);
  }
  /** A folder can RECEIVE a dragged folder only if it's a volume folder and the
   *  nest is structurally legal (see folderMoveInto — self/descendant/no-op/depth
   *  guards). The dragged source is read from `folderDragFrom` because
   *  dataTransfer payloads aren't readable during dragover. */
  function isFolderDropTarget(path: string, kind: string): boolean {
    if (kind !== 'volume' || !folderDragFrom) return false;
    return folderMoveInto(folderDragFrom, path).ok;
  }
  function onFolderDragOver(ev: DragEvent, path: string, kind: string) {
    const types = ev.dataTransfer?.types;
    if (!types) return;
    // Folder-into-folder nesting takes priority when a folder is being dragged.
    if (types.includes(FOLDER_DND)) {
      if (!isFolderDropTarget(path, kind)) return;
      ev.preventDefault();
      ev.dataTransfer!.dropEffect = 'move';
      if (dragOverPath !== path) dragOverPath = path;
      return;
    }
    // Part-into-folder move (the pre-existing path).
    if (!isDropTarget(path, kind)) return;
    if (!types.includes(PRIM_DND)) return;
    ev.preventDefault();
    ev.dataTransfer!.dropEffect = 'move';
    if (dragOverPath !== path) dragOverPath = path;
  }
  function onFolderDragLeave(path: string) {
    if (dragOverPath === path) dragOverPath = null;
  }
  function onFolderDrop(ev: DragEvent, path: string, kind: string) {
    // Folder drop first — a folder drag carries FOLDER_DND, not PRIM_DND.
    if (ev.dataTransfer?.types.includes(FOLDER_DND)) {
      if (kind !== 'volume') return;
      ev.preventDefault();
      dragOverPath = null;
      const from = ev.dataTransfer.getData(FOLDER_DND) || folderDragFrom || '';
      folderDragFrom = null;
      if (from) void moveFolderInto(from, path);
      return;
    }
    if (!isDropTarget(path, kind)) return;
    ev.preventDefault();
    dragOverPath = null;
    const id = ev.dataTransfer?.getData(PRIM_DND);
    if (!id) return;
    // Source meta from the drag payload (kind + current dir); fall back to a
    // tree walk + the live lists when it's absent (drag from another surface).
    let srcKind = '', fromDir = '';
    try {
      const raw = ev.dataTransfer?.getData(PRIM_DND_FROM);
      if (raw) { const j = JSON.parse(raw); srcKind = j.kind ?? ''; fromDir = j.dir ?? ''; }
    } catch { /* ignore malformed payload */ }
    if (!srcKind) {
      srcKind = stdlib.some((e) => e.id === id) ? 'stdlib'
        : stdstale.some((e) => e.id === id) ? 'stdstale'
        : archived.some((e) => e.id === id) ? 'archive' : 'volume';
    }
    if (!fromDir) fromDir = findPartDir(tree, id) ?? '';
    if (srcKind !== 'volume' && srcKind !== 'archive') return; // read-only src part — can't move
    void movePart(id, srcKind, fromDir, path);
  }

  /** Optimistically relocate folder `from`'s subtree to `dest` in the live tree
   *  (the proxied /list lags — prod_list_staleness — so surface the nesting now;
   *  loadList reconciles right after). Mutates the $state tree in place: detach
   *  the node from its old parent, re-root its (and every descendant's) `path`
   *  prefix from `from` → `dest`, rename its leaf, attach under the new parent. */
  function relocateFolderInTree(from: string, dest: string) {
    if (!tree) return;
    const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
    const oldParent = nodeAt(tree, parentOf(from));
    const node = nodeAt(tree, from);
    const newParent = nodeAt(tree, parentOf(dest));
    if (!oldParent || !node || !newParent || oldParent === node) return;
    oldParent.children = oldParent.children.filter((c) => c.path !== from);
    const reroot = (n: FolderNode) => {
      n.path = dest + n.path.slice(from.length);
      for (const c of n.children) reroot(c);
    };
    reroot(node);
    node.name = dest.split('/').pop()!;
    if (!newParent.children.some((c) => c.path === dest)) newParent.children = [...newParent.children, node];
  }

  /** Drag-nest a FOLDER: move `from` INTO folder `toParent` (dest = toParent/leaf).
   *  Reuses the folder/move endpoint (same one behind the tab-move action); the
   *  structural guards live in the pure `folderMoveInto` so an illegal drop never
   *  gets here. Optimistic relocate + ensureExpanded, then loadList reconciles. */
  async function moveFolderInto(from: string, toParent: string) {
    const v = folderMoveInto(from, toParent);
    if (!v.ok) {
      if (v.reason && v.reason !== 'already there' && typeof alert === 'function') alert(`Can't move folder: ${v.reason}`);
      return;
    }
    const dest = v.dest;
    if (nodeAt(tree, dest)) { if (typeof alert === 'function') alert(`A folder "${dest}" already exists.`); return; }
    folderMoveBusy = from;
    try {
      const r = await fetch(`/api/primitives/folder/move?from=${encodeURIComponent(from)}&to=${encodeURIComponent(dest)}`, { method: 'POST' });
      if (!r.ok) {
        if (typeof alert === 'function') alert(`Move folder failed (${r.status}): ${(await r.text()).slice(0, 200)}`);
        return;
      }
      relocateFolderInTree(from, dest); // optimistic — show the nesting now
      ensureExpanded(toParent);
      ensureExpanded(dest);
      await loadList();                 // reconcile against the server
    } catch (e: any) {
      if (typeof alert === 'function') alert(`Move folder error: ${e?.message ?? e}`);
    } finally {
      folderMoveBusy = null;
    }
  }

  // ─── "Move to…" dialog (anchored popover — mirrors the create menu) ───────
  let moveMenu = $state<{ id: string; kind: string; fromDir: string; mode: 'move' | 'copy'; x: number; y: number } | null>(null);
  /** Selected top-level folder-tab in the "Move/Copy to…" picker (a tree-root
   *  child name: 'basic' | 'completions' | 'archive' | a user folder). Its
   *  subtree is shown as an indented, clickable tree on the right. */
  let moveMenuTab = $state<string>('basic');
  /** Pre-select the picker tab that owns the source folder so the likely
   *  destination branch is already open; fall back to Basic. */
  function defaultMoveTab(fromDir: string): string {
    const top = topLevelOf(fromDir);
    const names = new Set((tree?.children ?? []).map((c) => c.name));
    return top && names.has(top) ? top : (names.has('basic') ? 'basic' : ([...names][0] ?? 'basic'));
  }
  function openMoveMenu(id: string, kind: string, fromDir: string, mode: 'move' | 'copy', ev: MouseEvent) {
    ev.stopPropagation();
    if (moveMenu?.id === id && moveMenu?.mode === mode) { moveMenu = null; return; }
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    // Anchor under the trigger, nudged left so the menu doesn't overflow the rail.
    moveMenuTab = defaultMoveTab(fromDir);
    moveMenu = { id, kind, fromDir, mode, x: Math.max(8, r.right - 200), y: r.bottom + 2 };
  }
  function closeMoveMenu() { moveMenu = null; }
  /** Valid move destinations from the tree — excludes the bare `completions`
   *  container, the read-only stdlib/stdstale src groups (not in the tree), and
   *  the part's CURRENT folder. */
  // moveTargets(tree, fromDir) → ./primitives-tree.
  function pickMoveTarget(path: string) {
    const m = moveMenu;
    closeMoveMenu();
    if (!m) return;
    if (m.mode === 'copy') void copyPart(m.id, m.kind, path);
    else void movePart(m.id, m.kind, m.fromDir, path);
  }
  // Outside-click + Escape dismissal — only wired while the move menu is open.
  $effect(() => {
    if (!moveMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeMoveMenu(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.prim-move-menu')) return; // click inside the menu
      if (t && t.closest('.prim-move')) return;      // the trigger toggles itself
      closeMoveMenu();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
    };
  });

  // ─── Per-row actions menu (one ⋯ kebab + right-click) — clubs rename / move /
  //     copy / delete into ONE anchored popover so rows stay compact (no more
  //     four hover buttons). Opened by the kebab OR a contextmenu (Mac: two-
  //     finger tap). Move/Copy hand off to the existing moveMenu popover. ──────
  let rowMenu = $state<{ id: string; kind: string; dir: string; source: string; canRename: boolean; x: number; y: number } | null>(null);
  function openRowMenu(id: string, kind: string, dir: string, source: string, canRename: boolean, ev: MouseEvent) {
    ev.preventDefault(); ev.stopPropagation();
    const vw = typeof window !== 'undefined' ? window.innerWidth : 9999;
    rowMenu = { id, kind, dir, source, canRename, x: Math.min(ev.clientX, vw - 180), y: ev.clientY };
  }
  function closeRowMenu() { rowMenu = null; }
  function rowMenuRename() { const m = rowMenu; closeRowMenu(); if (m) startRename(m.id, m.source); }
  function rowMenuMoveCopy(mode: 'move' | 'copy') {
    const m = rowMenu; closeRowMenu();
    if (m) { moveMenuTab = defaultMoveTab(m.dir); moveMenu = { id: m.id, kind: m.kind, fromDir: m.dir, mode, x: m.x, y: m.y }; }
  }
  function rowMenuDelete() {
    const m = rowMenu; closeRowMenu();
    if (!m) return;
    void deletePrim(m.id, m.source, m.kind === 'archive' ? 'permanent' : 'archive');
  }
  $effect(() => {
    if (!rowMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeRowMenu(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.prim-row-menu')) return;
      if (t && t.closest('.prim-kebab')) return;
      closeRowMenu();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    return () => { window.removeEventListener('keydown', onKey); window.removeEventListener('mousedown', onDown, true); };
  });

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
      mergePending();        // re-surface any just-created parts the server hasn't caught up to yet
      mergePendingFolders(); // …and any just-created empty folders (same lag)
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

  // ✨ AI "generate a part" popover, anchored to the sidebar button beside the
  // ↻ RAG rebuild. AiMenu with NO session = generate-only; a success opens the
  // proposed graph in a FRESH tab via openGeneratedTab (the library-level flow,
  // distinct from the rail's in-place generate).
  let genMenuOpen = $state(false);
  let genBtnEl = $state<HTMLButtonElement | null>(null);
  let genMenuPos = $state<{ left: number; top: number }>({ left: 56, top: 120 });
  function openGenMenu() {
    if (genBtnEl) { const r = genBtnEl.getBoundingClientRect(); genMenuPos = { left: r.right + 6, top: r.top }; }
    genMenuOpen = true;
  }
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
  // The tree drives rendering (sortBy is applied to each node's parts in the
  // folderNode snippet); only the synthetic stdlib/stdstale src roots need a
  // pre-sorted Entry list here.
  let stdlibSorted    = $derived(sortBy(stdlib));
  let stdstaleSorted  = $derived(sortBy(stdstale));
  // Synthetic read-only tree roots for the engine SOURCES (git-tracked src,
  // NOT volume folders → no real path, no create/rename/trash). Rendered as
  // their own branches at the bottom of the tree.
  let stdlibNode = $derived<FolderNode>({ name: 'stdlib', path: '__stdlib', parts: stdlibSorted, children: [] });
  let stdstaleNode = $derived<FolderNode>({ name: 'stdstale', path: '__stdstale', parts: stdstaleSorted, children: [] });
  function toggleSortMode() {
    sortMode = sortMode === 'alpha' ? 'default' : 'alpha';
    try { localStorage.setItem('prim-sidebar-sort', sortMode); } catch { /* ignore */ }
  }
  onMount(() => {
    try {
      const te = localStorage.getItem('prim-tree-expanded');
      if (te) expanded = JSON.parse(te);
      const sm = localStorage.getItem('prim-sidebar-sort');
      if (sm === 'alpha' || sm === 'default') sortMode = sm;
      const at = localStorage.getItem('prim-active-tab');
      // Normalize legacy per-folder tab ids into the 3-tab scheme
      // (archive / __stdlib / __stdstale → INTERNAL; completions → WELL; else BASIC).
      if (at) {
        activeTab = (at === INTERNAL_TAB || at === 'basic' || at === 'completions')
          ? at
          : (['archive', '__stdlib', '__stdstale'].includes(at) ? INTERNAL_TAB : 'basic');
      }
    } catch { /* ignore */ }
  });

  /** Create a new entry by opening a fresh tab with the typed id. The
   *  file isn't written until the user clicks Save inside the editor —
   *  fetching /source for an id that doesn't exist 404s, GraphEditorPane
   *  treats that as a fresh graph + lets the first save create the file. */
  function createPartIn(dir: string) {
    const prompt = typeof window !== 'undefined' ? window.prompt : null;
    if (!prompt) return;
    const raw = prompt(`new part id in ${dir}/ (lowercase, _ allowed)`, '');
    if (!raw) return;
    const id = raw.trim();
    if (!ID_RE.test(id)) { alert(`bad id "${id}" — must match [a-z][a-z0-9_]*`); return; }
    // First Save lands the .prim.ts in this folder (location IS category,
    // Rule 16). The pane carries `createDir`.
    ensureExpanded(dir);
    void openTab(id, dir);
  }

  // ─── Single "+" create menu (per-folder New part / New folder) ─────────────
  /** The two-button ＋part / ＋subfolder hover affordance was replaced by ONE
   *  `+` button on each volume folder row that opens a small anchored popover
   *  (New part here / New folder here). Only one menu is open at a time. The
   *  popover is `position:fixed` (z-index 1000) so it escapes the rail's
   *  overflow:auto clipping; it dismisses on outside-click + Escape. */
  let createMenu = $state<{ path: string; x: number; y: number } | null>(null);
  function openCreateMenu(path: string, ev: MouseEvent) {
    ev.stopPropagation();
    if (createMenu?.path === path) { createMenu = null; return; }
    const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
    // Anchor just under the + button, nudged left so the menu doesn't overflow
    // the rail's right edge.
    createMenu = { path, x: Math.max(8, r.right - 150), y: r.bottom + 2 };
  }
  function closeCreateMenu() { createMenu = null; }
  function menuNewPart() { const p = createMenu?.path; closeCreateMenu(); if (p != null) createPartIn(p); }
  function menuNewFolder() { const p = createMenu?.path; closeCreateMenu(); if (p != null) void createSubfolderIn(p); }
  // Outside-click + Escape dismissal — only wired while a menu is open.
  $effect(() => {
    if (!createMenu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') closeCreateMenu(); };
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && t.closest('.prim-create-menu')) return; // click inside the menu
      if (t && t.closest('.prim-folder-add')) return;  // the + button toggles itself
      closeCreateMenu();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
    };
  });

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
<div class="prim-root" class:collapsed={sidebarCollapsed} class:no-sidebar={!embedCfg.sidebar} class:no-tabs={tabs.length === 0} style="--rail-w: {!embedCfg.sidebar || sidebarCollapsed ? 0 : railWidth}px">
  <!-- Floating expand handle — only when collapsed AND no tabs are open
       (empty state has no tab strip to host the inline ☰). With tabs open the
       ☰ lives inside the tab strip instead, so it can't overlap a tab.
       Hidden entirely when the embed config turns the sidebar off. -->
  {#if embedCfg.sidebar && sidebarCollapsed && tabs.length === 0}
    <button class="prim-rail-expand" type="button" title="Show the primitives sidebar" onclick={toggleSidebar}>☰</button>
  {/if}
  <!-- Parts-list sidebar + its resize divider — gated by the embed config
       (`?sidebar=0` lets an external host embed /primitives with its own nav). -->
  {#if embedCfg.sidebar}
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
      <!-- ✨ Generate a new part from a description (AI) — opens in a new tab. -->
      <button class="prim-rag-rebuild ai" type="button" bind:this={genBtnEl}
        class:active={genMenuOpen}
        title="Generate a new part from a description (AI)"
        onclick={() => (genMenuOpen ? (genMenuOpen = false) : openGenMenu())}>✨</button>
    </div>
    {#if genMenuOpen}
      <AiMenu pos={genMenuPos}
        onGenerated={(id, graph) => { openGeneratedTab(id, graph); genMenuOpen = false; }}
        onClose={() => (genMenuOpen = false)} />
    {/if}
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

    <!-- Reusable part (file) row — open / drag / rename / trash. `kind` is the
         provenance, which decides the badge + which row-actions are offered:
           volume   → vol badge,  ✎ rename + 🗑 soft-delete (→ archive/)
           archive  → arch badge, permanent 🗑 (irreversible), no rename
           stdlib   → src badge,  read-only (no rename / trash)
           stdstale → stale badge,read-only
         `depth` indents the row to match its folder nesting. -->
    {#snippet partRow(e: Entry, depth: number, kind: 'volume' | 'archive' | 'stdlib' | 'stdstale', dir: string)}
      {@const tag = kind === 'archive' ? 'arch' : kind === 'stdlib' ? 'src' : kind === 'stdstale' ? 'stale' : 'vol'}
      {@const canRename = kind === 'volume'}
      <!-- Windows-Explorer drop: a drag over a FILE row resolves to the file's
           ENCLOSING folder (`dir`), so dropping anywhere in an open folder's
           body — not just its name row — moves the item into that folder. The
           handlers are shared with the folder-row drop; `kind`/target self-gate
           (isDropTarget rejects stdlib/stdstale + illegal paths). -->
      {@const dropDir = resolveDropTargetFolder({ kind: 'file', parentPath: dir })}
      <div class="prim-row-wrap" class:active={tabs.some((t) => t.id === e.id)} class:renaming={renamingId === e.id}
        class:drop-into={dragOverPath === dropDir && dragOverPath !== ''}
        ondragover={(ev) => onFolderDragOver(ev, dropDir, kind)}
        ondragleave={() => onFolderDragLeave(dropDir)}
        ondrop={(ev) => onFolderDrop(ev, dropDir, kind)}
        role="presentation">
        {#if renamingId === e.id}
          <div class="prim-row prim-row-rename" style="padding-left: {12 + depth * 14}px">
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
            style="padding-left: {12 + depth * 14}px"
            draggable={!isCoarsePointer}
            ondragstart={(ev) => {
              if (ev.dataTransfer) {
                ev.dataTransfer.setData(PRIM_DND, e.id);
                // Source meta so a folder/tab drop knows the from-dir + provenance
                // (for the no-op guard + the read-only-src gate). copyMove allows
                // BOTH the canvas copy-drop and a folder move-drop.
                ev.dataTransfer.setData(PRIM_DND_FROM, JSON.stringify({ kind, dir }));
                ev.dataTransfer.effectAllowed = 'copyMove';
              }
            }}
            onclick={() => openTab(e.id)}
            oncontextmenu={(ev) => { if (kind === 'volume' || kind === 'archive') openRowMenu(e.id, kind, dir, e.source, canRename, ev); }}>
            <span class="prim-file-ic">📄</span>
            <span class="prim-name">{e.id}</span>
            <!-- `vol` is the common case → no badge (declutter); only the
                 exceptions (arch / src / stale) get a tag. -->
            {#if tag !== 'vol'}<span class="prim-tag {tag}">{tag}</span>{/if}
          </button>
          <!-- All row actions live in ONE ⋯ menu now (rename / move / copy /
               delete) — also opened by right-click on the row. Keeps the row
               compact. Read-only src groups (stdlib/stdstale) get no menu. -->
          {#if kind === 'volume' || kind === 'archive'}
            <button class="prim-kebab" type="button"
              title="Actions — rename, move, copy, delete (or right-click)"
              aria-label="Actions for {e.id}"
              disabled={moveBusy === e.id || deleteBusy === e.id}
              onclick={(ev) => openRowMenu(e.id, kind, dir, e.source, canRename, ev)}
              >{(moveBusy === e.id || deleteBusy === e.id) ? '…' : '⋯'}</button>
          {/if}
        {/if}
      </div>
    {/snippet}

    <!-- Recursive FOLDER node — chevron + 📁 + name + subtree count. Clicking
         the row expands/collapses IN PLACE; children (subfolders then files)
         render indented one level deeper. A filter forces every folder open
         and hides anything that doesn't match. `kind` propagates so an
         archive subtree gets permanent-delete + no create, src groups stay
         read-only, and volume folders offer a single `+` create menu on hover. -->
    {#snippet folderNode(node: FolderNode, depth: number, kind: 'volume' | 'archive' | 'stdlib' | 'stdstale')}
      {@const open = filter.trim() ? true : isExpanded(node.path)}
      {@const kids = sortFolders(node.children, sortMode).filter((n) => !filter.trim() || subtreeMatches(n, pass))}
      {@const files = sortBy(node.parts).filter(pass)}
      {@const folderDraggable = kind === 'volume' && !isCoarsePointer && !FOLDER_PROTECTED_ROOTS.has(node.path)}
      <div class="prim-tree-node">
        <div class="prim-folder-row-wrap">
          <button class="prim-folder-row" type="button"
            class:drop-target={dragOverPath === node.path}
            class:dragging={folderDragFrom === node.path}
            style="padding-left: {8 + depth * 14}px"
            title={folderDraggable
              ? `primitives/${node.path}/ — drag onto another folder to nest it`
              : `primitives/${node.path}/`}
            draggable={folderDraggable}
            ondragstart={(ev) => {
              if (!folderDraggable) return;
              if (ev.dataTransfer) {
                ev.dataTransfer.setData(FOLDER_DND, node.path);
                ev.dataTransfer.effectAllowed = 'move';
              }
              folderDragFrom = node.path;
            }}
            ondragend={() => { folderDragFrom = null; dragOverPath = null; }}
            ondragover={(ev) => onFolderDragOver(ev, node.path, kind)}
            ondragleave={() => onFolderDragLeave(node.path)}
            ondrop={(ev) => onFolderDrop(ev, node.path, kind)}
            onclick={() => toggleExpand(node.path)}>
            <span class="prim-chev">{open ? '▾' : '▸'}</span>
            <span class="prim-folder-ic">{open ? '📂' : '📁'}</span>
            <span class="prim-name">{depth === 0 ? tabLabel(node.name) : node.name}</span>
            <span class="prim-count">({subtreeCount(node)})</span>
          </button>
          {#if kind === 'volume'}
            <button class="prim-folder-add" class:open={createMenu?.path === node.path}
              type="button" aria-haspopup="menu"
              aria-expanded={createMenu?.path === node.path}
              title={`Folder actions — new part / folder, rename, delete (primitives/${node.path}/)`}
              onclick={(ev) => openCreateMenu(node.path, ev)}>⋯</button>
          {/if}
        </div>
        {#if open}
          {#each kids as c (c.path)}
            {@render folderNode(c, depth + 1, kind)}
          {/each}
          {#each files as e (e.id)}
            {@render partRow(e, depth + 1, kind, node.path)}
          {/each}
          {#if kids.length === 0 && files.length === 0}
            <div class="prim-empty" style="padding-left: {12 + (depth + 1) * 14}px">{filter.trim() ? 'no matches' : 'empty'}</div>
          {/if}
        {/if}
      </div>
    {/snippet}

    <!-- Body = a thin LEFT vertical-tab rail of THREE main tabs (Internal /
         Basic / Well) + the scoped file tree to its right. Each tab SCOPES the
         tree to that group (activeView) — Internal nests ARCHIVED / STDLIB /
         STALE folders; Basic + Well show their volume subtrees; subfolders
         within a branch still expand/collapse in place. See
         docs/plans/sidebar-reorg.md. -->
    <div class="prim-body">
    <!-- THREE fixed main tabs (docs/plans/sidebar-reorg.md):
           INTERNAL → ARCHIVED / STDLIB / STALE folders (system / read-only / trash)
           BASIC    → volume basic/ parts (+ any other user top folder)
           WELL     → volume completions/<family>/…  (downhole completions)
         BASIC + WELL double as cross-branch drop targets (drop a part onto them
         to move it to basic / — completions rejects a bare drop, needs a family);
         INTERNAL routes a drop to archive/ (soft delete). -->
    <nav class="prim-tabrail" role="tablist" aria-label="Primitive categories">
      <!-- When collapsed the rail shrinks to just this tab strip; the » button
           re-expands it to the full tree. (Clicking any tab expands too, via
           selectTab.) Hidden when expanded — the header « handles collapse. -->
      {#if sidebarCollapsed}
        <button class="prim-tabrail-expand" type="button"
          title="Expand the sidebar" aria-label="Expand the sidebar"
          onclick={toggleSidebar}>»</button>
      {/if}
      <button class="prim-tabbtn src" class:active={activeTab === INTERNAL_TAB}
        class:drop-target={dragOverPath === 'archive'}
        role="tab" type="button" aria-selected={activeTab === INTERNAL_TAB}
        title="Internal — archived parts + read-only engine sources (stdlib / stale). Drop a part here to archive it."
        ondragover={(ev) => onFolderDragOver(ev, 'archive', 'archive')}
        ondragleave={() => onFolderDragLeave('archive')}
        ondrop={(ev) => onFolderDrop(ev, 'archive', 'archive')}
        onclick={() => selectTab(INTERNAL_TAB)}>Internal</button>
      <button class="prim-tabbtn" class:active={activeTab === 'basic'}
        class:drop-target={dragOverPath === 'basic'}
        role="tab" type="button" aria-selected={activeTab === 'basic'}
        title="Basic — general parts (primitives/basic/)"
        ondragover={(ev) => onFolderDragOver(ev, 'basic', 'volume')}
        ondragleave={() => onFolderDragLeave('basic')}
        ondrop={(ev) => onFolderDrop(ev, 'basic', 'volume')}
        onclick={() => selectTab('basic')}>Basic</button>
      <button class="prim-tabbtn" class:active={activeTab === 'completions'}
        class:drop-target={dragOverPath === 'completions'}
        role="tab" type="button" aria-selected={activeTab === 'completions'}
        title="Well — downhole completions (primitives/completions/<family>/)"
        ondragover={(ev) => onFolderDragOver(ev, 'completions', 'volume')}
        ondragleave={() => onFolderDragLeave('completions')}
        ondrop={(ev) => onFolderDrop(ev, 'completions', 'volume')}
        onclick={() => selectTab('completions')}>Well</button>
    </nav>

    <!-- ONE expand/collapse file tree. Volume folders first (archive subtree
         flagged so its files get permanent-delete), then the read-only engine
         SRC groups (stdlib / stdstale) as their own branches, then a ⛁ Cache
         footer row that swaps the MAIN panel to the bake-cache inspector. -->
    <div class="prim-tree-scroll prim-rail-scroll">

      {#if listLoading}<div class="prim-empty">loading…</div>{/if}
      {#if listError}<div class="prim-error">list failed: {listError}</div>{/if}

      <!-- Toolbar scoped to the ACTIVE tab: a `+` to create a part/folder
           directly in this top-level folder (volume only) + the global
           ＋folder to add a new top-level folder. -->
      <div class="prim-tree-toolbar">
        {#if activeView.createPath}
          <button class="prim-mini" type="button"
            title={`New part or folder in primitives/${activeView.createPath}/`}
            onclick={(ev) => openCreateMenu(activeView.createPath!, ev)}>＋ new</button>
        {/if}
        <button class="prim-mini" type="button"
          title="New top-level folder — creates primitives/<name>/ on the volume"
          disabled={folderBusy} onclick={addTopFolder}>＋ folder</button>
      </div>

      <!-- The tree is SCOPED to the active MAIN tab (activeView). Each folder row
           carries its own kind so INTERNAL can nest archive (permanent-delete) +
           read-only stdlib / stale side-by-side; Basic/Well render their volume
           subtree. The tab itself is the branch header — no redundant top row. -->
      {#if activeView}
        {@const vFolders = sortRenderFolders(activeView.folders).filter((rf) => !filter.trim() || subtreeMatches(rf.node, pass))}
        {@const vFiles = sortRenderFiles(activeView.files).filter((rf) => pass(rf.entry))}
        {#each vFolders as rf (rf.node.path)}
          {@render folderNode(rf.node, 0, rf.kind)}
        {/each}
        {#each vFiles as rf (rf.entry.id)}
          {@render partRow(rf.entry, 0, rf.kind, rf.dir)}
        {/each}
        {#if vFolders.length === 0 && vFiles.length === 0}
          <div class="prim-empty">{filter.trim() ? 'no matches' : 'empty'}</div>
        {/if}
      {/if}

      <!-- ⛁ Bake-cache inspector — a non-folder leaf; selecting it swaps the
           main area to <CacheBrowser/>. -->
      <button class="prim-cache-row" class:active={showCache} type="button"
        title="Bake-cache inspector (local volume, not proxied)"
        onclick={() => { showCache = !showCache; }}>
        <span class="prim-folder-ic">⛁</span>
        <span class="prim-name">Cache</span>
      </button>

    </div><!-- /.prim-tree-scroll -->
    </div><!-- /.prim-body -->

    <!-- Single "+" create menu — anchored popover (one at a time). position:fixed
         so it escapes the rail's overflow:auto clipping (memory
         floating_panel_z_index). Dismisses on outside-click / Escape. -->
    {#if createMenu}
      <div class="prim-create-menu" role="menu"
        style="left: {createMenu.x}px; top: {createMenu.y}px">
        <div class="prim-create-menu-head">primitives/{createMenu.path}/</div>
        <button class="prim-create-menu-item" type="button" role="menuitem"
          onclick={menuNewPart}>＋ New part here</button>
        <button class="prim-create-menu-item" type="button" role="menuitem"
          disabled={folderBusy} onclick={menuNewFolder}>📁 New folder here</button>
        {#if isEditableFolder(createMenu.path)}
          {@const mt = moveFolderDestFor(createMenu.path)}
          <div class="prim-create-menu-sep"></div>
          {#if mt}
            <button class="prim-create-menu-item" type="button" role="menuitem"
              title={`Move this folder (and its parts) to the ${mt.label} tab — primitives/${mt.dest}/`}
              disabled={folderBusy} onclick={menuMoveFolder}>↔ Move to {mt.label}</button>
          {/if}
          <button class="prim-create-menu-item" type="button" role="menuitem"
            disabled={folderBusy} onclick={menuRenameFolder}>✎ Rename folder</button>
          <button class="prim-create-menu-item danger" type="button" role="menuitem"
            disabled={folderBusy} onclick={menuDeleteFolder}>🗑 Delete folder</button>
        {/if}
      </div>
    {/if}

    <!-- Recursive DESTINATION node for the Move/Copy picker — mirrors the
         sidebar's folderNode: an indented, clickable folder row + its children
         one level deeper. Selecting a row (top-level OR nested) picks it as the
         move target ("into this exact folder"). The source folder is disabled
         for Move (can't move onto itself) but allowed for Copy (dup in place). -->
    {#snippet moveTargetNode(node: FolderNode, depth: number, excludeDir: string)}
      {@const selectable = isMoveTarget(node.path, excludeDir)}
      {@const isSource = node.path === moveMenu?.fromDir}
      <button class="prim-move-target" type="button" role="menuitem"
        class:source={isSource} disabled={!selectable}
        style="padding-left: {8 + depth * 14}px"
        title={selectable ? `Move into primitives/${node.path}/` : `primitives/${node.path}/`}
        onclick={() => selectable && pickMoveTarget(node.path)}>
        <span class="prim-folder-ic">📁</span>
        <span class="prim-name">{depth === 0 ? tabLabel(node.name) : node.name}</span>
        {#if isSource}<span class="prim-move-here">here</span>{/if}
      </button>
      {#each sortFolders(node.children, sortMode) as c (c.path)}
        {@render moveTargetNode(c, depth + 1, excludeDir)}
      {/each}
    {/snippet}

    <!-- "Move/Copy to…" picker — anchored popover (one at a time). A vertical
         tab rail of the top-level volume folders (archive / basic / completions
         / any user folder — NOT the read-only stdlib/stdstale src groups, which
         aren't in the tree) with the selected tab's subfolders shown as an
         indented, clickable tree on the right (mirrors the sidebar). Clicking a
         folder — top-level tab OR nested node — sets the move target.
         position:fixed to escape the rail's overflow clipping; dismisses on
         outside-click / Escape (same as the create menu). -->
    {#if moveMenu}
      <!-- Copy can target the CURRENT folder too (a duplicate in place), so it
           excludes nothing; Move excludes the source folder. -->
      {@const excludeDir = moveMenu.mode === 'copy' ? '' : moveMenu.fromDir}
      {@const tabs = topFolders}
      {@const activeTabName = tabs.some((f) => f.name === moveMenuTab) ? moveMenuTab : (tabs[0]?.name ?? '')}
      {@const activeNode = nodeAt(tree, activeTabName)}
      <div class="prim-move-menu prim-move-picker" role="menu"
        style="left: {moveMenu.x}px; top: {moveMenu.y}px">
        <div class="prim-create-menu-head">{moveMenu.mode === 'copy' ? 'Copy' : 'Move'} {moveMenu.id} to…</div>
        {#if tabs.length === 0}
          <div class="prim-move-empty">no folders</div>
        {:else}
          <div class="prim-move-picker-body">
            <!-- LEFT: vertical tab rail of top-level folders. -->
            <div class="prim-move-tabs" role="tablist" aria-label="Destination category">
              {#each tabs as tf (tf.path)}
                <button class="prim-move-tab" type="button" role="tab"
                  class:active={tf.name === activeTabName}
                  aria-selected={tf.name === activeTabName}
                  title={`primitives/${tf.path}/`}
                  onclick={() => (moveMenuTab = tf.name)}>{tabLabel(tf.name)}</button>
              {/each}
            </div>
            <!-- RIGHT: the selected tab's subtree, clickable to pick a target. -->
            <div class="prim-move-tree">
              {#if activeNode}
                {@render moveTargetNode(activeNode, 0, excludeDir)}
              {:else}
                <div class="prim-move-empty">empty</div>
              {/if}
            </div>
          </div>
        {/if}
      </div>
    {/if}

    <!-- Per-row actions menu — the single ⋯ kebab / right-click popover. Move &
         Copy hand off to the moveMenu above; Rename + Delete fire inline. -->
    {#if rowMenu}
      <div class="prim-move-menu prim-row-menu" role="menu"
        style="left: {rowMenu.x}px; top: {rowMenu.y}px">
        <div class="prim-create-menu-head">{rowMenu.id}</div>
        {#if rowMenu.canRename}
          <button class="prim-create-menu-item" type="button" role="menuitem"
            onclick={rowMenuRename}>✎ Rename</button>
        {/if}
        <button class="prim-create-menu-item" type="button" role="menuitem"
          onclick={() => rowMenuMoveCopy('move')}>↪ Move to…</button>
        <button class="prim-create-menu-item" type="button" role="menuitem"
          onclick={() => rowMenuMoveCopy('copy')}>⎘ Copy to…</button>
        <button class="prim-create-menu-item danger" type="button" role="menuitem"
          onclick={rowMenuDelete}>{rowMenu.kind === 'archive' ? '🗑 Delete permanently' : '🗑 Archive'}</button>
      </div>
    {/if}

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
  {/if}

  <main class="prim-main">
    {#if showCache}
      <!-- ⛁ Cache row active — the inspector replaces the editor tab strip. -->
      <CacheBrowser active={true} />
    {:else if tabs.length === 0}
      <div class="prim-empty-state">
        <p>No primitives open.</p>
        <p>Click a primitive in the sidebar to open it in a tab. Each tab embeds the graph editor.</p>
      </div>
    {:else}
      <!-- Tab strip — clicking flips activeKey without unmounting the iframe.
           The iframe stays loaded so flipping back to a tab is instant. -->
      <div class="prim-tabs">
        {#if embedCfg.sidebar && sidebarCollapsed}
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
            <GraphEditorPane id={t.id} embed={embedPartial ?? true} onOpenTab={openTab} active={activeKey === t.key} seedGraph={t.seedGraph}
              createDir={t.createDir}
              onSaved={onPartSaved}
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
  /* ✨ generate-a-part button — violet accent to match the AI family. */
  .prim-rag-rebuild.ai { color: #7c3aed; }
  .prim-rag-rebuild.ai:hover:not(:disabled), .prim-rag-rebuild.ai.active { background: #f5f3ff; border-color: #c4b5fd; color: #6d28d9; }
  /* Quiet footnote under the filter row — count + last refreshed Xm ago.
     Pulls the eye only when something's wrong (error state goes red). */
  .prim-rag-foot {
    margin: 2px 14px 6px;
    font: 10px Arial; color: #78716c;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .prim-rag-err { color: #b91c1c; }

  /* ─── Single expand/collapse file tree ───────────────────────────────── */
  /* The whole sidebar body is ONE scrolling tree (Windows-Explorer / VS-Code
     style): folder rows expand/collapse in place, files nest underneath,
     subfolders open beside their siblings. Indent is applied inline per
     depth so there's no fixed per-level class to maintain. */
  .prim-tree-scroll { padding-bottom: 8px; min-width: 0; }

  /* Body = horizontal split: a narrow LEFT vertical-tab rail + the file tree.
     Fills the remaining rail height after the header + filter + RAG foot. */
  .prim-body {
    display: flex; flex-direction: row;
    flex: 1 1 0; min-height: 0; min-width: 0;
    /* Cap the folder/file window at 80% of the viewport so a long file list
       scrolls internally (.prim-rail-scroll) instead of running to the very
       bottom edge of the sidebar. */
    max-height: 80vh;
  }
  /* Vertical jump rail — a left column of filing-cabinet tabs whose labels are
     rotated to read top→bottom. Scrolls if there are many folders. Clicking a
     tab expands + scrolls its top-level folder into view (jumpToFolder). */
  .prim-tabrail {
    flex: 0 0 auto;
    display: flex; flex-direction: column; gap: 3px;
    padding: 6px 5px;
    border-right: 1px solid #e5e7eb; background: #f3f4f6;
    overflow-y: auto; overflow-x: hidden;
    scrollbar-width: thin; scrollbar-color: #cbd5e1 #f3f4f6;
  }
  .prim-tabbtn {
    flex: 0 0 auto;
    writing-mode: vertical-rl;            /* text runs top→bottom */
    display: flex; align-items: center; justify-content: center;
    padding: 8px 4px; border: 1px solid transparent; border-radius: 5px;
    background: transparent; cursor: pointer;
    font: 600 11px Arial; color: #44403c;
    text-transform: uppercase; letter-spacing: 0.6px;
    white-space: nowrap; min-height: 60px;
    transition: background 100ms, color 100ms, border-color 100ms;
  }
  .prim-tabbtn:hover { background: #e7e5e4; }
  /* Active = that top-level folder is currently expanded in the tree. */
  .prim-tabbtn.active { background: #0c4a6e; color: #fff; border-color: #0c4a6e; }
  /* SRC tabs (stdlib / stdstale) — blue tint for read-only provenance. */
  .prim-tabbtn.src { color: #1e40af; }
  .prim-tabbtn.src.active { background: #1e3a8a; color: #fff; border-color: #1e3a8a; }
  .prim-tree-toolbar {
    display: flex; gap: 6px; padding: 6px 12px;
    border-bottom: 1px solid #f3f4f6;
  }
  .prim-mini {
    padding: 3px 8px; border: 1px solid #d6d3d1; border-radius: 4px;
    background: #fff; cursor: pointer; font: 11px Arial; color: #44403c;
  }
  .prim-mini:hover:not(:disabled) { background: #d1fae5; border-color: #86efac; color: #166534; }
  .prim-mini:disabled { cursor: wait; opacity: 0.5; }

  /* Folder row — chevron + 📁 + name + count. The wrap hosts the row button
     plus the hover-revealed single `+` create-menu trigger as a sibling
     (can't nest <button>s). */
  .prim-folder-row-wrap { display: flex; align-items: stretch; }
  .prim-folder-row-wrap:hover .prim-folder-row { background: #e7e5e4; }
  .prim-folder-row-wrap:hover .prim-folder-add,
  .prim-folder-add.open { opacity: 0.85; }
  .prim-folder-row {
    display: flex; align-items: center; gap: 6px; flex: 1 1 auto; min-width: 0;
    padding: 5px 12px; background: transparent; border: 0; cursor: pointer;
    text-align: left; font: 600 12px Arial; color: #292524;
  }
  .prim-folder-ic { font-size: 13px; flex: 0 0 auto; }
  .prim-file-ic { font-size: 11px; flex: 0 0 auto; opacity: 0.65; }
  .prim-chev {
    flex: 0 0 auto; width: 10px; color: #78716c; font-size: 9px; line-height: 1;
  }
  /* Hover-revealed single `+` create trigger — green so it reads as "create".
     Opens the anchored New part / New folder popover. */
  .prim-folder-add {
    flex: 0 0 auto;
    min-width: 24px; padding: 0 7px; background: transparent; border: 0;
    color: #15803d; cursor: pointer; font: 700 15px Arial; line-height: 1;
    opacity: 0; transition: opacity 100ms, background 100ms;
    display: flex; align-items: center; justify-content: center;
  }
  .prim-folder-add:hover, .prim-folder-add.open { opacity: 1 !important; background: #d1fae5; color: #166534; }

  /* Anchored create-menu popover (position:fixed, z-index 1000 — escapes the
     rail's overflow clipping; see floating_panel_z_index memory). */
  .prim-create-menu {
    position: fixed; z-index: 1000; min-width: 150px;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16); padding: 4px;
    display: flex; flex-direction: column; gap: 1px;
  }
  .prim-create-menu-head {
    padding: 4px 8px 6px; font: 600 10px Arial; color: #a8a29e;
    border-bottom: 1px solid #f3f4f6; margin-bottom: 2px;
    /* Wrap instead of clipping — a long "Move <id> to…" / "primitives/<path>/"
       header was ellipsis-truncated at 240px and read as cut off. */
    white-space: normal; overflow-wrap: anywhere; max-width: 260px;
  }
  .prim-create-menu-item {
    text-align: left; padding: 6px 10px; border: 0; border-radius: 4px;
    background: transparent; cursor: pointer; font: 12px Arial; color: #292524;
  }
  .prim-create-menu-item:hover:not(:disabled) { background: #d1fae5; color: #166534; }
  .prim-create-menu-item:disabled { cursor: wait; opacity: 0.5; }
  .prim-create-menu-sep { height: 1px; margin: 4px 6px; background: #e7e5e4; }

  /* "Move to…" dialog — same anchored-popover chrome as the create menu, but
     scrollable (a part can have many destination folders). Reuses
     .prim-create-menu-head + .prim-create-menu-item for the rows. */
  .prim-move-menu {
    position: fixed; z-index: 1000; min-width: 190px; max-height: 320px;
    overflow-y: auto;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 6px;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.16); padding: 4px;
    display: flex; flex-direction: column; gap: 1px;
  }
  .prim-move-empty { padding: 6px 10px; font: 11px Arial; color: #a8a29e; }

  /* Tabbed-tree destination picker — a vertical tab rail of top-level folders +
     the selected tab's indented subtree (mirrors the sidebar folder tree). */
  .prim-move-picker { min-width: 300px; padding: 4px 4px 6px; }
  .prim-move-picker-body { display: flex; align-items: stretch; gap: 6px; min-height: 60px; max-height: 300px; }
  .prim-move-tabs {
    flex: 0 0 auto; display: flex; flex-direction: column; gap: 2px;
    padding-right: 6px; border-right: 1px solid #e7e5e4; overflow-y: auto; max-width: 130px;
  }
  .prim-move-tab {
    text-align: left; white-space: nowrap; padding: 4px 8px; border: 0; border-radius: 4px;
    background: transparent; color: #44403c; font: 12px Arial; cursor: pointer;
  }
  .prim-move-tab:hover { background: #f3f4f6; }
  .prim-move-tab.active { background: #d1fae5; color: #166534; font-weight: 600; }
  .prim-move-tree { flex: 1 1 auto; overflow-y: auto; min-width: 150px; }
  .prim-move-target {
    display: flex; align-items: center; gap: 4px; width: 100%; text-align: left;
    padding: 4px 8px; border: 0; border-radius: 4px; background: transparent;
    color: #1c1917; font: 12px Arial; cursor: pointer;
  }
  .prim-move-target .prim-name { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prim-move-target:hover:not(:disabled) { background: #d1fae5; color: #166534; }
  .prim-move-target:disabled { cursor: default; color: #a8a29e; }
  .prim-move-target.source { font-style: italic; }
  .prim-move-here { flex: 0 0 auto; font: 10px Arial; color: #a8a29e; }

  /* Move (↪) row action — blue like rename (it's an "edit", not a delete),
     hover-revealed beside ✎. Always reachable for volume + archive parts. */
  .prim-row-wrap:hover .prim-move { opacity: 0.85; }
  .prim-move {
    flex: 0 0 auto;
    width: 22px; padding: 0; background: transparent; border: 0; cursor: pointer;
    font-size: 13px; color: #0369a1; opacity: 0;
    transition: opacity 100ms, background 100ms;
  }
  .prim-move:hover { opacity: 1 !important; background: #e0f2fe; }
  .prim-move:disabled { cursor: wait; opacity: 0.4 !important; }

  /* The single ⋯ row-actions kebab — hover-revealed, opens the row menu. */
  .prim-row-wrap:hover .prim-kebab { opacity: 0.8; }
  .prim-kebab {
    flex: 0 0 auto;
    width: 22px; padding: 0; background: transparent; border: 0; cursor: pointer;
    font: 700 16px Arial; line-height: 1; color: #57534e; opacity: 0;
    transition: opacity 100ms, background 100ms;
  }
  .prim-kebab:hover { opacity: 1 !important; background: #f3f4f6; color: #1f2937; }
  .prim-kebab:disabled { cursor: wait; opacity: 0.4 !important; }
  /* Delete row in the actions menu — red so it reads as destructive. */
  .prim-create-menu-item.danger { color: #b91c1c; }
  .prim-create-menu-item.danger:hover:not(:disabled) { background: #fee2e2; color: #991b1b; }

  /* Drop-target highlight while dragging a part over a folder row / top tab —
     green wash + inset ring so the target reads clearly during the drag. */
  .prim-folder-row.drop-target { background: #dcfce7; box-shadow: inset 0 0 0 2px #86efac; }
  /* A draggable (user-movable) folder gets the grab cursor, like part rows. */
  .prim-folder-row[draggable="true"] { cursor: grab; }
  .prim-folder-row[draggable="true"]:active { cursor: grabbing; }
  .prim-folder-row.dragging { opacity: 0.55; }
  .prim-tabbtn.drop-target { background: #166534; color: #fff; border-color: #166534; }
  /* Dropping over a FILE row lands in its enclosing folder (Explorer-style):
     the folder header lights up (.drop-target above), and every file row in
     that folder gets a subtle wash so the whole folder body reads as the
     landing zone. Lighter than the header so the container still dominates. */
  .prim-row-wrap.drop-into { background: #f0fdf4; box-shadow: inset 2px 0 0 #86efac; }

  /* ⛁ Cache footer row — amber tint so the inspector reads as a distinct
     utility surface, not a part folder; inverts to amber when active. */
  .prim-cache-row {
    display: flex; align-items: center; gap: 6px; width: 100%;
    margin-top: 6px; padding: 6px 12px;
    border: 0; border-top: 1px solid #f3f4f6; background: transparent;
    cursor: pointer; text-align: left; font: 600 12px Arial; color: #92400e;
  }
  .prim-cache-row:hover { background: #fef3c7; }
  .prim-cache-row.active { background: #92400e; color: #fff; }

  .prim-count { color: #a8a29e; font-weight: 400; font-size: 10px; }

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
  /* Collapsed (desktop + mobile LANDSCAPE): the rail shrinks to a thin
     vertical-tab strip (VS-Code activity-bar style) — the .prim-tabrail stays
     visible while the header, filter, RAG foot and the scrolling tree are
     hidden. The resize divider is gone (nothing to resize at this width). The
     first grid track sizes to the strip's content (max-content); main fills
     the rest. Portrait overrides this with its own full-collapse below. */
  .prim-root.collapsed { grid-template-columns: max-content minmax(0, 1fr); }
  .prim-root.collapsed .prim-rail-divider { display: none; }
  .prim-root.collapsed .prim-rail > header,
  .prim-root.collapsed .prim-filter-row,
  .prim-root.collapsed .prim-rag-foot,
  .prim-root.collapsed .prim-tree-scroll { display: none; }
  /* The strip owns the rail's right border now (the tree pane is gone). */
  .prim-root.collapsed .prim-rail { border-right: none; }
  /* Embed config `sidebar:false` — the rail + divider aren't rendered, so the
     three-track grid collapses to a single column the editor fills. Declared
     AFTER `.collapsed` so it wins when a stale `prim-rail-collapsed` also set
     that class (same specificity → source order decides). */
  .prim-root.no-sidebar { grid-template-columns: minmax(0, 1fr); }
  .prim-root.collapsed .prim-tabrail { border-right: 1px solid #e5e7eb; }
  /* » re-expand chip pinned at the top of the collapsed tab strip. */
  .prim-tabrail-expand {
    flex: 0 0 auto; align-self: center;
    width: 26px; height: 24px; margin: 0 0 6px; padding: 0;
    background: #fff; border: 1px solid #cbd5e1; border-radius: 4px;
    font: 14px Arial; color: #475569; cursor: pointer; line-height: 1;
  }
  .prim-tabrail-expand:hover { background: #f1f5f9; color: #1e293b; }
  /* The legacy ☰ expand chips (floating + inline-in-tabstrip) are only needed
     by the mobile-PORTRAIT full-collapse path (rail hidden there). On desktop
     / landscape the thin rail's » button replaces them, so hide them. */
  .prim-rail-expand { display: none; }
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
    /* Collapsed: in portrait the rail stacks ABOVE the editor, so the thin
       vertical-tab strip used on desktop doesn't fit — fall back to the full
       collapse (rail display:none) and bring back the floating / inline ☰
       expand chips. .prim-main is then the ONLY grid item left — it must land
       on a SINGLE 1fr track. A two-track `0 1fr` would auto-place the lone
       main onto the leading `0` and blank the whole screen. */
    .prim-root.collapsed .prim-rail { display: none; }
    .prim-rail-expand { display: inline-flex; align-items: center; justify-content: center; }
    .prim-root.collapsed { grid-template-rows: minmax(0, 1fr) !important; }
    /* Embed config `sidebar:false` in portrait — no rail row; the editor is the
       lone grid item, so give it a single full-height row/column. */
    .prim-root.no-sidebar { grid-template-rows: minmax(0, 1fr) !important; grid-template-columns: 1fr !important; }
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
