<!--
  /graph-editor — Slices 1+4+5 of the visual composition editor.

  Three-pane layout:
    LEFT (40%)  — SVG graph canvas with Call/Method/Mv/Rot nodes, picker, wires
    MIDDLE(35%) — live 3D Threlte bake
    RIGHT (25%) — live .asm.ts source

  Slices delivered:
    1 (foundation)  — drop one Call, see canvas + bake + source
    4 (CSG)         — drop ⊖ ⊕ ⊗ method nodes; drag-wire from a node's
                       output socket to a method's obj/arg input
    5 (transforms)  — drop mv/rot wrapper nodes; drag-wire to set child;
                       3 xyz inputs on each transform card

  Save: writes <exemplar>.asm.ts to the volume via /api/primitives/save.

  Per docs/plans/composition-architecture.md.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import {
    newGraph,
    addCall,
    addMethodPlaceholder,
    addMvPlaceholder,
    addRotPlaceholder,
    setMethodInput,
    setTransformChild,
    setTransformAxis,
    setCallArg,
    removeNode,
    setLayout,
    asLiteral,
    asParam,
    addParam,
    removeParam,
    wrapInTransform,
    unwrapTransform,
    inlineTransformOf,
    type Graph,
    type NodeId,
    type CsgOp,
    type MvNode,
    type RotNode,
  } from '$lib/cad/composition-graph';
  import { emitGraph } from '$lib/cad/composition-emit';
  import { bakeGraphPreview } from '$lib/cad/composition-bake';

  let graph = $state<Graph>(newGraph());
  let exemplarId = $state('test_graph_a');
  let saveStatus = $state<string | null>(null);

  let emitted = $derived(emitGraph(graph, { id: exemplarId }));
  let sourceText = $derived(emitted.source);

  let bake = $state<{ ok: boolean; source?: string; bake?: any; message?: string } | 'loading' | null>(null);
  let bakeTimer: ReturnType<typeof setTimeout> | undefined;
  $effect(() => {
    const hasNode = Object.values(graph.nodes).some((n) => n.type !== 'list' || n.children.length > 0);
    if (!hasNode) { bake = null; return; }
    bake = 'loading';
    clearTimeout(bakeTimer);
    bakeTimer = setTimeout(async () => {
      const r = await bakeGraphPreview(graph, { id: exemplarId });
      bake = { ok: r.ok, source: emitted.source, bake: r, message: r.message as string | undefined };
    }, 250);
  });

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
  let panning = false; let panStart = { x: 0, y: 0 }; let panOrig = { x: 0, y: 0 };
  function onCanvasPointerDown(ev: PointerEvent) {
    if (ev.button === 1 || ev.shiftKey) {
      panning = true; panStart = { x: ev.clientX, y: ev.clientY }; panOrig = { ...pan };
      canvasEl?.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    }
  }
  function onCanvasPointerMove(ev: PointerEvent) {
    if (panning) {
      pan = { x: panOrig.x + (ev.clientX - panStart.x), y: panOrig.y + (ev.clientY - panStart.y) };
    }
    if (wireFrom) {
      const pt = clientToGraph(ev.clientX, ev.clientY);
      wireMouse = pt;
    }
  }
  function onCanvasPointerUp(ev: PointerEvent) {
    if (panning) { panning = false; canvasEl?.releasePointerCapture(ev.pointerId); }
    // If a wire-drag was in flight and we're releasing over empty canvas, cancel.
    if (wireFrom) { wireFrom = null; wireMouse = null; }
  }
  function onCanvasWheel(ev: WheelEvent) {
    ev.preventDefault();
    const k = Math.exp(-ev.deltaY * 0.001);
    zoom = Math.max(0.2, Math.min(3, zoom * k));
  }

  // ─── drag-to-move node cards ────────────────────────────────────────────
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

  // ─── drag-to-wire ───────────────────────────────────────────────────────
  // wireFrom is either a node's output socket OR a param's output chip. On
  // release over an input socket, the connection is committed.
  type WireSource =
    | { kind: 'out'; nodeId: NodeId }
    | { kind: 'param-out'; paramName: string };
  let wireFrom = $state<WireSource | null>(null);
  let wireMouse = $state<{ x: number; y: number } | null>(null);
  function clientToGraph(cx: number, cy: number) {
    if (!canvasEl) return { x: cx, y: cy };
    const r = canvasEl.getBoundingClientRect();
    return { x: ((cx - r.left) - pan.x) / zoom, y: ((cy - r.top) - pan.y) / zoom };
  }
  function startWire(ev: PointerEvent, nodeId: NodeId) {
    ev.stopPropagation();
    wireFrom = { kind: 'out', nodeId };
    wireMouse = clientToGraph(ev.clientX, ev.clientY);
  }
  function startParamWire(ev: PointerEvent, paramName: string) {
    ev.stopPropagation();
    wireFrom = { kind: 'param-out', paramName };
    wireMouse = clientToGraph(ev.clientX, ev.clientY);
  }
  function endWireOnInput(ev: PointerEvent, targetId: NodeId, slot: 'obj' | 'arg' | 'child') {
    ev.stopPropagation();
    if (!wireFrom) return;
    // Only node-output wires fit method/transform sockets (those carry shapes).
    if (wireFrom.kind !== 'out' || wireFrom.nodeId === targetId) { wireFrom = null; wireMouse = null; return; }
    if (slot === 'obj' || slot === 'arg') {
      graph = setMethodInput(graph, targetId, slot, wireFrom.nodeId);
    } else {
      graph = setTransformChild(graph, targetId, wireFrom.nodeId);
    }
    wireFrom = null; wireMouse = null;
  }
  function endWireOnCallArg(ev: PointerEvent, callId: NodeId, key: string) {
    ev.stopPropagation();
    if (!wireFrom) return;
    if (wireFrom.kind === 'param-out') {
      graph = setCallArg(graph, callId, key, asParam(wireFrom.paramName));
    }
    wireFrom = null; wireMouse = null;
  }
  function bezier(x1: number, y1: number, x2: number, y2: number): string {
    const dx = Math.max(40, Math.abs(x2 - x1) * 0.4);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  // Socket position helpers — match the node card geometries below.
  // Call card: 200×<auto>; output socket on right edge mid-card.
  // Method card: 180×100; sockets on left (obj at y+30, arg at y+70) + right (output y+50).
  // Mv/Rot card: 200×120; left (child y+40) + right (output y+60).
  function nodeSize(node: any): { w: number; h: number } {
    if (node.type === 'call') {
      const argCount = Object.keys(node.args ?? {}).length;
      return { w: 220, h: Math.max(80, 50 + argCount * 22) };
    }
    if (node.type === 'method') return { w: 180, h: 100 };
    if (node.type === 'mv' || node.type === 'rot') return { w: 200, h: 120 };
    return { w: 180, h: 80 };
  }
  function nodePos(id: NodeId): { x: number; y: number } {
    return graph.layout[id] ?? { x: 0, y: 0 };
  }
  function outputSocketAt(id: NodeId): { x: number; y: number } {
    const node = graph.nodes[id];
    if (!node) return { x: 0, y: 0 };
    const { w, h } = nodeSize(node);
    const p = nodePos(id);
    return { x: p.x + w, y: p.y + h / 2 };
  }
  function inputSocketAt(id: NodeId, slot: 'obj' | 'arg' | 'child'): { x: number; y: number } {
    const p = nodePos(id);
    const node = graph.nodes[id];
    if (!node) return p;
    if (slot === 'obj')  return { x: p.x, y: p.y + 30 };
    if (slot === 'arg')  return { x: p.x, y: p.y + 70 };
    /* child */          return { x: p.x, y: p.y + 50 };
  }

  // ─── picker — drops Calls, CSG ops, transforms ──────────────────────────
  let pickerOpen = $state(false);
  let pickerSrcs = $state<string[]>([]);
  let pickerFilter = $state('');
  async function openPicker() {
    pickerOpen = true;
    if (pickerSrcs.length === 0) {
      try {
        const r = await fetch('/api/primitives/list');
        const d = await r.json() as any;
        // completions is an OBJECT keyed by family ({drill_pipe: [...], packers: [...]}) —
        // flatten its values; basic + stdlib are flat arrays of {id, …}.
        const basicItems = Array.isArray(d.basic) ? d.basic : [];
        const stdlibItems = Array.isArray(d.stdlib) ? d.stdlib : [];
        const completionItems: any[] = d.completions && typeof d.completions === 'object'
          ? (Object.values(d.completions) as any[][]).flat()
          : [];
        const all = [...basicItems, ...stdlibItems, ...completionItems];
        pickerSrcs = [...new Set(all.map((p: any) => p.id).filter(Boolean))].sort();
      } catch { /* fall through */ }
    }
  }
  function closePicker() { pickerOpen = false; pickerFilter = ''; }
  async function dropCall(src: string) {
    closePicker();
    let args: Record<string, any> = {};
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`);
      const d = await r.json() as any;
      for (const [k, p] of Object.entries((d.params ?? {}) as Record<string, any>)) {
        args[k] = asLiteral(p.default ?? 0);
      }
    } catch { /* leave args empty */ }
    const result = addCall(graph, src, args);
    graph = result.graph;
  }
  function dropCsg(op: CsgOp) { closePicker(); graph = addMethodPlaceholder(graph, op).graph; }
  function dropMv()  { closePicker(); graph = addMvPlaceholder(graph).graph; }
  function dropRot() { closePicker(); graph = addRotPlaceholder(graph).graph; }

  function deleteNode(id: string) { graph = removeNode(graph, id); }
  function onArgEdit(id: string, key: string, value: number) {
    graph = setCallArg(graph, id, key, asLiteral(value));
  }
  function onTransformAxis(id: string, axis: 0 | 1 | 2, value: number) {
    graph = setTransformAxis(graph, id, axis, value);
  }
  function resetGraph() { graph = newGraph(); }

  // ─── inline transforms on Call cards ────────────────────────────────────
  function toggleInlineTransform(callId: NodeId, kind: 'mv' | 'rot') {
    const existing = inlineTransformOf(graph, callId, kind);
    if (existing) {
      graph = unwrapTransform(graph, existing);
    } else {
      graph = wrapInTransform(graph, callId, kind).graph;
    }
  }
  /** Inline wrappers should NOT render on the main canvas — their xyz inputs
   *  surface inside their child's Call card instead. */
  function isInlineWrapper(nodeId: NodeId): boolean {
    const n = graph.nodes[nodeId];
    if (!n || (n.type !== 'mv' && n.type !== 'rot')) return false;
    const childId = (n as MvNode | RotNode).child;
    if (!childId) return false;
    const child = graph.nodes[childId];
    return child?.type === 'call' && inlineTransformOf(graph, childId, n.type) === nodeId;
  }

  // ─── assembly-level params (Slice 3 first cut) ──────────────────────────
  let newParamName = $state('');
  let newParamDefault = $state(0);
  let addParamPop = $state<{ x: number; y: number } | null>(null);
  function openAddParamPop(ev: PointerEvent) { addParamPop = { x: ev.clientX, y: ev.clientY }; }
  function closeAddParamPop() { addParamPop = null; }
  function onAddParam() {
    const name = newParamName.trim();
    if (!name) return;
    graph = addParam(graph, name, { default: newParamDefault, step: 0.05 });
    newParamName = ''; newParamDefault = 0;
    addParamPop = null;
  }
  function onRemoveParam(name: string) {
    const r = removeParam(graph, name);
    if (r.orphans.length > 0) {
      // Surface to the user — the editor refuses, expects them to unwire first.
      alert(`Can't remove ${name}: ${r.orphans.length} call arg${r.orphans.length === 1 ? '' : 's'} still wired to it. Unwire first.`);
      return;
    }
    graph = r.graph;
  }
  /** Wire popover state — when the user clicks an arg's wire icon, this opens
   *  a small menu with param choices. */
  let wirePop = $state<{ callId: NodeId; key: string; x: number; y: number } | null>(null);
  function openWirePop(ev: MouseEvent, callId: NodeId, key: string) {
    ev.stopPropagation();
    wirePop = { callId, key, x: ev.clientX, y: ev.clientY };
  }
  function closeWirePop() { wirePop = null; }
  function wireArgToParam(callId: NodeId, key: string, paramName: string) {
    graph = setCallArg(graph, callId, key, asParam(paramName));
    wirePop = null;
  }
  function unwireArgToLiteral(callId: NodeId, key: string) {
    const node = graph.nodes[callId];
    if (!node || node.type !== 'call') return;
    const cur = (node as any).args[key];
    const literal = cur?.kind === 'literal' ? cur.value : (graph.params[cur?.param]?.default ?? 0);
    graph = setCallArg(graph, callId, key, asLiteral(typeof literal === 'number' ? literal : 0));
    wirePop = null;
  }

  // ─── Save ─────────────────────────────────────────────────────────────
  let saveBusy = $state(false);
  async function saveGraph() {
    if (saveBusy) return;
    saveBusy = true;
    saveStatus = `saving ${exemplarId}…`;
    try {
      const r = await fetch('/api/primitives/save', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          id: exemplarId,
          source: emitted.source,
          kind: 'asm',
          dir: 'basic',
        }),
      });
      if (r.ok) {
        saveStatus = `✓ ${exemplarId} saved to basic/`;
      } else {
        saveStatus = `✗ save ${r.status}: ${(await r.text()).slice(0, 160)}`;
      }
    } catch (e: any) {
      saveStatus = `✗ ${e?.message ?? e}`;
    } finally {
      saveBusy = false;
    }
  }

  // Derived view-helpers.
  let allNodes = $derived(Object.values(graph.nodes).filter((n) => n.type !== 'list' && !isInlineWrapper(n.id)));
  let paramEntries = $derived(Object.entries(graph.params));
  let filteredSrcs = $derived.by(() => {
    const q = pickerFilter.trim().toLowerCase();
    if (!q) return pickerSrcs;
    return pickerSrcs.filter((s) => s.toLowerCase().includes(q));
  });
