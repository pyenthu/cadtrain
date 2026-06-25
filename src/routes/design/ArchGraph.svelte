<script lang="ts">
  /**
   * ArchGraph.svelte — collapsible, auto-laid-out architecture TREE for /design.
   *
   * The data (nodes + edges) comes from architecture.ts; layout is COMPUTED here
   * from the parent/child hierarchy (system → 4 containers → components) by a
   * small recursive left-to-right tree-layout (x = depth·colWidth, y walks the
   * visible leaves). Clicking a container/system caret collapses its subtree —
   * descendants AND their edges vanish — and the whole tree reflows + animates.
   *
   * SSR is globally off (src/+layout.ts), so the top-level @xyflow import is safe.
   */
  import { SvelteFlow, Background, BackgroundVariant, Controls, MarkerType, useSvelteFlow, type ColorMode } from '@xyflow/svelte';
  import { forceSimulation, forceLink, forceManyBody, forceCollide, forceX, forceY } from 'd3-force';
  import '@xyflow/svelte/dist/style.css';

  import ArchNode from './nodes/ArchNode.svelte';
  import ContainerNode from './nodes/ContainerNode.svelte';
  import { ARCH_TREE_NODES, ARCH_EDGES, type ArchTreeNode, type ArchEdgeData } from './architecture';
  import type { Node, Edge } from '@xyflow/svelte';

  const nodeTypes = { archNode: ArchNode, containerNode: ContainerNode };
  const colorMode: ColorMode = 'light';

  // ── tree indices ──────────────────────────────────────────
  const byId = new Map(ARCH_TREE_NODES.map((n) => [n.id, n]));
  const childrenOf = new Map<string, string[]>();
  for (const n of ARCH_TREE_NODES) {
    if (n.parentId) {
      const arr = childrenOf.get(n.parentId) ?? [];
      arr.push(n.id);
      childrenOf.set(n.parentId, arr);
    }
  }
  const roots = ARCH_TREE_NODES.filter((n) => !n.parentId).map((n) => n.id);
  const isParent = (id: string) => (childrenOf.get(id)?.length ?? 0) > 0;

  // ── visibility (a node shows unless an ancestor is collapsed) ──────
  function visibleIds(collapsed: Set<string>): Set<string> {
    const vis = new Set<string>();
    function walk(id: string) {
      vis.add(id);
      if (collapsed.has(id)) return;
      for (const k of childrenOf.get(id) ?? []) walk(k);
    }
    for (const r of roots) walk(r);
    return vis;
  }

  // Depth (for a stable, non-random seed — d3-force from all-origin collapses).
  const depthOf = new Map<string, number>();
  (function () {
    function walk(id: string, d: number) { depthOf.set(id, d); for (const k of childrenOf.get(id) ?? []) walk(k, d + 1); }
    for (const r of roots) walk(r, 0);
  })();

  /** d3-force directed layout over the VISIBLE nodes. Hierarchy (parent→child)
   *  links are short + stiff so children cluster around their container; the
   *  architecture edges are longer + soft so related groups drift together.
   *  Run synchronously to convergence (no animation jitter on every reflow). */
  function computeLayout(collapsed: Set<string>): Map<string, { x: number; y: number }> {
    const vis = visibleIds(collapsed);
    const ids = [...vis];
    const LEVEL_W = 400;   // horizontal pitch between hierarchy depths (the cascade)
    type SN = { id: string; x: number; y: number; r: number };
    const simNodes: SN[] = ids.map((id, i) => {
      const n = byId.get(id);
      const isHub = n?.treeKind === 'system' || n?.treeKind === 'container';
      // cascade seed: x by depth (columns), y fanned by index — the sim starts
      // already layered so it settles into a tidy left→right cascade, not a blob.
      return { id, x: 80 + (depthOf.get(id) ?? 0) * LEVEL_W, y: 80 + (i % 16) * 72, r: isHub ? 96 : 58 };
    });
    const hierLinks = ids.flatMap((id) =>
      collapsed.has(id) ? [] : (childrenOf.get(id) ?? []).filter((k) => vis.has(k)).map((k) => ({ source: id, target: k, h: true })));
    const archLinks = (ARCH_EDGES as Array<{ source: string; target: string }>)
      .filter((e) => vis.has(e.source) && vis.has(e.target))
      .map((e) => ({ source: e.source, target: e.target, h: false }));
    const sim = forceSimulation(simNodes as any)
      .force('link', forceLink([...hierLinks, ...archLinks] as any).id((d: any) => d.id)
        .distance((l: any) => (l.h ? 150 : 230)).strength((l: any) => (l.h ? 0.85 : 0.12)))
      .force('charge', forceManyBody().strength(-650))
      .force('collide', forceCollide((d: any) => d.r + 10).strength(0.9))
      // CASCADE: a strong depth→x pull lays the hierarchy out in columns; the
      // soft y-centering lets charge + collide fan siblings out vertically.
      .force('x', forceX((d: any) => 80 + (depthOf.get(d.id) ?? 0) * LEVEL_W).strength(0.92))
      .force('y', forceY(360).strength(0.06))
      .stop();
    for (let i = 0; i < 340; i++) sim.tick();
    const pos = new Map<string, { x: number; y: number }>();
    for (const sn of simNodes) pos.set(sn.id, { x: Math.round(sn.x), y: Math.round(sn.y) });
    return pos;
  }

  // ── edge styling ──────────────────────────────────────────
  function edgeColor(kind: string | undefined): string {
    switch (kind) {
      case 'flow':    return '#f97316';
      case 'summary': return '#475569';
      case 'calls':   return '#60a5fa';
      case 'mounts':  return '#818cf8';
      case 'reads':
      case 'writes':  return '#c084fc';
      default:        return '#cbd5e1';
    }
  }
  function styleEdge(e: Edge<ArchEdgeData>): Edge<ArchEdgeData> {
    const kind = e.data?.edgeKind;
    const c = edgeColor(kind);
    const pipeline = kind === 'flow' || kind === 'summary';
    const summary = kind === 'summary';
    return {
      ...e,
      type: 'bezier',
      animated: kind === 'flow',
      zIndex: summary ? 4 : 0,
      style: pipeline
        ? `stroke:${c};stroke-width:${summary ? 2.4 : 1.8};`
        : `stroke:${c};stroke-width:1.4;stroke-dasharray:5 4;opacity:0.85;`,
      markerEnd: { type: MarkerType.ArrowClosed, color: c, width: 14, height: 14 },
      ...(summary && e.data?.label
        ? {
            label: e.data.label,
            labelStyle: 'fill:#334155;font-weight:700;font-size:10.5px;',
            labelBgStyle: 'fill:#ffffff;',
            labelBgPadding: [6, 3] as [number, number],
            labelBgBorderRadius: 5,
          }
        : {}),
    };
  }

  // ── build xyflow nodes/edges from a collapsed set ─────────
  function buildNodes(pos: Map<string, { x: number; y: number }>, collapsed: Set<string>): Node<ArchTreeNode>[] {
    const out: Node<ArchTreeNode>[] = [];
    for (const n of ARCH_TREE_NODES) {
      const p = pos.get(n.id);
      if (!p) continue; // hidden (ancestor collapsed)
      const parent = n.treeKind === 'system' || n.treeKind === 'container';
      out.push({
        id: n.id,
        type: parent ? 'containerNode' : 'archNode',
        position: p,
        draggable: false,
        selectable: !parent,
        data: parent
          ? ({ ...n, collapsed: collapsed.has(n.id), childCount: childrenOf.get(n.id)?.length ?? 0, onToggle } as unknown as ArchTreeNode)
          : n,
        zIndex: parent ? 1 : 2,
      });
    }
    return out;
  }
  function buildEdges(pos: Map<string, { x: number; y: number }>): Edge<ArchEdgeData>[] {
    return (ARCH_EDGES as Edge<ArchEdgeData>[])
      .filter((e) => pos.has(e.source) && pos.has(e.target))
      .map(styleEdge);
  }

  // ── reactive state ────────────────────────────────────────
  // Default: containers COLLAPSED — the initial view is a clean system + 4
  // container nodes; expanding all 56 components at once makes the tree ~3360px
  // tall so fitView zooms it to an illegible thread. Click a caret to drill in.
  let collapsed = new Set<string>(['c-webapp', 'c-api', 'c-kernel', 'c-volume']);

  const layout0 = computeLayout(collapsed);
  // SvelteFlow OWNS these arrays — they must be writable `$state.raw`, not a
  // `$derived` (a derived edges array renders zero `.svelte-flow__edge-path`).
  let nodes = $state.raw<Node<ArchTreeNode>[]>(buildNodes(layout0, collapsed));
  let edges = $state.raw<Edge<ArchEdgeData>[]>(buildEdges(layout0));

  // fitView from the provider context — re-frame the tree after every
  // collapse/expand so a newly-expanded subtree doesn't fall below the fold.
  const { fitView } = useSvelteFlow();

  function rebuild() {
    const pos = computeLayout(collapsed);
    nodes = buildNodes(pos, collapsed);
    edges = buildEdges(pos);
    // let the DOM apply the new node positions, then re-frame with a glide.
    setTimeout(() => { try { fitView({ padding: 0.18, duration: 420 }); } catch { /* pre-mount */ } }, 60);
  }

  function onToggle(id: string) {
    if (!isParent(id)) return;
    const next = new Set(collapsed);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    collapsed = next;
    rebuild();
  }

  function expandAll() {
    collapsed = new Set();
    rebuild();
  }
  function collapseContainers() {
    collapsed = new Set(['c-webapp', 'c-api', 'c-kernel', 'c-volume']);
    rebuild();
  }
