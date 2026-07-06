<script lang="ts">
  /**
   * FolderTreemap.svelte — a zoomable LOC treemap of the src/ tree for the
   * /design "Folder tree" tab. Rectangle area ∝ lines of code.
   *
   * Shows the CURRENT focus folder two levels deep: each child (depth-1) is a
   * labelled block; folders are subdivided once more (depth-2) so you see the
   * texture, and clicking a folder zooms into it (breadcrumb navigates back up).
   * Colour groups by the depth-1 child; hover a rect for its path + LOC. Files
   * are leaves; deeper folders aggregate to a single sized block until you drill.
   *
   * Data: folder-tree.ts (a generated snapshot). d3-hierarchy does the squarify.
   */
  import { hierarchy, treemap, treemapSquarify, type HierarchyRectangularNode } from 'd3-hierarchy';
  import { FOLDER_TREE, type FolderNode } from './folder-tree';

  const W = 1180;
  const H = 700;

  // area palette — depth-1 children of the current focus cycle through these.
  const PALETTE = [
    '#3b82f6', '#f97316', '#22c55e', '#a855f7', '#ec4899', '#14b8a6',
    '#f59e0b', '#6366f1', '#ef4444', '#06b6d4', '#84cc16', '#eab308',
  ];

  // ── focus stack (breadcrumb) ───────────────────────────────
  // Each entry is a FolderNode; the last is the current focus.
  let stack = $state<FolderNode[]>([FOLDER_TREE]);
  const focus = $derived(stack[stack.length - 1]);

  function subtreeLoc(n: FolderNode): number {
    if (!n.children) return n.loc ?? 0;
    return n.children.reduce((s, c) => s + subtreeLoc(c), 0);
  }
  function fileCount(n: FolderNode): number {
    if (!n.children) return 1;
    return n.children.reduce((s, c) => s + fileCount(c), 0);
  }

  // Prune the focus subtree to 2 visible levels: children (depth-1) and
  // grandchildren (depth-2). Deeper folders collapse into a single aggregated
  // leaf carrying their total LOC (so the block is sized right, click to drill).
  type Pruned = { name: string; path: string; loc?: number; isFolder?: boolean; ref: FolderNode; children?: Pruned[] };
  function prune(node: FolderNode, depth: number): Pruned {
    const base: Pruned = { name: node.name, path: node.path, ref: node };
    if (node.children && depth > 0) {
      base.children = node.children.map((c) => prune(c, depth - 1));
    } else {
      base.loc = subtreeLoc(node);
      base.isFolder = !!node.children;
    }
    return base;
  }

  type RNode = HierarchyRectangularNode<Pruned>;
  const layout = $derived.by<RNode>(() => {
    const shallow = prune(focus, 2);
    const root = hierarchy(shallow)
      .sum((d) => (d.children ? 0 : d.loc ?? 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap<Pruned>()
      .tile(treemapSquarify)
      .size([W, H])
      .paddingOuter(6)
      .paddingTop(20)
      .paddingInner(4)
      .round(true)(root);
    return root as RNode;
  });

  // depth-1 nodes (the labelled area blocks) + their palette colour
  const areas = $derived(layout.children ?? []);
  const colorFor = $derived.by(() => {
    const m = new Map<string, string>();
    areas.forEach((a, i) => m.set(a.data.path, PALETTE[i % PALETTE.length]));
    return m;
  });
  // every rendered rect (depth-1 leaves + depth-2), each with its area colour
  const rects = $derived.by(() => {
    const out: { n: RNode; color: string; area: RNode }[] = [];
    for (const a of areas) {
      const color = colorFor.get(a.data.path) ?? '#94a3b8';
      if (a.children) for (const c of a.children) out.push({ n: c, color, area: a });
      else out.push({ n: a, color, area: a }); // a file directly under focus
    }
    return out;
  });

  function isFolder(n: RNode): boolean {
    return !!(n.data.ref.children) ;
  }
  // safe DOM id from a path (slashes/dots break url(#…) references)
  const safeId = (p: string) => 'clip-' + p.replace(/[^a-zA-Z0-9]/g, '-');
  function zoomInto(n: FolderNode) {
    if (!n.children) return;
    stack = [...stack, n];
  }
  function crumbTo(i: number) {
    stack = stack.slice(0, i + 1);
  }

  // hover
  let hovered = $state<RNode | null>(null);
  let mouse = $state({ x: 0, y: 0 });
  function onMove(e: PointerEvent) { mouse = { x: e.clientX, y: e.clientY }; }

  const fmt = (n: number) => n.toLocaleString();
</script>

<div class="tm-wrap" onpointermove={onMove}>
  <!-- breadcrumb -->
  <div class="crumbs">
    {#each stack as s, i}
      {#if i > 0}<span class="sep">/</span>{/if}
      <button type="button" class="crumb" class:cur={i === stack.length - 1} onclick={() => crumbTo(i)}>{s.name}</button>
    {/each}
    <span class="crumb-meta">{fmt(fileCount(focus))} files · {fmt(subtreeLoc(focus))} LOC</span>
  </div>

  <svg class="tm-svg" viewBox="0 0 {W} {H}" preserveAspectRatio="xMidYMid meet" role="application" aria-label="Folder LOC treemap">
    <!-- depth-1 area headers (labels + click-to-zoom) -->
    {#each areas as a}
      {@const folder = isFolder(a)}
      <g
        class="area-head"
        class:folder
        onclick={() => folder && zoomInto(a.data.ref)}
        onpointerenter={() => (hovered = a)}
        role={folder ? 'button' : undefined}
        tabindex={folder ? 0 : undefined}
      >
        <rect x={a.x0} y={a.y0} width={Math.max(0, a.x1 - a.x0)} height={Math.max(0, a.y1 - a.y0)} rx="5" class="area-bg" fill={colorFor.get(a.data.path)} />
        <clipPath id={safeId(a.data.path)}><rect x={a.x0} y={a.y0} width={Math.max(0, a.x1 - a.x0)} height={16} /></clipPath>
        <text x={a.x0 + 5} y={a.y0 + 12} class="area-lbl" clip-path="url(#{safeId(a.data.path)})">
          {folder ? '▸ ' : ''}{a.data.name} · {fmt(a.value ?? 0)}
        </text>
      </g>
    {/each}

    <!-- leaf / depth-2 rects -->
    {#each rects as r}
      {@const w = Math.max(0, r.n.x1 - r.n.x0)}
      {@const h = Math.max(0, r.n.y1 - r.n.y0)}
      {@const folder = isFolder(r.n)}
      <g
        class="cell"
        class:folder
        class:dim={hovered && hovered !== r.n && hovered !== r.area}
        onclick={() => folder && zoomInto(r.n.data.ref)}
        onpointerenter={() => (hovered = r.n)}
        role={folder ? 'button' : undefined}
        tabindex={folder ? 0 : undefined}
      >
        <rect x={r.n.x0} y={r.n.y0} width={w} height={h} rx="2" fill={r.color} class="cell-bg" class:is-folder={folder} />
        {#if w > 58 && h > 16}
          <text x={r.n.x0 + 4} y={r.n.y0 + 11} class="cell-lbl">{folder ? '▸ ' : ''}{r.n.data.name}</text>
        {/if}
      </g>
    {/each}
  </svg>

  {#if hovered}
    <div class="tip" style="left:{mouse.x + 14}px; top:{mouse.y + 14}px;">
      <div class="tip-path">{hovered.data.path}</div>
      <div class="tip-meta">
        {#if isFolder(hovered)}
          <span class="chip folder">folder</span> {fmt(fileCount(hovered.data.ref))} files
        {:else}
          <span class="chip">file</span>
        {/if}
        <span class="loc">{fmt(hovered.value ?? hovered.data.loc ?? 0)} LOC</span>
      </div>
    </div>
  {/if}
</div>

<p class="tm-caption">
  Area ∝ lines of code · colour groups by folder · <b>click a folder</b> to zoom in ·
  breadcrumb to go back · hover for path + LOC
</p>

<style>
  .tm-wrap {
    position: relative; width: 100%;
    border: 1px solid #e7ecf2; border-radius: 16px; overflow: hidden;
    background: #fbfcfe; box-shadow: inset 0 1px 0 #fff, 0 1px 3px rgba(15,23,42,0.04);
    touch-action: none;
  }
  .crumbs {
    display: flex; align-items: center; gap: 3px; flex-wrap: wrap;
    padding: 9px 12px; border-bottom: 1px solid #eef2f7; background: #fff;
    font-size: 0.74rem;
  }
  .crumb {
    font: inherit; color: #3b82f6; background: none; border: none; padding: 2px 5px;
    border-radius: 6px; cursor: pointer; font-weight: 600;
  }
  .crumb:hover { background: #eff6ff; }
  .crumb.cur { color: #0f172a; cursor: default; }
  .crumb.cur:hover { background: none; }
  .sep { color: #cbd5e1; }
  .crumb-meta { margin-left: auto; color: #94a3b8; font-size: 0.68rem; }

  .tm-svg { width: 100%; height: 700px; display: block; }

  .area-bg { opacity: 0.1; }
  .area-head.folder { cursor: pointer; }
  .area-lbl {
    font-size: 10px; font-weight: 700; fill: #334155;
    font-family: ui-monospace, Menlo, monospace; pointer-events: none;
  }

  .cell { cursor: default; }
  .cell.folder { cursor: pointer; }
  .cell-bg {
    stroke: #fff; stroke-width: 1; opacity: 0.85;
    transition: opacity 0.12s ease;
  }
  .cell-bg.is-folder { opacity: 0.55; stroke-width: 1.5; }
  .cell:hover .cell-bg { opacity: 1; }
  .cell.dim { opacity: 0.35; }
  .cell-lbl {
    font-size: 8px; fill: #0f172a; pointer-events: none;
    font-family: ui-monospace, Menlo, monospace;
  }

  .tip {
    position: fixed; z-index: 30; max-width: 320px; padding: 8px 11px;
    background: rgba(15,23,42,0.95); color: #e2e8f0; border-radius: 9px;
    box-shadow: 0 8px 24px rgba(15,23,42,0.25); pointer-events: none;
    font-size: 0.72rem; line-height: 1.35;
  }
  .tip-path { font-weight: 700; font-family: ui-monospace, Menlo, monospace; color: #fff; margin-bottom: 4px; word-break: break-all; }
  .tip-meta { display: flex; align-items: center; gap: 8px; }
  .chip { font-size: 0.6rem; font-weight: 700; color: #fff; padding: 1px 7px; border-radius: 20px; background: #64748b; }
  .chip.folder { background: #f59e0b; }
  .loc { font-size: 0.64rem; color: #94a3b8; }

  .tm-caption { margin: 9px 2px 0; font-size: 0.72rem; color: #94a3b8; text-align: center; line-height: 1.4; }
  .tm-caption b { color: #64748b; font-weight: 700; }
</style>
