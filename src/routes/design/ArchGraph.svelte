<script lang="ts">
  /**
   * ArchGraph.svelte — interactive @xyflow/svelte canvas for /design.
   *
   * Top-level import is fine here because SSR is globally OFF for this app
   * (src/+layout.ts exports ssr = false).  The component is also only ever
   * mounted from /design, which is a client-only page.
   */
  import { SvelteFlow, Background, Controls, MiniMap, type ColorMode } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import ArchNode from './nodes/ArchNode.svelte';
  import { ARCH_NODES, ARCH_EDGES, type ArchNodeData, type ArchEdgeData } from './architecture';
  import type { Node, Edge } from '@xyflow/svelte';

  // SvelteFlow needs $state arrays so it can sync internal drag/select state.
  let nodes = $state<Node<ArchNodeData>[]>(ARCH_NODES as Node<ArchNodeData>[]);
  let edges = $state<Edge<ArchEdgeData>[]>(ARCH_EDGES as Edge<ArchEdgeData>[]);

  const nodeTypes = { archNode: ArchNode };

  // Edge style helpers
  function edgeStyle(kind: string | undefined): string {
    switch (kind) {
      case 'flow':   return 'stroke:#f97316;stroke-width:2;';
      case 'calls':  return 'stroke:#3b82f6;stroke-width:1.5;stroke-dasharray:4 2;';
      case 'mounts': return 'stroke:#6366f1;stroke-width:1.5;';
      case 'reads':  return 'stroke:#a855f7;stroke-width:1.5;stroke-dasharray:2 3;';
      case 'writes': return 'stroke:#a855f7;stroke-width:2;';
      default:       return 'stroke:#9ca3af;stroke-width:1.5;';
    }
  }

  // Annotate edges with style and animation for 'flow' edges
  let styledEdges = $derived(
    edges.map((e) => ({
      ...e,
      style: edgeStyle(e.data?.edgeKind),
      animated: e.data?.edgeKind === 'flow',
      markerEnd: 'url(#arrow)',
      type: 'smoothstep',
    }))
  );

  const colorMode: ColorMode = 'light';
</script>

<div class="arch-canvas">
  <SvelteFlow
    {nodes}
    edges={styledEdges}
    {nodeTypes}
    {colorMode}
    fitView
    fitViewOptions={{ padding: 0.18 }}
    minZoom={0.25}
    maxZoom={2}
    proOptions={{ hideAttribution: false }}
  >
    <Background />
    <Controls />
    <MiniMap zoomable pannable />
  </SvelteFlow>

  <!-- Legend -->
  <div class="legend">
    <div class="legend-title">Legend</div>
    <div class="legend-row"><span class="dot" style="background:#3b82f6"></span>route</div>
    <div class="legend-row"><span class="dot" style="background:#22c55e"></span>api group</div>
    <div class="legend-row"><span class="dot" style="background:#f97316"></span>lib / pipeline</div>
    <div class="legend-row"><span class="dot" style="background:#a855f7"></span>store</div>
    <hr class="legend-hr" />
    <div class="legend-row"><span class="line solid" style="background:#6366f1"></span>mounts</div>
    <div class="legend-row"><span class="line dashed" style="background:#3b82f6"></span>calls API</div>
    <div class="legend-row"><span class="line animated" style="background:#f97316"></span>data flow</div>
    <div class="legend-row"><span class="line dashed" style="background:#a855f7"></span>reads store</div>
    <div class="legend-row"><span class="line solid" style="background:#a855f7"></span>writes store</div>
  </div>
</div>

<style>
  .arch-canvas {
    position: relative;
    width: 100%;
    height: 640px;
    border: 1px solid #e5e7eb;
    border-radius: 12px;
    overflow: hidden;
    background: #f8fafc;
  }

  /* legend panel */
  .legend {
    position: absolute;
    top: 12px;
    right: 12px;
    background: rgba(255,255,255,0.93);
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 10px 12px;
    font-size: 0.72rem;
    color: #374151;
    z-index: 10;
    backdrop-filter: blur(4px);
    line-height: 1.4;
    min-width: 110px;
  }
  .legend-title {
    font-weight: 700;
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: #6b7280;
    margin-bottom: 6px;
  }
  .legend-row {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-bottom: 3px;
  }
  .dot {
    display: inline-block;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .line {
    display: inline-block;
    width: 20px;
    height: 2px;
    flex-shrink: 0;
    border-radius: 1px;
  }
  .line.dashed {
    background: repeating-linear-gradient(
      90deg,
      currentColor 0, currentColor 4px,
      transparent 4px, transparent 7px
    );
    height: 2px;
  }
  .line.animated {
    background: repeating-linear-gradient(
      90deg,
      #f97316 0, #f97316 4px,
      transparent 4px, transparent 7px
    );
    height: 2px;
  }
  .legend-hr {
    border: none;
    border-top: 1px solid #e5e7eb;
    margin: 6px 0;
  }
</style>
