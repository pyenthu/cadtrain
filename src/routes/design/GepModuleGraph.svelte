<script lang="ts">
  /**
   * GepModuleGraph.svelte — a COMPACT force-directed module map of the
   * GraphEditorPane (GEP) editor cluster for the /design "GEP module" tab.
   *
   * Unlike the app-architecture ArchGraph (a curated collapsible xyflow tree),
   * this is a d3-force network: every file in `src/lib/shared/graph-editor/*`
   * is a node (radius ∝ LOC, colour = cluster), every import/mount is a link.
   * Deliberately label-light — node dots + a short id, with the file's role /
   * LOC / cluster surfaced ON HOVER via a floating tooltip. Drag a node to pin
   * it; scroll to zoom; drag the canvas to pan.
   *
   * SSR is globally off (src/+layout.ts) so d3-force in the module scope is safe.
   */
  import {
    forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
    type Simulation,
  } from 'd3-force';
  import { onMount } from 'svelte';
  import { GEP_CLUSTERS, GEP_MODULE_NODES, GEP_MODULE_LINKS, type GepModuleNode } from './gep-modules';

  // Simulation-mutated node/link records (d3 adds x/y/vx/vy + resolves link ends).
  type SimNode = GepModuleNode & { x: number; y: number; fx?: number | null; fy?: number | null };
  type SimLink = { source: SimNode; target: SimNode; kind?: string };

  const W = 1180;
  const H = 720;

  const clusterColor = new Map(GEP_CLUSTERS.map((c) => [c.id, c.color]));
  const colorOf = (n: GepModuleNode) => clusterColor.get(n.cluster) ?? '#94a3b8';
  // Radius grows with LOC (sqrt so area ∝ LOC), clamped so the monster files
  // (GEP 4456, NodeCard 2453) stay on-canvas without swamping the small modules.
  const radiusOf = (n: GepModuleNode) => Math.max(6, Math.min(30, Math.sqrt(n.loc) * 0.42));

  let nodes = $state.raw<SimNode[]>([]);
  let links = $state.raw<SimLink[]>([]);
  let sim: Simulation<SimNode, undefined> | null = null;

  // pan / zoom (simple; d3-zoom not needed for this size)
  let tx = $state(0);
  let ty = $state(0);
  let scale = $state(1);

  // hover tooltip
  let hovered = $state<SimNode | null>(null);
  let mouse = $state({ x: 0, y: 0 });

  // node drag
  let dragging: SimNode | null = null;

  let svgEl: SVGSVGElement;

  onMount(() => {
    const ns: SimNode[] = GEP_MODULE_NODES.map((n, i) => ({
      ...n,
      // seed positions on a ring so the sim unfolds smoothly (deterministic).
      x: W / 2 + Math.cos((i / GEP_MODULE_NODES.length) * Math.PI * 2) * 240,
      y: H / 2 + Math.sin((i / GEP_MODULE_NODES.length) * Math.PI * 2) * 240,
    }));
    const byId = new Map(ns.map((n) => [n.id, n]));
    const ls: SimLink[] = GEP_MODULE_LINKS
      .map((l) => ({ source: byId.get(l.source)!, target: byId.get(l.target)!, kind: l.kind }))
      .filter((l) => l.source && l.target);

    sim = forceSimulation(ns)
      .force('link', forceLink<SimNode, SimLink>(ls).id((d) => d.id).distance(70).strength(0.35))
      .force('charge', forceManyBody().strength(-320))
      .force('center', forceCenter(W / 2, H / 2))
      .force('collide', forceCollide<SimNode>().radius((d) => radiusOf(d) + 6))
      .force('x', forceX(W / 2).strength(0.04))
      .force('y', forceY(H / 2).strength(0.06))
      .on('tick', () => {
        // reassign to trigger Svelte reactivity ($state.raw = replace ref)
        nodes = [...ns];
        links = [...ls];
      });

    return () => sim?.stop();
  });

  // ── canvas pan / zoom ──────────────────────────────────────
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.max(0.35, Math.min(3, scale * factor));
    // zoom toward cursor
    const rect = svgEl.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    tx = mx - ((mx - tx) * next) / scale;
    ty = my - ((my - ty) * next) / scale;
    scale = next;
  }

  let panning = false;
  let panStart = { x: 0, y: 0, tx: 0, ty: 0 };
  function onCanvasDown(e: PointerEvent) {
    if (dragging) return;
    panning = true;
    panStart = { x: e.clientX, y: e.clientY, tx, ty };
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }
  function toWorld(e: PointerEvent) {
    const rect = svgEl.getBoundingClientRect();
    return { x: (e.clientX - rect.left - tx) / scale, y: (e.clientY - rect.top - ty) / scale };
  }
  function onCanvasMove(e: PointerEvent) {
    mouse = { x: e.clientX, y: e.clientY };
    if (dragging) {
      const w = toWorld(e);
      dragging.fx = w.x;
      dragging.fy = w.y;
      sim?.alphaTarget(0.3).restart();
      nodes = [...nodes];
      return;
    }
    if (panning) {
      tx = panStart.tx + (e.clientX - panStart.x);
      ty = panStart.ty + (e.clientY - panStart.y);
    }
  }
  function onCanvasUp(e: PointerEvent) {
    panning = false;
    if (dragging) {
      // release the pin so the node settles with the sim (comment out to keep pinned)
      dragging.fx = null;
      dragging.fy = null;
      dragging = null;
      sim?.alphaTarget(0);
    }
  }

  function onNodeDown(e: PointerEvent, n: SimNode) {
    e.stopPropagation();
    dragging = n;
    n.fx = n.x;
    n.fy = n.y;
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
  }

  function reheat() {
    sim?.alpha(0.9).restart();
  }
