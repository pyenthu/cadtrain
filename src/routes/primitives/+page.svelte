<script lang="ts">
  // 3-pane primitives browser:
  //   sidebar (left)   — folder tree, filters main grid
  //   main grid        — cards for currently visible primitives
  //   inspector (right)— opens on card click, shows params + actions.
  //                      Closed by default; collapses back when × clicked.
  //
  // Click flow stays within /primitives — a card click no longer navigates
  // to /author. The inspector's "Open in Author" button is the explicit
  // path to the editor. The plan + 4-level hierarchy:
  //   primitive → composition → component → assembly  is documented in
  //   ~/.claude/plans/silly-conjuring-deer.md.
  import { COMPONENTS } from '$lib/components/library';

  // Folder hierarchy. The `compound: true` flag propagates to every leaf
  // claimed by that folder (or its sub-folders) — used to badge "compound"
  // entries that are really small assemblies (body + upset + thread band)
  // and will be decomposed into real atoms in Phase B.
  interface Folder {
    id: string;
    name: string;
    /** Predicate run against COMPONENTS items to claim leaves into this folder. */
    match: (c: { id: string; category: string }) => boolean;
    /** Optional nested folders. Each sub-folder claims a subset of this folder's items. */
    sub?: Folder[];
    /** If true, leaves under this folder are compositions (small assemblies),
     *  not true primitive atoms. Surfaced as a badge on the card. */
    compound?: boolean;
  }

  const TREE: Folder[] = [
    {
      id: 'primitives',
      name: 'Primitives',
      match: (c) => ['hollow_cylinder', 'taper', 'shoulder'].includes(c.id),
    },
    {
      id: 'compounds',
      name: 'Compounds',
      compound: true,
      match: (c) => c.category === 'connection',
      sub: [
        { id: 'api_tubular',  name: 'API tubular',  compound: true, match: (c) => ['thread_eue', 'thread_ltc'].includes(c.id) },
        { id: 'drill_string', name: 'Drill string', compound: true, match: (c) => ['thread_reg', 'thread_if', 'thread_fh', 'thread_nc'].includes(c.id) },
        { id: 'generic_ends', name: 'Generic ends', compound: true, match: (c) => ['threaded_box', 'threaded_pin'].includes(c.id) },
      ],
    },
    {
      id: 'features',
      name: 'Features',
      match: (c) => c.category === 'feature',
    },
    {
      id: 'mechanical',
      name: 'Mechanical',
      match: (c) => c.category === 'mechanical',
    },
  ];

  function itemsInFolder(folder: Folder): typeof COMPONENTS {
    return COMPONENTS.filter((c) => folder.match(c));
  }

  /** True iff any compound-flagged folder (top-level or nested) claims c. */
  function isCompound(c: { id: string; category: string }): boolean {
    function walk(tree: Folder[]): boolean {
      for (const f of tree) {
        if (f.compound && f.match(c)) return true;
        if (f.sub && walk(f.sub)) return true;
      }
      return false;
    }
    return walk(TREE);
  }

  // The 3 pipe-applicable primitives. Pipe badge stays as a side annotation
  // independent of the primitive/compound distinction.
  const PIPE_PRIMS = new Set(['hollow_cylinder', 'thread_eue', 'thread_ltc']);

  // Sidebar state. selectedFolder filters the main grid. selectedCard opens
  // the inspector and tracks which primitive is currently being inspected.
  let selectedFolder = $state<string>('all');
  let selectedCard = $state<string | null>(null);
  let collapsed = $state<Set<string>>(new Set());
  /** Local copy of the inspector primitive's params — sliders/inputs bind here
   *  so editing doesn't mutate the COMPONENTS source-of-truth. */
  let inspectorParams = $state<Record<string, number>>({});

  function toggleFolder(id: string, ev?: MouseEvent) {
    ev?.stopPropagation();
    if (collapsed.has(id)) collapsed.delete(id);
    else collapsed.add(id);
    collapsed = new Set(collapsed);
  }
  const isExpanded = (id: string) => !collapsed.has(id);

  function selectCard(id: string) {
    const def = COMPONENTS.find((c) => c.id === id);
    if (!def) return;
    selectedCard = id;
    inspectorParams = structuredClone(def.defaults);
  }
  function closeInspector() { selectedCard = null; }

  async function copyId() {
    if (!selectedCard) return;
    try { await navigator.clipboard.writeText(selectedCard); } catch {}
  }

  let visible = $derived.by(() => {
    if (selectedFolder === 'all') return COMPONENTS;
    function find(tree: Folder[]): Folder | null {
      for (const f of tree) {
        if (f.id === selectedFolder) return f;
        if (f.sub) { const r = find(f.sub); if (r) return r; }
      }
      return null;
    }
    const folder = find(TREE);
    return folder ? itemsInFolder(folder) : COMPONENTS;
  });

  let inspectorDef = $derived(
    selectedCard ? COMPONENTS.find((c) => c.id === selectedCard) ?? null : null,
  );
