<script lang="ts">
  /**
   * Hierarchical edge-bundling layout — adapted from the react-graph-gallery
   * "Hierarchical edge bundling" recipe (d3, not React). The classic recipe
   * bundles CROSS-links between leaves along the tree's radial skeleton; our
   * folder tree is a PURE HIERARCHY (no cross-edges), so we bundle the
   * parent→child structure itself: `d3.cluster()` puts every node at a radial
   * (angle, radius), then for each leaf we draw the bundled spline that runs
   * from the centre out through its ancestors to the leaf
   * (`d3.lineRadial().curve(d3.curveBundle.beta(0.85))`). Splines that share
   * ancestors hug each other near the middle — the signature "bundled trunk"
   * look — and fan out to the rim where the files live. Leaves are dots
   * coloured by top-level area; faint radial labels mark the areas.
   */
  import { hierarchy, cluster } from 'd3-hierarchy';
  import type { HierarchyNode } from 'd3-hierarchy';
  import { lineRadial, curveBundle } from 'd3-shape';
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

  let width = $state(880);
  const HEIGHT = 620;
  const MARGIN = 96; // room for the rim labels + dots

  const layout = $derived.by(() => {
    const radius = Math.max(40, Math.min(width, HEIGHT) / 2 - MARGIN);
    const root = hierarchy(data)
      .sum((d) => d.loc ?? 0)
      // Keep siblings grouped so areas occupy contiguous arcs.
      .sort(
        (a, b) =>
          areaKey(a).localeCompare(areaKey(b)) ||
          (a.data.name ?? '').localeCompare(b.data.name ?? ''),
      );
    cluster<FolderNode>().size([2 * Math.PI, radius])(root);

    // Bundled spline builder: angle = node.x, radius = node.y.
    const line = lineRadial<HierarchyNode<FolderNode>>()
      .curve(curveBundle.beta(0.85))
      .radius((d) => (d as any).y)
      .angle((d) => (d as any).x);

    const leaves = root.leaves();
    const paths = leaves.map((leaf) => ({
      node: leaf,
      d: line(leaf.ancestors().reverse()) ?? '',
    }));

    // Leaf dot positions (polar → cartesian, angle measured from +y / top).
    const dots = leaves.map((leaf) => {
      const a = (leaf as any).x - Math.PI / 2;
      const r = (leaf as any).y;
      return { node: leaf, x: Math.cos(a) * r, y: Math.sin(a) * r };
    });

    // One faint label per top-level area at the mean angle of its leaves.
    const byArea = new Map<
      string,
      { node: HierarchyNode<FolderNode>; angles: number[] }
    >();
    for (const leaf of leaves) {
      const k = areaKey(leaf);
      const rec = byArea.get(k) ?? {
        node: leaf.ancestors().reverse()[2] ?? leaf,
        angles: [],
      };
      rec.angles.push((leaf as any).x);
      byArea.set(k, rec);
    }
    const labels = [...byArea.entries()].map(([name, rec]) => {
      const mean = rec.angles.reduce((s, v) => s + v, 0) / rec.angles.length;
      const deg = (mean * 180) / Math.PI - 90;
      const flip = mean > Math.PI;
      return {
        name,
        node: rec.node,
        angle: deg,
        flip,
        r: radius + 10,
      };
    });

    return { radius, paths, dots, labels };
  });
</script>

<div class="fh-wrap" bind:clientWidth={width}>
  <svg
    viewBox={`0 0 ${width} ${HEIGHT}`}
    width={width}
    height={HEIGHT}
    role="img"
    aria-label="Hierarchical edge bundling of src/ folders"
  >
    <g transform={`translate(${width / 2},${HEIGHT / 2})`}>
      <!-- bundled parent→leaf splines -->
      {#each layout.paths as p (p.node.data.path)}
        <path class="bundle" d={p.d} stroke={color(p.node)} />
      {/each}
      <!-- leaves -->
      {#each layout.dots as dt (dt.node.data.path)}
        <!-- svelte-ignore a11y_no_static_element_interactions a11y_no_noninteractive_tabindex -->
        <circle
          role="button"
          tabindex="-1"
          class="leaf"
          cx={dt.x}
          cy={dt.y}
          r="2.4"
          fill={color(dt.node)}
          onmousemove={(e) => showTip(tipFor(dt.node), e.clientX, e.clientY)}
          onmouseleave={hideTip}
        />
      {/each}
      <!-- area rim labels -->
      {#each layout.labels as lb (lb.name)}
        <g transform={`rotate(${lb.angle}) translate(${lb.r},0)`}>
          <text
            class="area-label"
            transform={lb.flip ? 'rotate(180)' : ''}
            text-anchor={lb.flip ? 'end' : 'start'}
            fill={color(lb.node)}
            dy="0.31em"
            onmousemove={(e) =>
              showTip(tipFor(lb.node), e.clientX, e.clientY)}
            onmouseleave={hideTip}
          >
            {lb.name}
          </text>
        </g>
      {/each}
    </g>
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
  .bundle {
    fill: none;
    stroke-width: 0.9;
    stroke-opacity: 0.28;
    transition: stroke-opacity 0.12s ease;
  }
  .leaf {
    cursor: default;
    transition: r 0.1s ease;
  }
  .leaf:hover {
    r: 4;
  }
  .area-label {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.02em;
    cursor: default;
    paint-order: stroke;
    stroke: rgba(251, 251, 251, 0.85);
    stroke-width: 3px;
  }
</style>
