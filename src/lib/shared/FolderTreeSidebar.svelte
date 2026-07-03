<script lang="ts" module>
  /**
   * FolderTreeSidebar — a generic, parameterised VS-Code / Windows-Explorer
   * style expand/collapse folder tree for a left rail.
   *
   * EXTRACTED from the /primitives sidebar (`src/routes/primitives/+page.svelte`
   * + `primitives-tree.ts`). That sidebar is the canonical cadtrain folder tree
   * (chevron + folder icon + count badge, subfolders expand IN PLACE, a live
   * filter forces every matching folder open) but it is INLINE markup welded to
   * the volume `/api/primitives/*` model — not importable as-is. This is the
   * clean, data-driven distillation of the same interaction model: feed it a
   * `FolderTree` and it renders + emits `onSelect(id)` when a leaf is clicked.
   *
   * Dark-themed to match the subsurface-visualisation chrome (/wells). Consumers
   * own the data + the selection; this component owns only expand/collapse +
   * filter (persisted to localStorage under `storageKey`).
   */

  /** A leaf file row. `id` is the stable selection key; `name` is the label. */
  export interface TreeFile {
    id: string;
    name: string;
    /** Optional short tag chip (e.g. a type or provenance marker). */
    tag?: string;
    /** Optional badge count shown after the name. */
    badge?: string | number;
  }

  /** A folder node. `path` is a stable key for the expand/collapse map. */
  export interface FolderTree {
    name: string;
    path: string;
    folders: FolderTree[];
    files: TreeFile[];
  }

  /** Total files in a subtree (direct + descendants) — the folder count badge. */
  export function subtreeFileCount(node: FolderTree): number {
    return node.files.length + node.folders.reduce((n, f) => n + subtreeFileCount(f), 0);
  }
</script>

<script lang="ts">
  let {
    /** Root of the tree. Its own name/path are ignored — its children render as
     *  the top-level rows. */
    tree,
    /** Currently-selected leaf id (highlighted). */
    activeId = null,
    /** Ids of open tabs, if the consumer wants open-but-inactive leaves marked. */
    openIds = [],
    title = '',
    subtitle = '',
    /** localStorage namespace for the expanded map + filter. */
    storageKey = 'folder-tree',
    /** Folder paths open by default on first load (no persisted state yet). */
    defaultExpanded = [],
    /** File-leaf icon. */
    fileIcon = '📄',
    onSelect = (_id: string) => {},
  }: {
    tree: FolderTree | null;
    activeId?: string | null;
    openIds?: string[];
    title?: string;
    subtitle?: string;
    storageKey?: string;
    defaultExpanded?: string[];
    fileIcon?: string;
    onSelect?: (id: string) => void;
  } = $props();

  // ── Expand / collapse (persisted) ──────────────────────────────────────────
  function loadExpanded(): Record<string, boolean> {
    if (typeof localStorage === 'undefined') return {};
    try {
      return JSON.parse(localStorage.getItem(`${storageKey}-expanded`) ?? '{}');
    } catch {
      return {};
    }
  }
  let expanded = $state<Record<string, boolean>>(loadExpanded());

  function isExpanded(path: string): boolean {
    return expanded[path] ?? defaultExpanded.includes(path);
  }
  function toggleExpand(path: string) {
    expanded = { ...expanded, [path]: !isExpanded(path) };
    try {
      localStorage.setItem(`${storageKey}-expanded`, JSON.stringify(expanded));
    } catch {
      /* ignore */
    }
  }

  // ── Live filter ──────────────────────────────────────────────────────────
  let filter = $state('');
  const pass = (f: TreeFile) =>
    !filter.trim() ||
    f.name.toLowerCase().includes(filter.trim().toLowerCase()) ||
    f.id.toLowerCase().includes(filter.trim().toLowerCase());

  function subtreeMatches(node: FolderTree): boolean {
    return node.files.some(pass) || node.folders.some(subtreeMatches);
  }

  const topFolders = $derived(tree?.folders ?? []);
  const topFiles = $derived(tree?.files ?? []);
</script>

