<!--
  ProfilePreview.svelte — the right-pane 2D profile PREVIEW (GEP modularize #940
  CUT 2). Inline SVG of the resolved polygon, passed to RightPane as the
  `profilePreview` snippet from the GEP shell.

  All resolve state + the derived viewBox/path live on the per-pane
  `ProfilePreviewState` instance (`pp`); this component is pure markup over it.
  Vertex DRAG routes through `polyUI` (the shared `PolyPreviewState`) exactly as
  the inline version did — startPolyVertexDrag / polyDragMove / polyDragEnd.

  `hlVertex` + `showSvgTip` / `moveSvgTip` / `hideSvgTip` stay SHELL-owned (node
  cards + PolyPreview also read them) and are passed in as callbacks — this
  component keeps no copy (same prop pattern as PolyPreview.svelte).
-->
<script lang="ts">
  import { entryIdxForEvalIdx } from './geom';
  import type { ProfilePreviewState } from './profile-preview-state.svelte';
  import type { PolyPreviewState } from './poly-preview-state.svelte';
  import type { Graph } from '$lib/cad/composition-graph';

  let {
    pp,
    polyUI,
    graph,
    exemplarId,
    hlVertex,
    showSvgTip,
    moveSvgTip,
    hideSvgTip,
  }: {
    pp: ProfilePreviewState;
    polyUI: PolyPreviewState;
    graph: Graph;
    exemplarId: string;
    hlVertex: { polyId: string; idx: number } | null;
    showSvgTip: (ev: PointerEvent, polyId: string, entryIdx: number | null, evalI: number, total: number, p: [number, number]) => void;
    moveSvgTip: (ev: PointerEvent) => void;
    hideSvgTip: (polyId: string, entryIdx: number | null) => void;
  } = $props();
</script>

