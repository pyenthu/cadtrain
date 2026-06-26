<script lang="ts">
  /**
   * /volume — a file manager for the persistent data volume.
   *
   * Walks the volume tree via the /api/volume CRUD endpoint. Left pane:
   * breadcrumb + dir/file listing with upload / new-folder / delete.
   * Right pane: inline preview — images, video, PDF, text — and an
   * editor for text files (save writes back via PUT).
   *
   * In local dev with CADTRAIN_VOLUME_REMOTE_URL set, every /api/volume
   * call proxies to the live Railway volume (/app_data) — so this page
   * is editing PRODUCTION. Without the proxy it's the local volume root.
   */
  import { onMount } from 'svelte';
  import { dev } from '$app/environment';

  interface FileNode { name: string; type: 'file'; id: string; size: number | null }
  interface DirNode { name: string; type: 'dir'; id: string; children: Record<string, FileNode | DirNode> }
  type Node = FileNode | DirNode;

  let currentPath = $state('');
  let dir = $state<DirNode | null>(null);
  let loading = $state(true);
  let loadError = $state<string | null>(null);

  let selected = $state<FileNode | null>(null);
  let previewKind = $state<'image' | 'video' | 'pdf' | 'text' | 'binary' | null>(null);
  let previewText = $state<string>('');
  let previewLoading = $state(false);

  // ── Mutation state ──────────────────────────────────────────────────
  let actionBusy = $state(false);
  let actionError = $state<string | null>(null);
  let showNewFolder = $state(false);
  let newFolderName = $state('');
  let editing = $state(false);
  let editText = $state('');
  let editSaving = $state(false);
  let fileInput: HTMLInputElement | null = $state(null);

  // ── Backup (volume → src/volume_backup) ─────────────────────────────
  let backing = $state(false);
  let backupMsg = $state<string | null>(null);
  async function runBackup() {
    if (backing) return;
    backing = true;
    backupMsg = 'Backing up…';
    try {
      const r = await fetch('/api/volume/backup', { method: 'POST' });
      const j = await r.json().catch(() => null);
      if (!r.ok) throw new Error(j?.message || `${r.status}`);
      const ok = j?.errorCount ? ` (${j.errorCount} errors)` : '';
      backupMsg = `Copied ${j.files} files · ${humanSize(j.bytes)} → src/volume_backup${ok}`;
    } catch (e: any) {
      backupMsg = `Backup failed: ${e?.message ?? e}`;
    } finally {
      backing = false;
    }
  }

  // ── OneDrive sync (PROD volume → onedrive:APPS/cadtrain) ─────────────
  let syncing = $state(false);
  let oneDriveMsg = $state<string | null>(null);
  // Dry-run toggle (shared by "Sync all" + "Sync selected"): preview only,
  // nothing is written to OneDrive.
  let dryRun = $state(false);
  async function runOneDrive() {
    if (syncing) return;
    if (!dryRun && !confirm('Mirror the PRODUCTION volume up to OneDrive (APPS/cadtrain)?\nReplaced/deleted files are kept under APPS/cadtrain-prev/.')) return;
    syncing = true;
    oneDriveMsg = dryRun ? 'Previewing full sync (dry run)…' : 'Syncing to OneDrive…';
    try {
      const r = await fetch('/api/volume/onedrive', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ dryRun }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.output || `${r.status}`);
      const head = dryRun ? '◑ Dry run — full sync preview (nothing written)' : (j?.summary || 'Synced → onedrive:APPS/cadtrain');
      oneDriveMsg = j?.output ? `${head}\n\n${j.output}` : head;
    } catch (e: any) {
      oneDriveMsg = `OneDrive sync failed: ${e?.message ?? e}`;
    } finally {
      syncing = false;
    }
  }

  // ── Selective sync (only the checked paths → OneDrive, non-destructive) ─
  let selSyncing = $state(false);
  async function runSyncSelected() {
    if (selSyncing) return;
    const paths = [...selectedPaths];
    if (paths.length === 0) return;
    if (!dryRun && !confirm(`Upload ${paths.length} selected file${paths.length === 1 ? '' : 's'} to OneDrive (${diff?.dest})?\nNon-destructive — overwritten files are kept under -prev/<ts>.`)) return;
    selSyncing = true;
    oneDriveMsg = dryRun ? `Previewing upload of ${paths.length} file(s) (dry run)…` : `Uploading ${paths.length} file(s)…`;
    try {
      const r = await fetch('/api/volume/onedrive/sync-paths', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ paths, dryRun }),
      });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.ok === false) throw new Error(j?.message || j?.output || `${r.status}`);
      const head = j?.summary || (dryRun ? 'Dry run complete' : 'Selective sync complete');
      oneDriveMsg = j?.output ? `${head}\n\n${j.output}` : head;
    } catch (e: any) {
      oneDriveMsg = `Selective sync failed: ${e?.message ?? e}`;
    } finally {
      selSyncing = false;
    }
  }

  // ── Volume ⇄ OneDrive diff (metadata: path + size — fast, no download) ─
  type DiffEntry = { path: string; status: 'new' | 'gone' | 'changed' | 'match'; local: number | null; remote: number | null };
  let diffing = $state(false);
  let diffMsg = $state<string | null>(null);
  let diff = $state<{ dest: string; counts: Record<string, number>; entries: DiffEntry[] } | null>(null);
  async function runDiff() {
    if (diffing) return;
    diffing = true; diffMsg = 'Comparing volume vs OneDrive…'; diff = null;
    selectedPaths = new Set(); collapsed = new Set();
    try {
      const r = await fetch('/api/volume/onedrive/diff', { method: 'POST' });
      const j = await r.json().catch(() => null);
      if (!r.ok || j?.ok === false) throw new Error(j?.message || `${r.status}`);
      diff = j; diffMsg = null;
    } catch (e: any) {
      diffMsg = `Diff failed: ${e?.message ?? e}`;
    } finally {
      diffing = false;
    }
  }
  const DIFF_GLYPH: Record<string, string> = { new: '+', gone: '−', changed: '~', match: '=' };
  const DIFF_LABEL: Record<string, string> = { new: 'only in the volume', gone: 'only on OneDrive', changed: 'size differs', match: 'in sync' };

  // ── Folder-tree grouping of the diff entries (client-side transform) ──
  // Only non-`match` entries are placed into the tree, so any folder that
  // appears contains at least one difference. Each folder rolls up its
  // descendants' +/−/~ counts; `new`+`changed` files are SELECTABLE for a
  // copy-up (a `gone` file is only on OneDrive — a copy can't act on it).
  type TreeFile = { kind: 'file'; name: string; path: string; entry: DiffEntry };
  type TreeDir = {
    kind: 'dir'; name: string; path: string; children: TreeNode[];
    counts: { new: number; gone: number; changed: number };
    selectable: string[]; // descendant file paths eligible for upload
  };
  type TreeNode = TreeFile | TreeDir;

  function buildTree(entries: DiffEntry[]): TreeDir {
    const root: TreeDir = { kind: 'dir', name: '', path: '', children: [], counts: { new: 0, gone: 0, changed: 0 }, selectable: [] };
    const dirs = new Map<string, TreeDir>([['', root]]);
    const ensureDir = (path: string): TreeDir => {
      const existing = dirs.get(path);
      if (existing) return existing;
      const idx = path.lastIndexOf('/');
      const parent = ensureDir(idx >= 0 ? path.slice(0, idx) : '');
      const d: TreeDir = { kind: 'dir', name: idx >= 0 ? path.slice(idx + 1) : path, path, children: [], counts: { new: 0, gone: 0, changed: 0 }, selectable: [] };
      dirs.set(path, d);
      parent.children.push(d);
      return d;
    };
    for (const e of entries) {
      if (e.status === 'match') continue;
      const idx = e.path.lastIndexOf('/');
      const parent = ensureDir(idx >= 0 ? e.path.slice(0, idx) : '');
      parent.children.push({ kind: 'file', name: idx >= 0 ? e.path.slice(idx + 1) : e.path, path: e.path, entry: e });
    }
    const finalize = (d: TreeDir): void => {
      for (const c of d.children) if (c.kind === 'dir') finalize(c);
      d.children.sort((a, b) => (a.kind !== b.kind ? (a.kind === 'dir' ? -1 : 1) : a.name.localeCompare(b.name)));
      for (const c of d.children) {
        if (c.kind === 'dir') {
          d.counts.new += c.counts.new; d.counts.gone += c.counts.gone; d.counts.changed += c.counts.changed;
          d.selectable.push(...c.selectable);
        } else {
          const s = c.entry.status;
          if (s === 'new' || s === 'gone' || s === 'changed') d.counts[s]++;
          if (s === 'new' || s === 'changed') d.selectable.push(c.path);
        }
      }
    };
    finalize(root);
    return root;
  }

  let tree = $derived(diff ? buildTree(diff.entries) : null);

  // Selection (file paths) + collapse (folder paths). Plain Sets reassigned
  // on mutation so Svelte tracks them.
  let selectedPaths = $state(new Set<string>());
  let collapsed = $state(new Set<string>());

  function isCollapsed(path: string): boolean { return collapsed.has(path); }
  function toggleCollapse(path: string): void {
    const next = new Set(collapsed);
    next.has(path) ? next.delete(path) : next.add(path);
    collapsed = next;
  }
  function toggleFile(path: string): void {
    const next = new Set(selectedPaths);
    next.has(path) ? next.delete(path) : next.add(path);
    selectedPaths = next;
  }
  function dirChecked(d: TreeDir): boolean {
    return d.selectable.length > 0 && d.selectable.every((p) => selectedPaths.has(p));
  }
  function dirIndeterminate(d: TreeDir): boolean {
    const some = d.selectable.some((p) => selectedPaths.has(p));
    return some && !dirChecked(d);
  }
  function toggleDir(d: TreeDir): void {
    const all = dirChecked(d);
    const next = new Set(selectedPaths);
    for (const p of d.selectable) all ? next.delete(p) : next.add(p);
    selectedPaths = next;
  }
  function selectAll(): void { selectedPaths = new Set(tree?.selectable ?? []); }
  function selectNone(): void { selectedPaths = new Set(); }

  // Action: reflect derived indeterminate state onto the checkbox DOM prop.
  function indeterminate(node: HTMLInputElement, value: boolean) {
    node.indeterminate = value;
    return { update(v: boolean) { node.indeterminate = v; } };
  }

  function sizeLabel(e: DiffEntry): string {
    if (e.status === 'changed') return `${e.local}→${e.remote} B`;
    if (e.status === 'new') return `${e.local} B`;
    return `${e.remote} B`;
  }

  const TEXT_RE = /\.(json|jsonl|txt|md|ts|tsx|js|mjs|cjs|svelte|css|html?|csv|log|ya?ml|xml|svg)$/i;
  const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;
  const VIDEO_RE = /\.(webm|mp4|mov)$/i;
  const PDF_RE = /\.pdf$/i;
  const TEXT_PREVIEW_CAP = 512 * 1024;

  function volumeUrl(rel: string): string {
    return `/api/volume?path=${encodeURIComponent(rel)}`;
  }
  function joinPath(base: string, name: string): string {
    return base ? `${base}/${name}` : name;
  }
  function humanSize(bytes: number | null): string {
    if (bytes == null) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  }

  // In local dev the volume root may be the project cwd, so hide obvious
  // non-data noise. On Railway the root is /app_data and this never matches.
  const HIDDEN = new Set(['node_modules', '.svelte-kit', '.git']);

  let entries = $derived.by<Node[]>(() => {
    if (!dir) return [];
    return Object.values(dir.children)
      .filter((n) => !n.name.startsWith('.') && !HIDDEN.has(n.name))
      .sort((a, b) => {
        if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
  });

  let crumbs = $derived.by(() => {
    const out = [{ label: 'volume', path: '' }];
    if (currentPath) {
      const parts = currentPath.split('/').filter(Boolean);
      let acc = '';
      for (const p of parts) {
        acc = acc ? `${acc}/${p}` : p;
        out.push({ label: p, path: acc });
      }
    }
    return out;
  });

  async function loadDir(path: string) {
    loading = true;
    loadError = null;
    selected = null;
    previewKind = null;
    previewText = '';
    editing = false;
    showNewFolder = false;
    actionError = null;
    try {
      const r = await fetch(volumeUrl(path), { cache: 'no-store' });
      if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
      const node = await r.json();
      if (node?.type !== 'dir') throw new Error('Not a directory');
      dir = node as DirNode;
      currentPath = path;
    } catch (e: any) {
      loadError = e?.message ?? String(e);
      dir = null;
    } finally {
      loading = false;
    }
  }

  async function openFile(f: FileNode) {
    selected = f;
    previewText = '';
    editing = false;
    if (IMAGE_RE.test(f.name)) { previewKind = 'image'; return; }
    if (VIDEO_RE.test(f.name)) { previewKind = 'video'; return; }
    if (PDF_RE.test(f.name)) { previewKind = 'pdf'; return; }
    if (TEXT_RE.test(f.name)) {
      if (f.size != null && f.size > TEXT_PREVIEW_CAP) { previewKind = 'binary'; return; }
      previewKind = 'text';
      previewLoading = true;
      try {
        const r = await fetch(volumeUrl(f.id), { cache: 'no-store' });
        let txt = await r.text();
        if (/\.json$/i.test(f.name)) {
          try { txt = JSON.stringify(JSON.parse(txt), null, 2); } catch { /* leave raw */ }
        }
        previewText = txt;
      } catch (e: any) {
        previewText = `// failed to load: ${e?.message ?? e}`;
      } finally {
        previewLoading = false;
      }
      return;
    }
    previewKind = 'binary';
  }

  function navUp() {
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    loadDir(parts.join('/'));
  }

  // ── Mutations ───────────────────────────────────────────────────────
  async function uploadFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    actionBusy = true;
    actionError = null;
    try {
      for (const file of Array.from(files)) {
        const dest = joinPath(currentPath, file.name);
        const r = await fetch(volumeUrl(dest), {
          method: 'PUT',
          body: await file.arrayBuffer(),
          headers: { 'content-type': file.type || 'application/octet-stream' },
        });
        if (!r.ok) throw new Error(`upload ${file.name}: ${r.status}`);
      }
      await loadDir(currentPath);
    } catch (e: any) {
      actionError = e?.message ?? String(e);
    } finally {
      actionBusy = false;
      if (fileInput) fileInput.value = '';
    }
  }

  async function createFolder() {
    const name = newFolderName.trim();
    if (!name) return;
    if (/[/\\]/.test(name)) { actionError = 'Folder name cannot contain slashes'; return; }
    actionBusy = true;
    actionError = null;
    try {
      const r = await fetch(`${volumeUrl(joinPath(currentPath, name))}&action=mkdir`, { method: 'POST' });
      if (!r.ok) throw new Error(`mkdir: ${r.status}`);
      newFolderName = '';
      showNewFolder = false;
      await loadDir(currentPath);
    } catch (e: any) {
      actionError = e?.message ?? String(e);
    } finally {
      actionBusy = false;
    }
  }

  async function deleteEntry(node: Node, ev: MouseEvent) {
    ev.stopPropagation();
    const isDir = node.type === 'dir';
    const msg = isDir
      ? `Delete folder "${node.name}" and everything inside it? This cannot be undone.`
      : `Delete "${node.name}"? This cannot be undone.`;
    if (!confirm(msg)) return;
    actionBusy = true;
    actionError = null;
    try {
      const url = volumeUrl(node.id) + (isDir ? '&recursive=1' : '');
      const r = await fetch(url, { method: 'DELETE' });
      if (!r.ok && r.status !== 204) throw new Error(`delete: ${r.status}`);
      if (selected?.id === node.id) { selected = null; previewKind = null; }
      await loadDir(currentPath);
    } catch (e: any) {
      actionError = e?.message ?? String(e);
    } finally {
      actionBusy = false;
    }
  }

  function startEdit() {
    editText = previewText;
    editing = true;
  }
  function cancelEdit() {
    editing = false;
    editText = '';
  }
  async function saveEdit() {
    if (!selected) return;
    editSaving = true;
    actionError = null;
    try {
      const r = await fetch(volumeUrl(selected.id), {
        method: 'PUT',
        body: editText,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
      if (!r.ok) throw new Error(`save: ${r.status}`);
      previewText = editText;
      editing = false;
      await loadDir(currentPath); // refresh size in the listing
      // re-select the same file so the preview header size updates
      const again = dir?.children[selected.name];
      if (again && again.type === 'file') selected = again;
    } catch (e: any) {
      actionError = e?.message ?? String(e);
    } finally {
      editSaving = false;
    }
  }

  onMount(() => loadDir(''));
</script>

<div class="vol">
  <header class="vol-hdr">
    <h1 class="vol-title">Volume</h1>
    <nav class="crumbs">
      {#each crumbs as c, i (c.path)}
        {#if i > 0}<span class="crumb-sep">/</span>{/if}
        <button
          class="crumb"
          class:current={c.path === currentPath}
          type="button"
          onclick={() => loadDir(c.path)}
        >{c.label}</button>
      {/each}
    </nav>
    {#if dev}
      <button
        class="vol-backup"
        type="button"
        disabled={backing}
        title="Copy the entire volume into the repo at src/volume_backup/ (dev only)"
        onclick={runBackup}
      >{backing ? '⏳ Backing up…' : '⬇ Backup → src'}</button>
      <button
        class="vol-backup"
        type="button"
        disabled={syncing}
        title="Mirror the PRODUCTION volume up to OneDrive (APPS/cadtrain) via rclone (dev only)"
        onclick={runOneDrive}
      >{syncing ? '⏳ Syncing…' : '☁ Volume → OneDrive'}</button>
      <button
        class="vol-backup"
        type="button"
        disabled={diffing}
        title="Compare the volume against OneDrive (metadata only — fast, no download)"
        onclick={runDiff}
      >{diffing ? '⏳ Diffing…' : '⇄ Diff OneDrive'}</button>
    {/if}
    <button class="vol-refresh" type="button" title="Reload" onclick={() => loadDir(currentPath)}>↻</button>
  </header>

  {#if dev && (oneDriveMsg || backupMsg || diffMsg)}
    {@const flashMsg = oneDriveMsg ?? backupMsg ?? diffMsg}
    <div class="vol-flash" class:err={(flashMsg ?? '').toLowerCase().includes('failed')}>
      <pre>{flashMsg}</pre>
      <button class="vol-flash-x" type="button" title="Dismiss" onclick={() => { oneDriveMsg = null; backupMsg = null; diffMsg = null; }}>×</button>
    </div>
  {/if}

  {#snippet treeRows(nodes: TreeNode[], depth: number)}
    {#each nodes as node (node.path)}
      {#if node.kind === 'dir'}
        <div class="vol-tree-row vt-dir" style="padding-left:{depth * 14 + 4}px">
          <button class="vol-tree-twist" type="button" onclick={() => toggleCollapse(node.path)} aria-label="toggle folder">{isCollapsed(node.path) ? '▸' : '▾'}</button>
          <input
            class="vol-tree-cb"
            type="checkbox"
            checked={dirChecked(node)}
            disabled={node.selectable.length === 0}
            use:indeterminate={dirIndeterminate(node)}
            onchange={() => toggleDir(node)}
            title={node.selectable.length === 0 ? 'nothing here is uploadable (only files removed on OneDrive)' : 'select all uploadable files in this folder'}
          />
          <span class="vol-tree-name vt-dirname">{node.name}/</span>
          <span class="vol-tree-rollup">
            {#if node.counts.new}<span class="vol-diff-pill new">+{node.counts.new}</span>{/if}
            {#if node.counts.gone}<span class="vol-diff-pill gone">−{node.counts.gone}</span>{/if}
            {#if node.counts.changed}<span class="vol-diff-pill changed">~{node.counts.changed}</span>{/if}
          </span>
        </div>
        {#if !isCollapsed(node.path)}
          {@render treeRows(node.children, depth + 1)}
        {/if}
      {:else}
        <div class="vol-tree-row vt-file {node.entry.status}" style="padding-left:{depth * 14 + 22}px">
          <input
            class="vol-tree-cb"
            type="checkbox"
            checked={selectedPaths.has(node.path)}
            disabled={node.entry.status === 'gone'}
            onchange={() => toggleFile(node.path)}
            title={node.entry.status === 'gone' ? 'only on OneDrive — a copy-up can’t remove it (use “Sync all”)' : 'select for upload'}
          />
          <span class="vol-diff-badge {node.entry.status}" title={DIFF_LABEL[node.entry.status]}>{DIFF_GLYPH[node.entry.status]}</span>
          <span class="vol-tree-name">{node.name}</span>
          <span class="vol-diff-size">{sizeLabel(node.entry)}</span>
        </div>
      {/if}
    {/each}
  {/snippet}

  {#if dev && diff}
    {@const drift = diff.counts.new + diff.counts.gone + diff.counts.changed}
    <div class="vol-diff">
      <div class="vol-diff-head">
        <strong>Volume ⇄ {diff.dest}</strong>
        <span class="vol-diff-pill new">+{diff.counts.new} only in volume</span>
        <span class="vol-diff-pill gone">−{diff.counts.gone} only on OneDrive</span>
        <span class="vol-diff-pill changed">~{diff.counts.changed} changed</span>
        <span class="vol-diff-pill match">={diff.counts.match} match</span>
        <button class="vol-flash-x" type="button" title="Close diff" onclick={() => (diff = null)}>×</button>
      </div>
      {#if drift === 0}
        <div class="vol-diff-ok">✓ In sync — all {diff.counts.match} files match OneDrive.</div>
      {:else}
        {#if tree}
          <div class="vol-tree-bar">
            <button class="vol-tree-link" type="button" onclick={selectAll} disabled={(tree.selectable.length === 0)}>Select all ({tree.selectable.length})</button>
            <button class="vol-tree-link" type="button" onclick={selectNone} disabled={selectedPaths.size === 0}>Clear</button>
            <span class="vol-tree-selcount">{selectedPaths.size} selected</span>
          </div>
          <div class="vol-diff-list">
            {@render treeRows(tree.children, 0)}
          </div>
        {/if}
        <div class="vol-diff-foot">
          <label class="vol-dryrun" title="Preview only — POSTs with dryRun:true, nothing is written to OneDrive">
            <input type="checkbox" bind:checked={dryRun} />
            <span>Dry run (preview)</span>
          </label>
          <button
            class="vol-backup vol-backup-primary"
            type="button"
            disabled={selSyncing || syncing || selectedPaths.size === 0}
            onclick={runSyncSelected}
          >{selSyncing ? '⏳ …' : `${dryRun ? '◑ Preview' : '☁ Sync'} selected (${selectedPaths.size})`}</button>
          <button class="vol-backup" type="button" disabled={syncing || selSyncing} onclick={runOneDrive}>{syncing ? '⏳ …' : `${dryRun ? '◑ Preview' : '☁ Sync'} all → OneDrive`}</button>
          <span class="vol-diff-note">Selected = copy-up (non-destructive). All = full mirror; replaced/deleted files kept under {diff.dest}-prev/&lt;ts&gt;.</span>
        </div>
      {/if}
    </div>
  {/if}

  <div class="vol-body">
    <!-- Left — listing + actions -->
    <div class="vol-list">
      <div class="vol-actions">
        <input
          bind:this={fileInput}
          type="file"
          multiple
          class="vol-file-input"
          onchange={(e) => uploadFiles((e.currentTarget as HTMLInputElement).files)}
        />
        <button
          class="act-btn"
          type="button"
          disabled={actionBusy}
          onclick={() => fileInput?.click()}
        >↑ Upload</button>
        <button
          class="act-btn"
          type="button"
          disabled={actionBusy}
          onclick={() => { showNewFolder = !showNewFolder; newFolderName = ''; }}
        >＋ Folder</button>
      </div>
      {#if showNewFolder}
        <form class="vol-newfolder" onsubmit={(e) => { e.preventDefault(); createFolder(); }}>
          <input
            class="nf-input"
            type="text"
            placeholder="New folder name"
            bind:value={newFolderName}
            disabled={actionBusy}
          />
          <button class="nf-btn" type="submit" disabled={actionBusy || !newFolderName.trim()}>Create</button>
        </form>
      {/if}
      {#if actionError}
        <div class="vol-action-err">{actionError}</div>
      {/if}

      <div class="vol-rows">
        {#if loading}
          <div class="vol-msg">Loading…</div>
        {:else if loadError}
          <div class="vol-msg vol-err">Failed to load <code>{currentPath || '/'}</code>: {loadError}</div>
        {:else if entries.length === 0}
          <div class="vol-msg">Empty directory.</div>
        {:else}
          {#if currentPath}
            <button class="row row-up" type="button" onclick={navUp}>
              <span class="row-ic">↰</span><span class="row-name">..</span>
            </button>
          {/if}
          {#each entries as e (e.id)}
            <div class="row-wrap">
              {#if e.type === 'dir'}
                <button class="row row-dir" type="button" onclick={() => loadDir(e.id)}>
                  <span class="row-ic">▸</span>
                  <span class="row-name">{e.name}</span>
                </button>
              {:else}
                <button
                  class="row row-file"
                  class:active={selected?.id === e.id}
                  type="button"
                  onclick={() => openFile(e)}
                >
                  <span class="row-ic">·</span>
                  <span class="row-name">{e.name}</span>
                  <span class="row-size">{humanSize(e.size)}</span>
                </button>
              {/if}
              {#if !(currentPath === '' && e.type === 'dir')}
                <button
                  class="row-del"
                  type="button"
                  disabled={actionBusy}
                  title={`Delete ${e.name}`}
                  aria-label={`Delete ${e.name}`}
                  onclick={(ev) => deleteEntry(e, ev)}
                >✕</button>
              {/if}
            </div>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Right — preview / editor -->
    <div class="vol-preview">
      {#if !selected}
        <div class="vol-msg">Select a file to preview. Use ↑ Upload / ＋ Folder to add to <code>{currentPath || '/'}</code>.</div>
      {:else}
        {#key selected.id}
          <div class="pv-hdr">
            <span class="pv-name">{selected.name}</span>
            <span class="pv-size">{humanSize(selected.size)}</span>
            {#if previewKind === 'text' && !editing}
              <button class="pv-act" type="button" onclick={startEdit}>Edit</button>
            {/if}
            {#if previewKind === 'text' && editing}
              <button class="pv-act pv-act-primary" type="button" disabled={editSaving} onclick={saveEdit}>
                {editSaving ? 'Saving…' : 'Save'}
              </button>
              <button class="pv-act" type="button" disabled={editSaving} onclick={cancelEdit}>Cancel</button>
            {/if}
            <a class="pv-dl" href={volumeUrl(selected.id)} download={selected.name}>Download ↓</a>
          </div>
          <div class="pv-body">
            {#if previewKind === 'image'}
              <div class="pv-img-wrap">
                <img class="pv-img" src={volumeUrl(selected.id)} alt={selected.name} />
              </div>
            {:else if previewKind === 'video'}
              <video class="pv-video" controls preload="metadata" src={volumeUrl(selected.id)}>
                <track kind="captions" />
              </video>
            {:else if previewKind === 'pdf'}
              <embed class="pv-embed" type="application/pdf" src={volumeUrl(selected.id)} title={selected.name} />
            {:else if previewKind === 'text'}
              {#if previewLoading}
                <div class="vol-msg">Loading…</div>
              {:else if editing}
                <textarea class="pv-editor" bind:value={editText} spellcheck="false"></textarea>
              {:else}
                <pre class="pv-text">{previewText}</pre>
              {/if}
            {:else}
              <div class="vol-msg">
                Binary or oversized file — <a href={volumeUrl(selected.id)} download={selected.name}>download</a> to view.
              </div>
            {/if}
          </div>
        {/key}
      {/if}
    </div>
  </div>
</div>

<style>
  .vol { display: flex; flex-direction: column; height: 100vh; background: #fcfcfd; color: #222; }
  .vol-hdr {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 16px; border-bottom: 1px solid #e4e4ea; background: #fff;
    flex-shrink: 0;
  }
  .vol-title {
    font: 700 13px Arial; margin: 0; color: #cc2222;
    text-transform: uppercase; letter-spacing: 1px;
  }
  .crumbs { display: flex; align-items: center; gap: 2px; flex: 1; flex-wrap: wrap; }
  .crumb {
    font: 12px monospace; color: #555; background: none; border: none;
    padding: 2px 5px; border-radius: 3px; cursor: pointer;
  }
  .crumb:hover { background: #f0f0f4; color: #cc2222; }
  .crumb.current { color: #222; font-weight: 700; }
  .crumb-sep { color: #bbb; font: 12px monospace; }
  .vol-refresh {
    font: 13px Arial; color: #666; background: #f0f0f0;
    border: 1px solid #d4d4dc; border-radius: 4px;
    padding: 3px 9px; cursor: pointer;
  }
  .vol-refresh:hover { background: #e8e8ee; }
  .vol-backup {
    font: 11px Arial; color: #444; background: #f3f3f6;
    border: 1px solid #d8d8e0; border-radius: 4px;
    padding: 3px 10px; cursor: pointer; flex-shrink: 0;
  }
  .vol-backup:hover:not(:disabled) { background: #ececf2; color: #cc2222; }
  .vol-backup:disabled { opacity: 0.6; cursor: default; }
  .vol-flash {
    position: relative;
    padding: 8px 34px 8px 16px;
    background: #eef4ee; border-bottom: 1px solid #cfe0cf;
    flex-shrink: 0;
  }
  .vol-flash.err { background: #fbecea; border-bottom-color: #e7bdb6; }
  .vol-flash pre {
    margin: 0; font: 11px/1.5 ui-monospace, Menlo, monospace; color: #2e7d32;
    white-space: pre-wrap; word-break: break-word;
    max-height: 200px; overflow: auto;
  }
  .vol-flash.err pre { color: #b3271c; }
  .vol-flash-x {
    position: absolute; top: 5px; right: 8px;
    border: none; background: transparent; cursor: pointer;
    font-size: 16px; line-height: 1; color: #999;
  }
  .vol-flash-x:hover { color: #333; }

  /* ── Volume ⇄ OneDrive diff panel ─────────────────────────────────────── */
  .vol-diff { border-bottom: 1px solid #e5e7eb; background: #fafafa; font: 12px Arial; }
  .vol-diff-head { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 8px 12px; position: relative; }
  .vol-diff-head strong { color: #334155; }
  .vol-diff-pill { font: 700 11px ui-monospace, monospace; padding: 2px 7px; border-radius: 10px; border: 1px solid transparent; }
  .vol-diff-pill.new     { color: #166534; background: #dcfce7; border-color: #bbf7d0; }
  .vol-diff-pill.gone    { color: #b91c1c; background: #fee2e2; border-color: #fecaca; }
  .vol-diff-pill.changed { color: #b45309; background: #fef3c7; border-color: #fde68a; }
  .vol-diff-pill.match   { color: #64748b; background: #f1f5f9; border-color: #e2e8f0; }
  .vol-diff-ok { padding: 8px 14px 12px; color: #166534; font-weight: 600; }
  .vol-diff-list { max-height: 320px; overflow-y: auto; padding: 2px 8px 6px; }
  .vol-diff-row { display: flex; align-items: center; gap: 8px; padding: 2px 6px; border-radius: 4px; font: 11px ui-monospace, monospace; }
  .vol-diff-row:hover { background: #fff; }
  .vol-diff-badge { flex: none; width: 16px; height: 16px; display: flex; align-items: center; justify-content: center; border-radius: 3px; font-weight: 700; color: #fff; }
  .vol-diff-badge.new { background: #16a34a; }
  .vol-diff-badge.gone { background: #dc2626; }
  .vol-diff-badge.changed { background: #d97706; }
  .vol-diff-path { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155; }
  .vol-diff-size { flex: none; color: #94a3b8; }
  .vol-diff-foot { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; padding: 8px 12px 12px; }
  .vol-diff-note { color: #94a3b8; font-size: 11px; flex: 1 1 200px; }
  .vol-backup-primary { color: #fff; background: #cc2222; border-color: #cc2222; }
  .vol-backup-primary:hover:not(:disabled) { background: #a91d1d; color: #fff; }
  .vol-backup-primary:disabled { opacity: 0.5; }
  .vol-dryrun { display: flex; align-items: center; gap: 5px; font: 11px Arial; color: #475569; cursor: pointer; user-select: none; }
  .vol-dryrun input { cursor: pointer; }

  /* ── Diff folder tree ─────────────────────────────────────────────────── */
  .vol-tree-bar { display: flex; align-items: center; gap: 10px; padding: 4px 12px; border-top: 1px solid #eef0f3; }
  .vol-tree-link { font: 11px Arial; color: #cc2222; background: none; border: none; padding: 1px 2px; cursor: pointer; }
  .vol-tree-link:hover:not(:disabled) { text-decoration: underline; }
  .vol-tree-link:disabled { color: #b8bcc4; cursor: default; }
  .vol-tree-selcount { font: 11px ui-monospace, monospace; color: #64748b; margin-left: auto; }
  .vol-tree-row { display: flex; align-items: center; gap: 6px; padding: 2px 8px 2px 0; border-radius: 4px; font: 11px ui-monospace, monospace; }
  .vol-tree-row:hover { background: #fff; }
  .vol-tree-twist { width: 16px; flex: none; font: 10px Arial; color: #94a3b8; background: none; border: none; cursor: pointer; padding: 0; }
  .vol-tree-twist:hover { color: #334155; }
  .vol-tree-cb { flex: none; width: 13px; height: 13px; margin: 0; cursor: pointer; }
  .vol-tree-cb:disabled { cursor: default; }
  .vol-tree-name { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #334155; }
  .vt-dirname { font-weight: 700; color: #1e293b; }
  .vol-tree-rollup { flex: none; display: flex; gap: 4px; }
  .vol-tree-rollup .vol-diff-pill { padding: 0 5px; font-size: 10px; }

  .vol-body { flex: 1; display: flex; min-height: 0; }
  .vol-list {
    width: 360px; flex-shrink: 0; display: flex; flex-direction: column;
    border-right: 1px solid #e4e4ea; background: #fff;
  }
  .vol-actions {
    display: flex; gap: 6px; padding: 8px; border-bottom: 1px solid #f0f0f0;
    flex-shrink: 0;
  }
  .vol-file-input { display: none; }
  .act-btn {
    font: 11px Arial; color: #444; background: #f3f3f6;
    border: 1px solid #d8d8e0; border-radius: 4px;
    padding: 4px 10px; cursor: pointer;
  }
  .act-btn:hover:not(:disabled) { background: #ececf2; color: #cc2222; }
  .act-btn:disabled { opacity: 0.5; cursor: default; }
  .vol-newfolder { display: flex; gap: 6px; padding: 6px 8px; border-bottom: 1px solid #f0f0f0; }
  .nf-input {
    flex: 1; font: 12px Arial; padding: 4px 7px;
    border: 1px solid #d4d4dc; border-radius: 4px;
  }
  .nf-btn {
    font: 11px Arial; color: #fff; background: #cc2222;
    border: none; border-radius: 4px; padding: 4px 10px; cursor: pointer;
  }
  .nf-btn:disabled { opacity: 0.5; cursor: default; }
  .vol-action-err {
    font: 11px Arial; color: #c4392f; padding: 6px 10px;
    background: #fdf0ef; border-bottom: 1px solid #f3d6d3;
  }

  .vol-rows { flex: 1; overflow-y: auto; padding: 6px; }
  .row-wrap { display: flex; align-items: center; }
  .row-wrap:hover .row-del { opacity: 1; }
  .row {
    display: flex; align-items: center; gap: 7px; flex: 1; min-width: 0;
    font: 12px Arial; color: #333; text-align: left;
    background: none; border: none; border-radius: 4px;
    padding: 5px 8px; cursor: pointer;
  }
  .row:hover { background: #f4f4f8; }
  .row-file.active { background: #cc2222; color: #fff; }
  .row-file.active .row-size { color: #f3c9c9; }
  .row-ic { width: 12px; text-align: center; color: #999; flex-shrink: 0; }
  .row-dir .row-ic { color: #cc2222; }
  .row-file.active .row-ic { color: #fff; }
  .row-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .row-dir .row-name { font-weight: 600; }
  .row-size { font: 10px monospace; color: #aaa; flex-shrink: 0; }
  .row-up .row-name { color: #888; }
  .row-del {
    flex-shrink: 0; width: 22px; height: 22px; margin-right: 4px;
    font: 11px Arial; color: #999; background: none;
    border: none; border-radius: 4px; cursor: pointer;
    opacity: 0; transition: opacity 0.1s;
  }
  .row-del:hover:not(:disabled) { background: #fdeceb; color: #c4392f; }
  .row-del:disabled { cursor: default; }

  .vol-preview { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .pv-hdr {
    display: flex; align-items: center; gap: 10px;
    padding: 8px 14px; border-bottom: 1px solid #e4e4ea; background: #fff;
    flex-shrink: 0;
  }
  .pv-name { font: 600 12px Arial; color: #222; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .pv-size { font: 10px monospace; color: #aaa; flex-shrink: 0; }
  .pv-act {
    flex-shrink: 0; font: 11px Arial; color: #444;
    background: #f3f3f6; border: 1px solid #d8d8e0; border-radius: 4px;
    padding: 3px 10px; cursor: pointer;
  }
  .pv-act:hover:not(:disabled) { background: #ececf2; }
  .pv-act:disabled { opacity: 0.5; cursor: default; }
  .pv-act-primary { color: #fff; background: #cc2222; border-color: #cc2222; }
  .pv-act-primary:hover:not(:disabled) { background: #a91d1d; }
  .pv-dl {
    margin-left: auto; flex-shrink: 0;
    font: 11px Arial; color: #cc2222; text-decoration: none;
    padding: 3px 9px; border: 1px solid #e7c4c4; border-radius: 4px;
  }
  .pv-dl:hover { background: #fef0f0; }

  .pv-body { flex: 1; min-height: 0; overflow: auto; display: flex; }
  .pv-img-wrap {
    flex: 1; min-height: 100%; display: flex; align-items: flex-start; justify-content: center;
    background: #525659; padding: 16px;
  }
  .pv-img { max-width: 100%; height: auto; box-shadow: 0 2px 12px rgba(0,0,0,0.4); }
  .pv-video { width: 100%; height: 100%; background: #000; }
  .pv-embed { width: 100%; height: 100%; border: none; }
  .pv-text {
    margin: 0; padding: 14px 16px; flex: 1;
    font: 12px/1.5 monospace; color: #2a2a2a;
    white-space: pre-wrap; word-break: break-word;
  }
  .pv-editor {
    flex: 1; margin: 0; padding: 14px 16px; border: none; resize: none;
    font: 12px/1.5 monospace; color: #2a2a2a;
    outline: none; background: #fffdf8;
  }

  .vol-msg { padding: 24px 16px; font: 12px Arial; color: #888; }
  .vol-msg.vol-err { color: #c4392f; }
  .vol-msg code { font: 11px monospace; background: #f0f0f0; padding: 1px 5px; border-radius: 3px; }
</style>
