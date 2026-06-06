<!--
  /graph-editor — Slice 1 of the visual composition editor.

  Three-pane layout:
    LEFT (40%)  — SVG graph canvas with NodeCards + a "+ Call" picker
    MIDDLE(35%) — live 3D Threlte bake (PrimitiveDualCanvas)
    RIGHT (25%) — live .asm.ts source from emitGraph(graph)

  The graph lives in Svelte 5 $state; every mutation re-emits + re-bakes.
  No source round-trip: edits go to the graph, the source pane reflects
  what would be written to disk on Save.

  Per docs/plans/composition-architecture.md (Slice 1, 2026-06-06).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    newGraph,
    addCall,
    setCallArg,
    removeNode,
    setLayout,
    asLiteral,
    type Graph,
  } from '$lib/cad/composition-graph';
  import { emitGraph } from '$lib/cad/composition-emit';
  import { bakeGraphPreview } from '$lib/cad/composition-bake';

  // Start with an empty graph; user drops Calls via the picker.
  let graph = $state<Graph>(newGraph());
  let exemplarId = $state('test_graph_a');

  // Live emit — recomputed on every graph mutation.
  let emitted = $derived(emitGraph(graph, { id: exemplarId }));
  let sourceText = $derived(emitted.source);

  // Live bake — re-fetched on every graph change. Debounced 250ms.
  let bake = $state<{ ok: boolean; source?: string; bake?: any; message?: string } | 'loading' | null>(null);
  let bakeTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    // Touch `graph` to register the dep, but also $derived emit (which the
    // bake actually uses). Bake when there's at least one Call.
    const hasCall = Object.values(graph.nodes).some((n) => n.type === 'call');
    if (!hasCall) { bake = null; return; }
    bake = 'loading';
    clearTimeout(bakeTimer);
    bakeTimer = setTimeout(async () => {
      const r = await bakeGraphPreview(graph, { id: exemplarId });
      bake = { ok: r.ok, source: emitted.source, bake: r, message: r.message as string | undefined };
    }, 250);
  });

  // Lazy-load PrimitiveDualCanvas (WebGL / SSR-incompatible).
  let PrimitiveDualCanvas = $state<any>(null);
  onMount(async () => {
    try {
      const mod = await import('$lib/shared/PrimitiveDualCanvas.svelte');
      PrimitiveDualCanvas = mod.default;
    } catch { /* canvas unavailable */ }
  });

  // ─── canvas state — pan + zoom ─────────────────────────────────────────
  let pan = $state({ x: 0, y: 0 });
  let zoom = $state(1);
  let canvasEl: SVGSVGElement | undefined = $state();
  // Pan via middle-mouse / shift-drag on empty space.
  let panning = false; let panStart = { x: 0, y: 0 }; let panOrig = { x: 0, y: 0 };
  function onCanvasPointerDown(ev: PointerEvent) {
    if (ev.button === 1 || ev.shiftKey) {
      panning = true; panStart = { x: ev.clientX, y: ev.clientY }; panOrig = { ...pan };
      canvasEl?.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    }
  }
  function onCanvasPointerMove(ev: PointerEvent) {
    if (!panning) return;
    pan = { x: panOrig.x + (ev.clientX - panStart.x), y: panOrig.y + (ev.clientY - panStart.y) };
  }
  function onCanvasPointerUp(ev: PointerEvent) {
    if (panning) { panning = false; canvasEl?.releasePointerCapture(ev.pointerId); }
  }
  function onCanvasWheel(ev: WheelEvent) {
    ev.preventDefault();
    const k = Math.exp(-ev.deltaY * 0.001);
    zoom = Math.max(0.2, Math.min(3, zoom * k));
  }

  // ─── drag-to-move on individual node cards ─────────────────────────────
  let dragging: string | null = null;
  let dragOrig = { x: 0, y: 0 }; let dragStart = { x: 0, y: 0 };
  function onNodePointerDown(ev: PointerEvent, id: string) {
    if (ev.button !== 0) return;
    dragging = id;
    dragStart = { x: ev.clientX, y: ev.clientY };
    dragOrig = graph.layout[id] ?? { x: 0, y: 0 };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.stopPropagation();
  }
  function onNodePointerMove(ev: PointerEvent) {
    if (!dragging) return;
    const dx = (ev.clientX - dragStart.x) / zoom;
    const dy = (ev.clientY - dragStart.y) / zoom;
    graph = setLayout(graph, dragging, { x: dragOrig.x + dx, y: dragOrig.y + dy });
  }
  function onNodePointerUp(ev: PointerEvent) {
    if (dragging) {
      (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
      dragging = null;
    }
  }

  // ─── picker — drops a new Call ─────────────────────────────────────────
  let pickerOpen = $state(false);
  let pickerCandidates = $state<string[]>([]);
  async function openPicker() {
    pickerOpen = true;
    if (pickerCandidates.length === 0) {
      try {
        const r = await fetch('/api/primitives/list');
        const d = await r.json() as any;
        const all = [...(d.basic ?? []), ...(d.stdlib ?? [])];
        pickerCandidates = all.map((p: any) => p.id).sort();
      } catch { /* fall through with empty list */ }
    }
  }
  async function pickAndDrop(src: string) {
    pickerOpen = false;
    // Fetch defaults from the source endpoint so the Call's args are pre-populated.
    let args: Record<string, any> = {};
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`);
      const d = await r.json() as any;
      const params = d.params ?? {};
      for (const [k, p] of Object.entries(params as Record<string, any>)) {
        args[k] = asLiteral(p.default ?? 0);
      }
    } catch { /* defaults stay empty — function will use ?? defaults */ }
    const result = addCall(graph, src, args);
    graph = result.graph;
  }

  function deleteNode(id: string) { graph = removeNode(graph, id); }

  function onArgEdit(id: string, key: string, value: number) {
    graph = setCallArg(graph, id, key, asLiteral(value));
  }

  // ─── reset ──────────────────────────────────────────────────────────────
  function resetGraph() { graph = newGraph(); }

  // Derived view-helpers.
  let callNodes = $derived(Object.values(graph.nodes).filter((n) => n.type === 'call'));
</script>

<svelte:head>
  <title>Graph editor · CAD Train</title>
</svelte:head>

<div class="ge-root">
  <header class="ge-bar">
    <h1>Graph editor</h1>
    <span class="ge-meta">Slice 1 · visual composition</span>
    <input class="ge-id" type="text" bind:value={exemplarId} placeholder="exemplar id" />
    <button class="ge-btn" type="button" onclick={openPicker}>+ Call</button>
    <button class="ge-btn ghost" type="button" onclick={resetGraph}>Reset</button>
    <span class="ge-stat">{callNodes.length} call{callNodes.length === 1 ? '' : 's'} · zoom {zoom.toFixed(2)}</span>
  </header>

  <main class="ge-grid">
    <!-- LEFT — graph canvas -->
    <section class="ge-canvas-pane">
      <svg
        bind:this={canvasEl}
        class="ge-canvas"
        class:dragging={!!dragging}
        xmlns="http://www.w3.org/2000/svg"
        onpointerdown={onCanvasPointerDown}
        onpointermove={onCanvasPointerMove}
        onpointerup={onCanvasPointerUp}
        onwheel={onCanvasWheel}
      >
        <g transform="translate({pan.x},{pan.y}) scale({zoom})">
          <!-- Faint grid behind the nodes -->
          <defs>
            <pattern id="ge-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0 L0 0 0 40" fill="none" stroke="#e5e7eb" stroke-width="0.5"/>
            </pattern>
          </defs>
          <rect x="-2000" y="-2000" width="4000" height="4000" fill="url(#ge-grid)"/>

          {#each callNodes as call (call.id)}
            {@const pos = graph.layout[call.id] ?? { x: 0, y: 0 }}
            <g transform="translate({pos.x},{pos.y})" class="ge-node">
              <rect class="ge-node-bg" width="200" height="110" rx="6"
                onpointerdown={(ev) => onNodePointerDown(ev, call.id)}
                onpointermove={onNodePointerMove}
                onpointerup={onNodePointerUp}
              />
              <text x="10" y="22" class="ge-node-title">{(call as any).alias} · {(call as any).src}</text>
              <line x1="0" y1="32" x2="200" y2="32" class="ge-node-divider"/>
              <foreignObject x="6" y="36" width="188" height="68" class="ge-fo">
                <div class="ge-node-body" xmlns="http://www.w3.org/1999/xhtml">
                  {#each Object.entries((call as any).args ?? {}).slice(0, 3) as [k, v]}
                    <div class="ge-arg-row">
                      <span class="ge-arg-key">{k}</span>
                      <input class="ge-arg-input" type="number" step="0.05"
                        value={(v as any).kind === 'literal' ? (v as any).value : 0}
                        oninput={(e) => onArgEdit(call.id, k, Number((e.target as HTMLInputElement).value))}
                      />
                    </div>
                  {/each}
                  {#if Object.keys((call as any).args ?? {}).length > 3}
                    <div class="ge-arg-more">+{Object.keys((call as any).args).length - 3} more args …</div>
                  {/if}
                </div>
              </foreignObject>
              <text x="190" y="22" class="ge-node-x" onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(call.id); }}>×</text>
            </g>
          {/each}

          {#if callNodes.length === 0}
            <text x="80" y="100" class="ge-canvas-hint">Click <tspan font-weight="bold">+ Call</tspan> above to drop a primitive into the graph.</text>
          {/if}
        </g>
      </svg>
    </section>

    <!-- MIDDLE — 3D bake -->
    <section class="ge-bake-pane">
      <div class="ge-pane-head">3D bake</div>
      <div class="ge-bake-body">
        {#if !bake}
          <div class="ge-empty">Drop a Call to bake.</div>
        {:else if bake === 'loading'}
          <div class="ge-empty">baking…</div>
        {:else if !bake.ok}
          <div class="ge-err">{bake.message ?? 'bake failed'}</div>
        {:else if PrimitiveDualCanvas}
          <PrimitiveDualCanvas
            id={exemplarId}
            name={exemplarId}
            description=""
            args={Object.values(graph.params).map((p) => p.default)}
            source={bake.source}
            showControls={true}
            showLabels={false}
          />
        {:else}
          <div class="ge-empty">3D canvas loading…</div>
        {/if}
      </div>
    </section>

    <!-- RIGHT — live emitted source -->
    <section class="ge-source-pane">
      <div class="ge-pane-head">live source · <code>{exemplarId}.asm.ts</code></div>
      <pre class="ge-source">{sourceText}</pre>
    </section>
  </main>

  <!-- Picker popover -->
  {#if pickerOpen}
    <div class="ge-picker-shade" onclick={() => (pickerOpen = false)}></div>
    <div class="ge-picker">
      <div class="ge-picker-head">Drop a Call</div>
      <div class="ge-picker-list">
        {#each pickerCandidates as src (src)}
          <button class="ge-pick" type="button" onclick={() => pickAndDrop(src)}>{src}</button>
        {/each}
        {#if pickerCandidates.length === 0}
          <div class="ge-empty">loading list…</div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  .ge-root { display: grid; grid-template-rows: auto 1fr; height: 100vh; font-family: Arial; color: #1f2937; }
  .ge-bar { display: flex; align-items: center; gap: 12px; padding: 8px 16px; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
  .ge-bar h1 { font: 700 16px Arial; margin: 0; color: #0c4a6e; }
  .ge-meta { font: 11px ui-monospace, monospace; color: #6b7280; }
  .ge-id { padding: 4px 10px; font: 12px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 4px; width: 180px; }
  .ge-btn { padding: 4px 12px; font: 600 12px Arial; background: #0369a1; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  .ge-btn:hover { background: #0c4a6e; }
  .ge-btn.ghost { background: #e5e7eb; color: #1f2937; }
  .ge-btn.ghost:hover { background: #d1d5db; }
  .ge-stat { font: 11px ui-monospace, monospace; color: #6b7280; margin-left: auto; }
  .ge-grid { display: grid; grid-template-columns: 40% 35% 25%; overflow: hidden; }
  .ge-canvas-pane { border-right: 1px solid #e5e7eb; overflow: hidden; position: relative; }
  .ge-canvas { width: 100%; height: 100%; background: #fafaf9; cursor: grab; touch-action: none; }
  .ge-canvas.dragging { cursor: grabbing; }
  .ge-node-bg { fill: #fff; stroke: #0369a1; stroke-width: 2; cursor: grab; }
  .ge-node-title { font: 600 12px Arial; fill: #0c4a6e; pointer-events: none; }
  .ge-node-divider { stroke: #e5e7eb; }
  .ge-node-x { font: 14px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-fo { overflow: visible; }
  .ge-node-body { font: 11px Arial; color: #1f2937; line-height: 1.4; }
  .ge-arg-row { display: grid; grid-template-columns: 70px 1fr; gap: 4px; align-items: center; padding: 1px 0; }
  .ge-arg-key { font: 11px ui-monospace, monospace; color: #6b7280; }
  .ge-arg-input { padding: 1px 4px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 2px; width: 100%; }
  .ge-arg-more { font: 10px Arial; color: #9ca3af; padding-top: 2px; }
  .ge-canvas-hint { font: 13px Arial; fill: #9ca3af; }
  .ge-bake-pane, .ge-source-pane { display: grid; grid-template-rows: auto 1fr; overflow: hidden; }
  .ge-pane-head { padding: 6px 12px; font: 600 11px Arial; color: #57534e; text-transform: uppercase; letter-spacing: 0.5px; background: #f5f5f4; border-bottom: 1px solid #e7e5e4; }
  .ge-pane-head code { font: 11px ui-monospace, monospace; color: #0c4a6e; text-transform: none; letter-spacing: 0; }
  .ge-bake-body { overflow: hidden; min-height: 0; }
  .ge-empty { padding: 20px; text-align: center; color: #9ca3af; font: 12px Arial; }
  .ge-err { padding: 20px; color: #b91c1c; font: 12px ui-monospace, monospace; }
  .ge-source { margin: 0; padding: 10px 14px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; background: #fafaf9; overflow: auto; white-space: pre; }
  .ge-source-pane { border-left: 1px solid #e5e7eb; }
  .ge-picker-shade { position: fixed; inset: 0; background: rgba(0,0,0,0.2); z-index: 100; }
  .ge-picker {
    position: fixed; top: 60px; left: 16px; width: 320px; max-height: 60vh;
    background: #fff; border: 1px solid #0369a1; border-radius: 6px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.15);
    z-index: 101; display: grid; grid-template-rows: auto 1fr;
  }
  .ge-picker-head { padding: 8px 12px; font: 600 12px Arial; color: #0c4a6e; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
  .ge-picker-list { overflow-y: auto; padding: 4px 0; }
  .ge-pick { width: 100%; padding: 5px 12px; background: transparent; border: 0; text-align: left; font: 12px ui-monospace, monospace; color: #1f2937; cursor: pointer; }
  .ge-pick:hover { background: #e0f2fe; color: #0c4a6e; }
</style>
