<script lang="ts">
  // Browse the 18 base primitives. Sidebar groups them into 3 folders:
  //   Connections — thread / box / pin shapes (8 items)
  //   Body        — hollow cylinder, the pipe body (1 item)
  //   Other Parts — transitions + features + mechanicals (9 items)
  // Click a folder header → filter main grid to that group. Click an item
  // inside the folder → scroll to its card in the main view. Click a card →
  // /author?prim=<id> seeds a new component with that primitive.
  //
  // Pattern borrowed from SVTC's NavMenu (collapsible folders with caret
  // arrows + tracking-wide section labels) — generalised here as an
  // in-page sidebar for any "list of OOP-style derived objects" view.
  import { COMPONENTS } from '$lib/components/library';

  // Folder hierarchy. Top-level: Connections / Body / Other Parts.
  // Connections nests by use-case (API tubular, Drill string, Generic
  // ends) — when the gender-aware family primitives land later
  // (box-vam, pin-vam, box-eue, etc.) they slot into the appropriate
  // sub-folder by their `prim` id. Body + Other Parts are flat for now;
  // can grow sub-folders the same way when needed.
  interface Folder {
    id: string;
    name: string;
    /** Predicate run against COMPONENTS items to claim leaves into this folder. */
    match: (c: { id: string; category: string }) => boolean;
    /** Optional nested folders. Each sub-folder claims a subset of this folder's items. */
    sub?: Folder[];
  }

  const TREE: Folder[] = [
    {
      id: 'connections',
      name: 'Connections',
      match: (c) => c.category === 'connection',
      sub: [
        { id: 'api_tubular',  name: 'API tubular',   match: (c) => ['thread_eue', 'thread_ltc'].includes(c.id) },
        { id: 'drill_string', name: 'Drill string',  match: (c) => ['thread_reg', 'thread_if', 'thread_fh', 'thread_nc'].includes(c.id) },
        { id: 'generic_ends', name: 'Generic ends',  match: (c) => ['threaded_box', 'threaded_pin'].includes(c.id) },
      ],
    },
    {
      id: 'body',
      name: 'Body',
      match: (c) => c.category === 'basic',
    },
    {
      id: 'other_parts',
      name: 'Other Parts',
      match: (c) => ['transition', 'feature', 'mechanical'].includes(c.category),
    },
  ];

  /** Walk every folder + sub-folder so the visibility predicate can match
   *  by id at any depth. Returns the path of ids leading to the match. */
  function findFolderPath(id: string, tree: Folder[] = TREE, path: string[] = []): string[] | null {
    for (const f of tree) {
      const here = [...path, f.id];
      if (f.id === id) return here;
      if (f.sub) {
        const found = findFolderPath(id, f.sub, here);
        if (found) return found;
      }
    }
    return null;
  }

  function itemsInFolder(folder: Folder): typeof COMPONENTS {
    return COMPONENTS.filter((c) => folder.match(c));
  }

  // The 3 pipe-applicable primitives currently in COMPONENTS. Flagged in
  // the card UI so it's obvious at a glance which shapes feed pipe work
  // vs which are drill-string / completion-tool legacy.
  const PIPE_PRIMS = new Set(['hollow_cylinder', 'thread_eue', 'thread_ltc']);

  // Sidebar state. selected = 'all' shows every primitive in the main grid;
  // otherwise a folder id at any depth (top-level or nested) filters to
  // just its items. Folders default expanded — collapsed state lives in
  // `collapsed` so the default is "open" without enumerating every id.
  let selected = $state<string>('all');
  let collapsed = $state<Set<string>>(new Set());

  function toggleFolder(id: string, ev?: MouseEvent) {
    ev?.stopPropagation();
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    collapsed = new Set(collapsed);
  }
  const isExpanded = (id: string) => !collapsed.has(id);

  let visible = $derived.by(() => {
    if (selected === 'all') return COMPONENTS;
    // Walk to find the folder, then return its matching items (folder
    // predicate handles depth — sub-folder predicate is stricter than
    // its parent so the visible list narrows when you click deeper).
    function find(tree: Folder[]): Folder | null {
      for (const f of tree) {
        if (f.id === selected) return f;
        if (f.sub) { const r = find(f.sub); if (r) return r; }
      }
      return null;
    }
    const folder = find(TREE);
    return folder ? itemsInFolder(folder) : COMPONENTS;
  });
</script>