</script>

<div class="layout" class:inspector-open={selectedCard !== null}>
  <aside class="sidebar">
    <button
      class="all-link"
      class:active={selectedFolder === 'all'}
      onclick={() => (selectedFolder = 'all')}
    >
      <span>All Primitives</span>
      <span class="count">{COMPONENTS.length}</span>
    </button>

    {#snippet folderNode(f: Folder, depth: number)}
      {@const items = itemsInFolder(f)}
      {@const subClaims = (f.sub ?? []).flatMap((sf) => itemsInFolder(sf))}
      {@const leafItems = items.filter((c) => !subClaims.includes(c))}
      <div class="folder" style="--depth: {depth}">
        <div class="folder-hdr" class:active={selectedFolder === f.id}>
          <button class="caret" onclick={(e) => toggleFolder(f.id, e)} aria-label="Toggle folder">
            {isExpanded(f.id) ? '▾' : '▸'}
          </button>
          <button class="folder-name" onclick={() => (selectedFolder = f.id)}>
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
                <button
                  class="prim-link"
                  class:active={selectedCard === c.id}
                  onclick={() => selectCard(c.id)}
                >{c.name}</button>
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
        {COMPONENTS.length} base shapes. <strong>Primitive</strong> = atomic shape (≤ 4 params).
        <strong>Compound</strong> = small assembly of primitives (body + upset + threads…) — these
        are stand-ins that get decomposed in Phase B. Click a card to inspect its parameters; click
        "Open in Author" to start building with it.
      </p>
    </div>

    <div class="grid">
      {#each visible as c (c.id)}
        {@const compound = isCompound(c)}
        <button
          id="prim-{c.id}"
          class="card"
          class:selected={selectedCard === c.id}
          class:compound
          onclick={() => selectCard(c.id)}
          type="button"
        >
          <div class="thumb">
            <img src="/training_data/prim_{c.id}/images/default.png" alt={c.name}
                 loading="lazy" onerror={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }} />
          </div>
          <div class="info">
            <div class="name">
              <span class="n-text">{c.name}</span>
              {#if PIPE_PRIMS.has(c.id)}<span class="badge pipe">pipe</span>{/if}
            </div>
            <div class="id">{c.id}</div>
            {#if compound}<div class="badge compound-tag">compound</div>{/if}
            {#if c.tags?.length}
              <div class="tags">{c.tags.slice(0, 4).join(' · ')}</div>
            {/if}
          </div>
        </button>
      {/each}
    </div>
  </main>

  {#if inspectorDef}
    {@const compound = isCompound(inspectorDef)}
    <aside class="inspector">
      <div class="ins-hdr">
        <div class="ins-title">
          <div class="ins-name">{inspectorDef.name}</div>
          <div class="ins-id">{inspectorDef.id}</div>
        </div>
        <button class="ins-close" type="button" onclick={closeInspector} aria-label="Close inspector">×</button>
      </div>

      <div class="ins-meta">
        <span class="badge cat">{inspectorDef.category}</span>
        {#if compound}<span class="badge compound-tag">compound — to be decomposed</span>{/if}
        {#if PIPE_PRIMS.has(inspectorDef.id)}<span class="badge pipe">pipe</span>{/if}
      </div>

      {#if inspectorDef.description}
        <p class="ins-desc">{inspectorDef.description}</p>
      {/if}

      <div class="ins-sec">
        <div class="ins-sec-h">Parameters <span class="muted">{Object.keys(inspectorDef.params).length}</span></div>
        {#each Object.keys(inspectorDef.params) as key (key)}
          {@const def = inspectorDef.params[key]}
          <div class="pr">
            <div class="pr-row">
              <span class="lbl">{def.label}</span>
              <input class="pr-num" type="number" step={def.step} bind:value={inspectorParams[key]} />
            </div>
            <input class="pr-range" type="range" min={def.min} max={def.max} step={def.step} bind:value={inspectorParams[key]} />
          </div>
        {/each}
      </div>

      {#if inspectorDef.tags?.length}
        <div class="ins-sec">
          <div class="ins-sec-h">Tags</div>
          <div class="ins-tags">
            {#each inspectorDef.tags as t}<span class="tag">{t}</span>{/each}
          </div>
        </div>
      {/if}

      <div class="ins-actions">
        <a class="btn primary" href="/author?prim={inspectorDef.id}">Open in Author →</a>
        <button class="btn" type="button" onclick={copyId}>Copy id</button>
      </div>
    </aside>
  {/if}
</div>

<style>
  .layout {
    display: flex; flex-direction: row;
    height: 100%; overflow: hidden;
    font-family: Arial, sans-serif;
  }

  /* Sidebar — folder tree. */
  .sidebar {
    width: 240px; flex-shrink: 0;
    background: #f7f7f9;
    border-right: 1px solid #e2e2e8;
    padding: 14px 8px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 2px;
  }
  .all-link, .folder-name, .caret, .prim-link {
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
  .folder { display: flex; flex-direction: column; padding-left: calc(var(--depth, 0) * 12px); }
  .folder-hdr { display: flex; align-items: center; gap: 2px; border-radius: 4px; }
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
    border-radius: 3px;
  }
  .prim-link:hover { background: #ebebef; color: #cc2222; }
  .prim-link.active { background: #cc2222; color: #fff; }
  .count {
    font: bold 9px monospace; color: #999;
    background: #e6e6ea;
    padding: 1px 6px; border-radius: 8px;
  }
  .all-link.active .count, .folder-hdr.active .count { background: rgba(0,0,0,0.15); color: #fff; }
  .prim-link.active .count { background: rgba(255,255,255,0.2); color: #fff; }

  /* Main content. */
  .content {
    flex: 1; min-width: 0;
    padding: 22px 28px;
    overflow-y: auto;
    box-sizing: border-box;
  }
  .hdr h1 { margin: 0 0 4px; font-size: 22px; color: #cc2222; }
  .sub { margin: 0 0 22px; font: 12px Arial; color: #666; max-width: 800px; line-height: 1.5; }
  .sub strong { color: #333; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 12px; }
  .card {
    display: flex; flex-direction: column;
    background: #fff; border: 1px solid #e0e0e0; border-radius: 6px;
    overflow: hidden; cursor: pointer;
    transition: border-color 100ms, transform 100ms, box-shadow 100ms;
    scroll-margin-top: 24px;
    text-align: left;
    font: inherit; color: inherit;
    padding: 0;
  }
  .card:hover { border-color: #cc2222; transform: translateY(-1px); }
  .card.selected { border-color: #cc2222; box-shadow: 0 0 0 2px rgba(204, 34, 34, 0.18); }
  .card.compound { border-style: dashed; }
  .thumb {
    aspect-ratio: 1 / 1; background: #f8f8f8;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  .thumb img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .info { padding: 8px 10px; }
  .name { font: bold 12px Arial; color: #222; margin-bottom: 2px; display: flex; align-items: center; gap: 6px; }
  .n-text { flex: 1; }
  .badge { font: 8px Arial; padding: 1px 6px; border-radius: 8px; text-transform: uppercase; letter-spacing: 0.5px; display: inline-block; }
  .badge.pipe { background: #cc2222; color: #fff; }
  .badge.compound-tag { background: #fff3cd; color: #8a6d3b; border: 1px solid #faecbb; margin-top: 4px; }
  .badge.cat { background: #eef0f5; color: #555; }
  .id { font: 9px monospace; color: #888; margin-bottom: 4px; }
  .tags { font: 9px Arial; color: #aaa; margin-top: 4px; }

  /* Inspector — right pane, only renders when selectedCard !== null. */
  .inspector {
    width: 340px; flex-shrink: 0;
    background: #fff;
    border-left: 1px solid #e2e2e8;
    padding: 16px 18px;
    overflow-y: auto;
    display: flex; flex-direction: column; gap: 12px;
    box-shadow: -2px 0 8px rgba(0, 0, 0, 0.04);
  }
  .ins-hdr {
    display: flex; justify-content: space-between; align-items: flex-start;
    border-bottom: 1px solid #ececec;
    padding-bottom: 10px;
  }
  .ins-name { font: bold 14px Arial; color: #222; }
  .ins-id { font: 10px monospace; color: #888; margin-top: 2px; }
  .ins-close {
    background: transparent; border: none; cursor: pointer;
    font-size: 20px; line-height: 1; color: #888; padding: 0 4px;
  }
  .ins-close:hover { color: #cc2222; }
  .ins-meta { display: flex; flex-wrap: wrap; gap: 4px; }
  .ins-desc { font: 11px Arial; color: #555; line-height: 1.5; margin: 0; }
  .ins-sec { display: flex; flex-direction: column; gap: 6px; }
  .ins-sec-h {
    font: bold 9px Arial; color: #888;
    text-transform: uppercase; letter-spacing: 1px;
    padding-bottom: 4px; border-bottom: 1px solid #f0f0f0;
  }
  .muted { color: #bbb; font-weight: normal; margin-left: 4px; }
  .pr { display: flex; flex-direction: column; gap: 3px; padding: 4px 0; }
  .pr-row { display: flex; align-items: center; gap: 8px; }
  .lbl { flex: 1; font: 11px Arial; color: #555; }
  .pr-num {
    width: 64px; font: 10px monospace;
    padding: 2px 5px; border: 1px solid #ddd; border-radius: 3px;
    text-align: right;
  }
  .pr-range { width: 100%; accent-color: #cc2222; height: 4px; }
  .ins-tags { display: flex; flex-wrap: wrap; gap: 4px; }
  .tag { font: 9px Arial; color: #555; background: #f0f0f0; padding: 2px 6px; border-radius: 9px; }
  .ins-actions { display: flex; gap: 8px; margin-top: 8px; }
  .btn {
    flex: 1; text-align: center;
    padding: 8px 12px; font: bold 11px Arial;
    background: #f0f0f0; color: #333;
    border: 1px solid #ddd; border-radius: 4px;
    cursor: pointer; text-decoration: none;
  }
  .btn:hover { background: #e8e8e8; }
  .btn.primary { background: #cc2222; color: #fff; border-color: #cc2222; }
  .btn.primary:hover { background: #a91d1d; border-color: #a91d1d; }

  /* Narrow grid cards a bit when inspector is open so they don't squish. */
  .layout.inspector-open .grid { grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); }

  @media (max-width: 1000px) {
    .inspector { width: 300px; }
  }
  @media (max-width: 800px) {
    .inspector { position: fixed; top: 0; right: 0; height: 100vh; width: 320px; z-index: 50; }
  }
  @media (max-width: 700px) {
    .layout { flex-direction: column; }
    .sidebar {
      width: 100%; max-height: 220px;
      border-right: none; border-bottom: 1px solid #e2e2e8;
    }
  }
</style>
