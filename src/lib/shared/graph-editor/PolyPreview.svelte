<!--
  PolyPreview.svelte — the polygon 2D-preview OVERLAY (R6a Step 2, GEP modularize).

  The floating SVG vertex editor: a pinned popover that shows a polygon's (r,z)
  points and lets you drag / insert / delete vertices, plus zoom/resize/drag the
  popover itself. ALL state + handlers live on the per-pane `PolyPreviewState`
  instance (`polyUI`); this component is pure markup over it.

  The coord ƒ-popover (`polyExprPop`) STAYS in the GEP shell — it's shared by the
  polygon/poly_repeat node cards AND the mv/rot/txfmn transform axes, so one
  popover can't render in two components. `polyUI.openExprPop` (passed into the
  state instance) routes back to the shell-owned popover; this component only
  triggers it via the vertex-drag handlers on `polyUI`.

  `showSvgTip` / `moveSvgTip` / `hideSvgTip` + `hlVertex` stay in the shell too
  (svgTip + the highlight are read by node-card SVGs as well) and are passed in.
-->
<script lang="ts">
  import { entryIdxForEvalIdx } from './geom';
  import type { PolyPreviewState } from './poly-preview-state.svelte';
  import type { Graph } from '$lib/graph/composition-graph';

  let {
    polyUI,
    graph,
    hlVertex,
    showSvgTip,
    moveSvgTip,
    hideSvgTip,
  }: {
    polyUI: PolyPreviewState;
    graph: Graph;
    hlVertex: { polyId: string; idx: number } | null;
    showSvgTip: (ev: PointerEvent, polyId: string, entryIdx: number | null, evalI: number, total: number, p: [number, number]) => void;
    moveSvgTip: (ev: PointerEvent) => void;
    hideSvgTip: (polyId: string, entryIdx: number | null) => void;
  } = $props();
</script>