<aside class="ft-rail">
  {#if title}
    <div class="ft-head">
      <div class="ft-title">{title}</div>
      {#if subtitle}<div class="ft-sub">{subtitle}</div>{/if}
    </div>
  {/if}

  <div class="ft-filter">
    <input
      class="ft-filter-input"
      type="text"
      placeholder="Filter…"
      bind:value={filter}
      spellcheck="false"
      autocomplete="off"
    />
    {#if filter}
      <button class="ft-filter-clear" type="button" title="Clear filter" onclick={() => (filter = '')}>×</button>
    {/if}
  </div>

  <div class="ft-scroll">
    {#if !tree}
      <div class="ft-empty">loading…</div>
    {:else}
      {@const vFolders = topFolders.filter((n) => !filter.trim() || subtreeMatches(n))}
      {@const vFiles = topFiles.filter(pass)}
      {#each vFolders as node (node.path)}
        {@render folderNode(node, 0)}
      {/each}
      {#each vFiles as f (f.id)}
        {@render fileRow(f, 0)}
      {/each}
      {#if vFolders.length === 0 && vFiles.length === 0}
        <div class="ft-empty">{filter.trim() ? 'no matches' : 'empty'}</div>
      {/if}
    {/if}
  </div>
</aside>

{#snippet fileRow(f: TreeFile, depth: number)}
  <button
    class="ft-file"
    class:active={activeId === f.id}
    class:open={activeId !== f.id && openIds.includes(f.id)}
    type="button"
    style="padding-left: {12 + depth * 14}px"
    title={f.id}
    onclick={() => onSelect(f.id)}
  >
    <span class="ft-file-ic">{fileIcon}</span>
    <span class="ft-name">{f.name}</span>
    {#if f.badge != null}<span class="ft-count">{f.badge}</span>{/if}
    {#if f.tag}<span class="ft-tag">{f.tag}</span>{/if}
  </button>
{/snippet}

{#snippet folderNode(node: FolderTree, depth: number)}
  {@const open = filter.trim() ? true : isExpanded(node.path)}
  {@const kids = node.folders.filter((n) => !filter.trim() || subtreeMatches(n))}
  {@const files = node.files.filter(pass)}
  <div class="ft-node">
    <button
      class="ft-folder"
      type="button"
      style="padding-left: {8 + depth * 14}px"
      title={node.path}
      onclick={() => toggleExpand(node.path)}
    >
      <span class="ft-chev">{open ? '▾' : '▸'}</span>
      <span class="ft-folder-ic">{open ? '📂' : '📁'}</span>
      <span class="ft-name">{node.name}</span>
      <span class="ft-count">({subtreeFileCount(node)})</span>
    </button>
    {#if open}
      {#each kids as c (c.path)}
        {@render folderNode(c, depth + 1)}
      {/each}
      {#each files as f (f.id)}
        {@render fileRow(f, depth + 1)}
      {/each}
      {#if kids.length === 0 && files.length === 0}
        <div class="ft-empty" style="padding-left: {12 + (depth + 1) * 14}px">
          {filter.trim() ? 'no matches' : 'empty'}
        </div>
      {/if}
    {/if}
  </div>
{/snippet}

<style>
  .ft-rail {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    min-width: 0;
    background: #16161f;
    color: #d8d8ef;
    border-right: 1px solid #2a2a3e;
    font-family: Arial, sans-serif;
  }
  .ft-head {
    padding: 12px 12px 8px;
    border-bottom: 1px solid #2a2a3e;
  }
  .ft-title {
    font: 700 12px Arial;
    letter-spacing: 0.5px;
    color: #cc3333;
    text-transform: uppercase;
  }
  .ft-sub {
    font-size: 10px;
    color: #6a6a80;
    margin-top: 2px;
  }
  .ft-filter {
    position: relative;
    padding: 8px;
    border-bottom: 1px solid #2a2a3e;
  }
  .ft-filter-input {
    width: 100%;
    box-sizing: border-box;
    background: #1e1e2e;
    border: 1px solid #2a2a3e;
    border-radius: 5px;
    color: #e8e8ef;
    font: 12px ui-monospace, monospace;
    padding: 5px 24px 5px 8px;
    outline: none;
  }
  .ft-filter-input:focus {
    border-color: #cc3333;
  }
  .ft-filter-clear {
    position: absolute;
    right: 14px;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: #8a8aa0;
    cursor: pointer;
    font-size: 15px;
    line-height: 1;
  }
  .ft-filter-clear:hover {
    color: #ff6666;
  }
  .ft-scroll {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 4px 0 12px;
  }
  .ft-node {
    display: flex;
    flex-direction: column;
  }
  .ft-folder,
  .ft-file {
    display: flex;
    align-items: center;
    gap: 5px;
    width: 100%;
    text-align: left;
    background: none;
    border: none;
    border-left: 2px solid transparent;
    color: inherit;
    cursor: pointer;
    padding: 4px 10px;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
  }
  .ft-folder:hover,
  .ft-file:hover {
    background: #22223a;
  }
  .ft-file.active {
    background: #2a2a48;
    border-left-color: #cc3333;
    color: #fff;
  }
  .ft-file.open {
    color: #fff;
  }
  .ft-file.open .ft-file-ic {
    opacity: 1;
  }
  .ft-chev {
    width: 10px;
    color: #6a6a80;
    font-size: 9px;
    flex: none;
  }
  .ft-folder-ic,
  .ft-file-ic {
    flex: none;
    font-size: 12px;
  }
  .ft-file-ic {
    opacity: 0.7;
    margin-left: 12px;
  }
  .ft-name {
    overflow: hidden;
    text-overflow: ellipsis;
    font: 12px ui-monospace, monospace;
  }
  .ft-count {
    color: #55556a;
    font: 10px ui-monospace, monospace;
    flex: none;
  }
  .ft-tag {
    font-size: 9px;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    background: #2a2a48;
    color: #8a8ab0;
    border-radius: 3px;
    padding: 1px 5px;
    flex: none;
    margin-left: auto;
  }
  .ft-empty {
    font: 11px ui-monospace, monospace;
    color: #55556a;
    font-style: italic;
    padding: 6px 12px;
  }
</style>
