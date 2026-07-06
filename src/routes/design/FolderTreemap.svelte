<script lang="ts">
  /**
   * Treemap layout — area ∝ LOC, colour by top-level area.
   * The default folder-hierarchy view. Nested rectangles; leaves are files.
   */
  import { hierarchy, treemap } from 'd3-hierarchy';
  import type { HierarchyNode } from 'd3-hierarchy';
  import type { FolderNode } from './folder-tree';
  import { tipFor, type TipData } from './folder-hierarchy';

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

  const leaves = $derived.by(() => {
    const root = hierarchy(data)
      .sum((d) => d.loc ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    treemap<FolderNode>()
      .size([Math.max(width, 10), HEIGHT])
      .paddingInner(2)
      .paddingOuter(2)
      .paddingTop((d) => (d.depth > 0 && d.children ? 13 : 2))
      .round(true)(root);
    return root.leaves();
  });

  // Depth-1/2 folder cells we draw a faint frame + label for.
  const groups = $derived.by(() => {
    const root = leaves[0]?.ancestors().at(-1);
    if (!root) return [];
    return (root as HierarchyNode<FolderNode> & { descendants(): any })
      .descendants()
      .filter(
        (d: any) => d.depth >= 1 && d.depth <= 2 && d.children,
      ) as any[];
  });
</script>

<div class="fh-wrap" bind:clientWidth={width}>
  <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} role="img" aria-label="Treemap of src/ folders by lines of code">
    {#each groups as g (g.data.path)}
      <g class="grp">
        <rect
          x={g.x0}
          y={g.y0}
          width={Math.max(0, g.x1 - g.x0)}
          height={Math.max(0, g.y1 - g.y0)}
          rx="4"
          fill="none"
          stroke="rgba(0,0,0,0.10)"
          stroke-width="1"
        />
        {#if g.depth <= 2 && g.x1 - g.x0 > 40}
          <text class="grp-label" x={g.x0 + 4} y={g.y0 + 9}>{g.data.name}</text>
        {/if}
      </g>
    {/each}
    {#each leaves as leaf (leaf.data.path)}
      {@const w = Math.max(0, leaf.x1 - leaf.x0)}
      {@const h = Math.max(0, leaf.y1 - leaf.y0)}
      <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->
      <g
        role="button"
        tabindex="-1"
        onmousemove={(e) => showTip(tipFor(leaf), e.clientX, e.clientY)}
        onmouseleave={hideTip}
      >
        <rect
          x={leaf.x0}
          y={leaf.y0}
          width={w}
          height={h}
          rx="3"
          fill={color(leaf)}
          fill-opacity="0.86"
          stroke="rgba(255,255,255,0.55)"
          stroke-width="0.5"
        />
        {#if w > 44 && h > 16}
          <text class="leaf-label" x={leaf.x0 + 4} y={leaf.y0 + 12} clip-path="inset(0)">
            {leaf.data.name}
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
  svg {
    display: block;
    width: 100%;
    height: auto;
    border-radius: 12px;
    background: #fbfbfb;
    border: 1px solid #e7e7e7;
  }
  .grp-label {
    font-size: 9px;
    font-weight: 700;
    fill: rgba(0, 0, 0, 0.5);
    pointer-events: none;
    text-transform: lowercase;
    letter-spacing: 0.02em;
  }
  .leaf-label {
    font-size: 9px;
    fill: #fff;
    font-weight: 600;
    pointer-events: none;
  }
  g[role='button'] rect {
    cursor: default;
    transition: fill-opacity 0.12s ease;
  }
  g[role='button']:hover rect {
    fill-opacity: 1;
  }
</style>