{#if polyUI.polyPreviewFor && graph.nodes[polyUI.polyPreviewFor]}
  {@const previewMode = polyUI.polygonModeFor(polyUI.polyPreviewFor)}
  {@const pts = polyUI.polyToPoints(graph.nodes[polyUI.polyPreviewFor])}
  {@const isCart = previewMode === 'cartesian'}
  <!-- Frozen view (#155): viewBox derived from polyUI.polyPreviewView, NOT
       from the points' live bbox. Dragging a vertex updates pts but
       polyUI.polyPreviewView stays put — no auto-zoom mid-drag. The toolbar
       buttons (zoom +/− · fit · + · 🗑) are the only path to mutate
       the view. -->
  {@const xMin = polyUI.polyPreviewView.cx - polyUI.polyPreviewView.half}
  {@const yMin = polyUI.polyPreviewView.cy - polyUI.polyPreviewView.half}
  {@const w = polyUI.polyPreviewView.half * 2}
  {@const h = polyUI.polyPreviewView.half * 2}
  {@const pad = 0}
  {@const vb = `${xMin} ${yMin} ${w} ${h}`}
  {@const d = pts.length
    ? pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + ' Z'
    : ''}
  {@const dClose = pts.length > 1
    ? `M ${pts[pts.length - 1][0]} ${pts[pts.length - 1][1]} L ${pts[0][0]} ${pts[0][1]}`
    : ''}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  {#if !polyUI.polyPreviewPinned}
    <!-- Outside-click shade only when NOT pinned. Pinning makes the
         popup persist while the user edits polygon coords. A drag in
         progress also prevents dismissal — releasing the pointer over
         the shade region after dragging shouldn't close the popup. -->
    <div class="ge-poly-preview-shade" onclick={() => { if (!polyUI.polyDrag) polyUI.polyPreviewFor = null; }}></div>
  {/if}
  <div class="ge-poly-preview" class:pinned={polyUI.polyPreviewPinned}
    style="left: {polyUI.polyPreviewPos.left}px; top: {polyUI.polyPreviewPos.top}px; width: {polyUI.polyPreviewSize.w}px; height: {polyUI.polyPreviewSize.h}px">
    <div class="ge-poly-preview-head">
      <!-- Drag grip — pick up the popover by this dot-cluster and drop
           it anywhere (e.g. over the 3D canvas) so it stays visible
           while you edit a loop card on the graph canvas. svelte-ignore
           the pointer-driven role — the title attribute already
           communicates the affordance. -->
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <span class="ge-poly-preview-grab"
        title="Drag to reposition"
        onpointerdown={polyUI.startPolyPreviewDrag}
        onpointermove={polyUI.polyPreviewDragMove}
        onpointerup={polyUI.polyPreviewDragEnd}>⋮⋮</span>
      <span class="ge-poly-preview-count">2D · {pts.length} pts</span>
      <!-- Drawing toolbar (#155): zoom +/− / fit / append vertex / pop
           last vertex. Frozen view means these are the ONLY way to
           change the SVG framing; drag never re-zooms. -->
      <div class="ge-poly-preview-toolbar">
        <button class="ge-poly-tb-btn" type="button" title="Zoom in"
          onclick={() => polyUI.zoomPolyPreview(0.8)}>＋</button>
        <button class="ge-poly-tb-btn" type="button" title="Zoom out"
          onclick={() => polyUI.zoomPolyPreview(1.25)}>－</button>
        <button class="ge-poly-tb-btn" type="button" title="Fit to points"
          onclick={polyUI.fitPolyPreview}>⊡</button>
        <span class="ge-poly-tb-sep"></span>
        <!-- Mode toggles: ＋pt = "click on an edge to insert a vertex
             there" — armed state shows green tint until clicked again
             (or Escape). 🗑 = "click on a vertex to delete it" — armed
             state shows red tint. Both modes stay sticky so the user
             can chain edits. -->
        <button class="ge-poly-tb-btn ge-poly-tb-mode" type="button"
          class:on={polyUI.polyInsertMode}
          title={polyUI.polyInsertMode ? 'Insert mode ON — click an edge to add a vertex (Esc to exit)' : 'Insert mode: click an edge to add a vertex'}
          onclick={polyUI.togglePolyInsertMode}>＋pt</button>
        <button class="ge-poly-tb-btn ge-poly-tb-mode del" type="button"
          class:on={polyUI.polyDeleteMode}
          title={polyUI.polyDeleteMode ? 'Delete mode ON — click a vertex to remove it (Esc to exit)' : 'Delete mode: click a vertex to remove it'}
          onclick={polyUI.togglePolyDeleteMode} style="font-size: 10px">🗑</button>
      </div>
      <span class="ge-poly-preview-spacer"></span>
      <!-- Snap back to the polygon card on the graph canvas — the
           inverse of drag-it-onto-the-3D-canvas. Useful once a loop
           edit is done and the user wants the popover out of the
           3D-canvas region without closing it. -->
      <button class="ge-poly-preview-snap" type="button"
        title="Snap back to the polygon card"
        onclick={polyUI.snapPolyPreviewToCard}>↩</button>
      <button class="ge-poly-preview-pin" type="button"
        class:on={polyUI.polyPreviewPinned}
        title={polyUI.polyPreviewPinned ? 'Unpin (popup will close on outside click)' : 'Pin (popup stays open while you edit)'}
        onclick={() => (polyUI.polyPreviewPinned = !polyUI.polyPreviewPinned)}>📌</button>
      <button class="ge-poly-preview-close" type="button"
        onclick={() => { polyUI.polyPreviewFor = null; polyUI.polyPreviewPinned = true; }} aria-label="Close">×</button>
    </div>
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <svg viewBox={vb} preserveAspectRatio="xMidYMid meet"
      xmlns="http://www.w3.org/2000/svg"
      class="ge-poly-preview-svg"
      class:insert-mode={polyUI.polyInsertMode}
      class:delete-mode={polyUI.polyDeleteMode}
      onclick={(ev) => { if (polyUI.polyInsertMode && polyUI.polyPreviewFor) polyUI.handleSvgInsertClick(ev, polyUI.polyPreviewFor, isCart); }}
      onpointermove={(ev) => { if (polyUI.polyPreviewFor) polyUI.handleSvgInsertMove(ev, polyUI.polyPreviewFor, isCart); }}
      onpointerleave={polyUI.clearPolyInsertHover}>
      <g transform={previewMode === 'cartesian' ? `scale(1, -1) translate(0, ${-(2 * yMin + h)})` : ''}>
        {#if previewMode !== 'cartesian'}
          <!-- Axis dashes for revolve profiles (r = 0 vertical line). -->
          <line x1="0" y1={yMin - pad} x2="0" y2={yMin + h + pad}
            stroke="#94a3b8" stroke-width={Math.max(w, h) * 0.005}
            stroke-dasharray={`${Math.max(w, h) * 0.02} ${Math.max(w, h) * 0.02}`}/>
        {:else}
          <!-- Cartesian cross-section: show both axes through origin
               so the user sees the (0, 0) center the extrude rotates
               around. Thin grey crosshair, dashed. -->
          {@const aw = Math.max(w, h) * 0.005}
          {@const ad = `${Math.max(w, h) * 0.02} ${Math.max(w, h) * 0.02}`}
          <line x1={xMin - pad} y1="0" x2={xMin + w + pad} y2="0"
            stroke="#94a3b8" stroke-width={aw} stroke-dasharray={ad}/>
          <line x1="0" y1={yMin - pad} x2="0" y2={yMin + h + pad}
            stroke="#94a3b8" stroke-width={aw} stroke-dasharray={ad}/>
        {/if}
        <path d={d} fill="rgba(204, 34, 34, 0.22)" stroke="#991b1b"
          stroke-width={Math.max(w, h) * 0.008} stroke-linejoin="round"/>
        <!-- Dashed auto-closure from last → first. -->
        <path d={dClose} fill="none" stroke="#991b1b"
          stroke-width={Math.max(w, h) * 0.006}
          stroke-dasharray={`${Math.max(w, h) * 0.02} ${Math.max(w, h) * 0.015}`} stroke-linecap="round"/>
        <!-- Insert-mode HOVER GHOST — fat stroke on the nearest edge +
             a translucent dot at the perpendicular projection point.
             Allowed edges = GREEN (committing will land a vertex);
             edges inside a repeat-block expansion = ORANGE + 🚫 no-entry
             glyph at the projection point so the user can see at a
             glance that this edge is generator-owned. pointer-events:none
             on every layer so the highlight never steals the click. -->
        {#if polyUI.polyInsertMode && polyUI.polyInsertHover}
          {@const hov = polyUI.polyInsertHover}
          {@const stroke = hov.blocked ? '#ea580c' : '#16a34a'}
          {@const fill   = hov.blocked ? '#ea580c' : '#16a34a'}
          {@const sub    = hov.blocked ? '#9a3412' : '#15803d'}
          <line x1={hov.ax} y1={hov.ay} x2={hov.bx} y2={hov.by}
            stroke={stroke} stroke-width={Math.max(w, h) * 0.014}
            stroke-linecap="round" stroke-opacity="0.7" pointer-events="none"/>
          <circle cx={hov.px} cy={hov.py}
            r={Math.max(w, h) * 0.018}
            fill={fill} fill-opacity="0.55"
            stroke={sub} stroke-width={Math.max(w, h) * 0.005}
            pointer-events="none"/>
          {#if hov.blocked}
            <!-- 🚫 no-entry glyph rendered as a vector (circle + slash)
                 inside the SAME <g> as the path so it inherits the same
                 coord system + cartesian Y-flip. Drawn slightly bigger
                 than the projection dot so it reads as an overlay. -->
            {@const nr = Math.max(w, h) * 0.035}
            {@const nx = hov.px}
            {@const ny = hov.py}
            {@const sw = Math.max(w, h) * 0.008}
            <circle cx={nx} cy={ny} r={nr}
              fill="none" stroke="#9a3412" stroke-width={sw}
              pointer-events="none"/>
            <line x1={nx - nr * 0.7} y1={ny - nr * 0.7}
                  x2={nx + nr * 0.7} y2={ny + nr * 0.7}
              stroke="#9a3412" stroke-width={sw}
              stroke-linecap="round" pointer-events="none"/>
          {/if}
        {/if}
        <!-- Vertex hover halo (2026-06-11) — when the cursor is within
             ~3× the dot radius of a vertex, draw a soft ring around it
             so the user sees the point is interactive. Parametric +
             repeat-expanded points get a violet ring + a small ƒ glyph
             next to the dot signalling "click to edit expression";
             plain literal points get a neutral blue ring meaning
             "drag to move." pointer-events:none so the halo never
             intercepts the actual click that opens the popover. -->
        {#if polyUI.polyHoverVertex}
          {@const hv = polyUI.polyHoverVertex}
          {@const halo = hv.parametric ? '#6d28d9' : '#0369a1'}
          {@const haloR = Math.max(w, h) * 0.028}
          <circle cx={hv.px} cy={hv.py} r={haloR}
            fill={halo} fill-opacity="0.15"
            stroke={halo} stroke-width={Math.max(w, h) * 0.005}
            stroke-opacity="0.7"
            pointer-events="none"/>
          {#if hv.parametric}
            <!-- ƒ glyph just above the dot — vector so it inherits the
                 cartesian Y-flip with the rest of the <g>. Drawn as a
                 single bold character with a subtle background pill. -->
            {@const fxR = Math.max(w, h) * 0.022}
            {@const fxX = hv.px + haloR * 1.2}
            {@const fxY = hv.py - haloR * 0.4}
            <circle cx={fxX} cy={fxY} r={fxR}
              fill="#ede9fe" stroke="#6d28d9"
              stroke-width={Math.max(w, h) * 0.004}
              pointer-events="none"/>
            <text x={fxX} y={fxY}
              font-family="ui-monospace, monospace"
              font-size={Math.max(w, h) * 0.028}
              font-weight="700"
              fill="#5b21b6"
              text-anchor="middle"
              dominant-baseline="central"
              transform={previewMode === 'cartesian' ? `scale(1, -1) translate(0, ${-2 * fxY})` : ''}
              pointer-events="none">ƒ</text>
          {/if}
        {/if}
        {#each pts as p, i}
          {@const popupPolyNode = graph.nodes[polyUI.polyPreviewFor] as any}
          <!-- Map the evaluated point index back to its ENTRY index
               in the polygon so a loop-expanded point reads the right
               entry kind (a single repeat-ref entry expands to N
               points; without this all but the first would look up
               the wrong entry or undefined and render as red). -->
          {@const entryIdx = entryIdxForEvalIdx(graph,popupPolyNode, i)}
          {@const entry = entryIdx !== null ? popupPolyNode?.points?.[entryIdx] : null}
          {@const fromLoop = entryIdx === null}
          {@const parametricVertex = !!entry && entry.kind === 'point'
            && (entry.r?.kind !== 'literal' || entry.z?.kind !== 'literal')}
          {@const draggable = !!entry && entry.kind === 'point' && !parametricVertex && !fromLoop}
          {@const dotR = Math.max(w, h) * 0.012}
          <!-- Colour scheme (2026-06-11):
               * literal vertex (drag to move)      = red   #991b1b
               * parametric vertex (click to edit)   = violet #6d28d9
               * LOOP-GENERATED point                = purple #a855f7
                                                      with darker ring
                                                      for extra contrast
               The loop color is a distinctly LIGHTER violet so the user
               can tell which dots came from a generator at a glance. -->
          {@const fill = fromLoop ? '#a855f7' : (parametricVertex ? '#6d28d9' : '#991b1b')}
          {@const stroke = fromLoop ? '#6d28d9' : (parametricVertex ? '#a78bfa' : 'none')}
          {@const isHl = !!hlVertex && hlVertex.polyId === polyUI.polyPreviewFor && entryIdx === hlVertex.idx}
          {#if isHl}
            <circle cx={p[0]} cy={p[1]} r={dotR * 2.6} fill="none" stroke="#2563eb" stroke-width={dotR * 0.6} pointer-events="none"/>
          {/if}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <circle cx={p[0]} cy={p[1]} r={isHl ? dotR * 1.7 : dotR}
            fill={fill}
            stroke={stroke}
            stroke-width={fromLoop || parametricVertex ? dotR * 0.5 : 0}
            class:locked={!draggable}
            class:parametric={parametricVertex || fromLoop}
            onpointerdown={(ev) => polyUI.startPolyVertexDrag(ev, polyUI.polyPreviewFor!, i, isCart ? 'cartesian' : 'revolve')}
            onpointerenter={(ev) => showSvgTip(ev, polyUI.polyPreviewFor!, entryIdx, i, pts.length, p)}
            onpointermove={(ev) => { polyUI.polyDragMove(ev); moveSvgTip(ev); }}
            onpointerleave={() => hideSvgTip(polyUI.polyPreviewFor!, entryIdx)}
            onpointerup={polyUI.polyDragEnd}>
          </circle>
          <!-- Point-order markers: green ring + "1" on the FIRST vertex,
               orange ring + count on the LAST. Non-interactive. -->
          {#if i === 0}
            <circle cx={p[0]} cy={p[1]} r={dotR * 1.8} fill="none" stroke="#16a34a" stroke-width={dotR * 0.45} pointer-events="none"/>
            <text x={p[0] + dotR * 2.4} y={p[1] - dotR * 1.6} fill="#15803d" font-size={dotR * 3.4} font-weight="700" pointer-events="none" style="paint-order: stroke" stroke="#fff" stroke-width={dotR * 0.7}>1</text>
          {:else if i === pts.length - 1}
            <circle cx={p[0]} cy={p[1]} r={dotR * 1.8} fill="none" stroke="#ea580c" stroke-width={dotR * 0.45} pointer-events="none"/>
            <text x={p[0] + dotR * 2.4} y={p[1] - dotR * 1.6} fill="#c2410c" font-size={dotR * 3.4} font-weight="700" pointer-events="none" style="paint-order: stroke" stroke="#fff" stroke-width={dotR * 0.7}>{pts.length}</text>
          {/if}
        {/each}
      </g>
    </svg>
    <!-- Bottom-right resize grip — drag to grow/shrink the popup
         diagonally. Persists size to localStorage on release. -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ge-poly-preview-grip"
      onpointerdown={polyUI.startPolyPreviewResize}
      onpointermove={polyUI.polyPreviewResizeMove}
      onpointerup={polyUI.polyPreviewResizeEnd}>↘</div>
  </div>
{/if}

<style>
  /* Vertex circles in the 2D-preview SVG. (Split out of the shared
     `.ge-profile-2d svg circle` rule in GraphEditorPane — the profile
     mini-card half stays in the shell.) pointermove rewrites (r, z)
     directly; wired (param / expr) coords get a not-allowed cursor since
     dragging them would silently overwrite the wiring. Hover adds a
     translucent halo via stroke so the drop target reads as interactive
     (stroke is independent of the inline r attr, unlike a CSS r override
     which fights the geometry attribute). */
  .ge-poly-preview-svg circle {
    cursor: grab;
    touch-action: none;
    transition: stroke-width 80ms ease, stroke 80ms ease;
    stroke: transparent;
    stroke-width: 0;
  }
  .ge-poly-preview-svg circle:hover {
    stroke: rgba(153, 27, 27, 0.28);
    stroke-width: 0.012em;
    /* Stroke-width in em scales with the parent's font-size — not the SVG
       viewBox. The numeric value here is tuned against the path stroke
       width (sw) which is bbox-relative; the resulting halo reads
       proportional at common card sizes. */
  }
  .ge-poly-preview-svg circle:active { cursor: grabbing; }
  .ge-poly-preview-svg circle.locked { cursor: not-allowed; opacity: 0.7; }
  .ge-poly-preview-svg circle.locked:hover { stroke: transparent; stroke-width: 0; }

  /* Floating 2D-preview popup — fixed position next to the 👁 button.
     Useful when the right pane is showing 3D BAKE (because a revolve
     is consuming the polygon) and the user still wants to see the
     underlying 2D shape. */
  .ge-poly-preview-shade { position: fixed; inset: 0; z-index: 99; }
  .ge-poly-preview {
    /* Width + height set inline from polyUI.polyPreviewSize. min-width/min-height
       enforce the resize-grip floor in case the inline values get out of
       sync with the helper clamps. */
    position: fixed; min-width: 160px; min-height: 160px;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 8px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 100; display: flex; flex-direction: column;
    overflow: hidden;
  }
  /* Drag-resize grip — bottom-right corner. 14×14 hit area + a faint
     ↘ glyph that brightens on hover. Slate by default, violet on hover
     so it matches the pin's accent palette. */
  .ge-poly-preview-grip {
    position: absolute; right: 1px; bottom: 1px;
    width: 14px; height: 14px; padding: 0;
    display: flex; align-items: center; justify-content: center;
    font: 10px Arial; color: #94a3b8;
    cursor: nwse-resize; user-select: none;
    z-index: 1;
  }
  .ge-poly-preview-grip:hover { color: #6d28d9; }
  .ge-poly-preview-head {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px; border-bottom: 1px solid #f1f5f9;
    font: 600 11px Arial; color: #57534e;
  }
  .ge-poly-preview-count { white-space: nowrap; }
  .ge-poly-preview-spacer { flex: 1 1 auto; }
  /* Drag grip on the popover's title bar — pick-up affordance for the
     drag-anywhere flow (2026-06-11). Tight 14×16 box on the LEFT of
     the head so it reads as "handle"; cursor:grab on hover, grabbing
     during drag. Light grey dots until hovered. */
  .ge-poly-preview-grab {
    display: inline-flex; align-items: center; justify-content: center;
    width: 14px; height: 16px;
    margin-right: 4px;
    font: 700 9px ui-monospace, monospace; color: #94a3b8;
    line-height: 1; letter-spacing: -1px;
    cursor: grab; user-select: none;
    border-radius: 3px;
    transition: color 100ms, background 100ms;
  }
  .ge-poly-preview-grab:hover { color: #1f2937; background: #f1f5f9; }
  .ge-poly-preview-grab:active { cursor: grabbing; }
  /* Snap-back button — sits next to the pin icon, ↩ glyph reads as
     "send back". Tight 18×18 to match the pin/close affordances. */
  .ge-poly-preview-snap {
    width: 22px; height: 18px; padding: 0;
    background: transparent; border: 0; cursor: pointer;
    font: 600 12px Arial; color: #94a3b8; line-height: 1; opacity: 0.7;
    transition: opacity 100ms, color 100ms;
  }
  .ge-poly-preview-snap:hover { opacity: 1; color: #0c4a6e; }
  /* Drawing toolbar (#155) — small flat buttons left of the pin/close,
     freeze-then-zoom + add/delete vertex controls. Tight 18 × 18 with
     a faint hover wash; matches the inspector chrome. */
  .ge-poly-preview-toolbar {
    display: flex; align-items: center; gap: 1px;
    margin: 0 6px 0 8px;
  }
  .ge-poly-tb-btn {
    height: 18px; min-width: 18px; padding: 0 4px;
    background: transparent; border: 1px solid transparent; border-radius: 3px;
    font: 600 11px Arial; color: #57534e; line-height: 1; cursor: pointer;
    transition: background 80ms, border-color 80ms, color 80ms;
  }
  .ge-poly-tb-btn:hover { background: #f1f5f9; border-color: #cbd5e1; color: #1f2937; }
  .ge-poly-tb-btn:active { background: #e2e8f0; }
  /* Armed state — green for insert, red for delete. Bold border so the
     user has a clear "this mode is active" signal even when their mouse
     is on the SVG canvas. */
  .ge-poly-tb-mode.on { background: #dcfce7; border-color: #16a34a; color: #15803d; }
  .ge-poly-tb-mode.on:hover { background: #bbf7d0; }
  .ge-poly-tb-mode.del.on { background: #fee2e2; border-color: #b91c1c; color: #7f1d1d; }
  .ge-poly-tb-mode.del.on:hover { background: #fecaca; }
  .ge-poly-tb-sep {
    width: 1px; height: 12px; background: #e2e8f0; margin: 0 4px;
  }
  /* Mode cursors over the SVG canvas. Insert mode = `copy` so the user
     sees a "+ landing" hint when hovering an edge; delete mode = `crosshair`
     plus a soft red wash so vertex circles read as "armed for deletion". */
  .ge-poly-preview-svg.insert-mode { cursor: copy; background: #f0fdf4; }
  .ge-poly-preview-svg.delete-mode { cursor: crosshair; background: #fef2f2; }
  .ge-poly-preview-svg.delete-mode circle { cursor: not-allowed; }
  /* Pin toggle — when ON, the popup persists across canvas clicks so the
     user can edit polygon coords with the SVG live in the corner. */
  .ge-poly-preview-pin {
    width: 22px; height: 18px; padding: 0;
    background: transparent; border: 0; cursor: pointer;
    font: 11px Arial; color: #94a3b8; line-height: 1; opacity: 0.55;
    transition: opacity 100ms, color 100ms;
  }
  .ge-poly-preview-pin:hover { opacity: 1; color: #57534e; }
  .ge-poly-preview-pin.on { opacity: 1; color: #6d28d9; transform: rotate(-30deg); }
  .ge-poly-preview-pin.on:hover { color: #5b21b6; }
  /* Pinned popup state — slightly thicker border + violet accent so the
     user has a clear visual signal the popup is sticky. */
  .ge-poly-preview.pinned {
    border-color: #a78bfa; box-shadow: 0 6px 18px rgba(109, 40, 217, 0.18), 0 2px 4px rgba(109, 40, 217, 0.10);
  }
  .ge-poly-preview-close {
    width: 18px; height: 18px; padding: 0;
    background: transparent; border: 0; cursor: pointer;
    font: 14px Arial; color: #b91c1c; line-height: 1;
  }
  .ge-poly-preview-close:hover { background: #fee2e2; border-radius: 3px; }
  .ge-poly-preview-svg {
    flex: 1 1 auto; min-height: 0; width: 100%;
    background: #fafaf9; display: block;
  }
</style>