</script>

<div class="gep-wrap">
  <svg
    bind:this={svgEl}
    class="gep-svg"
    viewBox="0 0 {W} {H}"
    onwheel={onWheel}
    onpointerdown={onCanvasDown}
    onpointermove={onCanvasMove}
    onpointerup={onCanvasUp}
    role="application"
    aria-label="GraphEditorPane module dependency graph"
  >
    <g transform="translate({tx},{ty}) scale({scale})">
      <!-- links -->
      {#each links as l}
        <line
          x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y}
          class="edge"
          class:mount={l.kind === 'mounts'}
          class:dim={hovered && l.source !== hovered && l.target !== hovered}
          class:hot={hovered && (l.source === hovered || l.target === hovered)}
        />
      {/each}
      <!-- nodes -->
      {#each nodes as n}
        <g
          class="node"
          class:dim={hovered && hovered !== n && !GEP_MODULE_LINKS.some((l) => (l.source === hovered?.id && l.target === n.id) || (l.target === hovered?.id && l.source === n.id))}
          transform="translate({n.x},{n.y})"
          onpointerdown={(e) => onNodeDown(e, n)}
          onpointerenter={() => (hovered = n)}
          onpointerleave={() => (hovered = null)}
          role="button"
          tabindex="-1"
        >
          <circle r={radiusOf(n)} fill={colorOf(n)} class:shell={n.kind === 'shell'} />
          <text class="lbl" dy={radiusOf(n) + 10}>{n.label}</text>
        </g>
      {/each}
    </g>
  </svg>

  <!-- tooltip -->
  {#if hovered}
    <div class="tip" style="left:{mouse.x + 14}px; top:{mouse.y + 14}px;">
      <div class="tip-file">{hovered.id}</div>
      <div class="tip-role">{hovered.role}</div>
      {#if hovered.split}
        <div class="tip-split">✂ {hovered.split}</div>
      {/if}
      <div class="tip-meta">
        <span class="chip" style="background:{colorOf(hovered)}">{GEP_CLUSTERS.find((c) => c.id === hovered?.cluster)?.label ?? hovered.cluster}</span>
        <span class="loc">{hovered.loc.toLocaleString()} LOC</span>
      </div>
    </div>
  {/if}

  <!-- toolbar -->
  <div class="toolbar">
    <button type="button" onclick={reheat} title="Re-run the layout">↻ relayout</button>
    <button type="button" onclick={() => { tx = 0; ty = 0; scale = 1; }} title="Reset pan/zoom">⤢ reset</button>
  </div>

  <!-- compact cluster legend -->
  <div class="legend">
    <div class="legend-title">Clusters</div>
    {#each GEP_CLUSTERS as c}
      <div class="legend-row"><span class="sw" style="background:{c.color}"></span>{c.label}</div>
    {/each}
  </div>
</div>

<p class="gep-caption">
  Each dot = a file in <code>src/lib/shared/graph-editor/</code> · size ∝ LOC · colour = cluster ·
  lines = imports (solid) / mounts (dashed) · <b>hover</b> for role + size · drag · scroll to zoom
</p>

<style>
  .gep-wrap {
    position: relative;
    width: 100%;
    height: 720px;
    border: 1px solid #e7ecf2;
    border-radius: 16px;
    overflow: hidden;
    background: radial-gradient(circle at 50% 40%, #fdfefe, #f5f8fb);
    box-shadow: inset 0 1px 0 #ffffff, 0 1px 3px rgba(15, 23, 42, 0.04);
  }
  .gep-svg { width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
  .gep-svg:active { cursor: grabbing; }

  .edge { stroke: #cbd5e1; stroke-width: 1; opacity: 0.55; }
  .edge.mount { stroke-dasharray: 4 3; }
  .edge.dim { opacity: 0.08; }
  .edge.hot { stroke: #64748b; stroke-width: 1.8; opacity: 0.95; }

  .node { cursor: pointer; }
  .node circle {
    stroke: #ffffff;
    stroke-width: 1.5;
    transition: opacity 0.15s ease;
  }
  .node circle.shell { stroke: #0f172a; stroke-width: 2.5; }
  .node.dim { opacity: 0.28; }
  .node .lbl {
    font-size: 8.5px;
    fill: #475569;
    text-anchor: middle;
    pointer-events: none;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
  }

  .tip {
    position: fixed;
    z-index: 30;
    max-width: 280px;
    padding: 8px 11px;
    background: rgba(15, 23, 42, 0.95);
    color: #e2e8f0;
    border-radius: 9px;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25);
    pointer-events: none;
    font-size: 0.72rem;
    line-height: 1.35;
  }
  .tip-file { font-weight: 700; font-family: ui-monospace, Menlo, monospace; color: #fff; }
  .tip-role { margin: 3px 0 5px; color: #cbd5e1; }
  .tip-split {
    margin: 0 0 6px; padding: 4px 6px;
    background: rgba(148, 163, 184, 0.16); border-radius: 5px;
    color: #fcd34d; font-size: 0.66rem; line-height: 1.3;
  }
  .tip-meta { display: flex; align-items: center; gap: 8px; }
  .chip {
    font-size: 0.6rem;
    font-weight: 700;
    color: #fff;
    padding: 1px 7px;
    border-radius: 20px;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
  }
  .loc { font-size: 0.64rem; color: #94a3b8; }

  .toolbar { position: absolute; top: 12px; left: 12px; display: flex; gap: 6px; }
  .toolbar button {
    font-size: 0.7rem; font-weight: 600; color: #334155;
    background: rgba(255, 255, 255, 0.95); border: 1px solid #e2e8f0;
    border-radius: 8px; padding: 5px 10px; cursor: pointer;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
  }
  .toolbar button:hover { border-color: #cbd5e1; color: #0f172a; }

  .legend {
    position: absolute; top: 12px; right: 12px;
    padding: 10px 12px; min-width: 130px;
    background: rgba(255, 255, 255, 0.94); border: 1px solid #e7ecf2;
    border-radius: 11px; backdrop-filter: blur(6px);
    box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08);
    font-size: 0.68rem; color: #475569;
  }
  .legend-title {
    font-size: 0.58rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 6px;
  }
  .legend-row { display: flex; align-items: center; gap: 7px; margin-bottom: 3px; }
  .sw { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }

  .gep-caption {
    margin: 9px 2px 0; font-size: 0.72rem; color: #94a3b8; text-align: center; line-height: 1.4;
  }
  .gep-caption b { color: #64748b; font-weight: 700; }
  .gep-caption code { font-size: 0.68rem; color: #64748b; }
</style>
