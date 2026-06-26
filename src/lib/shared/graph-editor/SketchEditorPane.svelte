<!--
  SketchEditorPane.svelte — the full-tab sketch editor overlay (plan M.2),
  extracted from GraphEditorPane (modularize K.65, Phase E Step 2, block 2).

  Renders ONLY when sketch.editingSketchId && sketch.sketchEditor (the {#if}
  guard lives inside this component, so GEP mounts it unconditionally inside the
  canvas pane). Owns: the LEFT tools rail, the 2D draw stage (anchors, spline
  through-points + handles), the floating draggable PARAMS + sketch mini cards
  (fully wireable), the corner/spline dial topbar, the Done tick + hint.

  All state + handlers live on the ONE per-pane `sketch` (SketchState) instance,
  shared with SketchNodeCard and the shell-owned coord ƒ-popover. This pane only
  SETS sketch.sketchExprPop (via sketch.openSketchExprPop) — the popover renders
  in the GEP shell (the Phase-E-revert fix). Graph mutations route through
  setGraph(); the wire subsystem + params-card callbacks come in as props.

  CSS (the .ge-sketch-editor / -stool / -sk-* set + the .ge-sketch row classes
  shared with the mini card + the node chrome / sock / wire / params-card /
  param-chip classes the mini cards reuse) is duplicated here from GEP so
  Svelte's scoped CSS applies.
-->
<script lang="ts">
  import {
    sketchCols, sketchSockR, sketchSockZ, sketchSockVal, sketchRowVisible,
    miniBez, extractParamRefs, CARD_PAD, CARD_TITLE_H, PARAM_H, PARAM_GAP,
  } from './geom';
  import { sketchEntryH } from '$lib/cad/sketch-layout';
  import { argStr, argFrom } from './args';
  import {
    addSketchOp, setSketchOpField, moveSketchOp, removeSketchOp, addSketchRepeat,
    removeSketchSplinePoint, setSketchScale, type Graph,
  } from '$lib/cad/composition-graph';
  import type { SketchState } from './sketch-state.svelte';
  import type { WireState } from './wire-state.svelte';

  let {
    sketch,
    graph,
    setGraph,
    wire,
    paramEntries,
    paramNames,
    pcs,
    PARAM_W,
    onParamDefault,
    onOpenAddParamPop,
  }: {
    sketch: SketchState;
    graph: Graph;
    setGraph: (g: Graph) => void;
    wire: WireState;
    /** [name, ParamSchema][] — the PARAMS card rows (mini card mirror). */
    paramEntries: [string, any][];
    /** Object.keys(graph.params) — the wireable p.* set. */
    paramNames: string[];
    /** paramCardSize() result — { w, h } of the mini params card. */
    pcs: { w: number; h: number };
    /** dynamic chip width (GEP $derived from the longest label). */
    PARAM_W: number;
    onParamDefault: (name: string, value: number) => void;
    onOpenAddParamPop: (ev: PointerEvent) => void;
  } = $props();

  // ⚙ per-axis scale popover (whole-sketch scaleX / scaleY → compileSketch's
  // trailing args → baked profile stretches per axis). Local UI flag; the
  // values themselves live on the sketch node (scaleX/scaleY ArgValue).
  let scalePopOpen = $state(false);
  /** Literal value of an ArgValue scale field (1 when absent/non-literal). */
  function scaleVal(v: any): number {
    return v && v.kind === 'literal' && typeof v.value === 'number' ? v.value : 1;
  }
</script>

{#if sketch.editingSketchId && sketch.sketchEditor}
  {@const se = sketch.sketchEditor}
  {@const sid = sketch.editingSketchId}
  {@const fr = sketch.frame ?? se.ext}
  {@const span = Math.max(fr.maxX - fr.minX, fr.maxY - fr.minY) || 1}
  {@const pad = span * 0.12 + 0.2}
  {@const vb = `${fr.minX - pad} ${fr.minY - pad} ${(fr.maxX - fr.minX) + 2 * pad} ${(fr.maxY - fr.minY) + 2 * pad}`}
  {@const hr = span * 0.018}
  {@const sw = span * 0.008}
  <div class="ge-sketch-editor">
    <!-- Tool palette — LEFT vertical rail (matches the main editor vrail). -->
    <div class="ge-sketch-vtools">
      <button class="ge-stool" class:on={sketch.sketchTool === 'select'} title="Select / drag points" onclick={() => (sketch.sketchTool = 'select')}>⬚</button>
      <div class="ge-stool-sep"></div>
      <button class="ge-stool" class:on={sketch.sketchTool === 'line'} title="Line — click the canvas to add points" onclick={() => (sketch.sketchTool = 'line')}>╱</button>
      <button class="ge-stool" class:on={sketch.sketchTool === 'spline'} title="Spline — click to add a Bézier point" onclick={() => (sketch.sketchTool = 'spline')}>∿</button>
      <button class="ge-stool" class:on={sketch.sketchTool === 'fillet'} title="Fillet — click a corner to round it" onclick={() => (sketch.sketchTool = 'fillet')}>◜</button>
      <button class="ge-stool" class:on={sketch.sketchTool === 'chamfer'} title="Chamfer — click a corner to bevel it" onclick={() => (sketch.sketchTool = 'chamfer')}>⊿</button>
      <div class="ge-stool-sep"></div>
      <button class="ge-stool" title="Fit — re-frame the view to the sketch (the view stays fixed while you drag points)" onclick={sketch.fitSketchFrame}>⤢</button>
      <div class="ge-stool-sep"></div>
      {#each [1, 2, 3] as n (n)}
        <button class="ge-stool" class:on={sketchCols(graph,se.node) === n}
          title="{n}-column op layout"
          onclick={() => sketch.setSketchCols(se.node.id, n as 1 | 2 | 3)}>{n}</button>
      {/each}
      <div class="ge-stool-sep"></div>
      <!-- ⚙ whole-sketch per-axis scale (X = r, Y = z). 1/1 = no scale. -->
      <span class="ge-sk-scale-wrap">
        <button class="ge-stool" class:on={scalePopOpen || scaleVal(se.node.scaleX) !== 1 || scaleVal(se.node.scaleY) !== 1}
          title="Sketch settings — per-axis scale (X / Y)"
          onclick={() => (scalePopOpen = !scalePopOpen)}>⚙</button>
        {#if scalePopOpen}
          <div class="ge-sk-scale-pop">
            <div class="ge-sk-scale-hd">Per-axis scale</div>
            <label class="ge-sk-scale-row">
              <span class="ge-sk-scale-lbl">X (r)</span>
              <input class="ge-sk-scale-in" type="number" step="0.1" min="0"
                value={scaleVal(se.node.scaleX)}
                onchange={(e) => setGraph(setSketchScale(graph, sid, 'x', { kind: 'literal', value: Number((e.currentTarget as HTMLInputElement).value) || 1 }))} />
            </label>
            <label class="ge-sk-scale-row">
              <span class="ge-sk-scale-lbl">Y (z)</span>
              <input class="ge-sk-scale-in" type="number" step="0.1" min="0"
                value={scaleVal(se.node.scaleY)}
                onchange={(e) => setGraph(setSketchScale(graph, sid, 'y', { kind: 'literal', value: Number((e.currentTarget as HTMLInputElement).value) || 1 }))} />
            </label>
            <button class="ge-sk-scale-reset" type="button" title="Reset both axes to 1×"
              disabled={scaleVal(se.node.scaleX) === 1 && scaleVal(se.node.scaleY) === 1}
              onclick={() => setGraph(setSketchScale(setSketchScale(graph, sid, 'x', { kind: 'literal', value: 1 }), sid, 'y', { kind: 'literal', value: 1 }))}>Reset 1×1</button>
          </div>
        {/if}
      </span>
    </div>
    <!-- S.2: the 2D draw stage fills the sketcher (minus the tool rail +
         the 3D pane). The PARAMS card + sketch card FLOAT over it as a
         draggable overlay (.ge-sketch-side / .ge-sketch-cards) — each
         drags by its TITLE bar — and stay fully wireable: drag a param's
         output socket onto a coord's input socket to wire p.<name>, wires
         re-route from the moved card, 3D re-bakes live. The overlay is
         pointer-events:none so drawing passes through; only the card
         bodies + sockets capture events. Stage-level pointer handlers
         track both a card-title drag and an in-flight wire that crosses
         the empty canvas (which would otherwise eat the move events). -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="ge-sketch-stage" onpointermove={sketch.sketchStageMove} onpointerup={sketch.sketchStageUp}>
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <svg bind:this={sketch.sketchSvgEl} class="ge-sketch-svg" class:tool={sketch.sketchTool !== 'select'} class:panning={!!sketch.sketchPanDrag}
        viewBox={vb} preserveAspectRatio="xMidYMid meet"
        onpointerdown={sketch.sketchCanvasClick} onwheel={sketch.sketchCanvasWheel}>
        <!-- revolve axis at r = 0 -->
        <line x1="0" y1={fr.minY - pad} x2="0" y2={fr.maxY + pad} stroke="#cbd5e1" stroke-width={sw * 0.5} stroke-dasharray={`${sw * 4} ${sw * 3}`}/>
        {#if se.pts.length > 2}
          <polygon points={se.pts.map((q) => `${q[0]},${q[1]}`).join(' ')} fill="rgba(147,51,234,0.12)" stroke="#7c3aed" stroke-width={sw} stroke-linejoin="round"/>
        {/if}
        {#each se.anchors as a, i (a.opIdx)}
          <!-- corner badge: ring on filleted/chamfered vertices; gold when selected -->
          {#if a.corner}
            <circle cx={a.r} cy={a.z} r={hr * 1.9} fill="none"
              stroke={a.cornerOpIdx === sketch.selectedCornerOpIdx ? '#f59e0b' : (a.corner === 'fillet' ? '#0e7490' : '#b45309')}
              stroke-width={hr * 0.4} pointer-events="none"/>
          {/if}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <circle cx={a.r} cy={a.z} r={hr}
            class="ge-sk-anchor" class:locked={!a.literal}
            fill={a.kind === 'spline' ? '#0891b2' : '#7c3aed'} stroke="#fff" stroke-width={hr * 0.25}
            onpointerdown={(ev) => sketch.sketchAnchorDown(ev, a.opIdx, a.literal, a.kind)}
            onpointermove={sketch.sketchAnchorMove}
            onpointerup={(ev) => { sketch.sketchAnchorUp(); sketch.sketchAnchorTap(ev, sid, a.opIdx, argStr(se.node.ops[a.opIdx].r)); }}
            ondblclick={(ev) => sketch.openSketchExprPop(ev, sid, a.opIdx, 'r', argStr(se.node.ops[a.opIdx].r))}/>
          <!-- Number every point (1,2,3…) in small font next to it. -->
          <text x={a.r + hr * 1.7} y={a.z - hr * 1.3} font-size={hr * 2.0} fill={i === 0 ? '#15803d' : '#6d28d9'} font-weight="700" pointer-events="none" style="paint-order: stroke" stroke="#fff" stroke-width={hr * 0.5}>{i + 1}</text>
          <!-- (Param→point on-canvas sockets/badges removed — param links
               read on the sketch CARD only, per user; the drawing stays clean.) -->
        {/each}
        <!-- Phase 2: selected spline's relative through-points + end handles.
             Amber dots; thin dashed handle lines off the endpoints. Ghost
             (low-opacity) end handles are defaults the user grabs to create
             an h0/h1; solid ones are stored. -->
        {#if sketch.selectedSpline}
          {@const ss = sketch.selectedSpline}
          <line x1={ss.a[0]} y1={ss.a[1]} x2={ss.h0.x} y2={ss.h0.y} stroke="#d97706"
            stroke-width={sw * 0.7} stroke-dasharray={`${sw * 2} ${sw * 2}`}
            opacity={ss.h0.set ? 0.9 : 0.4} pointer-events="none"/>
          <line x1={ss.b[0]} y1={ss.b[1]} x2={ss.h1.x} y2={ss.h1.y} stroke="#d97706"
            stroke-width={sw * 0.7} stroke-dasharray={`${sw * 2} ${sw * 2}`}
            opacity={ss.h1.set ? 0.9 : 0.4} pointer-events="none"/>
          {#each ss.pts as pt (pt.k)}
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <circle cx={pt.x} cy={pt.y} r={hr} class="ge-sk-spt"
              fill="#f59e0b" stroke="#fff" stroke-width={hr * 0.25}
              onpointerdown={(ev) => sketch.splineCompDown(ev, 'pt', pt.k)}
              onpointermove={sketch.splineCompMove} onpointerup={sketch.splineCompUp}/>
            <!-- per-point delete: a small × above-right of THIS through-point -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <circle class="ge-sk-spt-del-hit" role="button" tabindex="-1"
              cx={pt.x + hr * 1.5} cy={pt.y - hr * 1.5} r={hr * 0.9}
              data-tip="Delete this through-point"
              onpointerdown={(ev) => { ev.stopPropagation(); if (sketch.editingSketchId) setGraph(removeSketchSplinePoint(graph, sketch.editingSketchId, ss.opIdx, pt.k)); }}/>
            <text x={pt.x + hr * 1.5} y={pt.y - hr * 1.5 + hr * 0.5} font-size={hr * 1.4} text-anchor="middle"
              fill="#fff" font-weight="700" pointer-events="none">×</text>
          {/each}
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <circle cx={ss.h0.x} cy={ss.h0.y} r={hr * 0.82} class="ge-sk-spt"
            fill="#fbbf24" stroke="#b45309" stroke-width={hr * 0.3}
            opacity={ss.h0.set ? 1 : 0.45}
            onpointerdown={(ev) => sketch.splineCompDown(ev, 'h0')}
            onpointermove={sketch.splineCompMove} onpointerup={sketch.splineCompUp}/>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <circle cx={ss.h1.x} cy={ss.h1.y} r={hr * 0.82} class="ge-sk-spt"
            fill="#fbbf24" stroke="#b45309" stroke-width={hr * 0.3}
            opacity={ss.h1.set ? 1 : 0.45}
            onpointerdown={(ev) => sketch.splineCompDown(ev, 'h1')}
            onpointermove={sketch.splineCompMove} onpointerup={sketch.splineCompUp}/>
        {/if}
      </svg>
      <!-- Floating, draggable cards overlay (S.2): the real PARAMS card +
           sketch node card, on top of the 2D stage. 1:1 px coordinate
           space (no viewBox). Root is pointer-events:none so the canvas
           underneath stays drawable; each card group re-enables events.
           Wires + the in-flight preview route from sketch.sketchCardPos. -->
      {#if sketch.miniLayout}
        {@const ml = sketch.miniLayout}
        {@const sn = se.node}
        <!-- opIdx → the point NUMBER shown next to that anchor in the 2D stage
             ({i+1} over se.anchors), so a card row carries the SAME number as
             its point. Corner ops (fillet/chamfer) aren't anchors → no number. -->
        {@const opNum = new Map(se.anchors.map((a, i) => [a.opIdx, i + 1]))}
        {@const scW = sketch.sketchCardSize?.w ?? ml.scW}
        {@const scH = sketch.sketchCardSize?.h ?? ml.sch}
        <svg class="ge-sketch-cards" bind:this={sketch.miniSvgEl}>
          <!-- committed wires: every param-driven coord → its param socket -->
          {#each (sn.ops as Array<any>) as op, idx (idx)}
            {#if sketchRowVisible(sketch.sketchOpsScrollTop,sn, idx, scH)}
              {@const fields = (op.op === 'line' || op.op === 'spline')
                ? [['r', sketchSockR(sn, idx)], ['z', sketchSockZ(sn, idx)]]
                : op.op === 'fillet' ? [['radius', sketchSockVal(sn, idx)]]
                : op.op === 'chamfer' ? [['dist', sketchSockVal(sn, idx)]] : []}
              {#each fields as [field, sy] (field)}
                {@const av = (op as any)[field]}
                {@const ty = sketch.sketchCardPos.sketch.y + (sy as number) - sketch.sketchOpsScrollTop}
                {#if av?.kind === 'param'}
                  {@const pi = paramNames.indexOf(av.param)}
                  {#if pi >= 0}{@const a = sketch.miniParamSockAbs(pi)}<path class="ge-wire param" d={miniBez(a.x, a.y, sketch.sketchCardPos.sketch.x, ty)}/>{/if}
                {:else if av?.kind === 'expr'}
                  {#each extractParamRefs(av.expr) as ref (ref)}
                    {@const pi = paramNames.indexOf(ref)}
                    {#if pi >= 0}{@const a = sketch.miniParamSockAbs(pi)}<path class="ge-wire param expr" d={miniBez(a.x, a.y, sketch.sketchCardPos.sketch.x, ty)}/>{/if}
                  {/each}
                {/if}
              {/each}
            {/if}
          {/each}
          <!-- (Param→on-canvas-point wires removed — param links are shown
               on the sketch CARD only, per user. Card→coord wires below.) -->

          <!-- PARAMS card — drag by its title bar -->
          <g class="card" transform="translate({sketch.sketchCardPos.params.x},{sketch.sketchCardPos.params.y})">
            <rect class="ge-params-card-bg" width={pcs.w} height={pcs.h} rx="8"/>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect class="ge-sketch-card-title" x="0" y="0" width={pcs.w} height={CARD_TITLE_H} rx="8"
              onpointerdown={(ev) => sketch.sketchCardDown(ev, 'params')}/>
            <text x="10" y={CARD_TITLE_H - 9} class="ge-params-card-title" pointer-events="none">Params</text>
            <!-- + add a new param (same handler as the main params card) -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <circle role="button" tabindex="-1" class="ge-params-add-btn"
              cx={pcs.w - 14} cy={CARD_TITLE_H - 13} r="9"
              data-tip="Add a parameter"
              onpointerdown={(ev) => { ev.stopPropagation(); onOpenAddParamPop(ev); }}/>
            <text x={pcs.w - 14} y={CARD_TITLE_H - 9} class="ge-params-add-glyph" text-anchor="middle" pointer-events="none">+</text>
            <line x1="0" y1={CARD_TITLE_H} x2={pcs.w} y2={CARD_TITLE_H} class="ge-params-card-divider" pointer-events="none"/>
            {#if paramEntries.length === 0}
              <text x="10" y={CARD_TITLE_H + 22} class="ge-sketch-mini-empty">No params yet — add them on the graph.</text>
            {/if}
            {#each paramEntries as [name, p], i (name)}
              <g transform="translate({CARD_PAD},{CARD_TITLE_H + CARD_PAD + i * (PARAM_H + PARAM_GAP)})">
                <foreignObject x="0" y="0" width={PARAM_W} height={PARAM_H}>
                  <div class="ge-param-chip" xmlns="http://www.w3.org/1999/xhtml">
                    <span class="name" title="p.{name}">p.{name}</span>
                    <input class="val" type="number" step="0.05" value={(p as any).default}
                      onchange={(e) => onParamDefault(name, Number((e.target as HTMLInputElement).value))}/>
                  </div>
                </foreignObject>
                <!-- Output socket — drag onto a sketch coord input socket. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out param"
                  cx={PARAM_W + CARD_PAD + 4} cy={PARAM_H / 2} r="5"
                  data-tip="Drag onto a sketch coord to wire p.{name}"
                  onpointerdown={(ev) => wire.startParamWire(ev, name)}/>
              </g>
            {/each}
          </g>

          <!-- SKETCH node card — drag by its title bar; per-coord wire
               sockets (LEFT edge) + a ƒ button on every coord row. -->
          <g class="card" transform="translate({sketch.sketchCardPos.sketch.x},{sketch.sketchCardPos.sketch.y})">
            <rect class="ge-node-bg sketch" width={scW} height={scH} rx="6"/>
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect class="ge-sketch-card-title" x="0" y="0" width={scW} height="32" rx="6"
              onpointerdown={(ev) => sketch.sketchCardDown(ev, 'sketch')}/>
            <text x="10" y="22" class="ge-node-title" pointer-events="none">✐ sketch</text>
            <line x1="0" y1="32" x2={scW} y2="32" class="ge-node-divider" pointer-events="none"/>
            <foreignObject x="6" y="36" width={scW - 12} height={scH - 40} class="ge-fo">
              <div class="ge-sketch" xmlns="http://www.w3.org/1999/xhtml">
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <div class="ge-sketch-ops" onscroll={(e) => (sketch.sketchOpsScrollTop = (e.currentTarget as HTMLElement).scrollTop)}>
                  {#each (sn.ops as Array<any>) as op, idx (idx)}
                    {#if op.op === 'line' || op.op === 'spline'}
                      <div class="ge-sketch-vtx" class:editing={sketch.sketchExprPop?.sid === sid && sketch.sketchExprPop?.opIdx === idx} style="height: {sketchEntryH(op)}px">
                        <span class="ge-sketch-vidx" class:first={opNum.get(idx) === 1}>{opNum.get(idx) ?? ''}</span>
                        <div class="ge-sketch-srow">
                          <button class="ge-sketch-axis" class:spline={op.op === 'spline'} class:rel={op.mode === 'rel'} title="Toggle absolute / Δ relative (offset from previous point)" onclick={() => sketch.toggleSketchOpMode(sid, idx, op)}>{sketch.sketchAxisLabel(op, 'r')}</button>
                          <input class="ge-sketch-in" type="text" value={argStr(op.r)} title={op.mode === 'rel' ? 'Δr — offset from previous point' : 'r — number or p.param'}
                            onchange={(e) => { setGraph(setSketchOpField(graph, sid, idx, 'r', argFrom((e.target as HTMLInputElement).value))); }}/>
                          <button class="ge-sketch-fx" type="button" title="Write/edit an expression for r" class:on={op.r?.kind === 'expr'}
                            onclick={(ev) => sketch.openSketchExprPop(ev, sid, idx, 'r', argStr(op.r))}>ƒ</button>
                          <button class="ge-sketch-btn" type="button" title="Move up" disabled={idx === 0}
                            onclick={() => { setGraph(moveSketchOp(graph, sid, idx, -1)); }}>▲</button>
                        </div>
                        <div class="ge-sketch-srow">
                          <button class="ge-sketch-axis" class:spline={op.op === 'spline'} class:rel={op.mode === 'rel'} title="Toggle absolute / Δ relative (offset from previous point)" onclick={() => sketch.toggleSketchOpMode(sid, idx, op)}>{sketch.sketchAxisLabel(op, 'z')}</button>
                          <input class="ge-sketch-in" type="text" value={argStr(op.z)} title={op.mode === 'rel' ? 'Δz — offset from previous point' : 'z'}
                            onchange={(e) => { setGraph(setSketchOpField(graph, sid, idx, 'z', argFrom((e.target as HTMLInputElement).value))); }}/>
                          <button class="ge-sketch-fx" type="button" title="Write/edit an expression for z" class:on={op.z?.kind === 'expr'}
                            onclick={(ev) => sketch.openSketchExprPop(ev, sid, idx, 'z', argStr(op.z))}>ƒ</button>
                          <button class="ge-sketch-btn" type="button" title="Move down" disabled={idx === sn.ops.length - 1}
                            onclick={() => { setGraph(moveSketchOp(graph, sid, idx, 1)); }}>▼</button>
                          <button class="ge-sketch-btn del" type="button" title="Remove op" disabled={sn.ops.length <= 1}
                            onclick={() => { setGraph(removeSketchOp(graph, sid, idx)); }}>×</button>
                        </div>
                      </div>
                    {:else if op.op === 'repeat-ref'}
                      {@const src = graph.nodes[op.sourceId]}
                      {@const cnt = (src as any)?.type === 'sketch_repeat' ? argStr((src as any).count) : '?'}
                      <div class="ge-sketch-vtx repeat" style="height: {sketchEntryH(op)}px">
                        <span class="ge-sketch-vidx">{opNum.get(idx) ?? ''}</span>
                        <div class="ge-sketch-srow">
                          <span class="ge-sketch-axis repeat" title="Sketch repeat — edit the prototype on its ↻ card">↻ ×{cnt}</span>
                          <span class="ge-sketch-rep-hint">{(src as any)?.type === 'sketch_repeat' ? 'repeat block' : 'missing source'}</span>
                          <button class="ge-sketch-btn" type="button" title="Move up" disabled={idx === 0}
                            onclick={() => { setGraph(moveSketchOp(graph, sid, idx, -1)); }}>▲</button>
                          <button class="ge-sketch-btn" type="button" title="Move down" disabled={idx === sn.ops.length - 1}
                            onclick={() => { setGraph(moveSketchOp(graph, sid, idx, 1)); }}>▼</button>
                          <button class="ge-sketch-btn del" type="button" title="Remove repeat" disabled={sn.ops.length <= 1}
                            onclick={() => { setGraph(removeSketchOp(graph, sid, idx)); }}>×</button>
                        </div>
                      </div>
                    {:else}
                      <div class="ge-sketch-vtx corner" class:editing={sketch.sketchExprPop?.sid === sid && sketch.sketchExprPop?.opIdx === idx} style="height: {sketchEntryH(op)}px">
                        <span class="ge-sketch-vidx">{opNum.get(idx) ?? ''}</span>
                        <div class="ge-sketch-srow">
                          <span class="ge-sketch-axis corner" class:chamfer={op.op === 'chamfer'} title={op.op === 'fillet' ? 'fillet radius' : 'chamfer distance'}>{op.op === 'fillet' ? 'fillet' : 'chamf'}</span>
                          <input class="ge-sketch-in" type="text" value={argStr(op.op === 'fillet' ? op.radius : op.dist)} title={op.op === 'fillet' ? 'fillet radius' : 'chamfer dist'}
                            onchange={(e) => { setGraph(setSketchOpField(graph, sid, idx, op.op === 'fillet' ? 'radius' : 'dist', argFrom((e.target as HTMLInputElement).value))); }}/>
                          <button class="ge-sketch-fx" type="button" title="Write/edit an expression" class:on={(op.op === 'fillet' ? op.radius : op.dist)?.kind === 'expr'}
                            onclick={(ev) => sketch.openSketchExprPop(ev, sid, idx, op.op === 'fillet' ? 'radius' : 'dist', argStr(op.op === 'fillet' ? op.radius : op.dist))}>ƒ</button>
                          <button class="ge-sketch-btn" type="button" title="Move up" disabled={idx === 0}
                            onclick={() => { setGraph(moveSketchOp(graph, sid, idx, -1)); }}>▲</button>
                          <button class="ge-sketch-btn" type="button" title="Move down" disabled={idx === sn.ops.length - 1}
                            onclick={() => { setGraph(moveSketchOp(graph, sid, idx, 1)); }}>▼</button>
                          <button class="ge-sketch-btn del" type="button" title="Remove op" disabled={sn.ops.length <= 1}
                            onclick={() => { setGraph(removeSketchOp(graph, sid, idx)); }}>×</button>
                        </div>
                      </div>
                    {/if}
                  {/each}
                </div>
                <div class="ge-sketch-foot">
                  <button class="ge-sketch-add" type="button" title="Add a line segment" onclick={() => { setGraph(addSketchOp(graph, sid, 'line')); }}>+ line</button>
                  <button class="ge-sketch-add" type="button" title="Add a Bézier spline" onclick={() => { setGraph(addSketchOp(graph, sid, 'spline')); }}>+ spline</button>
                  <button class="ge-sketch-add" type="button" title="Round the previous corner" onclick={() => { setGraph(addSketchOp(graph, sid, 'fillet')); }}>+ fillet</button>
                  <button class="ge-sketch-add" type="button" title="Bevel the previous corner" onclick={() => { setGraph(addSketchOp(graph, sid, 'chamfer')); }}>+ chamfer</button>
                  <button class="ge-sketch-add repeat" type="button" title="Repeat a run of ops N times (threads / serrations)" onclick={() => { setGraph(addSketchRepeat(graph, sid).graph); }}>+ repeat</button>
                </div>
              </div>
            </foreignObject>
            <!-- Per-coord INPUT sockets (drop a param's output socket here).
                 They live in card-space, so when the ops list scrolls they
                 shift up by sketch.sketchOpsScrollTop and hide once their row
                 scrolls out of the visible card band. -->
            {#each (sn.ops as Array<any>) as op, idx (idx)}
              {#if sketchRowVisible(sketch.sketchOpsScrollTop,sn, idx, scH)}
                {#if op.op === 'line' || op.op === 'spline'}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class={`ge-sock in poly-coord${op.r?.kind === 'param' ? ' wired' : ''}`}
                    cx="0" cy={sketchSockR(sn, idx) - sketch.sketchOpsScrollTop} r="4" data-tip="Drag a param here → r"
                    onpointerup={(ev) => wire.endWireOnSketchCoord(ev, sid, idx, 'r')}/>
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class={`ge-sock in poly-coord${op.z?.kind === 'param' ? ' wired' : ''}`}
                    cx="0" cy={sketchSockZ(sn, idx) - sketch.sketchOpsScrollTop} r="4" data-tip="Drag a param here → z"
                    onpointerup={(ev) => wire.endWireOnSketchCoord(ev, sid, idx, 'z')}/>
                {:else if op.op === 'fillet' || op.op === 'chamfer'}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class={`ge-sock in poly-coord${(op.op === 'fillet' ? op.radius : op.dist)?.kind === 'param' ? ' wired' : ''}`}
                    cx="0" cy={sketchSockVal(sn, idx) - sketch.sketchOpsScrollTop} r="4" data-tip="Drag a param here"
                    onpointerup={(ev) => wire.endWireOnSketchCoord(ev, sid, idx, op.op === 'fillet' ? 'radius' : 'dist')}/>
                {/if}
              {/if}
            {/each}
            <!-- Bottom-right resize grip — drag to set a fixed card size
                 (the ops list then scrolls when ops overflow). -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <path class="ge-sketch-resize-grip" d={`M ${scW - 3} ${scH - 14} L ${scW - 3} ${scH - 3} L ${scW - 14} ${scH - 3} Z`}
              onpointerdown={sketch.sketchCardResizeDown} onpointermove={sketch.sketchCardResizeMove} onpointerup={sketch.sketchCardResizeUp}/>
          </g>

          <!-- in-flight preview: param out socket → cursor -->
          {#if wire.from?.kind === 'param-out' && wire.mouse}
            {@const pi = paramNames.indexOf(wire.from.paramName)}
            {#if pi >= 0}
              {@const a = sketch.miniParamSockAbs(pi)}
              <path class="ge-wire in-flight" d={miniBez(a.x, a.y, wire.mouse.x, wire.mouse.y)} pointer-events="none"/>
            {/if}
          {/if}
        </svg>
      {/if}
      <!-- DRAGGABLE top bar — the live corner radius/dist dial or spline
           controls. Floats over the stage; drag the ⣿ handle to reposition.
           Only rendered when a corner or spline is selected — otherwise it
           would show as an empty floating box (just the grip). -->
      {#if sketch.selectedCorner || sketch.selectedSpline}
      <div class="ge-sketch-topbar" style="left: {sketch.sketchBarPos.x}px; top: {sketch.sketchBarPos.y}px">
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <span class="ge-sketch-grip" title="Drag the toolbar"
          onpointerdown={sketch.sketchBarDown} onpointermove={sketch.sketchBarMove} onpointerup={sketch.sketchBarUp}>⣿</span>
        {#if sketch.selectedCorner}
          <div class="ge-stool-sep"></div>
          <span class="ge-sketch-dial">
            <span class="ge-sketch-dial-lbl">{sketch.selectedCorner.kind === 'fillet' ? '◜ radius' : '⊿ dist'}</span>
            {#if sketch.selectedCorner.bound}
              <!-- Param/expr-driven: show the binding + live resolved value;
                   ↩ unties back to a literal you can drag. -->
              <span class="ge-sketch-bound" title="Driven by {sketch.selectedCorner.label}">ƒ {sketch.selectedCorner.label}</span>
              <span class="ge-sketch-resolved">= {Math.round(sketch.selectedCorner.value * 1000) / 1000}</span>
              <button class="ge-sketch-dial-x untie" title="Unbind → literal" onclick={() => sketch.bindCornerParam('__literal__')}>↩</button>
            {:else}
              <input class="ge-sketch-range" type="range" min="0" max={span * 0.5} step={span / 200}
                value={sketch.selectedCorner.value}
                oninput={(e) => sketch.setCornerValue(+(e.currentTarget as HTMLInputElement).value)} />
              <input class="ge-sketch-num" type="number" min="0" step="0.01"
                value={Math.round(sketch.selectedCorner.value * 1000) / 1000}
                onchange={(e) => sketch.setCornerValue(+(e.currentTarget as HTMLInputElement).value)} />
              <span class="ge-sketch-wire-hint">↦ tap a param →</span>
            {/if}
            <button class="ge-sketch-dial-x" title="Remove this corner" onclick={sketch.removeSelectedCorner}>✕</button>
          </span>
        {/if}
        {#if sketch.selectedSpline}
          <div class="ge-stool-sep"></div>
          <span class="ge-sketch-dial">
            <span class="ge-sketch-dial-lbl">∿ spline · {sketch.selectedSpline.pts.length} pt</span>
            <button class="ge-stool" title="Add a through-point (mid-chord)" onclick={sketch.addSplinePt}>+ pt</button>
            <button class="ge-stool" title="Remove the last through-point" disabled={sketch.selectedSpline.pts.length === 0} onclick={sketch.removeSplinePt}>− pt</button>
            <button class="ge-stool" title="Clear both end handles → auto Catmull-Rom tangent" disabled={!sketch.selectedSpline.h0.set && !sketch.selectedSpline.h1.set} onclick={sketch.autoTangentSpline}>auto tangent</button>
          </span>
        {/if}
      </div>
      {/if}
      <!-- Standalone Done tick — pinned top-right, above the canvas/overlay. -->
      <button class="ge-sketch-done-tick" title="Done — back to the graph" onclick={sketch.closeSketchEditor}>✓</button>
      <div class="ge-sketch-hint">
        {#if sketch.sketchTool === 'select'}Drag the violet points to reshape · pick a tool to add ops
        {:else if sketch.sketchTool === 'fillet' || sketch.sketchTool === 'chamfer'}Click a corner to {sketch.sketchTool} it, then use the dial to set the {sketch.sketchTool === 'fillet' ? 'radius' : 'distance'}
        {:else}Click the canvas to add a {sketch.sketchTool}{/if}
      </div>
    </div>
  </div>
{/if}
<style>
  /* ─── node chrome + sockets (mini cards reuse these; from GEP) ─────────── */
  .ge-node-bg { fill: #fff; stroke: #0369a1; stroke-width: 2; cursor: grab; touch-action: none; }
  .ge-node-bg.sketch { fill: #faf5ff; stroke: #9333ea; }
  .ge-node-title { font: 600 12px Arial; fill: #0c4a6e; pointer-events: none; }
  .ge-node-divider { stroke: #e5e7eb; }
  .ge-fo { overflow: visible; }
  .ge-sock { fill: #fff; stroke: #0c4a6e; stroke-width: 2; cursor: crosshair; touch-action: none; }
  @media (pointer: coarse) {
    .ge-sock { transform-box: fill-box; transform-origin: center; transform: scale(1.5); }
  }
  .ge-sock.out { stroke: #15803d; }
  .ge-sock.in.poly-coord { stroke: #c2410c; }
  .ge-sock.in.poly-coord.wired { fill: #ede9fe; stroke: #6d28d9; }
  .ge-sock.out.param { stroke: #d97706; fill: #fef3c7; }
  .ge-sock.out.param:hover { fill: #fde68a; }
  .ge-sock:hover { fill: #fef3c7; }

  /* ─── wires (mini card committed + in-flight) ─────────────────────────── */
  .ge-wire { stroke-width: 2; stroke-linecap: round; fill: none; }
  .ge-wire.param { stroke: #d97706; stroke-dasharray: 2 2; opacity: 0.85; }
  .ge-wire.param.expr { stroke: #b45309; stroke-dasharray: 5 3; opacity: 0.75; }
  .ge-wire.in-flight { stroke: #15803d; stroke-dasharray: 6 4; }

  /* ─── PARAMS mini card + chips (from GEP) ─────────────────────────────── */
  .ge-params-card-bg { fill: #fffbeb; stroke: #d97706; stroke-width: 1.5; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.06)); }
  .ge-params-card-title { font: 700 12px Arial; fill: #78350f; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-params-card-divider { stroke: #fde68a; stroke-width: 1; }
  .ge-params-add-btn { fill: #fcd34d; stroke: #d97706; stroke-width: 1.5; cursor: pointer; transition: fill 0.12s; }
  .ge-params-add-btn:hover { fill: #f59e0b; }
  .ge-params-add-glyph { font: 700 14px Arial; fill: #78350f; user-select: none; }
  .ge-param-chip {
    display: flex; align-items: center;
    height: 100%; box-sizing: border-box;
    padding: 0 4px;
    background: #fef3c7; border: 1px solid #d97706; border-radius: 5px;
    color: #78350f; font: 700 10px ui-monospace, monospace;
    gap: 4px;
  }
  .ge-param-chip .name {
    flex: 1 1 auto; min-width: 0;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    color: #78350f;
  }
  .ge-param-chip .val {
    flex: 0 0 44px;
    width: 44px; padding: 0 3px;
    font: 10px ui-monospace, monospace; color: #92400e; text-align: center;
    background: rgba(255,255,255,0.9); border: 1px solid #fbbf24; border-radius: 3px;
    box-sizing: border-box;
    cursor: ew-resize;
  }
  .ge-param-chip .val:focus { outline: 1px solid #d97706; background: #fff; cursor: text; }

  /* ─── sketch op rows (shared with SketchNodeCard) ─────────────────────── */
  .ge-sketch { font: 11px ui-monospace, monospace; color: #1f2937; display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .ge-sketch-ops { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
  .ge-sketch-vtx { position: relative; box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 1px; padding: 0 2px 0 16px; margin: 0; border: 1px solid #e9d5ff; border-radius: 4px; background: rgba(250,245,255,0.6); }
  /* point-order number, matching the {i+1} label next to each anchor in the 2D stage. */
  .ge-sketch-vidx { position: absolute; left: 1px; top: 50%; transform: translateY(-50%); width: 12px; text-align: center; font: 700 9px ui-monospace, monospace; color: #6d28d9; pointer-events: none; }
  .ge-sketch-vidx.first { color: #15803d; }
  .ge-sketch-vtx.corner { background: rgba(243,232,255,0.85); border-color: #d8b4fe; }
  .ge-sketch-vtx.editing { border-color: #f59e0b; background: rgba(254,243,199,0.7); box-shadow: 0 0 0 1px #f59e0b; }
  .ge-sketch-srow { display: flex; align-items: center; gap: 3px; height: 18px; }
  .ge-sketch-axis { width: 40px; flex: none; font: 700 9px ui-monospace, monospace; color: #7c3aed; text-align: right; white-space: nowrap; }
  button.ge-sketch-axis { border: none; background: none; padding: 0; cursor: pointer; }
  button.ge-sketch-axis:hover { text-decoration: underline; }
  .ge-sketch-axis.rel { color: #ea580c; }   /* relative (Δ) coords */
  .ge-sketch-axis.spline { color: #0891b2; }
  .ge-sketch-axis.corner { color: #0e7490; }      /* fillet */
  .ge-sketch-axis.corner.chamfer { color: #b45309; }
  .ge-sketch-in { width: 100%; min-width: 0; padding: 1px 4px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 2px; box-sizing: border-box; cursor: text; }
  .ge-sketch-in:hover { background: #faf5ff; }
  .ge-sketch-in:focus { outline: 1px solid #7c3aed; background: #fff; }
  .ge-sketch-btn { width: 14px; height: 17px; padding: 0; flex: none; background: #fff; border: 1px solid #d6d3d1; border-radius: 2px; font: 8px Arial; color: #57534e; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .ge-sketch-btn:hover:not(:disabled) { background: #f3e8ff; color: #6b21a8; }
  .ge-sketch-btn:disabled { opacity: 0.35; cursor: default; }
  .ge-sketch-btn.del:hover:not(:disabled) { background: #fee2e2; color: #991b1b; }
  .ge-sketch-foot { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
  .ge-sketch-add { padding: 2px 6px; font: 600 10px Arial; background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 3px; cursor: pointer; }
  .ge-sketch-add:hover { background: #e9d5ff; }
  .ge-sketch-add.repeat { background: #ede9fe; color: #5b21b6; border-color: #a78bfa; }
  .ge-sketch-add.repeat:hover { background: #ddd6fe; }
  .ge-sketch-axis.repeat { color: #7c3aed; width: auto; }
  .ge-sketch-vtx.repeat { background: rgba(237,233,254,0.9); border-color: #c4b5fd; }
  .ge-sketch-rep-hint { flex: 1 1 auto; font: 9px Arial; color: #7c3aed; opacity: 0.75; white-space: nowrap; overflow: hidden; }
  .ge-sketch-fx { width: 16px; height: 17px; padding: 0; flex: none; background: #fff; border: 1px solid #d6d3d1; border-radius: 2px; font: 700 11px serif; color: #57534e; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .ge-sketch-fx:hover { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-sketch-fx.on { background: #ede9fe; color: #5b21b6; border-color: #a78bfa; }

  /* ─── full-tab editor chrome ──────────────────────────────────────────── */
  .ge-sketch-editor { position: absolute; inset: 0; z-index: 60; background: #fbfbfd; display: flex; flex-direction: column; }
  /* TOP horizontal tool palette. */
  .ge-sketch-vtools { display: flex; flex-direction: row; align-items: center; gap: 4px; padding: 2px 8px; border-bottom: 1px solid #e2e8f0; background: #fff; flex: 0 0 auto; }
  .ge-stool { width: 25px; height: 22px; padding: 0; display: flex; align-items: center; justify-content: center; background: #fff; border: 1px solid #d6d3d1; border-radius: 5px; font: 13px ui-monospace, monospace; color: #57534e; cursor: pointer; }
  .ge-stool:hover { background: #f3e8ff; color: #6b21a8; border-color: #c4b5fd; }
  .ge-stool.on { background: #ede9fe; color: #5b21b6; border-color: #a78bfa; }
  .ge-stool-sep { width: 1px; height: 16px; background: #e2e8f0; margin: 0 3px; }
  /* ⚙ per-axis scale popover (anchored below the gear button). */
  .ge-sk-scale-wrap { position: relative; display: inline-flex; }
  .ge-sk-scale-pop {
    position: absolute; top: calc(100% + 4px); left: 0; z-index: 20;
    display: flex; flex-direction: column; gap: 6px;
    padding: 8px 10px; min-width: 150px;
    background: #fff; border: 1px solid #d8b4fe; border-radius: 8px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.14);
  }
  .ge-sk-scale-hd { font: 700 10px Arial; color: #6b21a8; text-transform: uppercase; letter-spacing: 0.4px; }
  .ge-sk-scale-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .ge-sk-scale-lbl { font: 600 11px ui-monospace, monospace; color: #57534e; }
  .ge-sk-scale-in { width: 64px; padding: 2px 5px; font: 12px ui-monospace, monospace; border: 1px solid #cbd5e1; border-radius: 4px; box-sizing: border-box; }
  .ge-sk-scale-in:focus { outline: 1px solid #7c3aed; }
  .ge-sk-scale-reset { margin-top: 2px; padding: 3px 6px; font: 600 10px Arial; background: #f3e8ff; color: #6b21a8; border: 1px solid #d8b4fe; border-radius: 4px; cursor: pointer; }
  .ge-sk-scale-reset:hover:not(:disabled) { background: #e9d5ff; }
  .ge-sk-scale-reset:disabled { opacity: 0.4; cursor: default; }
  /* DRAGGABLE floating top bar (status + corner dial + Done). */
  .ge-sketch-topbar {
    position: absolute; z-index: 5; display: flex; align-items: center; gap: 6px;
    padding: 5px 8px; background: rgba(255,255,255,0.96); border: 1px solid #e2e8f0;
    border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.12);
  }
  .ge-sketch-grip { cursor: grab; touch-action: none; color: #94a3b8; font-size: 14px; line-height: 1; padding: 0 2px; user-select: none; }
  .ge-sketch-grip:active { cursor: grabbing; }
  .ge-sketch-dial { display: flex; align-items: center; gap: 5px; }
  .ge-sketch-dial-lbl { font: 600 11px ui-monospace, monospace; color: #0e7490; white-space: nowrap; }
  .ge-sketch-range { width: 110px; accent-color: #0891b2; touch-action: none; }
  .ge-sketch-num { width: 56px; font: 12px ui-monospace, monospace; padding: 2px 4px; border: 1px solid #cbd5e1; border-radius: 4px; }
  .ge-sketch-wire-hint { font: 11px Arial; color: #b45309; white-space: nowrap; }
  .ge-sketch-bound { font: 600 11px ui-monospace, monospace; color: #92400e; background: #fef3c7; border: 1px solid #f59e0b; border-radius: 9999px; padding: 1px 8px; }
  .ge-sketch-resolved { font: 11px ui-monospace, monospace; color: #64748b; }
  .ge-sketch-dial-x { width: 20px; height: 20px; padding: 0; background: #fff; border: 1px solid #fca5a5; border-radius: 4px; color: #b91c1c; cursor: pointer; font: 11px Arial; }
  .ge-sketch-dial-x:hover { background: #fee2e2; }
  .ge-sketch-dial-x.untie { border-color: #fbbf24; color: #b45309; }
  .ge-sketch-dial-x.untie:hover { background: #fef3c7; }
  /* S.2: floating cards overlay — pointer-events:none so the 2D canvas stays drawable. */
  .ge-sketch-cards { position: absolute; inset: 0; width: 100%; height: 100%; display: block; pointer-events: none; touch-action: none; }
  .ge-sketch-cards g.card { pointer-events: auto; }
  .ge-sketch-card-title { fill: transparent; cursor: grab; }
  .ge-sketch-card-title:active { cursor: grabbing; }
  .ge-sketch-mini-empty { font: 11px Arial; fill: #94a3b8; }
  .ge-sketch-stage { flex: 1 1 auto; min-height: 0; position: relative; display: flex; }
  .ge-sketch-svg { flex: 1 1 auto; width: 100%; height: 100%;
    background:
      linear-gradient(#eef2f6 1px, transparent 1px) 0 0 / 24px 24px,
      linear-gradient(90deg, #eef2f6 1px, transparent 1px) 0 0 / 24px 24px, #fbfbfd; }
  .ge-sketch-svg { cursor: grab; touch-action: none; }
  .ge-sketch-svg.tool { cursor: crosshair; }
  .ge-sketch-svg.panning { cursor: grabbing; }
  .ge-sk-anchor { cursor: grab; touch-action: none; }
  .ge-sk-anchor:hover { stroke: #fde68a; }
  .ge-sk-anchor.locked { cursor: not-allowed; opacity: 0.6; }
  .ge-sk-spt { cursor: grab; touch-action: none; }
  .ge-sk-spt:hover { stroke: #fde68a; }
  .ge-sk-spt-del-hit { fill: #dc2626; stroke: #fff; stroke-width: 0.4px; cursor: pointer; touch-action: none; }
  .ge-sk-spt-del-hit:hover { fill: #b91c1c; }
  .ge-sketch-resize-grip { fill: #c4b5fd; cursor: nwse-resize; touch-action: none; }
  .ge-sketch-resize-grip:hover { fill: #a78bfa; }
  .ge-sketch-done-tick {
    position: absolute; top: 10px; right: 14px; z-index: 10;
    width: 34px; height: 34px; padding: 0; display: flex; align-items: center; justify-content: center;
    background: #ecfdf5; color: #15803d; border: 1px solid #6ee7b7; border-radius: 9999px;
    font: 700 17px Arial; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,0.14);
  }
  .ge-sketch-done-tick:hover { background: #d1fae5; border-color: #34d399; }
  .ge-sketch-hint { position: absolute; left: 12px; bottom: 10px; font: 11px Arial; color: #6b7280; background: rgba(255,255,255,0.85); padding: 3px 8px; border-radius: 4px; pointer-events: none; }
</style>
