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
    setTransformAxisValue,
    setViewport,
    addStackPlaceholder,
    addRepeatPlaceholder,
    setRepeatChild,
    setRepeatCount,
    appendContainerChild,
    removeContainerChildAt,
    setCallArg,
    removeNode,
    setLayout,
    asLiteral,
    asExpr,
    asParam,
    addParam,
    removeParam,
    setParamSchema,
    wrapInTransform,
    unwrapTransform,
    inlineTransformOf,
    hydrateGraph,
    type Graph,
    type NodeId,
    type CsgOp,
    type MvNode,
    type RotNode,
  } from '$lib/cad/composition-graph';
  import { emitGraph } from '$lib/cad/composition-emit';
  import { bakeGraphPreview } from '$lib/cad/composition-bake';
  import { autoLayoutGraph, forceSeparate } from '$lib/cad/composition-layout';
  import { dragNumber } from '$lib/shared/dragNumber';

  let graph = $state<Graph>(newGraph());
  let exemplarId = $state('test_graph_a');
  let saveStatus = $state<string | null>(null);
  /** Embed mode (`?embed=1`) — when the editor is iframed inside another
   *  surface (e.g. the /vocab Editor tab), hide the global layout nav so
   *  the chrome doesn't double-up. The page's own .ge-bar stays since it
   *  hosts Save / + Drop / id input — the in-context controls. */
  let embed = $state(false);
  /** Drift detection (Phase 11). Per src-name → its meta.params keys
   *  as last seen on the volume. Compared to each Call's args keys; a
   *  mismatch marks the Call as drifted. Refresh syncs the Call's args
   *  back to the expected shape (preserves existing values for shared
   *  keys, fills new keys with the primitive's defaults). */
  let expectedParams = $state<Record<string, string[]>>({});
  let expectedDefaults = $state<Record<string, Record<string, number>>>({});

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
  /** Set when a URL `?id=<name>` is given but the loaded source has no
   *  meta.graph (legacy text-format assembly OR a leaf primitive). The
   *  canvas stays empty + a banner surfaces above the source pane explaining
   *  why. The user can still Save a NEW graph alongside the legacy file —
   *  but we don't fight the user with auto-translation. */
  let legacyLoad = $state<{ id: string; reason: 'no-graph' | 'fetch-failed' } | null>(null);
  onMount(async () => {
    try {
      const mod = await import('$lib/shared/PrimitiveDualCanvas.svelte');
      PrimitiveDualCanvas = mod.default;
    } catch { /* canvas unavailable */ }

    // URL load: `/graph-editor?id=<name>` fetches the part's source from the
    // volume + hydrates meta.graph into the canvas. If the source is missing
    // or has no meta.graph, we surface a banner instead of fabricating state.
    //
    // graph extraction: we look at `data.graph` (preferred — the server
    // extracts it via extractMetaFromSource) BUT fall back to a client-side
    // brace-walking parser on `data.source` so the load path works against
    // a prod endpoint that hasn't been redeployed with the graph field yet.
    try {
      const u = new URL(window.location.href);
      embed = u.searchParams.get('embed') === '1';
      const id = u.searchParams.get('id');
      if (id && /^[a-z_][a-z0-9_]*$/i.test(id)) {
        const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(id)}`);
        if (!r.ok) { legacyLoad = { id, reason: 'fetch-failed' }; exemplarId = id; return; }
        const d = await r.json();
        const graphJson = d.graph ?? extractGraphFromSource(d.source ?? '');
        if (graphJson && typeof graphJson === 'object') {
          graph = hydrateGraph(graphJson);
          // A — auto-layout on first load. When a freshly-translated part
          // (e.g. dt_stand, dt_joint) lands without saved layout entries
          // for its node cards, the visible nodes pile at the default-grid
          // position. Run autoLayoutGraph once so the user arrives at an
          // arranged canvas. Skip when the file HAS saved positions
          // (= the user already arranged + saved; respect their layout).
          const visibleIds = Object.values(graph.nodes)
            .filter((n) => !isInlineWrapper(n.id) && n.id !== graph.root)
            .map((n) => n.id);
          const savedCount = visibleIds.filter((id) => !!graphJson.layout?.[id]).length;
          if (visibleIds.length > 0 && savedCount === 0) {
            graph = autoLayoutGraph(graph);
          }
          // Restore canvas viewport — pan + zoom were captured at save time.
          if (graph.viewport) {
            pan = { ...graph.viewport.pan };
            zoom = graph.viewport.zoom;
          }
          exemplarId = id;
        } else {
          legacyLoad = { id, reason: 'no-graph' };
          exemplarId = id;
          // Banner lives in the source tab — auto-switch so the explanation
          // is visible by default rather than hidden behind the bake tab.
          rightTab = 'source';
        }
      }
    } catch { /* URL parse / network failures are non-fatal */ }
  });

  /** Client-side graph-block extractor — walks balanced braces to isolate
   *  the `graph: {...}` literal inside the meta block, then evals as plain
   *  data via `new Function`. Pure object/array literals → safe.
   *  Returns undefined when the source has no graph block (legacy part). */
  function extractGraphFromSource(src: string): any | undefined {
    if (!src) return undefined;
    const m = /(^|[\s,{])graph\s*:\s*\{/m.exec(src);
    if (!m) return undefined;
    const startBrace = src.indexOf('{', m.index + m[0].length - 1);
    if (startBrace < 0) return undefined;
    let depth = 0;
    let end = -1;
    for (let i = startBrace; i < src.length; i++) {
      const c = src[i];
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return undefined;
    const block = src.slice(startBrace, end + 1);
    try { return new Function(`return (${block});`)(); } catch { return undefined; }
  }

  // ─── canvas state — pan + zoom ─────────────────────────────────────────
  let pan = $state({ x: 0, y: 0 });
  let zoom = $state(1);
  let canvasEl: SVGSVGElement | undefined = $state();
  let panning = false; let panStart = { x: 0, y: 0 }; let panOrig = { x: 0, y: 0 };
  function onCanvasPointerDown(ev: PointerEvent) {
    // Middle button + Shift ALWAYS pan, even over content (power-user handle).
    // Plain left-click pans ONLY when the target is the canvas background —
    // the SVG itself or the grid rect. Any other target (a button, an input,
    // a node body) gets its own handler — pointerdown bubbles up to the
    // canvas but we DON'T capture/pan when the click was meant for a child.
    const isShortcut = ev.button === 1 || ev.shiftKey;
    const target = ev.target as Element;
    const isBackground =
      target === canvasEl ||
      (target.tagName.toLowerCase() === 'rect' && (target.getAttribute('fill') ?? '').includes('grid'));
    if (isShortcut || (ev.button === 0 && isBackground)) {
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
  /** Z-order ordering of node ids — last one wins (renders ON TOP). When the
   *  user clicks a node, we move its id to the END of this array so it pops
   *  to the front. Nodes not in this list render BEFORE the listed ones,
   *  in their natural Object.values order (= insertion order). */
  let zOrder = $state<string[]>([]);
  function bringToFront(id: string) {
    // Filter out the id (idempotent if not in list), then append.
    zOrder = [...zOrder.filter((x) => x !== id), id];
  }
  function onNodePointerDown(ev: PointerEvent, id: string) {
    if (ev.button !== 0) return;
    bringToFront(id);
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

  // ─── param chip positioning ─────────────────────────────────────────────
  // Chips are TACKED to the viewport top-left by default (📌). They render
  // OUTSIDE the pan/zoom transform — so when the user pans the canvas, the
  // chips stay where they are. This avoids the "ugly default-grid" problem
  // when you reload and your chips were arranged carefully on the canvas.
  // Position is purely derived from the chip's index in paramEntries.
  // Params card geometry. Outer card sits at (CARD_X0, CARD_Y0). The title
  // bar takes CARD_TITLE_H; chips fill the body below it. Each chip is
  // PARAM_W × PARAM_H, with PARAM_GAP between rows. The whole card is wide
  // enough to wrap the chip + padding; the socket sits OUTSIDE the card's
  // right edge so it can be drag-wired from.
  const CARD_X0 = 8, CARD_Y0 = 8, CARD_PAD = 8, CARD_TITLE_H = 26;
  const PARAM_W = 124, PARAM_H = 26, PARAM_GAP = 3;
  /** Position of the i-th chip's top-left INSIDE the params card. */
  function paramPos(_name: string, i: number): { x: number; y: number } {
    return {
      x: CARD_X0 + CARD_PAD,
      y: CARD_Y0 + CARD_TITLE_H + CARD_PAD + i * (PARAM_H + PARAM_GAP),
    };
  }
  /** Card outer rect dimensions — derived from chip count. */
  function paramCardSize(n: number): { w: number; h: number } {
    return {
      w: CARD_PAD * 2 + PARAM_W,
      h: CARD_TITLE_H + CARD_PAD * 2 + Math.max(1, n) * PARAM_H + Math.max(0, n - 1) * PARAM_GAP,
    };
  }
  let pcs = $derived(paramCardSize(Object.entries(graph.params ?? {}).length));
  /** Where a param chip's OUTPUT socket sits — in GRAPH space (the wires
   *  render inside the pan/zoom group, so we convert from the chip's fixed
   *  viewport position back into graph coords). The conversion ensures the
   *  wire's endpoint always lands on the visual chip socket regardless of
   *  pan/zoom. The chip's group is translated to paramPos, and the socket
   *  inside that group sits at (PARAM_W + CARD_PAD + 4, PARAM_H / 2).  */
  /** Pull every `p.<ident>` reference out of an expression string. Returns
   *  unique names in first-occurrence order. Used to render wires from the
   *  referenced param chips into the arg slot when arg.kind === 'expr'. */
  function extractParamRefs(expr: string): string[] {
    if (!expr) return [];
    const re = /\bp\.([a-zA-Z_]\w*)\b/g;
    const seen = new Set<string>();
    const out: string[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(expr)) !== null) {
      const name = m[1]!;
      if (!seen.has(name)) { seen.add(name); out.push(name); }
    }
    return out;
  }
  function paramSocketPos(name: string, i: number): { x: number; y: number } {
    const p = paramPos(name, i);
    const vx = p.x + PARAM_W + CARD_PAD + 4;
    const vy = p.y + PARAM_H / 2;
    // viewport → graph: invert outer transform `translate(pan) ∘ scale(zoom)`.
    return { x: (vx - pan.x) / zoom, y: (vy - pan.y) / zoom };
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
  /** Wire a param's output onto one of a mv/rot's three xyz slots. */
  function endWireOnTransformAxis(ev: PointerEvent, transformId: NodeId, axis: 0 | 1 | 2) {
    ev.stopPropagation();
    if (!wireFrom) return;
    if (wireFrom.kind === 'param-out') {
      graph = setTransformAxisValue(graph, transformId, axis, asParam(wireFrom.paramName));
    }
    wireFrom = null; wireMouse = null;
  }
  /** Replace a param-wired transform axis with a literal default. */
  function unwireTransformAxis(transformId: NodeId, axis: 0 | 1 | 2, fallback = 0) {
    const node = graph.nodes[transformId];
    if (!node || (node.type !== 'mv' && node.type !== 'rot')) return;
    const field = node.type === 'mv' ? (node as MvNode).offset : (node as RotNode).rot;
    const cur = field[axis];
    const literal = cur?.kind === 'literal' ? cur.value : (cur?.kind === 'param' ? (graph.params[cur.param]?.default ?? fallback) : fallback);
    graph = setTransformAxis(graph, transformId, axis, typeof literal === 'number' ? literal : fallback);
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
    if (node.type === 'repeat') return { w: 200, h: 100 };
    if (node.type === 'list' || node.type === 'stack' || node.type === 'group') {
      // One row per existing child + one "+ drop here" trailer row
      const slots = (node.children?.length ?? 0) + 1;
      return { w: 200, h: Math.max(60, 40 + slots * 22) };
    }
    return { w: 180, h: 80 };
  }
  /** Input socket Y for the i-th child slot of a container (list/stack/group). */
  function containerSlotY(i: number): number { return 40 + i * 22; }
  /** Drag-wire target — when a wire ends on a container's slot, append the
   *  source node as a child of that container. Idempotent (won't double-add). */
  function endWireOnContainerSlot(ev: PointerEvent, containerId: NodeId) {
    if (!wireFrom) return;
    ev.stopPropagation();
    graph = appendContainerChild(graph, containerId, wireFrom.nodeId);
    wireFrom = null; wireMouse = null;
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
  /** Container slot input socket position — the i-th child slot of a
   *  list/stack/group container's card. Used to draw the visible "piped
   *  into output" wires from each child node's output socket to its slot
   *  in the Output (root list) card. */
  function containerSlotInputAt(containerId: NodeId, i: number): { x: number; y: number } {
    const p = nodePos(containerId);
    return { x: p.x, y: p.y + containerSlotY(i) };
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
    let paramKeys: string[] = [];
    let defaults: Record<string, number> = {};
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`);
      const d = await r.json() as any;
      for (const [k, p] of Object.entries((d.params ?? {}) as Record<string, any>)) {
        args[k] = asLiteral(p.default ?? 0);
        paramKeys.push(k);
        defaults[k] = Number(p.default ?? 0);
      }
    } catch { /* leave args empty */ }
    const result = addCall(graph, src, args);
    graph = result.graph;
    // Cache the expected params for drift detection — same fetch we just did.
    if (paramKeys.length > 0) {
      expectedParams = { ...expectedParams, [src]: paramKeys };
      expectedDefaults = { ...expectedDefaults, [src]: defaults };
    }
  }

  /** Lazy-load expected params for any Call whose src we haven't fetched
   *  yet (URL hydrate, paste-in from clipboard, etc.). Idempotent — only
   *  fetches each src once per session. */
  async function loadExpectedParamsFor(src: string) {
    if (expectedParams[src]) return;
    try {
      const r = await fetch(`/api/primitives/source?name=${encodeURIComponent(src)}`);
      if (!r.ok) return;
      const d = await r.json() as any;
      const keys = Object.keys(d.params ?? {});
      const defaults: Record<string, number> = {};
      for (const [k, p] of Object.entries((d.params ?? {}) as Record<string, any>)) {
        defaults[k] = Number(p.default ?? 0);
      }
      expectedParams = { ...expectedParams, [src]: keys };
      expectedDefaults = { ...expectedDefaults, [src]: defaults };
    } catch { /* skip */ }
  }

  // Whenever the graph changes, fetch expected params for any new src.
  $effect(() => {
    const srcs = new Set<string>();
    for (const n of Object.values(graph.nodes)) {
      if (n.type === 'call') srcs.add(n.src);
    }
    for (const src of srcs) loadExpectedParamsFor(src);
  });

  /** A Call is "drifted" when its args keys differ from the underlying
   *  primitive's CURRENT meta.params keys. Returns false when expected
   *  params haven't been fetched yet (don't false-positive). */
  function isCallDrifted(callId: NodeId): boolean {
    const node = graph.nodes[callId];
    if (!node || node.type !== 'call') return false;
    const expected = expectedParams[node.src];
    if (!expected) return false;
    const have = Object.keys(node.args ?? {}).sort();
    const want = [...expected].sort();
    if (have.length !== want.length) return true;
    return have.some((k, i) => k !== want[i]);
  }

  /** Sync a drifted Call's args back to the primitive's CURRENT params:
   *    • keep existing arg values for keys that survive
   *    • add new keys with the primitive's default values
   *    • drop orphan keys
   *  Wholesale args replacement instead of incremental setCallArg so
   *  the graph diff is one transaction. */
  function refreshCallArgs(callId: NodeId) {
    const node = graph.nodes[callId];
    if (!node || node.type !== 'call') return;
    const expected = expectedParams[node.src];
    const defaults = expectedDefaults[node.src] ?? {};
    if (!expected) return;
    const newArgs: Record<string, any> = {};
    for (const k of expected) {
      const existing = (node.args as any)?.[k];
      newArgs[k] = existing ?? asLiteral(defaults[k] ?? 0);
    }
    // Mutate via setCallArg one key at a time — preserves edge index rebuild.
    let g = graph;
    // First strip orphan keys via a node replacement.
    const updated = { ...node, args: { ...newArgs } } as any;
    g = { ...g, nodes: { ...g.nodes, [callId]: updated } };
    graph = g;
  }
  // ─── Resizable 2-pane divider ──────────────────────────────────────────
  // The editor's main area is split canvas | (bake/source tabs). Default
  // ratio is canvas 70 % / right 30 %, giving the graph 7/10 of the width.
  // Persisted as client state (localStorage) so the user's preferred split
  // survives reloads without bloating meta.graph.
  let splitA = $state(70);          // canvas pane %
  let gridEl: HTMLElement | undefined = $state();
  let splitDragging = false;
  /** Right-pane tab: 3D bake or live source. */
  let rightTab = $state<'bake' | 'source'>('bake');
  onMount(() => {
    try {
      const a = Number(localStorage.getItem('ge-splitA-v2'));
      if (a >= 30 && a <= 85) splitA = a;
      const t = localStorage.getItem('ge-right-tab');
      if (t === 'bake' || t === 'source') rightTab = t;
    } catch { /* localStorage blocked — fine */ }
  });
  function startSplitDrag(ev: PointerEvent) {
    if (ev.button !== 0) return;
    splitDragging = true;
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.preventDefault();
  }
  function onSplitMove(ev: PointerEvent) {
    if (!splitDragging || !gridEl) return;
    const r = gridEl.getBoundingClientRect();
    const pct = ((ev.clientX - r.left) / r.width) * 100;
    splitA = Math.max(30, Math.min(85, pct));
  }
  function endSplitDrag(ev: PointerEvent) {
    if (!splitDragging) return;
    (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
    splitDragging = false;
    try { localStorage.setItem('ge-splitA-v2', String(splitA)); } catch { /* ignore */ }
  }
  function setRightTab(t: 'bake' | 'source') {
    rightTab = t;
    try { localStorage.setItem('ge-right-tab', t); } catch { /* ignore */ }
  }

  function dropCsg(op: CsgOp) { closePicker(); graph = addMethodPlaceholder(graph, op).graph; }
  function dropMv()  { closePicker(); graph = addMvPlaceholder(graph).graph; }
  function dropRot() { closePicker(); graph = addRotPlaceholder(graph).graph; }
  function dropStack(){ closePicker(); graph = addStackPlaceholder(graph).graph; }
  function dropRepeat(){ closePicker(); graph = addRepeatPlaceholder(graph).graph; }
  /** Drag-wire ending on a Repeat node's child slot — set the wire source
   *  as the new child. Idempotent and works for any node type that has an
   *  output socket. */
  function endWireOnRepeatChild(ev: PointerEvent, repeatId: NodeId) {
    if (!wireFrom) return;
    ev.stopPropagation();
    graph = setRepeatChild(graph, repeatId, wireFrom.nodeId);
    wireFrom = null; wireMouse = null;
  }

  function deleteNode(id: string) { graph = removeNode(graph, id); }
  function onArgEdit(id: string, key: string, value: number) {
    graph = setCallArg(graph, id, key, asLiteral(value));
  }
  /** Convert an arg between literal and expression modes (ƒ toggle).
   *  literal → expr seeded with the literal value as text (e.g. 1.5 → "1.5")
   *  expr → literal parsed via parseFloat, falling back to 0 if unparseable
   *  param  → expr seeded as "p.<paramName>" (no-op for the user — they could
   *           click × to fully unwire, but starting from the live binding is
   *           a natural way to compose `p.od / 2`). */
  function toggleArgExprMode(id: string, key: string) {
    const node = graph.nodes[id];
    if (!node || node.type !== 'call') return;
    const cur = (node as any).args[key];
    if (cur?.kind === 'expr') {
      const n = parseFloat(String(cur.expr));
      graph = setCallArg(graph, id, key, asLiteral(isNaN(n) ? 0 : n));
    } else if (cur?.kind === 'param') {
      graph = setCallArg(graph, id, key, asExpr(`p.${cur.param}`));
    } else {
      const seed = cur?.kind === 'literal' ? String(cur.value) : '0';
      graph = setCallArg(graph, id, key, asExpr(seed));
    }
  }
  function onArgExprEdit(id: string, key: string, expr: string) {
    graph = setCallArg(graph, id, key, asExpr(expr));
  }

  // ─── multi-source ƒ-expression popup editor ─────────────────────────────
  // When an arg's kind === 'expr' AND the expression references 2+ distinct
  // params, the inline text input is too cramped to author cleanly. The
  // collapsed chip — "ƒ(p.od, p.wall)" — opens this popup with a bigger
  // text area + click-to-insert chips for every declared param. Applied
  // value commits back to the arg via setCallArg(asExpr(...)).
  let argExprPop = $state<{ callId: NodeId; key: string; draft: string; x: number; y: number } | null>(null);
  function openArgExprPop(ev: MouseEvent, callId: NodeId, key: string, currentExpr: string) {
    ev.stopPropagation();
    argExprPop = { callId, key, draft: currentExpr, x: ev.clientX, y: ev.clientY };
  }
  function closeArgExprPop() { argExprPop = null; }
  function applyArgExprPop() {
    if (!argExprPop) return;
    graph = setCallArg(graph, argExprPop.callId, argExprPop.key, asExpr(argExprPop.draft));
    argExprPop = null;
  }
  function insertParamIntoDraft(name: string) {
    if (!argExprPop) return;
    const ref = `p.${name}`;
    const draft = argExprPop.draft;
    // Append with a space if there's existing text + the last char isn't whitespace.
    const sep = draft.length > 0 && !/\s$/.test(draft) ? ' ' : '';
    argExprPop = { ...argExprPop, draft: draft + sep + ref };
  }
  function onTransformAxis(id: string, axis: 0 | 1 | 2, value: number) {
    graph = setTransformAxis(graph, id, axis, value);
  }
  function resetGraph() { graph = newGraph(); }

  // ─── auto-layout (Phase 20) ────────────────────────────────────────────
  // 📐 Auto-layout runs the heuristic layered algorithm in
  // src/lib/cad/composition-layout.ts → rearranges every node by depth
  // column with a barycenter tiebreaker (cheap, deterministic, ~120 LOC,
  // zero deps). One-step undo restores the prior layout.
  //
  // Phase 21 (deferred) will swap in dagre when graphs grow past ~15 nodes.
  let undoLayout = $state<Record<string, { x: number; y: number }> | null>(null);
  function autoLayout() {
    undoLayout = { ...graph.layout };
    graph = autoLayoutGraph(graph);
  }
  function undoAutoLayout() {
    if (!undoLayout) return;
    graph = { ...graph, layout: { ...undoLayout } };
    undoLayout = null;
  }
  // Phase 22 — 🧲 Push apart. Resolves overlapping cards via pairwise
  // bounding-box separation. Includes the tacked params card as a
  // viewport-fixed obstacle so nodes get pushed clear of it too.
  // The same undoLayout snapshot is reused so the user can ↶ undo this
  // just like an auto-layout.
  function pushApart() {
    undoLayout = { ...graph.layout };
    // Convert the params card's viewport rect to graph space so it
    // participates in the force iteration. As the user pans, the card's
    // graph-space position shifts inversely; we recompute on each click.
    const pcardSize = paramCardSize(paramEntries.length);
    const obstacles = [{
      id: '__obs_params_card',
      x: (CARD_X0 - pan.x) / zoom,
      y: (CARD_Y0 - pan.y) / zoom,
      // socket spills past the card's right edge by ~12 px — pad accordingly
      w: (pcardSize.w + 14) / zoom,
      h: pcardSize.h / zoom,
    }];
    graph = forceSeparate(graph, {
      nodeSize: (id) => nodeSize(graph.nodes[id]),
      padding: 24,
      obstacles,
    });
  }

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
  function onParamDefault(name: string, value: number) {
    const cur = graph.params[name];
    if (!cur) return;
    graph = setParamSchema(graph, name, { ...cur, default: value });
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
    // Capture current viewport into the graph BEFORE serialising so the
    // emitted meta.graph carries the canvas state we want to restore on
    // reload. `emitted.source` is reactive — assigning graph re-runs the
    // emit chain to include the new viewport.
    graph = setViewport(graph, pan, zoom);
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
  // Visible nodes on the canvas: every node EXCEPT inline mv/rot wrappers
  // (those render inline inside their Call's card). The ROOT list IS visible
  // now — it shows up as the ▶ Output card so the user can see + curate what
  // the function returns. Non-root lists/stacks/groups also render as cards.
  let allNodes = $derived.by(() => {
    const all = Object.values(graph.nodes).filter((n) => !isInlineWrapper(n.id));
    // Z-order sort: nodes in `zOrder` render AFTER the rest, in the order they
    // were brought to front. SVG paints later elements ON TOP — that's how
    // we get click-to-front. Unlisted nodes keep their natural insertion order.
    if (zOrder.length === 0) return all;
    const zMap = new Map<string, number>();
    zOrder.forEach((id, i) => zMap.set(id, i));
    return [...all].sort((a, b) => {
      const aZ = zMap.get(a.id);
      const bZ = zMap.get(b.id);
      if (aZ === undefined && bZ === undefined) return 0;
      if (aZ === undefined) return -1;
      if (bZ === undefined) return 1;
      return aZ - bZ;
    });
  });
  /** Excludes the root list — that's the always-present ▶ Output card,
   *  not a user-dropped node. Used by the status bar + empty-canvas hint. */
  let visibleNodeCount = $derived(allNodes.filter((n) => n.id !== graph.root).length);
  let paramEntries = $derived(Object.entries(graph.params));
  let filteredSrcs = $derived.by(() => {
    const q = pickerFilter.trim().toLowerCase();
    if (!q) return pickerSrcs;
    return pickerSrcs.filter((s) => s.toLowerCase().includes(q));
  });
</script>

<svelte:head>
  <title>Graph editor · CAD Train</title>
  {#if embed}
    <!-- Hide the outer SvelteKit layout chrome when iframed. Injected as
         raw CSS in <head> so it can reach across scoped boundaries. -->
    {@html `<style>
      #nav-menu-wrapper { display: none !important; }
      .layout { padding: 0 !important; height: 100% !important; }
      .layout .content { padding: 0 !important; height: 100% !important; }
      html, body { height: 100%; margin: 0; overflow: hidden; }
    </style>`}
  {/if}
</svelte:head>

<div class="ge-root" class:embed>
  <header class="ge-bar">
    <h1>Graph editor</h1>
    <input class="ge-id" type="text" bind:value={exemplarId} placeholder="exemplar id" />
    <button class="ge-btn" type="button" onclick={openPicker}>+ Drop</button>
    <button class="ge-btn save" type="button" disabled={saveBusy} onclick={saveGraph}>{saveBusy ? '…' : '💾 Save'}</button>
    <button class="ge-btn ghost" type="button" onclick={resetGraph}>Reset</button>
    <button class="ge-btn ghost auto-layout" type="button" onclick={autoLayout}
      title="Rearrange nodes left-to-right by depth (Phase 20 heuristic)">📐 Auto-layout</button>
    <button class="ge-btn ghost push-apart" type="button" onclick={pushApart}
      title="Resolve overlapping cards via pairwise separation (Phase 22)">🧲 Push apart</button>
    {#if undoLayout}
      <button class="ge-btn ghost undo-layout" type="button" onclick={undoAutoLayout}
        title="Restore the prior layout">↶ Undo</button>
    {/if}
    {#if saveStatus}<span class="ge-save-stat">{saveStatus}</span>{/if}
    <span class="ge-stat">{visibleNodeCount} node{visibleNodeCount === 1 ? '' : 's'} · z {zoom.toFixed(2)}</span>
  </header>

  <main class="ge-grid" bind:this={gridEl}
    style="grid-template-columns: {splitA}% 6px 1fr">
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

          <!-- PARAM CHIPS render OUTSIDE the pan/zoom group (below) so they
               stay tacked to the viewport top-left even when the canvas
               is panned. -->
          {#if paramEntries.length === 0}
            <text x="120" y="35" class="ge-canvas-hint">← drop an outer dial here; drag its socket onto an arg.</text>
          {/if}

          <!-- PARAM WIRES — for every {Call.args[k] OR mv.offset[i] OR rot.rot[i]}
               with kind 'param', draw a bezier from the param chip's output
               socket to the consumer's input socket. -->
          {#each allNodes as n (n.id)}
            {#if n.type === 'call'}
              {#each Object.entries((n as any).args ?? {}) as [k, v], argIdx (k)}
                {#if (v as any).kind === 'param'}
                  {@const pIdx = paramEntries.findIndex(([nm]) => nm === (v as any).param)}
                  {#if pIdx >= 0}
                    {@const ps = paramSocketPos((v as any).param, pIdx)}
                    {@const pos = nodePos(n.id)}
                    {@const argY = pos.y + 36 + 14 + argIdx * 22}
                    <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, argY)}/>
                  {/if}
                {:else if (v as any).kind === 'expr'}
                  <!-- Expression arg — draw a wire from EACH referenced
                       p.<name> chip to this slot. Multi-source = visually
                       obvious; styled .expr to distinguish from direct
                       param wires (amber dashed vs orange dashed). -->
                  {#each extractParamRefs((v as any).expr) as refName (refName)}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos(refName, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const argY = pos.y + 36 + 14 + argIdx * 22}
                      <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, argY)}/>
                    {/if}
                  {/each}
                {/if}
              {/each}
              <!-- Inline transform axis wires (mv/rot wrapping this Call) -->
              {@const cSize = nodeSize(n)}
              {@const inlMv  = inlineTransformOf(graph, n.id, 'mv')}
              {@const inlRot = inlineTransformOf(graph, n.id, 'rot')}
              {#if inlMv}
                {@const mvN = graph.nodes[inlMv] as MvNode}
                {#each [0,1,2] as i (i)}
                  {#if (mvN.offset[i] as any).kind === 'param'}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === (mvN.offset[i] as any).param)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos((mvN.offset[i] as any).param, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const axisY = pos.y + cSize.h + 4 + 18 + i * 18}
                      <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, axisY)}/>
                    {/if}
                  {:else if (mvN.offset[i] as any).kind === 'expr'}
                    {#each extractParamRefs((mvN.offset[i] as any).expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0}
                        {@const ps = paramSocketPos(refName, pIdx)}
                        {@const pos = nodePos(n.id)}
                        {@const axisY = pos.y + cSize.h + 4 + 18 + i * 18}
                        <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, axisY)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
              {#if inlRot}
                {@const rotN = graph.nodes[inlRot] as RotNode}
                {#each [0,1,2] as i (i)}
                  {#if (rotN.rot[i] as any).kind === 'param'}
                    {@const pIdx = paramEntries.findIndex(([nm]) => nm === (rotN.rot[i] as any).param)}
                    {#if pIdx >= 0}
                      {@const ps = paramSocketPos((rotN.rot[i] as any).param, pIdx)}
                      {@const pos = nodePos(n.id)}
                      {@const rotY = pos.y + cSize.h + 4 + (inlMv ? 80 : 0) + 18 + i * 18}
                      <path class="ge-wire param" d={bezier(ps.x, ps.y, pos.x, rotY)}/>
                    {/if}
                  {:else if (rotN.rot[i] as any).kind === 'expr'}
                    {#each extractParamRefs((rotN.rot[i] as any).expr) as refName (refName)}
                      {@const pIdx = paramEntries.findIndex(([nm]) => nm === refName)}
                      {#if pIdx >= 0}
                        {@const ps = paramSocketPos(refName, pIdx)}
                        {@const pos = nodePos(n.id)}
                        {@const rotY = pos.y + cSize.h + 4 + (inlMv ? 80 : 0) + 18 + i * 18}
                        <path class="ge-wire param expr" d={bezier(ps.x, ps.y, pos.x, rotY)}/>
                      {/if}
                    {/each}
                  {/if}
                {/each}
              {/if}
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
            {:else if n.type === 'repeat'}
              <!-- Repeat node's child wire — bottom-left input socket -->
              {#if (n as any).child && graph.nodes[(n as any).child]}
                {@const src = outputSocketAt((n as any).child)}
                {@const pos = nodePos(n.id)}
                {@const size = nodeSize(n)}
                <path class="ge-wire child" d={bezier(src.x, src.y, pos.x, pos.y + size.h - 18)} fill="none"/>
              {/if}
            {:else if n.type === 'list' || n.type === 'stack' || n.type === 'group'}
              <!-- Container wires: each child of a container shows as a bezier
                   from the child's output socket → the container's i-th slot
                   input socket. Makes it visually obvious which parts are
                   "piped into" the Output card. -->
              {#each (n as any).children as childId, i (childId)}
                {#if graph.nodes[childId]}
                  {@const src = outputSocketAt(childId)}
                  {@const tgt = containerSlotInputAt(n.id, i)}
                  <path class="ge-wire output" class:root={n.id === graph.root}
                    d={bezier(src.x, src.y, tgt.x, tgt.y)} fill="none"/>
                {/if}
              {/each}
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
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
            <g transform="translate({pos.x},{pos.y})" class="ge-node"
              role="group"
              onpointerdown={() => bringToFront(n.id)}>
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
                <!-- Drift badge (Phase 11) — when the underlying primitive's params
                     differ from this Call's args keys, surface ⚠ + a Refresh
                     pointerdown handler that brings the Call back into sync. -->
                {#if isCallDrifted(n.id)}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x={size.w - 96} y="22"
                    class="ge-drift-btn"
                    onpointerdown={(ev) => { ev.stopPropagation(); refreshCallArgs(n.id); }}>⚠</text>
                {/if}
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
                          <span class="ge-arg-cell">
                            <input class="ge-arg-input" type="number" step="0.05"
                              value={(v as any).value}
                              use:dragNumber={{
                                step: 0.05,
                                get: () => Number((v as any).value) || 0,
                                set: (val) => onArgEdit(n.id, k, val),
                              }}
                              oninput={(e) => onArgEdit(n.id, k, Number((e.target as HTMLInputElement).value))}
                            />
                            <button class="ge-arg-fx" type="button" title="Switch to expression (ƒ)"
                              onclick={() => toggleArgExprMode(n.id, k)}>ƒ</button>
                          </span>
                        {:else if (v as any).kind === 'param'}
                          <!-- Wired param chip. ƒ promotes the bare wire to an
                               expression seeded with `p.<name>` so the user
                               can add math (e.g. `p.wall / 2`) without losing
                               the wire visualisation. × unwires back to literal. -->
                          <span class="ge-arg-pchip" title="Wired to param">
                            p.{(v as any).param}
                            <button class="ge-arg-pchip-fx" type="button"
                              title="Make this an expression (e.g. p.wall / 2)"
                              onclick={() => toggleArgExprMode(n.id, k)}>ƒ</button>
                            <button class="ge-arg-pchip-x" type="button"
                              onclick={() => unwireArgToLiteral(n.id, k)}>×</button>
                          </span>
                        {:else}
                          {@const expr = (v as any).expr ?? ''}
                          {@const refs = extractParamRefs(expr)}
                          {#if refs.length >= 2}
                            <!-- Multi-source ƒ chip — too dense for inline editing; click to open popup. -->
                            <span class="ge-arg-cell">
                              <!-- svelte-ignore a11y_click_events_have_key_events -->
                              <span class="ge-arg-fnchip" role="button" tabindex="-1"
                                title={`Click to edit · expression: ${expr}`}
                                onclick={(ev) => openArgExprPop(ev, n.id, k, expr)}>
                                ƒ(<span class="ge-arg-fnchip-refs">{refs.map((r) => 'p.' + r).join(', ')}</span>) ✎
                              </span>
                              <button class="ge-arg-fx on" type="button" title="Back to literal"
                                onclick={() => toggleArgExprMode(n.id, k)}>ƒ</button>
                            </span>
                          {:else}
                            <span class="ge-arg-cell">
                              <input class="ge-arg-input expr" type="text"
                                placeholder="e.g. p.od / 2"
                                value={expr}
                                oninput={(e) => onArgExprEdit(n.id, k, (e.target as HTMLInputElement).value)}
                              />
                              <button class="ge-arg-fx on" type="button" title="Open expression editor"
                                onclick={(ev) => openArgExprPop(ev, n.id, k, expr)}>✎</button>
                              <button class="ge-arg-fx on" type="button" title="Back to literal"
                                onclick={() => toggleArgExprMode(n.id, k)}>ƒ</button>
                            </span>
                          {/if}
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
                        {@const av = mvNode.offset[i] as any}
                        <div class="ge-arg-row tight">
                          <span class="ge-arg-key">{axis}</span>
                          {#if av.kind === 'param'}
                            <span class="ge-arg-pchip" title="Wired to param">
                              p.{av.param}
                              <button class="ge-arg-pchip-x" type="button"
                                onclick={() => unwireTransformAxis(inlineMv!, i as 0|1|2)}>×</button>
                            </span>
                          {:else}
                            <input class="ge-arg-input" type="number" step="0.5"
                              value={av.kind === 'literal' ? av.value : 0}
                              use:dragNumber={{
                                step: 0.5,
                                get: () => Number(av.value ?? 0),
                                set: (val) => onTransformAxis(inlineMv!, i as 0|1|2, val),
                              }}
                              oninput={(e) => onTransformAxis(inlineMv!, i as 0|1|2, Number((e.target as HTMLInputElement).value))}
                            />
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </foreignObject>
                  <!-- Per-axis input sockets on the LEFT edge — drag a param chip
                       output socket onto one to wire that axis. -->
                  {#each [0,1,2] as i (i)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1" class="ge-sock in param tiny"
                      cx="0" cy={size.h + 4 + 18 + i * 18} r="4"
                      onpointerup={(ev) => endWireOnTransformAxis(ev, inlineMv!, i as 0|1|2)}/>
                  {/each}
                {/if}
                {#if rotNode}
                  {@const rotY = size.h + 4 + (inlineMv ? 80 : 0)}
                  <foreignObject x="6" y={rotY} width={size.w - 12} height="72">
                    <div class="ge-inline-xform rot" xmlns="http://www.w3.org/1999/xhtml">
                      <div class="ge-inline-label">↻ rot</div>
                      {#each ['rx','ry','rz'] as axis, i (axis)}
                        {@const av = rotNode.rot[i] as any}
                        <div class="ge-arg-row tight">
                          <span class="ge-arg-key">{axis}</span>
                          {#if av.kind === 'param'}
                            <span class="ge-arg-pchip" title="Wired to param">
                              p.{av.param}
                              <button class="ge-arg-pchip-x" type="button"
                                onclick={() => unwireTransformAxis(inlineRot!, i as 0|1|2)}>×</button>
                            </span>
                          {:else}
                            <input class="ge-arg-input" type="number" step="1"
                              value={av.kind === 'literal' ? av.value : 0}
                              use:dragNumber={{
                                step: 1,
                                get: () => Number(av.value ?? 0),
                                set: (val) => onTransformAxis(inlineRot!, i as 0|1|2, val),
                              }}
                              oninput={(e) => onTransformAxis(inlineRot!, i as 0|1|2, Number((e.target as HTMLInputElement).value))}
                            />
                          {/if}
                        </div>
                      {/each}
                    </div>
                  </foreignObject>
                  {#each [0,1,2] as i (i)}
                    <!-- svelte-ignore a11y_no_static_element_interactions -->
                    <circle role="button" tabindex="-1" class="ge-sock in param tiny"
                      cx="0" cy={rotY + 18 + i * 18} r="4"
                      onpointerup={(ev) => endWireOnTransformAxis(ev, inlineRot!, i as 0|1|2)}/>
                  {/each}
                {/if}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <!-- Output: if a Call has an inline mv/rot wrapper, the visible
                     output is the WRAPPER's output (the transformed result), so
                     wires from this socket originate from the wrapper id. Without
                     this, downstream methods would bypass the inline transform —
                     emit would be `A.subtract(B)` instead of `mv(A,...).subtract(B)`. -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={cardH / 2} r="6"
                  onpointerdown={(ev) => startWire(ev, inlineRot ?? inlineMv ?? n.id)}/>
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
                    {#each ['x','y','z'] as axisLabel, i (axisLabel)}
                      <div class="ge-arg-row">
                        <span class="ge-arg-key">{n.type === 'mv' ? '' : 'r'}{axisLabel}</span>
                        <input class="ge-arg-input" type="number" step={n.type === 'mv' ? 0.5 : 1}
                          value={((t as any)[fieldName][i].kind === 'literal') ? (t as any)[fieldName][i].value : 0}
                          use:dragNumber={{
                            step: n.type === 'mv' ? 0.5 : 1,
                            get: () => Number((t as any)[fieldName][i].value ?? 0),
                            set: (val) => onTransformAxis(n.id, i as 0|1|2, val),
                          }}
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

              {:else if n.type === 'repeat'}
                {@const rep = n as any}
                {@const countLiteral = rep.count?.kind === 'literal' ? Number(rep.count.value) : 1}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg repeat"
                  width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}/>
                <text x="14" y="22" class="ge-node-title">↻ Repeat</text>
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                  onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <foreignObject x="20" y="40" width={size.w - 24} height="36">
                  <div class="ge-args" xmlns="http://www.w3.org/1999/xhtml">
                    <div class="ge-arg-row">
                      <span class="ge-arg-key">count</span>
                      <span class="ge-arg-cell">
                        {#if rep.count?.kind === 'param'}
                          <span class="ge-arg-pchip" title="Wired to param">
                            p.{rep.count.param}
                            <button class="ge-arg-pchip-x" type="button"
                              onclick={() => { graph = setRepeatCount(graph, n.id, asLiteral(graph.params[rep.count.param]?.default ?? 1)); }}>×</button>
                          </span>
                        {:else if rep.count?.kind === 'expr'}
                          <input class="ge-arg-input expr" type="text"
                            placeholder="e.g. p.n"
                            value={rep.count.expr}
                            oninput={(e) => { graph = setRepeatCount(graph, n.id, asExpr((e.target as HTMLInputElement).value)); }}/>
                        {:else}
                          <input class="ge-arg-input" type="number" min="1" step="1"
                            value={countLiteral}
                            use:dragNumber={{
                              step: 1,
                              get: () => countLiteral,
                              set: (val) => { graph = setRepeatCount(graph, n.id, asLiteral(Math.max(1, Math.round(val)))); },
                            }}
                            oninput={(e) => { graph = setRepeatCount(graph, n.id, asLiteral(Math.max(1, Math.round(Number((e.target as HTMLInputElement).value))))); }}/>
                        {/if}
                      </span>
                    </div>
                  </div>
                </foreignObject>
                <!-- Child input socket — drop any node's output here to repeat it. -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy={size.h - 18} r="6"
                  onpointerup={(ev) => endWireOnRepeatChild(ev, n.id)}/>
                <text x="10" y={size.h - 14} class="ge-sock-label">child</text>
                <!-- Output -->
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                  onpointerdown={(ev) => startWire(ev, n.id)}/>

              {:else if n.type === 'list' || n.type === 'stack' || n.type === 'group'}
                {@const isRoot = n.id === graph.root}
                {@const container = n as any}
                {@const title = isRoot ? '▶ Output' : n.type === 'stack' ? '↕ Stack' : n.type === 'group' ? '{} Group' : '[ ] List'}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <rect role="button" tabindex="-1" class="ge-node-bg container" class:root={isRoot} class:stack={n.type === 'stack'}
                  width={size.w} height={size.h} rx="6"
                  onpointerdown={(ev) => onNodePointerDown(ev, n.id)}
                  onpointermove={onNodePointerMove}
                  onpointerup={onNodePointerUp}
                />
                <text x="14" y="22" class="ge-node-title">{title}</text>
                {#if !isRoot}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" x={size.w - 14} y="22" class="ge-node-x"
                    onpointerdown={(ev) => { ev.stopPropagation(); deleteNode(n.id); }}>×</text>
                {/if}
                <line x1="0" y1="32" x2={size.w} y2="32" class="ge-node-divider"/>
                <!-- Children slots: one per child + a trailing "+ drop" slot -->
                {#each container.children as childId, i (childId)}
                  {@const childNode = graph.nodes[childId]}
                  {@const childLabel = childNode?.type === 'call'
                    ? `${(childNode as any).alias} · ${(childNode as any).src}`
                    : childNode?.type === 'method' ? `${(childNode as any).op}(…)`
                    : childNode?.type === 'mv' ? 'mv(…)'
                    : childNode?.type === 'rot' ? 'rot(…)'
                    : childNode?.type === 'stack' ? 'stack(…)'
                    : childNode?.type === 'repeat' ? `× ${childNode.count?.kind === 'literal' ? childNode.count.value : '…'}`
                    : '(missing)'}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock in child" cx="0" cy={containerSlotY(i)} r="5"
                    onpointerup={(ev) => endWireOnContainerSlot(ev, n.id)}/>
                  <text x="10" y={containerSlotY(i) + 4} class="ge-sock-label">{childLabel}</text>
                  <!-- × removes this child from the container -->
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <text role="button" tabindex="-1" class="ge-container-slot-x"
                    x={size.w - 14} y={containerSlotY(i) + 4}
                    onpointerdown={(ev) => { ev.stopPropagation(); graph = removeContainerChildAt(graph, n.id, i); }}>×</text>
                {/each}
                <!-- Trailing + drop slot — drag any output socket onto here to append. -->
                {@const trailY = containerSlotY(container.children.length)}
                <!-- svelte-ignore a11y_no_static_element_interactions -->
                <circle role="button" tabindex="-1" class="ge-sock in child trail" cx="0" cy={trailY} r="5"
                  onpointerup={(ev) => endWireOnContainerSlot(ev, n.id)}/>
                <text x="10" y={trailY + 4} class="ge-sock-label trail">+ drop here</text>
                <!-- Non-root containers have an OUTPUT socket — their result
                     can feed upstream (e.g. into a method.obj). -->
                {#if !isRoot}
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <circle role="button" tabindex="-1" class="ge-sock out" cx={size.w} cy={size.h / 2} r="6"
                    onpointerdown={(ev) => startWire(ev, n.id)}/>
                {/if}
              {/if}
            </g>
          {/each}

          {#if allNodes.filter((n) => n.id !== graph.root).length === 0}
            <text x="80" y="100" class="ge-canvas-hint">Click <tspan font-weight="bold">+ Drop</tspan> to add a Call, CSG op, or transform.</text>
          {/if}
        </g>

        <!-- PARAMS CARD — tacked outside the pan/zoom group so it stays
             glued to the viewport top-left. Holds N param chips vertically,
             with a title bar that has a + rounded button to add a new param.
             Each chip is vertically symmetric, with: 📌 pin (left),
             p.name + input value, 🗑 trash (right), output socket OUTSIDE
             the card's right edge for drag-wiring. -->
        <g class="ge-params-card" transform="translate({CARD_X0},{CARD_Y0})">
          <rect class="ge-params-card-bg" width={pcs.w} height={pcs.h} rx="8"/>
          <text x="10" y={CARD_TITLE_H - 9} class="ge-params-card-title">Params</text>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <circle role="button" tabindex="-1" class="ge-params-add-btn"
            cx={pcs.w - 14} cy={CARD_TITLE_H - 13} r="9"
            onpointerdown={(ev) => { ev.stopPropagation(); openAddParamPop(ev); }}/>
          <text x={pcs.w - 14} y={CARD_TITLE_H - 9} class="ge-params-add-glyph" text-anchor="middle" pointer-events="none">+</text>
          <line x1="0" y1={CARD_TITLE_H} x2={pcs.w} y2={CARD_TITLE_H} class="ge-params-card-divider"/>
        </g>
        <!-- Chips render in viewport coords too. Output sockets stick out
             of the card's right edge so they can still be drag-targeted. -->
        {#each paramEntries as [name, p], i (name)}
          {@const pos = paramPos(name, i)}
          <g class="ge-param-card" transform="translate({pos.x},{pos.y})">
            <!-- Chip body — full PARAM_H height for vertical centering -->
            <rect class="ge-param-card-bg" width={PARAM_W} height={PARAM_H} rx="6"/>
            <!-- 📌 pin (left edge), vertically centered -->
            <text x="6" y={PARAM_H / 2 + 4} class="ge-param-pin" pointer-events="none">📌</text>
            <!-- p.name -->
            <text x="22" y={PARAM_H / 2 + 4} class="ge-param-card-name" text-anchor="start">p.{name}</text>
            <!-- Input value -->
            <foreignObject x="60" y={(PARAM_H - 16) / 2} width="40" height="16">
              <input class="ge-param-card-input" type="number" step="0.05"
                xmlns="http://www.w3.org/1999/xhtml"
                value={(p as any).default}
                use:dragNumber={{
                  step: 0.05,
                  get: () => Number((p as any).default) || 0,
                  set: (val) => onParamDefault(name, val),
                }}
                oninput={(e) => onParamDefault(name, Number((e.target as HTMLInputElement).value))}/>
            </foreignObject>
            <!-- 🗑 trash — vertically centered -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <text role="button" tabindex="-1" class="ge-param-card-trash" x={PARAM_W - 13} y={PARAM_H / 2 + 4}
              onpointerdown={(ev) => { ev.stopPropagation(); onRemoveParam(name); }}>🗑</text>
            <!-- Output socket — OUTSIDE the card right edge so it's not clipped -->
            <!-- svelte-ignore a11y_no_static_element_interactions -->
            <circle role="button" tabindex="-1" class="ge-sock out param"
              cx={PARAM_W + CARD_PAD + 4} cy={PARAM_H / 2} r="5"
              onpointerdown={(ev) => startParamWire(ev, name)}/>
          </g>
        {/each}
      </svg>
    </section>

    <!-- Divider: canvas ↔ right pane -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <div class="ge-divider" role="separator" tabindex="-1" aria-orientation="vertical"
      onpointerdown={startSplitDrag}
      onpointermove={onSplitMove}
      onpointerup={endSplitDrag}></div>

    <!-- RIGHT pane — tabbed: 3D bake / live source. One tab visible at a
         time; both keep their state mounted so switching is instant. -->
    <section class="ge-right-pane">
      <div class="ge-pane-tabs" role="tablist">
        <button class="ge-pane-tab" class:active={rightTab === 'bake'}
          type="button" role="tab" aria-selected={rightTab === 'bake'}
          onclick={() => setRightTab('bake')}>3D bake</button>
        <button class="ge-pane-tab" class:active={rightTab === 'source'}
          type="button" role="tab" aria-selected={rightTab === 'source'}
          onclick={() => setRightTab('source')}>live source · <code>{exemplarId}.asm.ts</code></button>
      </div>
      <div class="ge-pane-bodies">
        <div class="ge-bake-body" class:hidden={rightTab !== 'bake'}>
          {#if !bake}<div class="ge-empty">Drop nodes to bake.</div>
          {:else if bake === 'loading'}<div class="ge-empty">baking…</div>
          {:else if !bake.ok}
            <div class="ge-err">
              <div>{bake.message ?? 'bake failed'}</div>
              {#if /parameter 0 has unknown type|memory access out of bounds/.test(bake.message ?? '')}
                <!-- Stale-server-modules trap — Vite HMR doesn't reload server-side
                     modules (primitive-loader / composition-graph / emit). Surface
                     the symptom + the fix instead of letting the user wonder. -->
                <div class="ge-err-hint">
                  ⚠ Looks like a stale dev server (Vite HMR skips server modules after
                  edits to composition-graph / composition-emit / primitive-loader).
                  Restart the dev server: <code>pkill -f 'bun run dev' && bun run dev</code>
                </div>
              {/if}
            </div>
          {:else if PrimitiveDualCanvas}
            <PrimitiveDualCanvas id={exemplarId} name={exemplarId} description=""
              args={Object.values(graph.params).map((p) => p.default)}
              source={bake.source}
              showControls={true} showLabels={false}/>
          {:else}<div class="ge-empty">3D canvas loading…</div>
          {/if}
        </div>
        <div class="ge-source-body" class:hidden={rightTab !== 'source'}>
          {#if legacyLoad}
            <div class="ge-legacy-banner">
              {#if legacyLoad.reason === 'no-graph'}
                <strong>{legacyLoad.id}</strong> opened in legacy mode — its source has
                no <code>meta.graph</code> block, so the canvas can't hydrate. Save
                here to overwrite with a graph-format part, or
                <a href="/primitives?id={legacyLoad.id}">open it in /primitives</a>
                to edit the original text body.
              {:else}
                Could not fetch <strong>{legacyLoad.id}</strong> from the volume.
                Check the id + your volume connection.
              {/if}
            </div>
          {/if}
          <pre class="ge-source">{sourceText}</pre>
        </div>
      </div>
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

  {#if argExprPop}
    <!-- ƒ-expression editor popup — wider input + click-to-insert chips for
         every declared param. Used when an arg references 2+ params (the
         inline text box becomes too cramped to read). -->
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="ge-wire-shade" onclick={closeArgExprPop}></div>
    <div class="ge-wire-pop ge-expr-pop"
      style="left: {Math.min(argExprPop.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 460)}px; top: {argExprPop.y}px">
      <div class="ge-wire-head">ƒ <code>{argExprPop.key}</code> expression</div>
      <textarea class="ge-expr-textarea" rows="3"
        placeholder="e.g. p.od / 2 - p.wall"
        value={argExprPop.draft}
        oninput={(e) => { if (argExprPop) argExprPop = { ...argExprPop, draft: (e.target as HTMLTextAreaElement).value }; }}></textarea>
      <div class="ge-expr-pop-row">
        <span class="ge-expr-pop-label">insert:</span>
        {#each paramEntries as [name, p] (name)}
          <button class="ge-expr-pop-chip" type="button"
            onclick={() => insertParamIntoDraft(name)}
            title={`Append p.${name} to the expression (default ${(p as any).default})`}>p.{name}</button>
        {/each}
        {#if paramEntries.length === 0}
          <span class="ge-empty">no params declared</span>
        {/if}
      </div>
      <div class="ge-expr-pop-row right">
        <button class="ge-param-add ghost" type="button" onclick={closeArgExprPop}>cancel</button>
        <button class="ge-param-add" type="button" onclick={applyArgExprPop}>apply</button>
      </div>
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
        <div class="ge-picker-label">Container</div>
        <button class="ge-pick container" type="button" onclick={dropStack}>↕ stack [...]</button>
        <button class="ge-pick container" type="button" onclick={dropRepeat}>↻ repeat × N</button>
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
  /* Embed mode (`?embed=1`) — page is iframed inside /vocab (or similar).
     Override the 100vh so the iframe parent controls the height. */
  .ge-root.embed { height: 100%; }
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
  /* grid-template-columns set inline (splitA% 6px splitB% 6px 1fr) — both
     dividers live between sections; the source pane gets the remainder. */
  .ge-grid { display: grid; overflow: hidden; }
  .ge-divider { background: #e5e7eb; cursor: col-resize; touch-action: none; transition: background 0.12s; }
  .ge-divider:hover, .ge-divider:active { background: #0369a1; }
  .ge-canvas-pane { overflow: hidden; position: relative; }
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
  .ge-node-bg.container { fill: #ecfdf5; stroke: #047857; stroke-width: 2; }
  .ge-node-bg.container.root { fill: #f0fdf4; stroke: #15803d; stroke-width: 2.5; }
  .ge-node-bg.container.stack { fill: #ecfeff; stroke: #0e7490; }
  /* Repeat × N — distinct color so it reads as "iteration", not "container". */
  .ge-node-bg.repeat { fill: #fdf2f8; stroke: #be185d; stroke-width: 2; }
  .ge-container-slot-x { font: 12px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-container-slot-x:hover { fill: #7f1d1d; }
  .ge-sock-label.trail { fill: #9ca3af; font-style: italic; }
  .ge-sock.trail { fill: #fff; stroke: #9ca3af; stroke-dasharray: 2 2; }
  .ge-node-title { font: 600 12px Arial; fill: #0c4a6e; pointer-events: none; }
  .ge-node-divider { stroke: #e5e7eb; }
  .ge-node-x { font: 14px Arial; fill: #b91c1c; cursor: pointer; user-select: none; }
  .ge-method-op { font: 900 36px Arial; fill: #92400e; pointer-events: none; }
  .ge-method-name { font: 11px Arial; fill: #92400e; text-transform: uppercase; letter-spacing: 0.5px; pointer-events: none; }
  .ge-fo { overflow: visible; }
  .ge-args, .ge-xyz { font: 11px Arial; color: #1f2937; line-height: 1.5; }
  /* IMPORTANT: row height is 22 px to match the input-socket spacing
     math in the SVG (cy = 36 + 14 + i * 22). Don't change without
     updating ALL three sites: the cy expression on socket circles,
     argY computation for the param/expr wires, and inline mv/rot axis
     positions. Misalignment of even 3-4 px per row stacks visibly. */
  .ge-arg-row { display: grid; grid-template-columns: 70px 1fr; gap: 4px; align-items: center; padding: 0; height: 22px; box-sizing: border-box; }
  .ge-arg-key { font: 11px ui-monospace, monospace; color: #6b7280; }
  .ge-arg-input { padding: 1px 4px; font: 11px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 2px; width: 100%; cursor: ew-resize; }
  .ge-arg-input:hover { background: #f0f9ff; }
  .ge-arg-input:focus { cursor: text; outline: 1px solid #0369a1; background: #fff; }
  .ge-arg-input.expr { cursor: text; background: #faf5ff; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-input.expr:focus { background: #fff; outline-color: #6d28d9; }
  /* Two-element cell: [ input | ƒ ] — keeps the grid 70px-key + 1fr-value
     layout intact while giving each arg row a literal/expr mode toggle. */
  .ge-arg-cell { display: flex; align-items: stretch; gap: 2px; }
  .ge-arg-cell > input { flex: 1 1 auto; min-width: 0; }
  .ge-arg-fx { flex: 0 0 auto; padding: 0 5px; font: 700 11px serif; background: transparent; border: 1px solid #e5e7eb; border-radius: 2px; color: #6b7280; cursor: pointer; line-height: 1; }
  .ge-arg-fx:hover { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-fx.on { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-param-card-input { cursor: ew-resize; }
  .ge-param-card-input:focus { cursor: text; }
  :global(body.dragnum-active) { cursor: ew-resize !important; }
  :global(body.dragnum-active *) { cursor: ew-resize !important; }
  .ge-arg-pchip { display: inline-flex; align-items: center; gap: 2px; padding: 1px 4px 1px 6px; font: 600 10px ui-monospace, monospace; background: #fef3c7; color: #78350f; border: 1px solid #fbbf24; border-radius: 9999px; }
  .ge-arg-pchip.ƒ { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .ge-arg-pchip-x { background: transparent; border: 0; font: 11px Arial; color: #b91c1c; cursor: pointer; padding: 0 2px; line-height: 1; }
  /* ƒ promote-to-expression on a wired param chip. Smaller + violet to
     differentiate from the × (unwire) and from the .ge-arg-fx (literal→expr
     toggle on literal inputs). */
  .ge-arg-pchip-fx { background: transparent; border: 0; font: 700 11px serif; color: #6d28d9; cursor: pointer; padding: 0 3px; line-height: 1; }
  .ge-arg-pchip-fx:hover { color: #4c1d95; background: rgba(109, 40, 217, 0.1); border-radius: 3px; }
  .ge-arg-key.wire-btn { background: transparent; border: 0; padding: 1px 4px; font: 11px ui-monospace, monospace; color: #6b7280; cursor: pointer; text-align: left; border-radius: 2px; }
  .ge-arg-key.wire-btn:hover { background: #fef3c7; color: #78350f; }
  .ge-xform-btn { font: 13px Arial; fill: #6b7280; cursor: pointer; user-select: none; }
  .ge-xform-btn:hover { fill: #6d28d9; }
  .ge-xform-btn.on { fill: #6d28d9; font-weight: bold; }
  .ge-drift-btn { font: 700 14px Arial; fill: #d97706; cursor: pointer; user-select: none; }
  .ge-drift-btn:hover { fill: #92400e; }
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
  /* Expression wires — multi-source. Same color as direct-param wires
     but a longer dash so it reads as "composed via expression" not
     "wired directly". Helps when both wire types meet at the same slot. */
  .ge-wire.param.expr { stroke: #b45309; stroke-dasharray: 5 3; opacity: 0.75; }
  .ge-wire.in-flight { stroke: #15803d; stroke-dasharray: 6 4; }
  /* output: piping a node into a container's slot. Green = "this is what the
     function returns / what gets stacked". root variant is slightly thicker
     to mark "this lands in the function's final return". */
  .ge-wire.output { stroke: #15803d; opacity: 0.7; }
  .ge-wire.output.root { stroke: #047857; stroke-width: 2.5; opacity: 0.85; }
  /* Param chips on canvas — small amber rounded rectangles at the top with
     output socket. The HTML strip above stays for adding/removing; these
     mirror the same data for visual wiring. */
  .ge-params-card-bg { fill: #fffbeb; stroke: #d97706; stroke-width: 1.5; filter: drop-shadow(0 2px 3px rgba(0,0,0,0.06)); }
  .ge-params-card-title { font: 700 12px Arial; fill: #78350f; user-select: none; text-transform: uppercase; letter-spacing: 0.5px; }
  .ge-params-card-divider { stroke: #fde68a; stroke-width: 1; }
  .ge-params-add-btn { fill: #fcd34d; stroke: #d97706; stroke-width: 1.5; cursor: pointer; transition: fill 0.12s; }
  .ge-params-add-btn:hover { fill: #f59e0b; }
  .ge-params-add-glyph { font: 700 14px Arial; fill: #78350f; user-select: none; }
  .ge-param-card-bg { fill: #fef3c7; stroke: #d97706; stroke-width: 1; }
  .ge-param-pin { font: 11px 'Apple Color Emoji', 'Segoe UI Emoji', 'Noto Color Emoji', Arial; user-select: none; opacity: 0.85; }
  .ge-param-card-trash { font: 12px 'Apple Color Emoji', 'Segoe UI Emoji', Arial; cursor: pointer; user-select: none; opacity: 0.65; }
  .ge-param-card-trash:hover { opacity: 1; }
  /* Hide native number-input spinner arrows everywhere in the editor —
     drag-to-scrub via dragNumber + keyboard arrows are the input methods;
     the chevrons take horizontal space we can't afford in tight cells. */
  :global(.ge-param-card-input::-webkit-outer-spin-button),
  :global(.ge-param-card-input::-webkit-inner-spin-button),
  :global(.ge-arg-input::-webkit-outer-spin-button),
  :global(.ge-arg-input::-webkit-inner-spin-button) { -webkit-appearance: none; margin: 0; }
  :global(.ge-param-card-input[type='number']),
  :global(.ge-arg-input[type='number']) { -moz-appearance: textfield; appearance: textfield; }
  .ge-param-card-name { font: 700 11px ui-monospace, monospace; fill: #78350f; pointer-events: none; }
  .ge-param-card-val { font: 10px ui-monospace, monospace; fill: #92400e; pointer-events: none; }
  .ge-param-card-input { width: 100%; padding: 0 4px; font: 10px ui-monospace, monospace; background: rgba(255,255,255,0.85); border: 1px solid #fbbf24; border-radius: 2px; color: #92400e; text-align: center; box-sizing: border-box; }
  .ge-param-card-input:focus { outline: 1px solid #d97706; background: #fff; }
  .ge-sock.in.param { stroke: #d97706; }
  .ge-sock.out.param { stroke: #d97706; fill: #fef3c7; }
  .ge-sock.in.param:hover, .ge-sock.out.param:hover { fill: #fde68a; }
  .ge-sock.tiny { stroke-width: 1.5; }

  .ge-bake-pane, .ge-source-pane { display: grid; grid-template-rows: auto 1fr; overflow: hidden; }
  .ge-source-pane:has(.ge-legacy-banner) { grid-template-rows: auto auto 1fr; }
  /* Combined right pane (tabbed): bake + source in one column with a tab strip.
     30 % default width gives the canvas 70 % to show the graph. */
  .ge-right-pane { display: grid; grid-template-rows: auto 1fr; overflow: hidden; border-left: 1px solid #e5e7eb; }
  .ge-pane-tabs { display: flex; gap: 0; background: #f5f5f4; border-bottom: 1px solid #e7e5e4; }
  .ge-pane-tab { flex: 1 1 auto; padding: 6px 12px; font: 600 11px Arial; color: #78716c; background: transparent; border: 0; border-bottom: 2px solid transparent; cursor: pointer; text-transform: uppercase; letter-spacing: 0.5px; transition: background 0.12s, color 0.12s, border-color 0.12s; }
  .ge-pane-tab code { font: 11px ui-monospace, monospace; color: #57534e; text-transform: none; letter-spacing: 0; }
  .ge-pane-tab:hover { background: #fafaf9; color: #1c1917; }
  .ge-pane-tab.active { color: #0c4a6e; border-bottom-color: #0369a1; background: #fff; }
  .ge-pane-tab.active code { color: #0c4a6e; }
  .ge-pane-bodies { position: relative; display: grid; min-height: 0; overflow: hidden; }
  .ge-pane-bodies > .ge-bake-body,
  .ge-pane-bodies > .ge-source-body { grid-area: 1 / 1; min-height: 0; overflow: auto; display: flex; flex-direction: column; }
  .ge-pane-bodies > .hidden { display: none; }
  .ge-legacy-banner { padding: 8px 12px; font: 11px ui-monospace, monospace; line-height: 1.5; color: #78350f; background: #fef3c7; border-bottom: 1px solid #fbbf24; }
  .ge-legacy-banner strong { color: #92400e; }
  .ge-legacy-banner a { color: #0369a1; }
  .ge-pane-head { padding: 6px 12px; font: 600 11px Arial; color: #57534e; text-transform: uppercase; letter-spacing: 0.5px; background: #f5f5f4; border-bottom: 1px solid #e7e5e4; }
  .ge-pane-head code { font: 11px ui-monospace, monospace; color: #0c4a6e; text-transform: none; letter-spacing: 0; }
  .ge-bake-body { overflow: hidden; min-height: 0; }
  .ge-empty { padding: 20px; text-align: center; color: #9ca3af; font: 12px Arial; }
  .ge-err { padding: 20px; color: #b91c1c; font: 12px ui-monospace, monospace; display: flex; flex-direction: column; gap: 10px; }
  .ge-err-hint { padding: 10px 12px; background: #fef3c7; color: #78350f; border: 1px solid #fbbf24; border-radius: 4px; font: 11px Arial; line-height: 1.4; }
  .ge-err-hint code { font: 11px ui-monospace, monospace; background: rgba(0,0,0,0.06); padding: 1px 5px; border-radius: 2px; }
  .ge-source { margin: 0; padding: 10px 14px; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; background: #fafaf9; overflow: auto; white-space: pre; }
  .ge-source-pane { border-left: 1px solid #e5e7eb; }

  .ge-picker-shade { position: fixed; inset: 0; background: rgba(0,0,0,0.2); z-index: 100; }
  /* Multi-source ƒ-chip — shown on a Call's arg row when expr references 2+ params */
  .ge-arg-fnchip { display: inline-flex; align-items: center; gap: 2px; flex: 1 1 auto; padding: 1px 6px; font: 600 10px ui-monospace, monospace; background: #fef3c7; color: #78350f; border: 1px solid #f59e0b; border-radius: 9999px; cursor: pointer; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; transition: background 0.12s; }
  .ge-arg-fnchip:hover { background: #fde68a; }
  .ge-arg-fnchip-refs { color: #b45309; font-weight: 500; }
  /* ƒ expression popup */
  .ge-expr-pop { min-width: 420px; max-width: 460px; padding: 8px; display: flex; flex-direction: column; gap: 6px; }
  .ge-expr-textarea { width: 100%; box-sizing: border-box; padding: 6px 8px; font: 12px ui-monospace, monospace; border: 1px solid #d6d3d1; border-radius: 4px; resize: vertical; background: #faf5ff; color: #5b21b6; }
  .ge-expr-textarea:focus { outline: 1px solid #6d28d9; background: #fff; }
  .ge-expr-pop-row { display: flex; align-items: center; gap: 4px; flex-wrap: wrap; padding: 4px 6px; }
  .ge-expr-pop-row.right { justify-content: flex-end; gap: 8px; }
  .ge-expr-pop-label { font: 11px Arial; color: #6b7280; margin-right: 4px; }
  .ge-expr-pop-chip { font: 600 11px ui-monospace, monospace; color: #78350f; background: #fef3c7; border: 1px solid #fbbf24; border-radius: 4px; padding: 2px 7px; cursor: pointer; transition: background 0.1s; }
  .ge-expr-pop-chip:hover { background: #fde68a; }
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
