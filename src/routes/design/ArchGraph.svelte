<script lang="ts">
  /**
   * ArchGraph.svelte — interactive @xyflow/svelte canvas for /design.
   *
   * Top-level import is fine here because SSR is globally OFF for this app
   * (src/+layout.ts exports ssr = false).  The component is also only ever
   * mounted from /design, which is a client-only page.
   */
  import { SvelteFlow, Background, Controls, MiniMap, MarkerType, type ColorMode } from '@xyflow/svelte';
  import '@xyflow/svelte/dist/style.css';

  import ArchNode from './nodes/ArchNode.svelte';
  import ContainerNode from './nodes/ContainerNode.svelte';
  import { ARCH_NODES, ARCH_CONTAINERS, ARCH_EDGES, type ArchNodeData, type ArchEdgeData } from './architecture';
  import type { Node, Edge } from '@xyflow/svelte';

  // C4 nesting rule: parents (system boundary, then containers) MUST appear
  // before their children in the nodes array.
  const initialNodes = [...ARCH_CONTAINERS, ...ARCH_NODES] as Node<ArchNodeData>[];

  // SvelteFlow needs $state arrays so it can sync internal drag/select state.
  let nodes = $state<Node<ArchNodeData>[]>(initialNodes);
  let edges = $state<Edge<ArchEdgeData>[]>(ARCH_EDGES as Edge<ArchEdgeData>[]);

  const nodeTypes = { archNode: ArchNode, containerNode: ContainerNode };

  // Edge stroke colour per relationship kind
  function edgeColor(kind: string | undefined): string {
    switch (kind) {
      case 'flow':    return '#f97316';
      case 'calls':   return '#3b82f6';
      case 'mounts':  return '#6366f1';
      case 'reads':   return '#a855f7';
      case 'writes':  return '#a855f7';
      case 'summary': return '#475569';
      default:        return '#9ca3af';
    }
  }

  // Edge style helpers
  function edgeStyle(kind: string | undefined): string {
    const c = edgeColor(kind);
    switch (kind) {
      case 'flow':    return `stroke:${c};stroke-width:2;`;
      case 'calls':   return `stroke:${c};stroke-width:1.5;stroke-dasharray:4 2;`;
      case 'mounts':  return `stroke:${c};stroke-width:1.5;`;
      case 'reads':   return `stroke:${c};stroke-width:1.5;stroke-dasharray:2 3;`;
      case 'writes':  return `stroke:${c};stroke-width:2;`;
      case 'summary': return `stroke:${c};stroke-width:3;`;          // bold C4 container arrows
      default:        return `stroke:${c};stroke-width:1.5;`;
    }
  }

  // Annotate edges with style, animation, arrowheads, and C4 summary labels.
  let styledEdges = $derived(
    edges.map((e) => {
      const kind = e.data?.edgeKind;
      const isSummary = kind === 'summary';
      return {
        ...e,
        style: edgeStyle(kind),
        animated: kind === 'flow',
        markerEnd: { type: MarkerType.ArrowClosed, color: edgeColor(kind), width: 16, height: 16 },
        type: 'smoothstep',
        zIndex: isSummary ? 5 : 0,
        // Surface the relationship label on the bold container-level arrows.
        ...(isSummary && e.data?.label
          ? {
              label: e.data.label,
              labelStyle: 'fill:#334155;font-weight:700;font-size:11px;',
              labelBgStyle: 'fill:#ffffff;',
              labelBgPadding: [6, 3] as [number, number],
              labelBgBorderRadius: 4,
            }
          : {}),
      };
    })
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
    <div class="legend-title">C4 Container view</div>
    <div class="legend-note">
      The dashed outer box is the <b>CAD&nbsp;Train</b> system. The four tinted
      boxes are its <b>containers</b>; nodes inside are their components.
    </div>
    <div class="legend-row"><span class="box" style="border-color:#3b82f6"></span>Web App</div>
    <div class="legend-row"><span class="box" style="border-color:#22c55e"></span>API layer</div>
    <div class="legend-row"><span class="box" style="border-color:#f97316"></span>CAD kernel</div>
    <div class="legend-row"><span class="box" style="border-color:#a855f7"></span>Volume store</div>
    <hr class="legend-hr" />
    <div class="legend-subtitle">Components</div>
    <div class="legend-row"><span class="dot" style="background:#3b82f6"></span>route</div>
    <div class="legend-row"><span class="dot" style="background:#22c55e"></span>api group</div>
    <div class="legend-row"><span class="dot" style="background:#f97316"></span>lib / pipeline</div>
    <div class="legend-row"><span class="dot" style="background:#a855f7"></span>store</div>
    <hr class="legend-hr" />
    <div class="legend-subtitle">Relationships</div>
    <div class="legend-row"><span class="line solid" style="background:#475569;height:3px"></span>container → container</div>
    <div class="legend-row"><span class="line dashed" style="background:#3b82f6"></span>calls API</div>
    <div class="legend-row"><span class="line solid" style="background:#6366f1"></span>mounts</div>
    <div class="legend-row"><span class="line animated" style="background:#f97316"></span>data flow</div>
    <div class="legend-row"><span class="line dashed" style="background:#a855f7"></span>reads store</div>
    <div class="legend-row"><span class="line solid" style="background:#a855f7"></span>writes store</div>
  </div>
</div>

<style>
  .arch-canvas {
    position: relative;
    width: 100%;
    height: 720px;
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
  .legend-subtitle {
    font-weight: 700;
    font-size: 0.6rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #9ca3af;
    margin-bottom: 4px;
  }
  .legend-note {
    font-size: 0.66rem;
    color: #6b7280;
    line-height: 1.35;
    margin-bottom: 8px;
    max-width: 170px;
  }
  .legend-note b {
    color: #374151;
  }
  .box {
    display: inline-block;
    width: 12px;
    height: 9px;
    border: 1.5px solid;
    border-radius: 3px;
    background: rgba(0, 0, 0, 0.02);
    flex-shrink: 0;
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