<!-- Profile mode: inline SVG of the resolved polygon. The graph-driven
     re-emit is Phase 2.2 — for now this shows the on-disk build()'s shape
     at default params. Closure (last → first vertex) drawn as a dashed line
     so the implicit polygon-close is visible. -->
{#if pp.profileView}
  {@const v = pp.profileView}
  {@const sw = Math.max(v.w, v.h) * 0.008}
  {@const vsw = Math.max(v.w, v.h) * 0.005}
  {@const ph = Math.max(v.w, v.h) * 0.012}
  <div class="ge-profile-2d">
    <div class="ge-profile-2d-head">{exemplarId} · {pp.profilePts.length} pts · {pp.rootPolygonMode}</div>
    <svg viewBox={v.vb} preserveAspectRatio="xMidYMid meet" xmlns="http://www.w3.org/2000/svg">
      <g transform={v.yFlip ? `scale(1, -1) translate(0, ${-(2 * v.yMin + v.h)})` : ''}>
        {#if v.axis}
          <!-- Revolve axis (r = 0 vertical dash line). -->
          <line x1="0" y1={v.yMin - v.pad} x2="0" y2={v.yMin + v.h + v.pad}
            stroke="#94a3b8" stroke-width={vsw}
            stroke-dasharray={`${Math.max(v.w, v.h) * 0.02} ${Math.max(v.w, v.h) * 0.02}`}/>
        {:else if v.yFlip}
          <!-- Cartesian crosshair (extrude cross-section): show both axes
               through (0, 0) so the user sees the center the extrude rotates
               around. -->
          {@const ad = `${Math.max(v.w, v.h) * 0.02} ${Math.max(v.w, v.h) * 0.02}`}
          <line x1={v.xMin - v.pad} y1="0" x2={v.xMin + v.w + v.pad} y2="0"
            stroke="#94a3b8" stroke-width={vsw} stroke-dasharray={ad}/>
          <line x1="0" y1={v.yMin - v.pad} x2="0" y2={v.yMin + v.h + v.pad}
            stroke="#94a3b8" stroke-width={vsw} stroke-dasharray={ad}/>
        {/if}
        <path d={v.d}
          fill="rgba(204, 34, 34, 0.22)" stroke="#991b1b" stroke-width={sw}
          stroke-linejoin="round"/>
        <!-- Auto-closure dashed line — visual reminder that the polygon
             implicitly closes the last vertex back to the first. -->
        <path d={v.dClose}
          fill="none" stroke="#991b1b" stroke-width={sw * 0.7}
          stroke-dasharray={`${sw * 2.5} ${sw * 2}`} stroke-linecap="round"/>
        {#each pp.profilePts as p, i}
          {@const rootPoly = pp.rootPolygonId ? (graph.nodes[pp.rootPolygonId] as any) : null}
          <!-- Same eval-idx → entry-idx mapping as the popup preview so
               loop-generated points read their true entry kind instead of
               falling off the array. (2026-06-11) -->
          {@const entryIdx = rootPoly ? entryIdxForEvalIdx(graph,rootPoly, i) : null}
          {@const entry = entryIdx !== null ? rootPoly?.points?.[entryIdx] : null}
          {@const fromLoop = entryIdx === null}
          {@const parametricVertex = !!entry && entry.kind === 'point'
            && (entry.r?.kind !== 'literal' || entry.z?.kind !== 'literal')}
          {@const draggable = !!entry && entry.kind === 'point' && !parametricVertex && !fromLoop}
          {@const fill = fromLoop ? '#a855f7' : (parametricVertex ? '#6d28d9' : '#991b1b')}
          {@const stroke = fromLoop ? '#6d28d9' : (parametricVertex ? '#a78bfa' : 'none')}
          {@const isHl = !!hlVertex && hlVertex.polyId === pp.rootPolygonId && entryIdx === hlVertex.idx}
          {#if isHl}
            <circle cx={p[0]} cy={p[1]} r={ph * 2.6} fill="none" stroke="#2563eb" stroke-width={ph * 0.6} pointer-events="none"/>
          {/if}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <circle cx={p[0]} cy={p[1]} r={isHl ? ph * 1.7 : ph}
            fill={fill}
            stroke={stroke}
            stroke-width={fromLoop || parametricVertex ? ph * 0.5 : 0}
            class:locked={!draggable}
            class:parametric={parametricVertex || fromLoop}
            onpointerdown={(ev) => {
              if (!pp.rootPolygonId) return;
              polyUI.startPolyVertexDrag(ev, pp.rootPolygonId, i, v.yFlip ? 'cartesian' : 'revolve');
            }}
            onpointerenter={(ev) => { if (pp.rootPolygonId) showSvgTip(ev, pp.rootPolygonId, entryIdx, i, pp.profilePts.length, p); }}
            onpointermove={(ev) => { polyUI.polyDragMove(ev); moveSvgTip(ev); }}
            onpointerleave={() => { if (pp.rootPolygonId) hideSvgTip(pp.rootPolygonId, entryIdx); }}
            onpointerup={polyUI.polyDragEnd}>
          </circle>
          <!-- Point-order markers: green ring + "1" on the FIRST vertex,
               orange ring + count on the LAST, so the winding / point
               sequence is readable. Non-interactive. -->
          {#if i === 0}
            <circle cx={p[0]} cy={p[1]} r={ph * 1.8} fill="none" stroke="#16a34a" stroke-width={ph * 0.45} pointer-events="none"/>
            <text x={p[0] + ph * 2.4} y={p[1] - ph * 1.6} fill="#15803d" font-size={ph * 3.4} font-weight="700" pointer-events="none" style="paint-order: stroke" stroke="#fff" stroke-width={ph * 0.7}>1</text>
          {:else if i === pp.profilePts.length - 1}
            <circle cx={p[0]} cy={p[1]} r={ph * 1.8} fill="none" stroke="#ea580c" stroke-width={ph * 0.45} pointer-events="none"/>
            <text x={p[0] + ph * 2.4} y={p[1] - ph * 1.6} fill="#c2410c" font-size={ph * 3.4} font-weight="700" pointer-events="none" style="paint-order: stroke" stroke="#fff" stroke-width={ph * 0.7}>{pp.profilePts.length}</text>
          {/if}
        {/each}
      </g>
    </svg>
  </div>
{:else if pp.profileResolveErr}
  <div class="ge-err"><div>{pp.profileResolveErr}</div></div>
{:else}
  <div class="ge-empty">resolving polygon…</div>
{/if}

<style>
  /* ─── Profile-mode 2D preview ────────────────────────────────────── */
  .ge-profile-2d { display: flex; flex-direction: column; height: 100%; min-height: 0; padding: 12px; box-sizing: border-box; }
  .ge-profile-2d-head { font: 600 11px Arial; color: #57534e; margin-bottom: 8px; letter-spacing: 0.3px; }
  .ge-profile-2d svg { flex: 1 1 auto; min-height: 240px; width: 100%; background: #fafaf9; border: 1px solid #e5e7eb; border-radius: 4px; }
  /* Polygon vertex dots are draggable when BOTH coords are literal — the
     pointermove rewrites (r, z) directly. Wired (param / expr) coords get
     a not-allowed cursor; dragging them would silently overwrite the
     wiring. Hover adds a translucent halo via stroke so the drop target
     reads as interactive (stroke is independent of the inline r attr,
     unlike a CSS r override which fights the geometry attribute). */
  .ge-profile-2d svg circle {
    cursor: grab;
    touch-action: none;
    transition: stroke-width 80ms ease, stroke 80ms ease;
    stroke: transparent;
    stroke-width: 0;
  }
  .ge-profile-2d svg circle:hover {
    stroke: rgba(153, 27, 27, 0.28);
    stroke-width: 0.012em;
    /* Stroke-width in em scales with the parent's font-size — not the SVG
       viewBox. The numeric value here is tuned against the path stroke
       width (sw) which is bbox-relative; the resulting halo reads
       proportional at common card sizes. */
  }
  .ge-profile-2d svg circle:active { cursor: grabbing; }
  .ge-profile-2d svg circle.locked { cursor: not-allowed; opacity: 0.7; }
  .ge-profile-2d svg circle.locked:hover { stroke: transparent; stroke-width: 0; }

  /* `.ge-empty` + `.ge-err` are shared shell classes — they stay defined in
     GraphEditorPane.svelte (params/picker/wire popovers use them too). The
     error/empty arms above inherit them from the RightPane subtree. */
  .ge-empty { padding: 20px; text-align: center; color: #9ca3af; font: 12px Arial; }
  .ge-err { padding: 20px; color: #b91c1c; font: 12px ui-monospace, monospace; display: flex; flex-direction: column; gap: 10px; }
</style>