</script>

<svelte:head><title>Graph editor · CAD Train</title></svelte:head>

<div class="ge-root">
  <header class="ge-bar">
    <h1>Graph editor</h1>
    <input class="ge-id" type="text" bind:value={exemplarId} placeholder="exemplar id" />
    <button class="ge-btn" type="button" onclick={openPicker}>+ Drop</button>
    <button class="ge-btn save" type="button" disabled={saveBusy} onclick={saveGraph}>{saveBusy ? '…' : '💾 Save'}</button>
    <button class="ge-btn ghost" type="button" onclick={resetGraph}>Reset</button>
    {#if saveStatus}<span class="ge-save-stat">{saveStatus}</span>{/if}
    <span class="ge-stat">{allNodes.length} node{allNodes.length === 1 ? '' : 's'} · z {zoom.toFixed(2)}</span>
  </header>

  <main class="ge-grid">
    <!-- LEFT — graph canvas -->
    <section class="ge-canvas-pane">
      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
      <svg
        bind:this={canvasEl}
        class="ge-canvas"
        class:dragging={!!dragging || !!wireFrom}
        xmlns="http://www.w3.org/2000/svg"
        role="application"
        aria-label="Graph canvas"
        onpointerdown={onCanvasPointerDown}
        onpointermove={onCanvasPointerMove}
        onpointerup={onCanvasPointerUp}
        onwheel={onCanvasWheel}
      >
        <g transform="translate({pan.x},{pan.y}) scale({zoom})">
          <defs>
            <pattern id="ge-grid" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
              <path d="M40 0 L0 0 0 40" fill="none" stroke="#e5e7eb" stroke-width="0.5"/>
            </pattern>
          </defs>
          <rect x="-2000" y="-2000" width="4000" height="4000" fill="url(#ge-grid)"/>

          <!-- PARAM CHIPS — render each meta.params row as a small chip at
               the top of the canvas with an output socket + ×-delete + a
               trailing + button to add a new param. -->
          {#each paramEntries as [name, p], i (name)}
            {@const px = 40 + i * 150}
            {@const py = 10}
            <g class="ge-param-card" transform="translate({px},{py})">
              <rect class="ge-param-card-bg" width="130" height="40" rx="20"/>
              <text x="58" y="18" class="ge-param-card-name" text-anchor="middle">p.{name}</text>
              <text x="58" y="32" class="ge-param-card-val" text-anchor="middle">{(p as any).default}{(p as any).unit ?? ''}</text>
              <!-- × delete on the chip -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <text role="button" tabindex="-1" class="ge-param-card-x" x="116" y="14"
                onpointerdown={(ev) => { ev.stopPropagation(); onRemoveParam(name); }}>×</text>
              <!-- output socket for drag-to-wire -->
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <circle role="button" tabindex="-1" class="ge-sock out param" cx="130" cy="20" r="6"
                onpointerdown={(ev) => startParamWire(ev, name)}/>
            </g>
          {/each}
          <!-- + add-param button at the end of the chip row -->
          <g class="ge-param-add-card" transform="translate({40 + paramEntries.length * 150},{10})">
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <rect role="button" tabindex="-1" class="ge-param-add-bg" width="60" height="40" rx="20"
              onpointerdown={(ev) => { ev.stopPropagation(); openAddParamPop(ev); }}/>
            <text x="30" y="26" class="ge-param-add-glyph" text-anchor="middle" pointer-events="none">+ param</text>
          </g>
          {#if paramEntries.length === 0}
            <text x="120" y="35" class="ge-canvas-hint">← drop an outer dial here; drag its socket onto an arg.</text>
          {/if}

          <!-- PARAM WIRES — for every Call.args[k].kind === 'param', draw a
               bezier from the param chip's output socket to the Call's arg
               input socket. -->
          {#each allNodes as n (n.id)}
            {#if n.type === 'call'}
              {#each Object.entries((n as any).args ?? {}) as [k, v], argIdx (k)}
                {#if (v as any).kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === (v as any).param)}
                  {#if pIdx >= 0}
                    {@const psx = 40 + pIdx * 150 + 130}
                    {@const psy = 10 + 20}
                    {@const pos = nodePos(n.id)}
                    {@const argY = pos.y + 36 + 14 + argIdx * 22}
                    <path class="ge-wire param" d={bezier(psx, psy, pos.x, argY)} fill="none"/>
                  {/if}
                {/if}
              {/each}
            {/if}
          {/each}

          <!-- WIRES: render method.obj/arg + transform.child as bezier paths. -->
          {#each allNodes as n (n.id)}
            {#if n.type === 'method'}
              {#if (n as any).obj && graph.nodes[(n as any).obj]}
                {@const src = outputSocketAt((n as any).obj)}
                {@const tgt = inputSocketAt(n.id, 'obj')}
                <path class="ge-wire obj" d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
              {#if (n as any).arg && graph.nodes[(n as any).arg]}
                {@const src = outputSocketAt((n as any).arg)}
                {@const tgt = inputSocketAt(n.id, 'arg')}
                <path class="ge-wire arg" d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {:else if n.type === 'mv' || n.type === 'rot'}
              {#if (n as any).child && graph.nodes[(n as any).child]}
                {@const src = outputSocketAt((n as any).child)}
                {@const tgt = inputSocketAt(n.id, 'child')}
                <path class="ge-wire child" d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
              {/if}
            {/if}
          {/each}

          <!-- In-flight wire being dragged -->
          {#if wireFrom && wireMouse}
            {@const src = outputSocketAt(wireFrom.nodeId)}
            <path class="ge-wire in-flight" d={bezier(src.x, src.y, wireMouse.x, wireMouse.y)} fill="none"/>
          {/if}

          <!-- NODE CARDS -->
          {#each allNodes as n (n.id)}
            {@const pos = nodePos(n.id)}
            {@const size = nodeSize(n)}
            <g transform="translate({pos.x},{pos.y})" class="ge-node">
              {#if n.type === 'call'}
                {@const call = n as any}
                {@const inlineMv  = inlineTransformOf(graph, n.id, 'mv')}
                {@const inlineRot = inlineTransformOf(graph, n.id, 'rot')}
                {@const mvNode    = inlineMv  ? (graph.nodes[inlineMv]  as MvNode)  : null}
                {@const rotNode   = inlineRot ? (graph.nodes[inlineRot] as RotNode) : null}
                {@const cardH     = size.h + (inlineMv ? 80 : 0) + (inlineRot ? 80 : 0)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg call" width={size.w} height={cardH} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <text x="10" y="22" class="ge-node-title">{call.alias} · {call.src}</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 56} y="22" class="ge-xform-btn" class:on={!!inlineMv}
                  onpointerdown={(ev) => { ev.stopPropagation(); toggleInlineTransform(n.id, 'mv'); }}>⇄</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 38} y="22" class="ge-xform-btn" class:on={!!inlineRot}
                  onpointerdown={(ev) => { ev.stopPropagation(); toggleInlineTransform(n.id, 'rot'); }}>↻</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <foreignObject x="6" y="36" width={size.w - 12} height={size.h - 40} class="ge-fo">
                  <div class="ge-args" xmlns="http://www.w3.org/1999/xhtml">
                    {#each Object.entries(call.args ?? {}) as [k, v] (k)}
                      <div class="ge-arg-row">
                        <button class="ge-arg-key wire-btn" type="button" title="Wire to outer param"
                          onclick={(ev) => openWirePop(ev, n.id, k)}>{k}</button>
                        {#if (v as any).kind === 'literal'}
                          <input class="ge-arg-input" type="number" step="0.05"
                            value={(v as any).value}
                            oninput={(e) => onArgEdit(n.id, k, Number((e.target as HTMLInputElement).value))}
                          />
                        {:else if (v as any).kind === 'param'}
                          <span class="ge-arg-pchip" title="Wired to param">
                            p.{(v as any).param}
                            <button class="ge-arg-pchip-x" type="button"
                              onclick={() => unwireArgToLiteral(n.id, k)}>×</button>
                          </span>
                        {:else}
                          <span class="ge-arg-pchip ƒ">ƒ {(v as any).expr}</span>
                        {/if}
                      </div>
                    {/each}
                  </div>
                </foreignObject>
                {#if mvNode}
                  <foreignObject x="6" y={size.h + 4} width={size.w - 12} height="72">
                    <div class="ge-inline-xform mv" xmlns="http://www.w3.org/1999/xhtml">
                      <div class="ge-inline-label">⇄ mv</div>
                      {#each ['x','y','z'] as axis, i (axis)}
                        <div class="ge-arg-row tight">
                          <span class="ge-arg-key">{axis}</span>
                          <input class="ge-arg-input" type="number" step="0.5"
                            value={(mvNode.offset[i] as any).kind === 'literal' ? (mvNode.offset[i] as any).value : 0}
                            oninput={(e) => onTransformAxis(inlineMv!, i as 0|1|2, Number((e.target as HTMLInputElement).value))}
                          />
                        </div>
                      {/each}
                    </div>
                  </foreignObject>
                {/if}
                {#if rotNode}
                  <foreignObject x="6" y={size.h + 4 + (inlineMv ? 80 : 0)} width={size.w - 12} height="72">
                    <div class="ge-inline-xform rot" xmlns="http://www.w3.org/1999/xhtml">
                      <div class="ge-inline-label">↻ rot</div>
                      {#each ['rx','ry','rz'] as axis, i (axis)}
                        <div class="ge-arg-row tight">
                          <span class="ge-arg-key">{axis}</span>
                          <input class="ge-arg-input" type="number" step="1"
                            value={(rotNode.rot[i] as any).kind === 'literal' ? (rotNode.rot[i] as any).value : 0}
                            oninput={(e) => onTransformAxis(inlineRot!, i as 0|1|2, Number((e.target as HTMLInputElement).value))}
                          />
                        </div>
                      {/each}
                    </div>
                  </foreignObject>
                {/if}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={cardH / 2} r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>
                <!-- Per-arg input sockets on the left edge of the Call card.
                     Drag a param chip's output socket onto one to wire. -->
                {#each Object.keys(call.args ?? {}) as ak, ai (ak)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in param"
                    cx="0" cy={36 + 14 + ai * 22} r="5"
                    onpointerup={(ev) => endWireOnCallArg(ev, n.id, ak)}/>
                {/each}

              {:else if n.type === 'method'}
                {@const m = n as any}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg method" width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <text x={size.w / 2} y="48" class="ge-method-op" text-anchor="middle">
                  {m.op === 'subtract' ? '⊖' : m.op === 'add' ? '⊕' : '⊗'}
                </text>
                <text x={size.w / 2} y="72" class="ge-method-name" text-anchor="middle">{m.op}</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="20" class="ge-node-x"
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <!-- Input sockets -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in obj" cx="0" cy="30" r="6"
                  onpointerup={(ev) => endWireOnInput(ev, n.id, 'obj')}/>
                <text x="10" y="34" class="ge-sock-label">obj</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in arg" cx="0" cy="70" r="6"
                  onpointerup={(ev) => endWireOnInput(ev, n.id, 'arg')}/>
                <text x="10" y="74" class="ge-sock-label">arg</text>
                <!-- Output -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>

              {:else if n.type === 'mv' || n.type === 'rot'}
                {@const t = n as any}
                {@const fieldName = n.type === 'mv' ? 'offset' : 'rot'}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg transform" class:rot={n.type === 'rot'}
                  width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <text x="14" y="22" class="ge-node-title">
                  {n.type === 'mv' ? '⇄ mv' : '↻ rot'}
                </text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <foreignObject x="20" y="42" width={size.w - 24} height={size.h - 50}>
                  <div class="ge-xyz" xmlns="http://www.w3.org/1999/xhtml">
                    {#each ['x','y','z'] as axisLabel, i}
                      <div class="ge-arg-row">
                        <span class="ge-arg-key">{n.type === 'mv' ? '' : 'r'}{axisLabel}</span>
                        <input class="ge-arg-input" type="number" step="0.5"
                          value={((t as any)[fieldName][i].kind === 'literal') ? (t as any)[fieldName][i].value : 0}
                          oninput={(e) => onTransformAxis(n.id, i as 0|1|2, Number((e.target as HTMLInputElement).value))}
                        />
                      </div>
                    {/each}
                  </div>
                </foreignObject>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <!-- Input -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy="50" r="6"
                  onpointerup={(ev) => endWireOnInput(ev, n.id, 'child')}/>
                <text x="10" y="54" class="ge-sock-label">child</text>
                <!-- Output -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>
              {/if}
            </g>
          {/each}

          {#if allNodes.length === 0}
            <text x="80" y="100" class="ge-canvas-hint">Click <tspan font-weight="bold">+ Drop</tspan> to add a Call, CSG op, or transform.</text>
          {/if}
        </g>
      </svg>
    </section>

    <!-- MIDDLE — 3D bake -->
    <section class="ge-bake-pane">
      <div class="ge-pane-head">3D bake</div>
      <div class="ge-bake-body">
        {#if !bake}<div class="ge-empty">Drop nodes to bake.</div>
        {:else if bake === 'loading'}<div class="ge-empty">baking…</div>
        {:else if !bake.ok}<div class="ge-err">{bake.message ?? 'bake failed'}</div>
        {:else if PrimitiveDualCanvas}
          <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
            args={Object.values(graph.params).map((p) => p.default)}
            source={bake.source}
            showControls={true} showLabels={false}/>
        {:else}<div class="ge-empty">3D canvas loading…</div>
        {/if}
      </div>
    </section>

    <!-- RIGHT — live emitted source -->
    <section class="ge-source-pane">
      <div class="ge-pane-head">live source · <code>{exemplarId}.asm.ts</code></div>
      <pre class="ge-source">{sourceText}</pre>
    </section>
  </main>

  {#if addParamPop}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeAddParamPop}></div>
    <div class="ge-wire-pop" style="left: {addParamPop.x}px; top: {addParamPop.y}px; min-width: 220px">
      <div class="ge-wire-head">+ new param</div>
      <div class="ge-addparam-row">
        <input class="ge-addparam-input" type="text" placeholder="name (e.g. outerOD)" bind:value={newParamName}
          onkeydown={(e) => { if (e.key === 'Enter') onAddParam(); }}/>
      </div>
      <div class="ge-addparam-row">
        <input class="ge-addparam-input num" type="number" step="0.05" placeholder="default" bind:value={newParamDefault}
          onkeydown={(e) => { if (e.key === 'Enter') onAddParam(); }}/>
      </div>
      <div class="ge-addparam-row">
        <button class="ge-param-add" type="button" onclick={onAddParam}>add</button>
        <button class="ge-param-add ghost" type="button" onclick={closeAddParamPop}>cancel</button>
      </div>
    </div>
  {/if}
  {#if wirePop}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeWirePop}></div>
    <div class="ge-wire-pop" style="left: {wirePop.x}px; top: {wirePop.y}px">
      <div class="ge-wire-head">wire <code>{wirePop.key}</code> to:</div>
      {#if paramEntries.length === 0}
        <div class="ge-empty">no params yet — add one in the strip above</div>
      {/if}
      {#each paramEntries as [name, p] (name)}
        <button class="ge-wire-item" type="button"
          onclick={() => wireArgToParam(wirePop!.callId, wirePop!.key, name)}>p.{name} <span class="ge-wire-default">({(p as any).default})</span></button>
      {/each}
      <button class="ge-wire-item literal" type="button"
        onclick={() => unwireArgToLiteral(wirePop!.callId, wirePop!.key)}>← back to literal</button>
    </div>
  {/if}
  {#if pickerOpen}
    <div class="ge-picker-shade" onclick={closePicker}></div>
    <div class="ge-picker">
      <div class="ge-picker-head">Drop a node</div>
      <div class="ge-picker-section">
        <div class="ge-picker-label">CSG</div>
        <button class="ge-pick csg" type="button" onclick={() => dropCsg('subtract')}>⊖ subtract</button>
        <button class="ge-pick csg" type="button" onclick={() => dropCsg('add')}>⊕ add</button>
        <button class="ge-pick csg" type="button" onclick={() => dropCsg('intersect')}>⊗ intersect</button>
      </div>
      <div class="ge-picker-section">
        <div class="ge-picker-label">Transform</div>
        <button class="ge-pick xform" type="button" onclick={dropMv}>⇄ mv [x, y, z]</button>
        <button class="ge-pick xform" type="button" onclick={dropRot}>↻ rot [rx, ry, rz]</button>
      </div>
      <div class="ge-picker-section">
        <div class="ge-picker-label">Call (primitive)</div>
        <input class="ge-picker-search" type="text" placeholder="filter…" bind:value={pickerFilter}/>
        <div class="ge-picker-list">
          {#each filteredSrcs as src (src)}
            <button class="ge-pick" type="button" onclick={() => dropCall(src)}>{src}</button>
          {/each}
          {#if pickerSrcs.length === 0}<div class="ge-empty">loading…</div>{/if}
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .ge-root { display: grid; grid-template-rows: auto 1fr; height: 100vh; font-family: Arial; color: #1f2937; }
  .ge-bar { display: flex; align-items: center; gap: 10px; padding: 6px 14px; border-bottom: 1px solid #e5e7eb; background: #f8fafc; }
  .ge-bar h1 { font: 700 15px Arial; margin: 0; color: #0c4a6e; }
  .ge-id { padding: 4px 10px; font: 12px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 4px; width: 180px; }
  .ge-btn { padding: 4px 12px; font: 600 12px Arial; background: #0369a1; color: #fff; border: 0; border-radius: 4px; cursor: pointer; }
  .ge-btn:hover { background: #0c4a6e; }
  .ge-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .ge-btn.save { background: #15803d; }
  .ge-btn.save:hover { background: #166534; }
  .ge-btn.ghost { background: #e5e7eb; color: #1f2937; }
  .ge-btn.ghost:hover { background: #d1d5db; }
  .ge-save-stat { font: 11px ui-monospace, monospace; color: #15803d; }
  .ge-stat { font: 11px ui-monospace, monospace; color: #6b7280; margin-left: auto; }
  .ge-grid { display: grid; grid-template-columns: 40% 35% 25%; overflow: hidden; }
  .ge-canvas-pane { border-right: 1px solid #e5e7eb; overflow: hidden; position: relative; }
  /* + param button + delete × on canvas chip + add-param popover rows. */
  .ge-param-card-x { font: 13px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-param-add-bg { fill: #fef3c7; stroke: #d97706; stroke-width: 2; stroke-dasharray: 4 3; cursor: pointer; }
  .ge-param-add-bg:hover { fill: #fde68a; }
  .ge-param-add-glyph { font: 600 10px Arial; fill: #92400e; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-addparam-row { padding: 6px 10px; display: flex; gap: 6px; }
  .ge-addparam-input { flex: 1; padding: 3px 8px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 3px; }
  .ge-addparam-input.num { max-width: 100px; }
  .ge-param-add { padding: 3px 12px; font: 600 11px Arial; background: #fbbf24; color: #78350f; border: 0; border-radius: 3px; cursor: pointer; }
  .ge-param-add:hover { background: #d97706; color: #fff; }
  .ge-param-add.ghost { background: #e5e7eb; color: #1f2937; }
  .ge-param-add.ghost:hover { background: #d1d5db; }

  .ge-canvas { width: 100%; height: 100%; background: #fafaf9; cursor: grab; touch-action: none; }
  .ge-canvas.dragging { cursor: grabbing; }

  .ge-node-bg { fill: #fff; stroke: #0369a1; stroke-width: 2; cursor: grab; }
  .ge-node-bg.method { fill: #fef3c7; stroke: #d97706; stroke-width: 2; }
  .ge-node-bg.transform { fill: #ede9fe; stroke: #6d28d9; stroke-width: 2; }
  .ge-node-bg.transform.rot { fill: #fce7f3; stroke: #be185d; }
  .ge-node-title { font: 600 12px Arial; fill: #0c4a6e; pointer-events: none; }
  .ge-node-divider { stroke: #e5e7eb; }
  .ge-node-x { font: 14px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-method-op { font: 900 36px Arial; fill: #92400e; pointer-events: none; }
  .ge-method-name { font: 11px Arial; fill: #92400e; text-transform: uppercase; letter-spacing: 0.5px; pointer-events: none; }
  .ge-fo { overflow: visible; }
  .ge-args, .ge-xyz { font: 11px Arial; color: #1f2937; line-height: 1.5; }
  .ge-arg-row { display: grid; grid-template-columns: 70px 1fr; gap: 4px; align-items: center; padding: 1px 0; }
  .ge-arg-key { font: 11px ui-monospace, monospace; color: #6b7280; }
  .ge-arg-input { padding: 1px 4px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 2px; width: 100%; }
  .ge-arg-pchip { display: inline-flex; align-items: center; gap: 2px; padding: 1px 4px 1px 6px; font: 600 10px ui-monospace, monospace; background: #fef3c7; color: #78350f; border: 1px solid #fbbf24; border-radius: 9999px; }
  .ge-arg-pchip.ƒ { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-pchip-x { background: transparent; border: 0; font: 11px Arial; color: #b91c1c; cursor: pointer; padding: 0 2px; line-height: 1; }
  .ge-arg-key.wire-btn { background: transparent; border: 0; padding: 1px 4px; font: 11px ui-monospace, monospace; color: #6b7280; cursor: pointer; text-align: left; border-radius: 2px; }
  .ge-arg-key.wire-btn:hover { background: #fef3c7; color: #78350f; }
  .ge-xform-btn { font: 13px Arial; fill: #6b7280; cursor: pointer; user-select: none; }
  .ge-xform-btn:hover { fill: #6d28d9; }
  .ge-xform-btn.on { fill: #6d28d9; font-weight: bold; }
  .ge-inline-xform { font: 11px Arial; color: #1f2937; line-height: 1.4; padding: 4px 0 0; border-top: 1px dashed #c4b5fd; }
  .ge-inline-xform.mv  { color: #5b21b6; }
  .ge-inline-xform.rot { color: #831843; border-top-color: #f9a8d4; }
  .ge-inline-label { font: 600 10px Arial; color: inherit; text-transform: uppercase; letter-spacing: 0.5px; padding: 0 0 2px; }
  .ge-arg-row.tight { padding: 0; }
  .ge-canvas-hint { font: 13px Arial; fill: #9ca3af; }

  .ge-sock { fill: #fff; stroke: #0c4a6e; stroke-width: 2; cursor: crosshair; }
  .ge-sock.out { stroke: #15803d; }
  .ge-sock.in.obj { stroke: #b91c1c; }
  .ge-sock.in.arg { stroke: #d97706; }
  .ge-sock.in.child { stroke: #6d28d9; }
  .ge-sock:hover { fill: #fef3c7; }
  .ge-sock-label { font: 10px ui-monospace, monospace; fill: #6b7280; pointer-events: none; }

  .ge-wire { stroke-width: 2; stroke-linecap: round; fill: none; }
  .ge-wire.obj { stroke: #b91c1c; }
  .ge-wire.arg { stroke: #d97706; }
  .ge-wire.child { stroke: #6d28d9; }
  .ge-wire.param { stroke: #d97706; stroke-dasharray: 2 2; opacity: 0.85; }
  .ge-wire.in-flight { stroke: #15803d; stroke-dasharray: 6 4; }
  /* Param chips on canvas — small amber rounded rectangles at the top with
     output socket. The HTML strip above stays for adding/removing; these
     mirror the same data for visual wiring. */
  .ge-param-card-bg { fill: #fef3c7; stroke: #d97706; stroke-width: 2; }
  .ge-param-card-name { font: 700 11px ui-monospace, monospace; fill: #78350f; pointer-events: none; }
  .ge-param-card-val { font: 10px ui-monospace, monospace; fill: #92400e; pointer-events: none; }
  .ge-sock.in.param { stroke: #d97706; }
  .ge-sock.out.param { stroke: #d97706; fill: #fef3c7; }
  .ge-sock.in.param:hover, .ge-sock.out.param:hover { fill: #fde68a; }

  .ge-bake-pane, .ge-source-pane { display: grid; grid-template-rows: auto 1fr; overflow: hidden; }
  .ge-pane-head { padding: 6px 12px; font: 600 11px Arial; color: #57534e; text-transform: uppercase; letter-spacing: 0.5px; background: #f5f5f4; border-bottom: 1px solid #e7e5e4; }
  .ge-pane-head code { font: 11px ui-monospace, monospace; color: #0c4a6e; text-transform: none; letter-spacing: 0; }
  .ge-bake-body { overflow: hidden; min-height: 0; }
  .ge-empty { padding: 20px; text-align: center; color: #9ca3af; font: 12px Arial; }
  .ge-err { padding: 20px; color: #b91c1c; font: 12px ui-monospace, monospace; }
  .ge-source { margin: 0; padding: 10px 14px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; background: #fafaf9; overflow: auto; white-space: pre; }
  .ge-source-pane { border-left: 1px solid #e5e7eb; }

  .ge-picker-shade { position: fixed; inset: 0; background: rgba(0,0,0,0.2); z-index: 100; }
  .ge-wire-shade { position: fixed; inset: 0; background: transparent; z-index: 99; }
  .ge-wire-pop { position: fixed; min-width: 200px; background: #fff; border: 1px solid #fbbf24; border-radius: 6px; box-shadow: 0 4px 14px rgba(0,0,0,0.18); padding: 4px 0; z-index: 100; }
  .ge-wire-head { padding: 6px 10px; font: 600 11px Arial; color: #78350f; border-bottom: 1px solid #fef3c7; }
  .ge-wire-head code { font: 11px ui-monospace, monospace; background: #fef3c7; padding: 1px 4px; border-radius: 2px; }
  .ge-wire-item { width: 100%; padding: 5px 12px; background: transparent; border: 0; text-align: left; font: 12px ui-monospace, monospace; color: #78350f; cursor: pointer; display: flex; gap: 8px; align-items: center; }
  .ge-wire-item:hover { background: #fef3c7; }
  .ge-wire-item.literal { color: #6b7280; border-top: 1px solid #f1f5f9; }
  .ge-wire-default { font: 10px ui-monospace, monospace; color: #92400e; }
  .ge-picker {
    position: fixed; top: 60px; left: 16px; width: 340px; max-height: 70vh;
    background: #fff; border: 1px solid #0369a1; border-radius: 6px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.15);
    z-index: 101; overflow-y: auto;
  }
  .ge-picker-head { padding: 8px 12px; font: 600 12px Arial; color: #0c4a6e; border-bottom: 1px solid #e5e7eb; background: #f8fafc; position: sticky; top: 0; }
  .ge-picker-section { padding: 6px 0 8px; border-bottom: 1px solid #f1f5f9; }
  .ge-picker-label { font: 600 10px Arial; color: #92400e; text-transform: uppercase; letter-spacing: 0.6px; padding: 4px 12px; }
  .ge-picker-search { width: calc(100% - 24px); margin: 4px 12px; padding: 3px 8px; font: 12px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 3px; }
  .ge-picker-list { max-height: 220px; overflow-y: auto; }
  .ge-pick { width: 100%; padding: 5px 12px; background: transparent; border: 0; text-align: left; font: 12px ui-monospace, monospace; color: #1f2937; cursor: pointer; }
  .ge-pick:hover { background: #e0f2fe; color: #0c4a6e; }
  .ge-pick.csg:hover { background: #fef3c7; color: #92400e; }
  .ge-pick.xform:hover { background: #ede9fe; color: #5b21b6; }
</style>