</script>

<div class="arch-canvas">
  <SvelteFlow
    bind:nodes
    bind:edges
    {nodeTypes}
    {colorMode}
    fitView
    fitViewOptions={{ padding: 0.16 }}
    minZoom={0.2}
    maxZoom={1.8}
    nodesDraggable={false}
    proOptions={{ hideAttribution: false }}
  >
    <Background variant={BackgroundVariant.Dots} gap={22} size={1} bgColor="#fbfcfe" />
    <Controls showLock={false} />
  </SvelteFlow>

  <!-- toolbar -->
  <div class="toolbar">
    <button type="button" onclick={expandAll}>Expand all</button>
    <button type="button" onclick={collapseContainers}>Collapse containers</button>
  </div>

  <!-- legend -->
  <div class="legend">
    <div class="legend-title">Collapsible tree</div>
    <div class="legend-note">
      <b>System → containers → components.</b> Click a container caret to
      collapse its subtree; the tree reflows. Click a <b>route</b> to open it.
    </div>
    <div class="legend-sub">Components</div>
    <div class="legend-row"><span class="sw" style="background:#3b82f6"></span>route</div>
    <div class="legend-row"><span class="sw" style="background:#22c55e"></span>api group</div>
    <div class="legend-row"><span class="sw" style="background:#f97316"></span>lib / pipeline</div>
    <div class="legend-row"><span class="sw" style="background:#a855f7"></span>store</div>
    <hr />
    <div class="legend-sub">Relationships</div>
    <div class="legend-row"><span class="ln solid" style="--c:#475569"></span>container flow</div>
    <div class="legend-row"><span class="ln solid" style="--c:#f97316"></span>data flow</div>
    <div class="legend-row"><span class="ln dash" style="--c:#60a5fa"></span>calls / mounts</div>
    <div class="legend-row"><span class="ln dash" style="--c:#c084fc"></span>reads / writes</div>
  </div>
