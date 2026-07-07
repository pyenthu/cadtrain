<script lang="ts">
  /**
   * CodeGraph.svelte — force-directed render of graphify's DETERMINISTIC code
   * knowledge-graph (graphify-out/graph.json), for the dev-only "Code graph"
   * tab on /design.
   *
   * The graph is built by POST /api/design/graphify (tree-sitter AST, ZERO
   * Claude tokens) and fetched by the parent, which passes the node-link JSON
   * in via the `graph` prop. Shape (NetworkX node-link):
   *   nodes: [{ id, label, community, file_type, source_file, source_location }]
   *   links: [{ source, target, relation, weight }]
   *
   * Node radius ∝ degree; colour = community (deterministic hash → HSL).
   * Reuses the pan/zoom/drag pattern from GepModuleGraph.svelte. To stay smooth
   * with ~2k nodes, tick→Svelte flushes are throttled to one per animation
   * frame, and labels render only for high-degree hubs (+ the hovered node).
   *
   * SSR is globally off (src/+layout.ts) so d3-force at module scope is safe.
   */
  import {
    forceSimulation, forceLink, forceManyBody, forceCenter, forceCollide, forceX, forceY,
    type Simulation,
  } from 'd3-force';

  type RawNode = {
    id: string;
    label?: string;
    community?: number;
    file_type?: string;
    source_file?: string;
    source_location?: string;
  };
  type RawLink = { source: string; target: string; relation?: string; weight?: number };
  export type GraphJson = { nodes: RawNode[]; links?: RawLink[]; edges?: RawLink[] };

  let { graph = null }: { graph: GraphJson | null } = $props();

  type SimNode = RawNode & {
    x: number; y: number; deg: number; fx?: number | null; fy?: number | null;
  };
  type SimLink = { source: SimNode; target: SimNode; relation?: string };

  const W = 1180;
  const H = 720;

  // Deterministic community → colour (golden-angle hue spread).
  const colorOf = (c: number | undefined) => {
    const id = c ?? 0;
    const hue = (id * 137.508) % 360;
    return `hsl(${hue.toFixed(0)}, 62%, 58%)`;
  };
  const radiusOf = (n: SimNode) => Math.max(3.5, Math.min(22, 3 + Math.sqrt(n.deg) * 2));

  let nodes = $state.raw<SimNode[]>([]);
  let links = $state.raw<SimLink[]>([]);
  let commCount = $state(0);
  let sim: Simulation<SimNode, undefined> | null = null;

  // pan / zoom
  let tx = $state(0);
  let ty = $state(0);
  let scale = $state(1);

  // hover
  let hovered = $state<SimNode | null>(null);
  let mouse = $state({ x: 0, y: 0 });
  let neighbours = new Set<string>();

  let dragging: SimNode | null = null;
  let svgEl: SVGSVGElement;

  // Throttle tick→Svelte flushes to once per rAF (2k nodes → cheap redraw).
  let rafPending = false;
  function scheduleFlush() {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      nodes = nodes.length ? [...(sim!.nodes() as SimNode[])] : [];
      links = [...links];
    });
  }

  function build(g: GraphJson) {
    sim?.stop();
    const rawLinks = g.links ?? g.edges ?? [];
    const deg = new Map<string, number>();
    for (const l of rawLinks) {
      deg.set(l.source, (deg.get(l.source) ?? 0) + 1);
      deg.set(l.target, (deg.get(l.target) ?? 0) + 1);
    }
    const ns: SimNode[] = g.nodes.map((n, i) => ({
      ...n,
      deg: deg.get(n.id) ?? 0,
      x: W / 2 + Math.cos((i / g.nodes.length) * Math.PI * 2) * 300,
      y: H / 2 + Math.sin((i / g.nodes.length) * Math.PI * 2) * 300,
    }));
    const byId = new Map(ns.map((n) => [n.id, n]));
    const ls: SimLink[] = rawLinks
      .map((l) => ({ source: byId.get(l.source)!, target: byId.get(l.target)!, relation: l.relation }))
      .filter((l) => l.source && l.target);

    commCount = new Set(ns.map((n) => n.community ?? 0)).size;

    sim = forceSimulation(ns)
      .force('link', forceLink<SimNode, SimLink>(ls).id((d) => d.id).distance(38).strength(0.25))
      .force('charge', forceManyBody().strength(-90).distanceMax(420))
      .force('center', forceCenter(W / 2, H / 2))
      .force('collide', forceCollide<SimNode>().radius((d) => radiusOf(d) + 2))
      .force('x', forceX(W / 2).strength(0.03))
      .force('y', forceY(H / 2).strength(0.05))
      .alphaDecay(0.03)
      .on('tick', scheduleFlush);

    links = ls;
    nodes = [...ns];
  }

  // Rebuild whenever a new graph arrives.
  $effect(() => {
    if (graph && graph.nodes?.length) build(graph);
    else { sim?.stop(); nodes = []; links = []; }
    return () => sim?.stop();
  });

  function computeNeighbours(n: SimNode | null) {
    neighbours = new Set();
    if (!n) return;
    for (const l of links) {
      if (l.source === n) neighbours.add(l.target.id);
      else if (l.target === n) neighbours.add(l.source.id);
    }
  }

  // ── pan / zoom ──
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
    const next = Math.max(0.2, Math.min(4, scale * factor));
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
      return;
    }
    if (panning) {
      tx = panStart.tx + (e.clientX - panStart.x);
      ty = panStart.ty + (e.clientY - panStart.y);
    }
  }
  function onCanvasUp() {
    panning = false;
    if (dragging) {
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
  function onNodeEnter(n: SimNode) { hovered = n; computeNeighbours(n); }
  function onNodeLeave() { hovered = null; neighbours = new Set(); }

  function relayout() { sim?.alpha(0.9).restart(); }
  function resetView() { tx = 0; ty = 0; scale = 1; }

  // Only draw a label for hubs (keeps ~2k nodes legible) + the hovered node.
  const LABEL_DEG = 6;
</script>

<div class="cg-wrap">
  {#if !graph || !graph.nodes?.length}
    <div class="cg-empty">
      <div class="cg-empty-icon">🕸️</div>
      <p><b>No code graph yet.</b></p>
      <p class="cg-empty-sub">Click <b>Run graphify</b> then <b>Build tree</b> above to build the deterministic
      code graph from <code>src/</code> (tree-sitter AST — zero Claude tokens).</p>
    </div>
  {:else}
    <svg
      bind:this={svgEl}
      class="cg-svg"
      viewBox="0 0 {W} {H}"
      onwheel={onWheel}
      onpointerdown={onCanvasDown}
      onpointermove={onCanvasMove}
      onpointerup={onCanvasUp}
      role="application"
      aria-label="Code knowledge graph"
    >
      <g transform="translate({tx},{ty}) scale({scale})">
        {#each links as l}
          <line
            x1={l.source.x} y1={l.source.y} x2={l.target.x} y2={l.target.y}
            class="edge"
            class:dim={hovered && l.source !== hovered && l.target !== hovered}
            class:hot={hovered && (l.source === hovered || l.target === hovered)}
          />
        {/each}
        {#each nodes as n}
          <g
            class="node"
            class:dim={hovered && hovered !== n && !neighbours.has(n.id)}
            transform="translate({n.x},{n.y})"
            onpointerdown={(e) => onNodeDown(e, n)}
            onpointerenter={() => onNodeEnter(n)}
            onpointerleave={onNodeLeave}
            role="button"
            tabindex="-1"
          >
            <circle r={radiusOf(n)} fill={colorOf(n.community)} />
            {#if n.deg >= LABEL_DEG || hovered === n}
              <text class="lbl" dy={radiusOf(n) + 9}>{n.label ?? n.id}</text>
            {/if}
          </g>
        {/each}
      </g>
    </svg>

    {#if hovered}
      <div class="tip" style="left:{mouse.x + 14}px; top:{mouse.y + 14}px;">
        <div class="tip-file">{hovered.label ?? hovered.id}</div>
        {#if hovered.source_file}
          <div class="tip-role">{hovered.source_file}{hovered.source_location ? ` · ${hovered.source_location}` : ''}</div>
        {/if}
        <div class="tip-meta">
          <span class="chip" style="background:{colorOf(hovered.community)}">community {hovered.community ?? 0}</span>
          <span class="loc">{hovered.deg} link{hovered.deg === 1 ? '' : 's'}</span>
        </div>
      </div>
    {/if}

    <div class="toolbar">
      <button type="button" onclick={relayout} title="Re-run the layout">↻ relayout</button>
      <button type="button" onclick={resetView} title="Reset pan/zoom">⤢ reset</button>
    </div>

    <div class="legend">
      <div class="legend-title">Code graph</div>
      <div class="legend-row">{nodes.length.toLocaleString()} nodes</div>
      <div class="legend-row">{links.length.toLocaleString()} edges</div>
      <div class="legend-row">{commCount.toLocaleString()} communities</div>
    </div>
  {/if}
</div>

{#if graph && graph.nodes?.length}
  <p class="cg-caption">
    Each dot = a symbol/file in <code>src/</code> · size ∝ degree · colour = community ·
    lines = imports / calls / contains · <b>hover</b> for source + degree · drag · scroll to zoom.
    Built by graphify's tree-sitter AST pipeline — <b>zero Claude tokens</b>.
  </p>
{/if}

<style>
  .cg-wrap {
    position: relative;
    width: 100%;
    height: 720px;
    border: 1px solid #e7ecf2;
    border-radius: 16px;
    overflow: hidden;
    background: radial-gradient(circle at 50% 40%, #fdfefe, #f5f8fb);
    box-shadow: inset 0 1px 0 #ffffff, 0 1px 3px rgba(15, 23, 42, 0.04);
  }
  .cg-svg { width: 100%; height: 100%; display: block; cursor: grab; touch-action: none; }
  .cg-svg:active { cursor: grabbing; }

  .edge { stroke: #cbd5e1; stroke-width: 0.7; opacity: 0.45; }
  .edge.dim { opacity: 0.05; }
  .edge.hot { stroke: #64748b; stroke-width: 1.6; opacity: 0.95; }

  .node { cursor: pointer; }
  .node circle { stroke: #ffffff; stroke-width: 1; transition: opacity 0.15s ease; }
  .node.dim { opacity: 0.18; }
  .node .lbl {
    font-size: 7.5px; fill: #475569; text-anchor: middle; pointer-events: none;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
  }

  .cg-empty {
    position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 4px; text-align: center;
    color: #64748b; padding: 2rem;
  }
  .cg-empty-icon { font-size: 2.4rem; margin-bottom: 4px; opacity: 0.7; }
  .cg-empty p { margin: 2px 0; }
  .cg-empty-sub { font-size: 0.82rem; color: #94a3b8; max-width: 32rem; line-height: 1.5; }
  .cg-empty code { font-size: 0.78rem; color: #64748b; }

  .tip {
    position: fixed; z-index: 30; max-width: 320px; padding: 8px 11px;
    background: rgba(15, 23, 42, 0.95); color: #e2e8f0; border-radius: 9px;
    box-shadow: 0 8px 24px rgba(15, 23, 42, 0.25); pointer-events: none;
    font-size: 0.72rem; line-height: 1.35;
  }
  .tip-file { font-weight: 700; font-family: ui-monospace, Menlo, monospace; color: #fff; }
  .tip-role { margin: 3px 0 5px; color: #cbd5e1; font-family: ui-monospace, Menlo, monospace; font-size: 0.66rem; word-break: break-all; }
  .tip-meta { display: flex; align-items: center; gap: 8px; }
  .chip {
    font-size: 0.6rem; font-weight: 700; color: #fff; padding: 1px 7px;
    border-radius: 20px; text-shadow: 0 1px 1px rgba(0, 0, 0, 0.3);
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
    position: absolute; top: 12px; right: 12px; padding: 10px 12px; min-width: 120px;
    background: rgba(255, 255, 255, 0.94); border: 1px solid #e7ecf2;
    border-radius: 11px; backdrop-filter: blur(6px);
    box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08); font-size: 0.68rem; color: #475569;
  }
  .legend-title {
    font-size: 0.58rem; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.08em; color: #94a3b8; margin-bottom: 6px;
  }
  .legend-row { margin-bottom: 3px; }

  .cg-caption {
    margin: 9px 2px 0; font-size: 0.72rem; color: #94a3b8; text-align: center; line-height: 1.4;
  }
  .cg-caption b { color: #64748b; font-weight: 700; }
  .cg-caption code { font-size: 0.68rem; color: #64748b; }
</style>
