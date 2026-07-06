<script lang="ts">
  /**
   * Tidy node-link tree — d3.tree(). Collapsible dendrogram.
   * With ~390 files a fully-expanded tree is unreadable, so folders past
   * depth 2 START COLLAPSED; click a folder to expand/collapse it.
   */
  import { hierarchy, tree } from 'd3-hierarchy';
  import type { HierarchyNode } from 'd3-hierarchy';
  import type { FolderNode } from './folder-tree';
  import { tipFor, isFolder, fmtLoc, type TipData } from './folder-hierarchy';

  let {
    data,
    color,
    showTip,
    hideTip,
  }: {
    data: FolderNode;
    color: (n: HierarchyNode<FolderNode>) => string;
    showTip: (t: TipData, x: number, y: number) => void;
    hideTip: () => void;
  } = $props();

  const ROW = 18;
  const COL = 190;
  const PAD = 24;

  // Folders collapsed by default: everything at depth >= 2.
  function initialCollapsed(): Set<string> {
    const set = new Set<string>();
    hierarchy(data).each((n) => {
      if (n.depth >= 2 && n.data.children && n.data.children.length)
        set.add(n.data.path);
    });
    return set;
  }
  let collapsed = $state<Set<string>>(initialCollapsed());

  // Rebuild + lay out, pruning children of collapsed folders.
  const laid = $derived.by(() => {
    const root = hierarchy(data, (d) =>
      collapsed.has(d.path) ? null : d.children,
    ).sum((d) => d.loc ?? 0);
    tree<FolderNode>().nodeSize([ROW, COL])(root);
    const nodes = root.descendants();
    const links = root.links();
    let minX = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes as any[]) {
      if (n.x < minX) minX = n.x;
      if (n.x > maxX) maxX = n.x;
      if (n.y > maxY) maxY = n.y;
    }
    return {
      nodes,
      links,
      offX: -minX + PAD,
      w: maxY + COL, // room for the label to the right of the deepest node
      h: maxX - minX + PAD * 2,
    };
  });

  function toggle(node: HierarchyNode<FolderNode>) {
    if (!isFolder(node)) return;
    const next = new Set(collapsed);
    if (next.has(node.data.path)) next.delete(node.data.path);
    else next.add(node.data.path);
    collapsed = next;
  }

  function linkPath(s: any, t: any, offX: number): string {
    const sx = s.x + offX,
      sy = s.y,
      tx = t.x + offX,
      ty = t.y;
    const mid = (sy + ty) / 2;
    return `M${sy},${sx}C${mid},${sx} ${mid},${tx} ${ty},${tx}`;
  }
</script>

<div class="tree-scroll">
  <svg
    width={laid.w}
    height={laid.h}
    viewBox={`0 0 ${laid.w} ${laid.h}`}
    role="img"
    aria-label="Collapsible node-link tree of src/ folders"
  >
    <g transform={`translate(${PAD},0)`}>
      {#each laid.links as l (l.target.data.path)}
        <path class="link" d={linkPath(l.source, l.target, laid.offX)} />
      {/each}
      {#each laid.nodes as n (n.data.path)}
        {@const isCollapsed = collapsed.has(n.data.path)}
        {@const folder = isFolder(n)}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->
        <g
          class="node"
          class:folder
          transform={`translate(${n.y},${(n as any).x + laid.offX})`}
          role="button"
          tabindex="-1"
          onclick={() => toggle(n)}
          onmousemove={(e) => showTip(tipFor(n), e.clientX, e.clientY)}
          onmouseleave={hideTip}
        >
          <circle
            r={folder ? 4 : 3}
            fill={folder ? (isCollapsed ? color(n) : '#fff') : color(n)}
            stroke={color(n)}
            stroke-width="1.5"
          />
          <text class="label" class:dir={folder} x={folder ? 8 : 7} y="3">
            {#if folder && isCollapsed}<tspan class="badge">▸ </tspan>{/if}{n.data.name}<tspan class="loc"> · {fmtLoc(n.value)}</tspan>
          </text>
        </g>
      {/each}
    </g>
  </svg>
</div>

<style>
  .tree-scroll {
    width: 100%;
    max-height: 560px;
    overflow: auto;
    border-radius: 12px;
    background: #fbfbfb;
    border: 1px solid #e7e7e7;
    padding: 4px 0;
  }
  svg {
    display: block;
  }
  .link {
    fill: none;
    stroke: rgba(0, 0, 0, 0.16);
    stroke-width: 1;
  }
  .node {
    cursor: default;
  }
  .node.folder {
    cursor: pointer;
  }
  .node circle {
    transition: r 0.1s ease;
  }
  .node.folder:hover circle {
    r: 5;
  }
  .label {
    font-size: 10.5px;
    fill: #333;
    dominant-baseline: middle;
    pointer-events: none;
  }
  .label.dir {
    font-weight: 700;
    fill: #1a1a1a;
  }
  .label .loc {
    fill: #a0a0a0;
    font-size: 9px;
  }
  .label .badge {
    fill: #cc2222;
    font-size: 9px;
  }
</style>
