<script lang="ts">
  /**
   * /design "Folder tree" view — a LAYOUT SWITCHER over four d3-hierarchy
   * renderings of the SAME src/ tree (area ∝ lines of code):
   *
   *   Treemap (default) · Icicle · Circle pack · Tree
   *
   * The switcher choice persists in localStorage['design-folder-layout'].
   * This shell owns the shared visual language — the area colour scale and the
   * one floating dark tooltip (path · file/folder · LOC) — and hands both to
   * whichever layout is mounted.
   */
  import { hierarchy } from 'd3-hierarchy';
  import { FOLDER_TREE, FOLDER_TREE_STATS } from './folder-tree';
  import { makeAreaColor, fmtLoc, type TipData } from './folder-hierarchy';
  import FolderTreemap from './FolderTreemap.svelte';
  import FolderIcicle from './FolderIcicle.svelte';
  import FolderCirclePack from './FolderCirclePack.svelte';
  import FolderTree from './FolderTree.svelte';
  import FolderEdgeBundle from './FolderEdgeBundle.svelte';
  import FolderArc from './FolderArc.svelte';

  type Layout = 'treemap' | 'icicle' | 'pack' | 'tree' | 'bundle' | 'arc';
  const LS_KEY = 'design-folder-layout';
  const LAYOUTS: { id: Layout; label: string; hint: string }[] = [
    { id: 'treemap', label: 'Treemap', hint: 'Nested rectangles, area ∝ LOC' },
    { id: 'icicle', label: 'Icicle', hint: 'Adjacency rows, click to zoom' },
    { id: 'pack', label: 'Circle pack', hint: 'Nested circles, click to zoom' },
    { id: 'tree', label: 'Tree', hint: 'Collapsible node-link dendrogram' },
    {
      id: 'bundle',
      label: 'Edge bundling',
      hint: 'Radial bundled parent→leaf splines',
    },
    { id: 'arc', label: 'Arc', hint: 'Parent→child arcs on one axis; click to expand' },
  ];

  const LAYOUT_IDS = LAYOUTS.map((l) => l.id) as Layout[];
  let layout = $state<Layout>('treemap');
  if (typeof localStorage !== 'undefined') {
    const v = localStorage.getItem(LS_KEY);
    if (v && (LAYOUT_IDS as string[]).includes(v)) layout = v as Layout;
  }
  function setLayout(l: Layout) {
    layout = l;
    if (typeof localStorage !== 'undefined') localStorage.setItem(LS_KEY, l);
  }

  // Area colour scale — keyed by top-level folder NAME so it's stable across
  // every layout's own hierarchy instance.
  const color = makeAreaColor(hierarchy(FOLDER_TREE).sum((d) => d.loc ?? 0));

  // ── shared floating tooltip ──
  let tip = $state<{ show: boolean; x: number; y: number; d: TipData | null }>({
    show: false,
    x: 0,
    y: 0,
    d: null,
  });
  function showTip(d: TipData, x: number, y: number) {
    tip = { show: true, x, y, d };
  }
  function hideTip() {
    tip = { ...tip, show: false };
  }

  const active = $derived(LAYOUTS.find((l) => l.id === layout) ?? LAYOUTS[0]);
</script>

<div class="fh-root">
  <!-- segmented control -->
  <div class="seg" role="tablist" aria-label="Folder layout">
    {#each LAYOUTS as l (l.id)}
      <button
        class="seg-btn"
        class:active={layout === l.id}
        role="tab"
        aria-selected={layout === l.id}
        title={l.hint}
        onclick={() => setLayout(l.id)}
      >
        {l.label}
      </button>
    {/each}
  </div>

  <p class="caption">
    <strong>{active.label}</strong> — {active.hint}. {FOLDER_TREE_STATS.files}
    files · {FOLDER_TREE_STATS.folders} folders ·
    {fmtLoc(FOLDER_TREE_STATS.loc)} lines of code across <code>src/</code>; area
    ∝ LOC, colour by top-level area.
  </p>

  <div class="stage">
    {#if layout === 'treemap'}
      <FolderTreemap data={FOLDER_TREE} {color} {showTip} {hideTip} />
    {:else if layout === 'icicle'}
      <FolderIcicle data={FOLDER_TREE} {color} {showTip} {hideTip} />
    {:else if layout === 'pack'}
      <FolderCirclePack data={FOLDER_TREE} {color} {showTip} {hideTip} />
    {:else if layout === 'bundle'}
      <FolderEdgeBundle data={FOLDER_TREE} {color} {showTip} {hideTip} />
    {:else if layout === 'arc'}
      <FolderArc data={FOLDER_TREE} {color} {showTip} {hideTip} />
    {:else}
      <FolderTree data={FOLDER_TREE} {color} {showTip} {hideTip} />
    {/if}
  </div>
</div>

<!-- shared dark tooltip (fixed to the viewport, follows the cursor) -->
{#if tip.show && tip.d}
  <div
    class="fh-tip"
    style={`left:${tip.x + 14}px; top:${tip.y + 14}px`}
    role="tooltip"
  >
    <div class="tip-path">{tip.d.path}</div>
    <div class="tip-meta">
      <span class="tip-kind">{tip.d.kind}</span>
      <span class="tip-loc">{fmtLoc(tip.d.loc)} LOC</span>
    </div>
  </div>
{/if}

<style>
  .fh-root {
    width: 100%;
  }
  .seg {
    display: inline-flex;
    gap: 0.25rem;
    margin-bottom: 0.9rem;
    padding: 0.22rem;
    border: 1px solid #e7e7e7;
    border-radius: 11px;
    background: #fafafa;
  }
  .seg-btn {
    font-size: 0.86rem;
    font-weight: 700;
    letter-spacing: -0.01em;
    padding: 0.4rem 0.95rem;
    border: none;
    border-radius: 8px;
    background: transparent;
    color: #555;
    cursor: pointer;
    transition: background 0.16s ease, color 0.16s ease, box-shadow 0.16s ease;
  }
  .seg-btn:hover {
    color: #1a1a1a;
  }
  .seg-btn.active {
    background: #fff;
    color: #cc2222;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.08);
  }
  .caption {
    margin: 0 0 1rem;
    max-width: 62rem;
    font-size: 0.9rem;
    color: #555;
    line-height: 1.5;
  }
  .caption strong {
    color: #1a1a1a;
  }
  .caption code {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.82rem;
    color: #cc2222;
  }
  .stage {
    width: 100%;
  }

  .fh-tip {
    position: fixed;
    z-index: 1200;
    pointer-events: none;
    max-width: 26rem;
    padding: 0.4rem 0.6rem;
    border-radius: 8px;
    background: rgba(20, 20, 22, 0.94);
    color: #f4f4f4;
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.28);
    font-size: 0.78rem;
    line-height: 1.35;
  }
  .tip-path {
    font-family: 'SF Mono', Menlo, Consolas, monospace;
    font-size: 0.74rem;
    word-break: break-all;
    color: #fff;
  }
  .tip-meta {
    display: flex;
    gap: 0.6rem;
    margin-top: 0.15rem;
    color: #b9b9b9;
  }
  .tip-kind {
    text-transform: uppercase;
    letter-spacing: 0.06em;
    font-size: 0.66rem;
    font-weight: 700;
    color: #f0b9b9;
  }
</style>
