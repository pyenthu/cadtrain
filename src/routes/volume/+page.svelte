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
    <button class="vol-refresh" type="button" title="Reload" onclick={() => loadDir(currentPath)}>↻</button>
  </header>

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
              <button
                class="row-del"
                type="button"
                disabled={actionBusy}
                title={`Delete ${e.name}`}
                aria-label={`Delete ${e.name}`}
                onclick={(ev) => deleteEntry(e, ev)}
              >✕</button>
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
