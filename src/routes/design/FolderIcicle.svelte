<script lang="ts">
  /**
   * Icicle layout — d3.partition(). Horizontal rectangles (depth →), size ∝ LOC.
   * Click a cell to re-root (zoom); breadcrumb walks back out.
   */
  import { hierarchy, partition } from 'd3-hierarchy';
  import type { HierarchyNode } from 'd3-hierarchy';
  import type { FolderNode } from './folder-tree';
  import { tipFor, isFolder, lighten, type TipData } from './folder-hierarchy';

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

  let width = $state(880);
  const HEIGHT = 520;

  let focusPath = $state<string>('');

  const root = $derived.by(() => {
    const r = hierarchy(data)
      .sum((d) => d.loc ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    partition<FolderNode>().size([HEIGHT, Math.max(width, 10)]).padding(1)(r);
    return r;
  });

  const focus = $derived(
    root.descendants().find((d) => d.data.path === focusPath) ?? root,
  );

  // Rescale every node relative to the focus cell (classic zoomable icicle).
  const cells = $derived.by(() => {
    const p = focus as any;
    const span = (p.x1 - p.x0) || 1;
    return root
      .descendants()
      .map((d: any) => {
        const rx0 = ((d.x0 - p.x0) / span) * HEIGHT;
        const rx1 = ((d.x1 - p.x0) / span) * HEIGHT;
        const ry0 = d.y0 - p.y0;
        const ry1 = d.y1 - p.y0;
        return { node: d, rx0, rx1, ry0, ry1, h: rx1 - rx0, w: ry1 - ry0 };
      })
      .filter(
        (c) =>
          c.h > 0.4 &&
          c.rx1 > 0 &&
          c.rx0 < HEIGHT &&
          c.ry0 < width &&
          c.ry1 > 0,
      );
  });

  const crumbs = $derived(focus.ancestors().reverse());

  function fill(node: HierarchyNode<FolderNode>): string {
    const base = color(node);
    return lighten(base, Math.min(0.6, node.depth * 0.11));
  }

  function onClick(node: HierarchyNode<FolderNode>) {
    // Zoom into folders; clicking the focus itself zooms back out one level.
    if (node === (focus as any)) focusPath = focus.parent?.data.path ?? '';
    else if (isFolder(node)) focusPath = node.data.path;
  }
</script>

<div class="fh-wrap" bind:clientWidth={width}>
  <nav class="crumbs" aria-label="Icicle breadcrumb">
    {#each crumbs as c, i (c.data.path)}
      {#if i > 0}<span class="sep">/</span>{/if}
      <button class="crumb" class:cur={c === focus} onclick={() => (focusPath = i === 0 ? '' : c.data.path)}>
        {c.data.name}
      </button>
    {/each}
  </nav>
  <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} role="img" aria-label="Icicle of src/ folders by lines of code">
    {#each cells as c (c.node.data.path)}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->
      <g
        role="button"
        tabindex="-1"
        class:leaf={!isFolder(c.node)}
        onclick={() => onClick(c.node)}
        onmousemove={(e) => showTip(tipFor(c.node), e.clientX, e.clientY)}
        onmouseleave={hideTip}
      >
        <rect
          x={c.ry0}
          y={c.rx0}
          width={Math.max(0, c.w)}
          height={Math.max(0, c.h - 0.6)}
          rx="2.5"
          fill={fill(c.node)}
          fill-opacity="0.9"
        />
        {#if c.h > 11 && c.w > 30}
          <text class="cell-label" x={c.ry0 + 5} y={c.rx0 + c.h / 2 + 3}>
            {c.node.data.name}
          </text>
        {/if}
      </g>
    {/each}
  </svg>
</div>

<style>
  .fh-wrap {
    width: 100%;
  }
  .crumbs {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.15rem;
    margin-bottom: 0.5rem;
    font-size: 0.82rem;
  }
  .crumb {
    border: none;
    background: none;
    padding: 0.1rem 0.25rem;
    border-radius: 5px;
    color: #2f6db3;
    font-weight: 600;
    cursor: pointer;
  }
  .crumb:hover {
    background: #eef3fa;
  }
  .crumb.cur {
    color: #1a1a1a;
    cursor: default;
  }
  .sep {
    color: #b0b0b0;
  }
  svg {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 12px;
    background: #fbfbfb;
    border: 1px solid #e7e7e7;
  }
  .cell-label {
    font-size: 9.5px;
    fill: #fff;
    font-weight: 600;
    pointer-events: none;
    paint-order: stroke;
    stroke: rgba(0, 0, 0, 0.18);
    stroke-width: 2px;
  }
  g[role='button'] {
    cursor: pointer;
  }
  g[role='button'].leaf {
    cursor: default;
  }
  g[role='button'] rect {
    transition: fill-opacity 0.12s ease;
  }
  g[role='button']:hover rect {
    fill-opacity: 1;
  }
</style>