<div class="layout">
  <aside class="sidebar">
    <button
      class="all-link"
      class:active={selected === 'all'}
      onclick={() => (selected = 'all')}
    >
      <span>All Primitives</span>
      <span class="count">{COMPONENTS.length}</span>
    </button>

    {#snippet folderNode(f: Folder, depth: number)}
      {@const items = itemsInFolder(f)}
      {@const subClaims = (f.sub ?? []).flatMap((sf) => itemsInFolder(sf))}
      {@const leafItems = items.filter((c) => !subClaims.includes(c))}
      <div class="folder" style="--depth: {depth}">
        <div class="folder-hdr" class:active={selected === f.id}>
          <button class="caret" onclick={(e) => toggleFolder(f.id, e)} aria-label="Toggle folder">
            {isExpanded(f.id) ? '▾' : '▸'}
          </button>
          <button class="folder-name" onclick={() => (selected = f.id)}>
            <span>{f.name}</span>
            <span class="count">{items.length}</span>
          </button>
        </div>
        {#if isExpanded(f.id)}
          {#if f.sub}
            {#each f.sub as child (child.id)}
              {@render folderNode(child, depth + 1)}
            {/each}
          {/if}
          {#if leafItems.length > 0}
            <div class="folder-items">
              {#each leafItems as c (c.id)}
                <a class="prim-link" href="#prim-{c.id}">{c.name}</a>
              {/each}
            </div>
          {/if}
        {/if}
      </div>
    {/snippet}

    {#each TREE as f (f.id)}
      {@render folderNode(f, 0)}
    {/each}
  </aside>

  <main class="content">
    <div class="hdr">
      <h1>Primitives</h1>
      <p class="sub">
        {COMPONENTS.length} base shapes — ManifoldCAD recipes the composition interpreter executes.
        Pipe-applicable primitives marked with a badge; the rest are drill-string / completion-tool shapes.
      </p>
    </div>

    <div class="grid">
      {#each visible as c (c.id)}
        <a id="prim-{c.id}" class="card" href="/author?prim={c.id}">
          <div class="thumb">
            <img src="/training_data/prim_{c.id}/images/default.png" alt={c.name}
                 loading="lazy" onerror={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }} />
          </div>
          <div class="info">
            <div class="name">
              {c.name}
              {#if PIPE_PRIMS.has(c.id)}<span class="badge pipe">pipe</span>{/if}
            </div>
            <div class="id">{c.id}</div>
            {#if c.tags?.length}
              <div class="tags">{c.tags.slice(0, 4).join(' · ')}</div>
            {/if}
          </div>
        </a>
      {/each}
    </div>
  </main>
</div>

<style>
  .layout {
    display: flex; flex-direction: row;
    height: 100%; overflow: hidden;
    font-family: Arial, sans-serif;
  }

  /* Sidebar — SVTC-style folder browser. Fixed-width left rail, scrolls
     independently of the main grid. */
  .sidebar {
    width: 240px; flex-shrink: 0;
    background: #f7f7f9;
    border-right: 1px solid #e2e2e8;
    padding: 14px 8px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 2px;
  }
  .all-link, .folder-name, .caret {
    background: transparent; border: none; cursor: pointer;
    font: inherit; color: inherit; text-align: left;
  }
  .all-link {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 12px; border-radius: 4px;
    font: bold 12px Arial; color: #333;
    margin-bottom: 6px;
  }
  .all-link:hover { background: #ebebef; }
  .all-link.active { background: #cc2222; color: #fff; }
  .folder {
    display: flex; flex-direction: column;
    /* Each depth level indents by an additional 12px so the recursive
       structure reads visually even without per-row indentation logic. */
    padding-left: calc(var(--depth, 0) * 12px);
  }
  .folder-hdr {
    display: flex; align-items: center; gap: 2px;
    border-radius: 4px;
  }
  .folder-hdr:hover { background: #ebebef; }
  .folder-hdr.active { background: #fef0f0; }
  .caret {
    width: 22px; height: 26px;
    display: flex; align-items: center; justify-content: center;
    font-size: 10px; color: #888;
    flex-shrink: 0;
  }
  .caret:hover { color: #333; }
  .folder-name {
    flex: 1;
    display: flex; align-items: center; justify-content: space-between;
    padding: 4px 8px 4px 2px;
    font: bold 9px Arial; color: #555;
    text-transform: uppercase; letter-spacing: 1px;
  }
  /* Nested folders get a slightly lighter / non-uppercase label so the
     hierarchy is readable — top-level reads as a heading, sub-level as
     a sub-heading. */
  .folder .folder .folder-name {
    font: bold 10px Arial; color: #666;
    letter-spacing: 0.5px; text-transform: none;
  }
  .folder-hdr.active .folder-name { color: #cc2222; }
  .folder-items {
    display: flex; flex-direction: column;
    margin-left: 22px;
    padding: 2px 0 6px;
  }
  .prim-link {
    display: block;
    padding: 3px 10px;
    font: 11px Arial; color: #555;
    text-decoration: none;
    border-radius: 3px;
  }
  .prim-link:hover { background: #ebebef; color: #cc2222; }
  .count {
    font: bold 9px monospace; color: #999;
    background: #e6e6ea;
    padding: 1px 6px; border-radius: 8px;
  }
  .all-link.active .count, .folder-hdr.active .count { background: rgba(0,0,0,0.15); color: #fff; }

  /* Main content — full-width grid that fills the remaining viewport. */
  .content {
    flex: 1; min-width: 0;
    padding: 22px 28px;
    overflow-y: auto;
    box-sizing: border-box;
  }
  .hdr h1 { margin: 0 0 4px; font-size: 22px; color: #cc2222; }
  .sub { margin: 0 0 22px; font: 12px Arial; color: #666; max-width: 700px; line-height: 1.5; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
  .card {
    display: flex; flex-direction: column;
    text-decoration: none; color: inherit;
    background: #fff; border: 1px solid #e0e0e0; border-radius: 6px;
    overflow: hidden;
    transition: border-color 100ms, transform 100ms;
    scroll-margin-top: 24px;
  }
  .card:hover { border-color: #cc2222; transform: translateY(-1px); }
  .thumb {
    aspect-ratio: 1 / 1; background: #f8f8f8;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .info { padding: 8px 10px; }
  .name { font: bold 12px Arial; color: #222; margin-bottom: 2px; display: flex; align-items: center; gap: 6px; }
  .badge { font: 8px Arial; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.5px; }
  .badge.pipe { background: #cc2222; color: #fff; }
  .id { font: 9px monospace; color: #888; margin-bottom: 4px; }
  .tags { font: 9px Arial; color: #aaa; }

  /* Below 700px, sidebar collapses to a horizontal strip above the grid. */
  @media (max-width: 700px) {
    .layout { flex-direction: column; }
    .sidebar {
      width: 100%; max-height: 220px;
      border-right: none; border-bottom: 1px solid #e2e2e8;
    }
  }
</style>