</div>

<style>
  .arch-canvas {
    position: relative;
    width: 100%;
    height: 760px;
    border: 1px solid #e7ecf2;
    border-radius: 16px;
    overflow: hidden;
    background: #fbfcfe;
    box-shadow: inset 0 1px 0 #ffffff, 0 1px 3px rgba(15, 23, 42, 0.04);
  }

  /* Reflow animation — xyflow positions nodes via transform on the wrapper. */
  :global(.arch-canvas .svelte-flow__node) {
    transition: transform 0.34s cubic-bezier(0.33, 1, 0.68, 1);
  }
  :global(.arch-canvas .svelte-flow__edge-path) {
    transition: opacity 0.2s ease;
  }
  :global(.arch-canvas .svelte-flow__edge.animated .svelte-flow__edge-path) {
    stroke-dasharray: 6 4;
  }

  /* toolbar */
  .toolbar {
    position: absolute;
    top: 12px;
    left: 12px;
    z-index: 12;
    display: flex;
    gap: 6px;
  }
  .toolbar button {
    font-size: 0.7rem;
    font-weight: 600;
    color: #334155;
    background: rgba(255, 255, 255, 0.95);
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    padding: 5px 10px;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);
    transition: border-color 0.15s ease, color 0.15s ease, background 0.15s ease;
  }
  .toolbar button:hover {
    border-color: #cbd5e1;
    background: #fff;
    color: #0f172a;
  }

  /* legend */
  .legend {
    position: absolute;
    top: 12px;
    right: 12px;
    z-index: 12;
    min-width: 168px;
    max-width: 200px;
    padding: 11px 13px;
    background: rgba(255, 255, 255, 0.94);
    border: 1px solid #e7ecf2;
    border-radius: 11px;
    backdrop-filter: blur(6px);
    box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08);
    font-size: 0.72rem;
    color: #475569;
    line-height: 1.4;
  }
  .legend-title {
    font-size: 0.62rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: #94a3b8;
    margin-bottom: 6px;
  }
  .legend-note {
    font-size: 0.66rem;
    color: #64748b;
    margin-bottom: 9px;
  }
  .legend-note b {
    color: #334155;
  }
  .legend-sub {
    font-size: 0.56rem;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #94a3b8;
    margin-bottom: 4px;
  }
  .legend-row {
    display: flex;
    align-items: center;
    gap: 7px;
    margin-bottom: 3px;
  }
  .sw {
    width: 10px;
    height: 10px;
    border-radius: 3px;
    flex-shrink: 0;
  }
  .ln {
    width: 20px;
    height: 0;
    flex-shrink: 0;
    border-top: 2px solid var(--c);
  }
  .ln.dash {
    border-top-style: dashed;
  }
  hr {
    border: none;
    border-top: 1px solid #eef2f7;
    margin: 7px 0;
  }
</style>
