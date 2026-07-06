<script lang="ts">
  /**
   * Arc diagram — adapted from the react-graph-gallery "Arc diagram" recipe
   * (d3, not React). Nodes sit on a single horizontal axis; each relationship
   * is a semicircular arc drawn above the axis. Our folder tree is a pure
   * hierarchy, so the relationships are the parent→child links.
   *
   * READABILITY CHOICE: with 443 leaves a fully-expanded axis is unreadable
   * (an arc per file, most nearly vertical). So folders at depth ≥ 2 START
   * COLLAPSED — the default view shows the top-level areas + their direct
   * children (~50 nodes), which reads cleanly. Click a folder dot to expand
   * its subtree onto the axis; the stage is horizontally scrollable so a fully
   * expanded area never overflows the page. Nodes are ordered by area then
   * path so each area's arcs stay clustered; arc height ∝ the horizontal span.
   */
  import { hierarchy } from 'd3-hierarchy';
  import type { HierarchyNode } from 'd3-hierarchy';
  import type { FolderNode } from './folder-tree';
  import { tipFor, isFolder, areaKey, type TipData } from './folder-hierarchy';

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

  const STEP = 15; // px between adjacent axis nodes
  const PAD = 30;
  const MAX_ARC = 210; // cap on arc height so tall arcs stay on-stage
  const BASE_PAD = 46; // gap below the axis for labels

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

  const layout = $derived.by(() => {
    const root = hierarchy(data, (d) =>
      collapsed.has(d.path) ? null : d.children,
    ).sum((d) => d.loc ?? 0);

    // Axis order: area then path. DFS already groups areas contiguously, but
    // sort explicitly so the ordering is stable + matches the caption.
    const nodes = root
      .descendants()
      .sort(
        (a, b) =>
          areaKey(a).localeCompare(areaKey(b)) ||
          a.data.path.localeCompare(b.data.path),
      );
    const xOf = new Map<string, number>();
    nodes.forEach((n, i) => xOf.set(n.data.path, PAD + i * STEP));

    const baseY = PAD + MAX_ARC;
    const arcs = root.links().map((l) => {
      const x0 = xOf.get(l.source.data.path)!;
      const x1 = xOf.get(l.target.data.path)!;
      const rx = Math.abs(x1 - x0) / 2;
      const ry = Math.min(rx, MAX_ARC);
      const sweep = x1 > x0 ? 1 : 0; // arc bows upward regardless of direction
      const d = `M${x0},${baseY} A${rx},${ry} 0 0 ${sweep} ${x1},${baseY}`;
      return { node: l.target, d };
    });

    const dots = nodes.map((n) => ({ node: n, x: xOf.get(n.data.path)!, baseY }));

    return {
      arcs,
      dots,
      baseY,
      w: PAD * 2 + Math.max(0, nodes.length - 1) * STEP,
      h: baseY + BASE_PAD,
    };
  });

  function toggle(node: HierarchyNode<FolderNode>) {
    if (!isFolder(node)) return;
    const next = new Set(collapsed);
    if (next.has(node.data.path)) next.delete(node.data.path);
    else next.add(node.data.path);
    collapsed = next;
  }
</script>

<div class="arc-scroll">
  <svg
    width={layout.w}
    height={layout.h}
    viewBox={`0 0 ${layout.w} ${layout.h}`}
    role="img"
    aria-label="Arc diagram of src/ parent→child folder links"
  >
    <!-- arcs -->
    {#each layout.arcs as a (a.node.data.path)}
      <path class="arc" d={a.d} stroke={color(a.node)} />
    {/each}
    <!-- axis -->
    <line
      class="axis"
      x1={PAD - 6}
      y1={layout.baseY}
      x2={layout.w - PAD + 6}
      y2={layout.baseY}
    />
    <!-- nodes -->
    {#each layout.dots as dt (dt.node.data.path)}
      {@const folder = isFolder(dt.node)}
      {@const isCollapsed = collapsed.has(dt.node.data.path)}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->
      <g
        class="node"
        class:folder
        transform={`translate(${dt.x},${dt.baseY})`}
        role="button"
        tabindex="-1"
        onclick={() => toggle(dt.node)}
        onmousemove={(e) => showTip(tipFor(dt.node), e.clientX, e.clientY)}
        onmouseleave={hideTip}
      >
        <circle
          r={folder ? 3.6 : 2.6}
          fill={folder ? (isCollapsed ? color(dt.node) : '#fff') : color(dt.node)}
          stroke={color(dt.node)}
          stroke-width="1.4"
        />
        <text class="label" class:dir={folder} transform="rotate(90)" x="8" y="3">
          {#if folder && isCollapsed}<tspan class="badge">▸</tspan>{/if}{dt.node
            .data.name}
        </text>
      </g>
    {/each}
  </svg>
</div>

<style>
  .arc-scroll {
    width: 100%;
    overflow-x: auto;
    overflow-y: hidden;
    border-radius: 12px;
    background: #fbfbfb;
    border: 1px solid #e7e7e7;
  }
  svg {
    display: block;
  }
  .arc {
    fill: none;
    stroke-width: 1.1;
    stroke-opacity: 0.42;
    transition: stroke-opacity 0.12s ease;
  }
  .axis {
    stroke: rgba(0, 0, 0, 0.18);
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
    font-size: 9.5px;
    fill: #555;
    dominant-baseline: middle;
    pointer-events: none;
  }
  .label.dir {
    font-weight: 700;
    fill: #1a1a1a;
  }
  .label .badge {
    fill: #cc2222;
    font-size: 8px;
  }
</style>
