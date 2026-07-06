<script lang="ts">
  /**
   * Circle-pack layout — d3.pack(). Nested circles, leaf area ∝ LOC.
   * Click a circle to zoom into it; click the focused circle to zoom out.
   */
  import { hierarchy, pack } from 'd3-hierarchy';
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
  const D = HEIGHT; // display diameter of the packed circle

  let focusPath = $state<string>('');

  const root = $derived.by(() => {
    const r = hierarchy(data)
      .sum((d) => d.loc ?? 0)
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    pack<FolderNode>().size([D, D]).padding(3)(r);
    return r;
  });

  const focus = $derived(
    root.descendants().find((d) => d.data.path === focusPath) ?? root,
  );

  const circles = $derived.by(() => {
    const f = focus as any;
    const k = D / (f.r * 2);
    const cx0 = width / 2;
    const cy0 = HEIGHT / 2;
    return root
      .descendants()
      .filter((d) => d.depth <= focus.depth + 2) // keep it light: 2 rings deep
      .map((d: any) => ({
        node: d,
        cx: (d.x - f.x) * k + cx0,
        cy: (d.y - f.y) * k + cy0,
        r: d.r * k,
      }))
      .filter((c) => c.r > 1.2)
      .sort((a, b) => b.r - a.r); // big first so labels/hover of small on top
  });

  const crumbs = $derived(focus.ancestors().reverse());

  function fill(node: HierarchyNode<FolderNode>): string {
    return lighten(color(node), Math.min(0.55, node.depth * 0.1));
  }

  function onClick(node: HierarchyNode<FolderNode>) {
    if (node === (focus as any)) focusPath = focus.parent?.data.path ?? '';
    else if (isFolder(node)) focusPath = node.data.path;
  }
</script>

<div class="fh-wrap" bind:clientWidth={width}>
  <nav class="crumbs" aria-label="Circle-pack breadcrumb">
    {#each crumbs as c, i (c.data.path)}
      {#if i > 0}<span class="sep">/</span>{/if}
      <button class="crumb" class:cur={c === focus} onclick={() => (focusPath = i === 0 ? '' : c.data.path)}>
        {c.data.name}
      </button>
    {/each}
  </nav>
  <svg viewBox={`0 0 ${width} ${HEIGHT}`} width={width} height={HEIGHT} role="img" aria-label="Circle-pack of src/ folders by lines of code">
    {#each circles as c (c.node.data.path)}
      <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->
      <circle
        role="button"
        tabindex="-1"
        class:folder={isFolder(c.node)}
        cx={c.cx}
        cy={c.cy}
        r={c.r}
        fill={fill(c.node)}
        fill-opacity={isFolder(c.node) ? 0.35 : 0.9}
        stroke="rgba(0,0,0,0.12)"
        stroke-width="0.6"
        onclick={() => onClick(c.node)}
        onmousemove={(e) => showTip(tipFor(c.node), e.clientX, e.clientY)}
        onmouseleave={hideTip}
      />
    {/each}
    {#each circles as c (c.node.data.path + '-t')}
      {#if c.node.parent === (focus as any) && c.r > 16}
        <text class="pk-label" x={c.cx} y={isFolder(c.node) ? c.cy - c.r + 11 : c.cy + 3}>
          {c.node.data.name}
        </text>
      {/if}
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
  circle {
    cursor: default;
    transition: fill-opacity 0.12s ease;
  }
  circle.folder {
    cursor: pointer;
  }
  circle:hover {
    fill-opacity: 1;
  }
  .pk-label {
    font-size: 10px;
    font-weight: 600;
    fill: #333;
    text-anchor: middle;
    pointer-events: none;
    paint-order: stroke;
    stroke: rgba(255, 255, 255, 0.8);
    stroke-width: 2.5px;
  }
</style>
