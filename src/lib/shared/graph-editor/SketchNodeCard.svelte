<!--
  SketchNodeCard.svelte — the {:else if n.type === 'sketch'} render arm of the
  graph-editor node canvas (modularize K.65, Phase E Step 2, block 1).

  SVG content rendered INSIDE the per-node <g transform> in GEP's node-render
  if-chain: the node bg/title/✎/× chrome, the ge-sketch ops list (line/spline
  coord sub-rows + fillet/chamfer corner rows) in a foreignObject, the per-coord
  wire INPUT sockets on the left edge, and the output socket on the right.

  All sketch state + handlers live on the ONE per-pane `sketch` (SketchState)
  instance, shared with SketchEditorPane and the shell-owned coord ƒ-popover —
  this card only SETS sketch.sketchExprPop (the popover renders in the shell).
  Graph mutations route through setGraph(...) so the parent owns `graph`.

  CSS for the .ge-sketch* row classes is duplicated here (also in
  SketchEditorPane's mini card) per the Phase E plan; the .ge-node-*/.ge-sock/.ge-fo
  chrome classes are duplicated from GEP so Svelte's scoped CSS applies.
-->
<script lang="ts">
  import { sketchEntryH } from '$lib/cad/sketch-layout';
  import { sketchSockR, sketchSockZ, sketchSockVal } from './geom';
  import { argStr, argFrom } from './args';
  import {
    addSketchOp, setSketchOpField, moveSketchOp, removeSketchOp, addSketchRepeat,
    type Graph,
  } from '$lib/cad/composition-graph';
  import type { SketchState } from './sketch-state.svelte';
  import type { WireState } from './wire-state.svelte';

  let {
    sketch,
    n,
    size,
    graph,
    setGraph,
    wire,
    consumed,
    onNodePointerDown,
    onNodePointerMove,
    onNodePointerUp,
    onDeleteNode,
  }: {
    sketch: SketchState;
    /** the sketch node */
    n: any;
    /** nodeSize(graph, n) — { w, h } */
    size: { w: number; h: number };
    graph: Graph;
    setGraph: (g: Graph) => void;
    wire: WireState;
    /** consumedSet.has(n.id) — wired into a revolve/extrude profile arg */
    consumed: boolean;
    onNodePointerDown: (ev: PointerEvent, id: string) => void;
    onNodePointerMove: (ev: PointerEvent) => void;
    onNodePointerUp: (ev: PointerEvent) => void;
    onDeleteNode: (id: string) => void;
  } = $props();
</script>

<!-- Sketch card (plan M.1) — CAD-operator profile producer:
     line/spline points + fillet/chamfer corner mods compile
     to (r,z) via Maker.js. Output socket wires into a
     revolve/extrude profile arg like a polygon. -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<rect role="button" tabindex="-1" class="ge-node-bg sketch"
  width={size.w} height={size.h} rx="6"
  style="width: {size.w}px; height: {size.h}px"
  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
  onpointermove={onNodePointerMove}
  onpointerup={onNodePointerUp}/>
<text x="10" y="22" class="ge-node-title">✐ sketch{consumed ? ' · 🔒' : ''}</text>
<!-- ✎ open the full-tab sketch editor (plan M.2). -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<text role="button" tabindex="-1" x={size.w - 32} y="22" class="ge-sketch-edit-btn"
  data-tip="Edit in the full-tab sketch editor"
  onpointerdown={(ev) => { ev.stopPropagation(); sketch.openSketchEditor(n.id); }}>✎</text>
<!-- svelte-ignore a11y_no_static_element_interactions -->
<text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
  class:disabled={consumed}
  data-tip={consumed ? 'Wired into a Revolve/Extrude — delete the consumer first.' : 'Delete sketch'}
  onpointerdown={(ev) => { ev.stopPropagation(); if (!consumed) onDeleteNode(n.id); }}>×</text>
<line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
<foreignObject x="6" y="36" width={size.w - 12} height={size.h - 40} class="ge-fo">
  <div class="ge-sketch" xmlns="http://www.w3.org/1999/xhtml">
    <div class="ge-sketch-ops">
      {#each (n.ops as Array<any>) as op, idx (idx)}
        {#if op.op === 'line' || op.op === 'spline'}
          <!-- Two STACKED sub-rows (r over z) — compact + each
               coord has a left-edge wire socket (rendered as SVG
               siblings below) so a param can be wired in. -->
          <div class="ge-sketch-vtx" class:editing={sketch.sketchExprPop?.sid === n.id && sketch.sketchExprPop?.opIdx === idx} style="height: {sketchEntryH(op)}px">
            <div class="ge-sketch-srow">
              <button class="ge-sketch-axis" class:spline={op.op === 'spline'} class:rel={op.mode === 'rel'} title="Toggle absolute / Δ relative (offset from previous point)" onclick={() => sketch.toggleSketchOpMode(n.id, idx, op)}>{sketch.sketchAxisLabel(op, 'r')}</button>
              <input class="ge-sketch-in" type="text" value={argStr(op.r)} title={op.mode === 'rel' ? 'Δr — offset from previous point' : 'r — number or p.param'}
                onchange={(e) => { setGraph(setSketchOpField(graph, n.id, idx, 'r', argFrom((e.target as HTMLInputElement).value))); }}/>
              <button class="ge-sketch-fx" type="button" title="Write/edit an expression for r" class:on={op.r?.kind === 'expr'}
                onclick={(ev) => sketch.openSketchExprPop(ev, n.id, idx, 'r', argStr(op.r))}>ƒ</button>
              <button class="ge-sketch-btn" type="button" title="Move up" disabled={idx === 0}
                onclick={() => { setGraph(moveSketchOp(graph, n.id, idx, -1)); }}>▲</button>
            </div>
            <div class="ge-sketch-srow">
              <button class="ge-sketch-axis" class:spline={op.op === 'spline'} class:rel={op.mode === 'rel'} title="Toggle absolute / Δ relative (offset from previous point)" onclick={() => sketch.toggleSketchOpMode(n.id, idx, op)}>{sketch.sketchAxisLabel(op, 'z')}</button>
              <input class="ge-sketch-in" type="text" value={argStr(op.z)} title={op.mode === 'rel' ? 'Δz — offset from previous point' : 'z'}
                onchange={(e) => { setGraph(setSketchOpField(graph, n.id, idx, 'z', argFrom((e.target as HTMLInputElement).value))); }}/>
              <button class="ge-sketch-fx" type="button" title="Write/edit an expression for z" class:on={op.z?.kind === 'expr'}
                onclick={(ev) => sketch.openSketchExprPop(ev, n.id, idx, 'z', argStr(op.z))}>ƒ</button>
              <button class="ge-sketch-btn" type="button" title="Move down" disabled={idx === n.ops.length - 1}
                onclick={() => { setGraph(moveSketchOp(graph, n.id, idx, 1)); }}>▼</button>
              <button class="ge-sketch-btn del" type="button" title="Remove op" disabled={n.ops.length <= 1}
                onclick={() => { setGraph(removeSketchOp(graph, n.id, idx)); }}>×</button>
            </div>
          </div>
        {:else if op.op === 'repeat-ref'}
          {@const src = graph.nodes[op.sourceId]}
          {@const cnt = (src as any)?.type === 'sketch_repeat' ? argStr((src as any).count) : '?'}
          <!-- Compact repeat-ref summary — the prototype ops live on the
               separate ↻ sketch-repeat card (#805). -->
          <div class="ge-sketch-vtx repeat" style="height: {sketchEntryH(op)}px">
            <div class="ge-sketch-srow">
              <span class="ge-sketch-axis repeat" title="Sketch repeat — edit the prototype on its ↻ card">↻ ×{cnt}</span>
              <span class="ge-sketch-rep-hint">{(src as any)?.type === 'sketch_repeat' ? 'repeat block' : 'missing source'}</span>
              <button class="ge-sketch-btn" type="button" title="Move up" disabled={idx === 0}
                onclick={() => { setGraph(moveSketchOp(graph, n.id, idx, -1)); }}>▲</button>
              <button class="ge-sketch-btn" type="button" title="Move down" disabled={idx === n.ops.length - 1}
                onclick={() => { setGraph(moveSketchOp(graph, n.id, idx, 1)); }}>▼</button>
              <button class="ge-sketch-btn del" type="button" title="Remove repeat" disabled={n.ops.length <= 1}
                onclick={() => { setGraph(removeSketchOp(graph, n.id, idx)); }}>×</button>
            </div>
          </div>
        {:else}
          <div class="ge-sketch-vtx corner" class:editing={sketch.sketchExprPop?.sid === n.id && sketch.sketchExprPop?.opIdx === idx} style="height: {sketchEntryH(op)}px">
            <div class="ge-sketch-srow">
              <span class="ge-sketch-axis corner" class:chamfer={op.op === 'chamfer'} title={op.op === 'fillet' ? 'fillet radius' : 'chamfer distance'}>{op.op === 'fillet' ? 'fillet' : 'chamf'}</span>
              <input class="ge-sketch-in" type="text" value={argStr(op.op === 'fillet' ? op.radius : op.dist)} title={op.op === 'fillet' ? 'fillet radius' : 'chamfer dist'}
                onchange={(e) => { setGraph(setSketchOpField(graph, n.id, idx, op.op === 'fillet' ? 'radius' : 'dist', argFrom((e.target as HTMLInputElement).value))); }}/>
              <button class="ge-sketch-fx" type="button" title="Write/edit an expression" class:on={(op.op === 'fillet' ? op.radius : op.dist)?.kind === 'expr'}
                onclick={(ev) => sketch.openSketchExprPop(ev, n.id, idx, op.op === 'fillet' ? 'radius' : 'dist', argStr(op.op === 'fillet' ? op.radius : op.dist))}>ƒ</button>
              <button class="ge-sketch-btn" type="button" title="Move up" disabled={idx === 0}
                onclick={() => { setGraph(moveSketchOp(graph, n.id, idx, -1)); }}>▲</button>
              <button class="ge-sketch-btn" type="button" title="Move down" disabled={idx === n.ops.length - 1}
                onclick={() => { setGraph(moveSketchOp(graph, n.id, idx, 1)); }}>▼</button>
              <button class="ge-sketch-btn del" type="button" title="Remove op" disabled={n.ops.length <= 1}
                onclick={() => { setGraph(removeSketchOp(graph, n.id, idx)); }}>×</button>
            </div>
          </div>
        {/if}
      {/each}
    </div>
    <div class="ge-sketch-foot">
      <button class="ge-sketch-add" type="button" title="Add a line segment" onclick={() => { setGraph(addSketchOp(graph, n.id, 'line')); }}>+ line</button>
      <button class="ge-sketch-add" type="button" title="Add a Bézier spline" onclick={() => { setGraph(addSketchOp(graph, n.id, 'spline')); }}>+ spline</button>
      <button class="ge-sketch-add" type="button" title="Round the previous corner" onclick={() => { setGraph(addSketchOp(graph, n.id, 'fillet')); }}>+ fillet</button>
      <button class="ge-sketch-add" type="button" title="Bevel the previous corner" onclick={() => { setGraph(addSketchOp(graph, n.id, 'chamfer')); }}>+ chamfer</button>
      <button class="ge-sketch-add repeat" type="button" title="Repeat a run of ops N times (threads / serrations)" onclick={() => { setGraph(addSketchRepeat(graph, n.id).graph); }}>+ repeat</button>
    </div>
  </div>
</foreignObject>
<!-- Per-coord wire sockets (drag a PARAMS output onto one to
     wire p.<name> into that coord). Mirrors the polygon card. -->
{#each (n.ops as Array<any>) as op, idx (idx)}
  {#if op.op === 'line' || op.op === 'spline'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <circle role="button" tabindex="-1" class="ge-sock in poly-coord" cx="0" cy={sketchSockR(n, idx)} r="4"
      class:wired={op.r?.kind === 'param'} data-tip="Drag a param here → r"
      onpointerup={(ev) => wire.endWireOnSketchCoord(ev, n.id, idx, 'r')}/>
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <circle role="button" tabindex="-1" class="ge-sock in poly-coord" cx="0" cy={sketchSockZ(n, idx)} r="4"
      class:wired={op.z?.kind === 'param'} data-tip="Drag a param here → z"
      onpointerup={(ev) => wire.endWireOnSketchCoord(ev, n.id, idx, 'z')}/>
  {:else if op.op === 'fillet' || op.op === 'chamfer'}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <circle role="button" tabindex="-1" class="ge-sock in poly-coord" cx="0" cy={sketchSockVal(n, idx)} r="4"
      class:wired={(op.op === 'fillet' ? op.radius : op.dist)?.kind === 'param'} data-tip="Drag a param here"
      onpointerup={(ev) => wire.endWireOnSketchCoord(ev, n.id, idx, op.op === 'fillet' ? 'radius' : 'dist')}/>
  {/if}
{/each}
<!-- svelte-ignore a11y_no_static_element_interactions -->
<circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
  onpointerdown={(ev) => wire.startWire(ev, n.id)}/>

<style>
  /* ─── node chrome (duplicated from GEP for scoped-CSS) ─────────────────── */
  .ge-node-bg { fill: #fff; stroke: #0369a1; stroke-width: 2; cursor: grab; touch-action: none; }
  .ge-node-bg.sketch { fill: #faf5ff; stroke: #9333ea; }
  .ge-node-title { font: 600 12px Arial; fill: #0c4a6e; pointer-events: none; }
  .ge-node-divider { stroke: #e5e7eb; }
  .ge-node-x { font: 14px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-node-x.disabled { fill: #cbd5e1; cursor: not-allowed; }
  .ge-fo { overflow: visible; }
  .ge-sock { fill: #fff; stroke: #0c4a6e; stroke-width: 2; cursor: crosshair; touch-action: none; }
  @media (pointer: coarse) {
    .ge-sock { transform-box: fill-box; transform-origin: center; transform: scale(1.5); }
  }
  .ge-sock.out { stroke: #15803d; }
  .ge-sock.in.poly-coord { stroke: #c2410c; }
  .ge-sock.in.poly-coord.wired { fill: #ede9fe; stroke: #6d28d9; }
  .ge-sock:hover { fill: #fef3c7; }

  /* ─── sketch op rows (shared with SketchEditorPane's mini card) ───────── */
  .ge-sketch { font: 11px ui-monospace, monospace; color: #1f2937; display: flex; flex-direction: column; height: 100%; min-height: 0; }
  .ge-sketch-ops { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
  .ge-sketch-vtx { box-sizing: border-box; display: flex; flex-direction: column; justify-content: center; gap: 1px; padding: 0 2px 0 4px; margin: 0; border: 1px solid #e9d5ff; border-radius: 4px; background: rgba(250,245,255,0.6); }
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
  .ge-sketch-axis.repeat { color: #7c3aed; width: auto; }   /* ↻ ×N repeat-ref */
  .ge-sketch-vtx.repeat { background: rgba(237,233,254,0.9); border-color: #c4b5fd; }
  .ge-sketch-rep-hint { flex: 1 1 auto; font: 9px Arial; color: #7c3aed; opacity: 0.75; white-space: nowrap; overflow: hidden; }
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
  .ge-sketch-fx { width: 16px; height: 17px; padding: 0; flex: none; background: #fff; border: 1px solid #d6d3d1; border-radius: 2px; font: 700 11px serif; color: #57534e; cursor: pointer; display: flex; align-items: center; justify-content: center; }
  .ge-sketch-fx:hover { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-sketch-fx.on { background: #ede9fe; color: #5b21b6; border-color: #a78bfa; }
  /* ✎ open-editor button. */
  .ge-sketch-edit-btn { font: 13px system-ui; fill: #7c3aed; cursor: pointer; }
  .ge-sketch-edit-btn:hover { fill: #5b21b6; }
</style>
