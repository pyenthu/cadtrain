/**
 * sketch-state.svelte.ts — the full-tab sketch editor's interaction state for
 * the graph editor (modularize K.65, Phase E).
 *
 * `SketchState` is a PER-INSTANCE class (one `new SketchState(...)` per
 * GraphEditorPane), NOT a module-level `$state` singleton — `/primitives` keeps
 * all tab panes mounted at once (`{#each tabs}` + `class:visible`), and the
 * open sketch / tool / drag / popover are per-pane transient state; a singleton
 * would leak the editing session across panes (mirrors `WireState`, Phase C).
 *
 * It is the SHARED home for the sketch state that was previously split between
 * GraphEditorPane's node-card arm (`{:else if n.type==='sketch'}`) AND the
 * full-tab editor: both reference ONE `sketch` instance, so e.g. `openSketchExprPop`
 * / `toggleSketchOpMode` / `sketchAxisLabel` are reachable from both call sites
 * (that cross-use is exactly why the first naive Phase E extraction failed).
 *
 * The class never closes over a pane's `graph` $state: it is handed `getGraph`
 * / `setGraph` (and `wire`, `getPcs`, `getParamW` — all of which read the pane's
 * reactive state) at construction, and every mutator does
 * `this.#setGraph(setX(this.#getGraph(), …))`. Methods are ARROW fields so
 * `this` stays bound when used as Svelte event handlers. `$state`/`$derived`
 * live in class fields (Svelte 5 compiles runes in `.svelte.ts` class fields).
 *
 * NOTE: the sketchFrame-FREEZE `$effect` (freeze the viewBox on open so point
 * drags don't rescale the canvas) stays in GraphEditorPane — `$effect` wants the
 * component's effect context; the component drives it via `this.frame` + `this.fitFrame`.
 */
import {
  setSketchOpField,
  removeSketchOp,
  addSketchOp,
  setSketchSplinePoint,
  addSketchSplinePoint,
  removeSketchSplinePoint,
  setSketchSplineHandle,
  clearSketchSplineHandle,
  addSketch,
  setSketchOpMode,
  setLayout,
  asLiteral,
  asParam,
  asExpr,
  type Graph,
  type NodeId,
} from '$lib/cad/composition-graph';
import { compileSketch, chordToAbs, absToChord, type SketchOp } from '$lib/cad/sketch';
import { sketchColLayout } from '$lib/cad/sketch-layout';
import { sketchCols, CARD_PAD, CARD_TITLE_H, PARAM_H, PARAM_GAP } from './geom';
import { evalArg, sketchParamScope, argToDraftStr } from './args';
import { releaseImplicitCapture } from './pointer-capture';
import type { WireState } from './wire-state.svelte';

const MINI_PX = 10, MINI_PY = 10, MINI_GAP = 46, MINI_SCW = 152, MINI_FOOT_H = 58;
const r3 = (n: number) => Math.round(n * 1000) / 1000;
/** Shortest distance from point (px,py) to segment a→b (clamped to the ends). */
function ptSegDist(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx, cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

export class SketchState {
  // ─── core editing state ────────────────────────────────────────────────
  editingSketchId = $state<string | null>(null);
  sketchTool = $state<'select' | 'line' | 'spline' | 'fillet' | 'chamfer'>('select');
  sketchSvgEl = $state<SVGSVGElement | null>(null);
  miniSvgEl = $state<SVGSVGElement | null>(null);
  // FROZEN viewBox frame (see the freeze $effect in GraphEditorPane).
  frame = $state<{ minX: number; maxX: number; minY: number; maxY: number } | null>(null);
  sketchDrag = $state<{ opIdx: number } | null>(null);
  selectedCornerOpIdx = $state<number | null>(null);
  selectedSplineOpIdx = $state<number | null>(null);
  splineDrag = $state<{ which: 'pt' | 'h0' | 'h1'; ptIdx?: number } | null>(null);
  sketchPanDrag = $state<{ minX: number; maxX: number; minY: number; maxY: number; px: number; py: number; sx: number; sy: number } | null>(null);
  sketchBarPos = $state<{ x: number; y: number }>({ x: 16, y: 10 });
  sketchCardPos = $state<{ params: { x: number; y: number }; sketch: { x: number; y: number } }>(
    { params: { x: 64, y: 56 }, sketch: { x: 64, y: 244 } },
  );
  sketchCardSize = $state<{ w: number; h: number } | null>(null);
  sketchOpsScrollTop = $state(0);
  sketchExprPop = $state<{ sid: NodeId; opIdx: number; field: 'r' | 'z' | 'radius' | 'dist'; draft: string; drafts?: { r: string; z: string }; x: number; y: number } | null>(null);
  sketchDelArmed = $state(false);

  // ─── non-reactive drag temporaries (only read inside handlers) ──────────
  sketchBarDrag: { sx: number; sy: number; px: number; py: number } | null = null;
  sketchCardDrag: { which: 'params' | 'sketch'; sx: number; sy: number; px: number; py: number } | null = null;
  sketchCardResize: { sw: number; sh: number; px: number; py: number } | null = null;
  sketchExprPopDrag: { dx: number; dy: number } | null = null;
  sketchLastTap: { opIdx: number; t: number } | null = null;
  sketchTapMoved = false;

  #getGraph: () => Graph;
  #setGraph: (g: Graph) => void;
  wire: WireState;
  getPcs: () => { w: number; h: number };
  getParamW: () => number;

  constructor(
    getGraph: () => Graph,
    setGraph: (g: Graph) => void,
    wire: WireState,
    getPcs: () => { w: number; h: number },
    getParamW: () => number,
  ) {
    this.#getGraph = getGraph;
    this.#setGraph = setGraph;
    this.wire = wire;
    this.getPcs = getPcs;
    this.getParamW = getParamW;
  }

  // ─── derived views ──────────────────────────────────────────────────────
  /** The active sketch resolved to numbers: compiled outline + draggable
   *  anchors + extents (for the editor viewBox). */
  sketchEditor = $derived.by(() => {
    if (!this.editingSketchId) return null;
    const graph = this.#getGraph();
    const node = graph.nodes[this.editingSketchId] as any;
    if (!node || node.type !== 'sketch') return null;
    const p = sketchParamScope(graph);
    const ops: SketchOp[] = node.ops.map((o: any) => {
      if (o.op === 'line') return { op: 'line', r: evalArg(o.r, p), z: evalArg(o.z, p), mode: o.mode };
      if (o.op === 'spline') return {
        op: 'spline', r: evalArg(o.r, p), z: evalArg(o.z, p), mode: o.mode,
        pts: (o.pts ?? []).map((c: any) => [evalArg(c[0], p), evalArg(c[1], p)] as [number, number]),
        h0: o.h0 ? [evalArg(o.h0[0], p), evalArg(o.h0[1], p)] as [number, number] : undefined,
        h1: o.h1 ? [evalArg(o.h1[0], p), evalArg(o.h1[1], p)] as [number, number] : undefined,
      };
      if (o.op === 'fillet') return { op: 'fillet', radius: evalArg(o.radius, p) };
      return { op: 'chamfer', dist: evalArg(o.dist, p) };
    });
    const seg = node.segments ? evalArg(node.segments, p) : 64;
    let pts: [number, number][] = [];
    try { pts = compileSketch(ops, seg); } catch { pts = []; }
    const anchors: { opIdx: number; r: number; z: number; kind: string; literal: boolean; rel: boolean; corner: 'fillet' | 'chamfer' | null; cornerOpIdx: number | null }[] = [];
    // Accumulate a running cursor so relative (Δr,Δz) ops resolve to their
    // ABSOLUTE canvas positions — mirrors compileSketch/toVerts. The first
    // point op is always absolute.
    let cur: [number, number] = [0, 0]; let started = false;
    node.ops.forEach((o: any, i: number) => {
      if (o.op === 'line' || o.op === 'spline') {
        const nx = node.ops[i + 1];
        const corner = nx && (nx.op === 'fillet' || nx.op === 'chamfer') ? nx.op as 'fillet' | 'chamfer' : null;
        const rel = o.mode === 'rel' && started;
        const ar = rel ? cur[0] + evalArg(o.r, p) : evalArg(o.r, p);
        const az = rel ? cur[1] + evalArg(o.z, p) : evalArg(o.z, p);
        cur = [ar, az]; started = true;
        anchors.push({ opIdx: i, r: ar, z: az, kind: o.op, literal: o.r?.kind === 'literal' && o.z?.kind === 'literal', rel, corner, cornerOpIdx: corner ? i + 1 : null });
      }
    });
    const all = [...pts, ...anchors.map((a) => [a.r, a.z] as [number, number])];
    const xs = all.map((q) => q[0]); const ys = all.map((q) => q[1]);
    const minX = Math.min(0, ...xs), maxX = Math.max(1, ...xs), minY = Math.min(0, ...ys), maxY = Math.max(1, ...ys);
    return { node, ops, pts, anchors, ext: { minX, maxX, minY, maxY } };
  });

  /** Whole mini-canvas layout (sketch card rect + viewBox), derived from the
   *  live param count + sketch ops so socket rows + the viewBox track edits. */
  miniLayout = $derived.by(() => {
    const se = this.sketchEditor;
    if (!se) return null;
    const pcs = this.getPcs();
    const sx = MINI_PX + pcs.w + MINI_GAP, sy = MINI_PY;
    // Column-aware (mirrors nodeSize): height = TALLEST column + footer; width =
    // 12 (insets) + innerW. At cols=1: tallestH = op-sum (= old opsH) and
    // scW = 12 + 140 = 152 = MINI_SCW → byte-identical to today.
    const cl = sketchColLayout(se.node.ops as any[], sketchCols(this.#getGraph(), se.node));
    const sch = 36 + cl.tallestH + MINI_FOOT_H;
    const scW = 12 + cl.innerW;
    const w = sx + scW + 12;
    const h = Math.max(MINI_PY + pcs.h, sy + sch) + 12;
    return { sx, sy, sch, scW, w, h };
  });

  selectedCorner = $derived.by(() => {
    if (this.selectedCornerOpIdx == null || !this.editingSketchId) return null;
    const graph = this.#getGraph();
    const node = graph.nodes[this.editingSketchId] as any;
    const o = node?.ops?.[this.selectedCornerOpIdx];
    if (!o || (o.op !== 'fillet' && o.op !== 'chamfer')) return null;
    const p = sketchParamScope(graph);
    const field = o.op === 'fillet' ? 'radius' : 'dist';
    const arg = o[field];                 // the raw ArgValue (literal | param | expr)
    const bound = arg?.kind === 'param' || arg?.kind === 'expr';
    const label = arg?.kind === 'param' ? `p.${arg.param}` : arg?.kind === 'expr' ? String(arg.expr) : null;
    return { idx: this.selectedCornerOpIdx, kind: o.op as 'fillet' | 'chamfer', field, value: evalArg(arg, p), bound, label, paramName: arg?.kind === 'param' ? arg.param : null };
  });

  selectedSpline = $derived.by(() => {
    if (this.selectedSplineOpIdx == null || !this.sketchEditor) return null;
    const se = this.sketchEditor;
    const ai = se.anchors.findIndex((x) => x.opIdx === this.selectedSplineOpIdx);
    if (ai < 0 || se.anchors[ai].kind !== 'spline') return null;
    const b: [number, number] = [se.anchors[ai].r, se.anchors[ai].z];
    // Previous vertex (wraps — the sketch outline is closed), same as the
    // engine's chord start `a`.
    const prev = se.anchors[(ai - 1 + se.anchors.length) % se.anchors.length];
    const a: [number, number] = [prev.r, prev.z];
    const o = se.node.ops[this.selectedSplineOpIdx] as any;
    const p = sketchParamScope(this.#getGraph());
    const pts = (o.pts ?? []).map((c: any, k: number) => {
      const u = evalArg(c[0], p), v = evalArg(c[1], p);
      const abs = chordToAbs(a, b, u, v);
      return { k, x: abs[0], y: abs[1] };
    });
    // Handle dot: stored h displaces off `a` (h0) or `b` (h1); absent → a
    // sensible default along the chord (±1/3) shown as a ghost.
    const handleDot = (h: any, base: 'a' | 'b') => {
      const set = !!h;
      const u = set ? evalArg(h[0], p) : (base === 'a' ? 1 / 3 : -1 / 3);
      const v = set ? evalArg(h[1], p) : 0;
      const absA = chordToAbs(a, b, u, v);        // a + chord-frame disp
      const dx = absA[0] - a[0], dy = absA[1] - a[1];
      const O = base === 'a' ? a : b;
      return { set, x: O[0] + dx, y: O[1] + dy };
    };
    return { opIdx: this.selectedSplineOpIdx, a, b, pts, h0: handleDot(o.h0, 'a'), h1: handleDot(o.h1, 'b') };
  });

  // # of point ops in the popover's sketch — guards the delete button (can't
  // remove the only point).
  sketchPopPtCount = $derived.by(() =>
    this.sketchExprPop ? ((this.#getGraph().nodes[this.sketchExprPop.sid] as any)?.ops ?? []).filter((o: any) => o.op === 'line' || o.op === 'spline').length : 0,
  );

  // ─── open / close ────────────────────────────────────────────────────────
  openSketchEditor = (id: string) => { this.editingSketchId = id; this.sketchTool = 'select'; this.selectedCornerOpIdx = null; this.selectedSplineOpIdx = null; this.frame = null; this.sketchCardSize = null; this.sketchOpsScrollTop = 0; };
  closeSketchEditor = () => { this.editingSketchId = null; this.sketchDrag = null; this.splineDrag = null; this.selectedCornerOpIdx = null; this.selectedSplineOpIdx = null; this.frame = null; this.sketchCardSize = null; this.sketchOpsScrollTop = 0; };

  // ─── mini-graph wire overlay (S.1) ───────────────────────────────────────
  /** client → cards-overlay coords. The overlay SVG (S.2) has NO viewBox and
   *  fills the stage at width/height:100% ⇒ user units are 1:1 with CSS px,
   *  so the mapping is just the rect offset. Drives the in-flight wire. */
  miniEventToCoord = (ev: PointerEvent): { x: number; y: number } | null => {
    if (!this.miniSvgEl) return null;
    const r = this.miniSvgEl.getBoundingClientRect();
    if (!r.width || !r.height) return null;
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  };
  miniPointerMove = (ev: PointerEvent) => {
    if (this.wire.from) { const p = this.miniEventToCoord(ev); if (p) this.wire.mouse = p; }
  };
  miniPointerUp = () => {
    if (!this.wire.from) return;
    // Mirror the main canvas: a no-drag tap that armed the wire stays armed
    // (tap-connect); any other release on empty space cancels the in-flight.
    if (this.wire.tapConnect && this.wire.justArmed && !this.wire.pointerMoved) { this.wire.justArmed = false; return; }
    this.wire.from = null; this.wire.mouse = null; this.wire.justArmed = false;
  };

  // ─── viewBox frame (freeze + fit) ────────────────────────────────────────
  fitSketchFrame = () => {
    if (!this.sketchEditor) return;
    const e = this.sketchEditor.ext;
    this.frame = { minX: e.minX, maxX: e.maxX, minY: e.minY, maxY: e.maxY };
  };

  /** Map a pointer event to sketch (r,z) coords via the SVG viewBox. */
  sketchEventToCoord = (ev: PointerEvent): [number, number] | null => {
    if (!this.sketchSvgEl || !this.sketchEditor) return null;
    const rect = this.sketchSvgEl.getBoundingClientRect();
    const { minX, maxX, minY, maxY } = this.frame ?? this.sketchEditor.ext;
    const pad = Math.max(maxX - minX, maxY - minY) * 0.12 + 0.2;
    const vbW = (maxX - minX) + 2 * pad, vbH = (maxY - minY) + 2 * pad;
    const fx = (ev.clientX - rect.left) / rect.width;
    const fy = (ev.clientY - rect.top) / rect.height;
    const r = (minX - pad) + fx * vbW;
    const z = (minY - pad) + fy * vbH;   // SVG y-down == z-down (revolve), so no flip
    return [Math.round(r * 1000) / 1000, Math.round(z * 1000) / 1000];
  };

  // ─── anchor drag ─────────────────────────────────────────────────────────
  sketchAnchorDown = (ev: PointerEvent, opIdx: number, literal: boolean, kind?: string) => {
    ev.stopPropagation();
    this.sketchTapMoved = false;
    // With the fillet/chamfer tool active, clicking a vertex anchor rounds/
    // bevels THAT corner (exact op index — no nearest-search needed).
    if (this.sketchTool === 'fillet' || this.sketchTool === 'chamfer') { this.cornerAtOpIdx(opIdx); return; }
    if (this.sketchTool !== 'select') return;
    // Click a spline's endpoint anchor → select that spline (reveals its
    // through-point + end-handle dots); clicking any other anchor clears it.
    if (kind === 'spline') { this.selectedSplineOpIdx = opIdx; this.selectedCornerOpIdx = null; }
    else this.selectedSplineOpIdx = null;
    if (!literal) return;
    this.sketchDrag = { opIdx };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  };
  sketchAnchorMove = (ev: PointerEvent) => {
    if (!this.sketchDrag || !this.editingSketchId) return;
    this.sketchTapMoved = true;
    const c = this.sketchEventToCoord(ev); if (!c) return;
    // For a relative (Δ) op, write the delta from the previous vertex's
    // absolute position so the increment is preserved; else write absolute.
    const node = this.#getGraph().nodes[this.editingSketchId] as any;
    const op = node?.ops?.[this.sketchDrag.opIdx];
    const se = this.sketchEditor;
    let r = c[0], z = c[1];
    if (op?.mode === 'rel' && se) {
      const ai = se.anchors.findIndex((a) => a.opIdx === this.sketchDrag!.opIdx);
      if (ai > 0) { const prev = se.anchors[ai - 1]; r = +(c[0] - prev.r).toFixed(3); z = +(c[1] - prev.z).toFixed(3); }
    }
    this.#setGraph(setSketchOpField(this.#getGraph(), this.editingSketchId, this.sketchDrag.opIdx, 'r', { kind: 'literal', value: r }));
    this.#setGraph(setSketchOpField(this.#getGraph(), this.editingSketchId, this.sketchDrag.opIdx, 'z', { kind: 'literal', value: z }));
  };
  sketchAnchorUp = () => { this.sketchDrag = null; };

  // Mobile equivalent of the mouse ondblclick → open the point's coordinate
  // popover. `dblclick` doesn't reliably fire for touch, so detect a
  // double-TAP (two quick taps on the same anchor with no drag between).
  sketchAnchorTap = (ev: PointerEvent, sid: NodeId, opIdx: number, curR: string) => {
    if (ev.pointerType !== 'touch') return;        // mouse path is ondblclick
    if (this.sketchTapMoved) { this.sketchLastTap = null; return; } // it was a drag, not a tap
    if (this.sketchTool !== 'select') return;
    const now = Date.now();
    if (this.sketchLastTap && this.sketchLastTap.opIdx === opIdx && now - this.sketchLastTap.t < 350) {
      this.sketchLastTap = null;
      this.openSketchExprPop(ev as unknown as MouseEvent, sid, opIdx, 'r', curR);
    } else {
      this.sketchLastTap = { opIdx, t: now };
    }
  };

  // ─── M.3: per-corner fillet/chamfer + radius dial ────────────────────────
  /** Bind / unbind the selected corner's radius|dist to a param `p.<name>`. */
  bindCornerParam = (name: string) => {
    const sc = this.selectedCorner; if (!sc || !this.editingSketchId) return;
    if (name === '__literal__' || name === '') {
      this.#setGraph(setSketchOpField(this.#getGraph(), this.editingSketchId, sc.idx, sc.field as any, { kind: 'literal', value: Math.max(0, Math.round(sc.value * 1000) / 1000) }));
    } else {
      this.#setGraph(setSketchOpField(this.#getGraph(), this.editingSketchId, sc.idx, sc.field as any, asParam(name)));
    }
  };
  /** Round/bevel the corner at vertex op `vIdx` with the active tool, then
   *  select it for the radius/dist dial. */
  cornerAtOpIdx = (vIdx: number) => {
    if (!this.editingSketchId) return;
    this.selectedSplineOpIdx = null;
    const node = this.#getGraph().nodes[this.editingSketchId] as any;
    const next = node.ops[vIdx + 1];
    if (next && (next.op === 'fillet' || next.op === 'chamfer')) {
      if (next.op !== this.sketchTool) {
        this.#setGraph(removeSketchOp(this.#getGraph(), this.editingSketchId, vIdx + 1));
        this.#setGraph(addSketchOp(this.#getGraph(), this.editingSketchId, this.sketchTool as any, vIdx));
      }
    } else {
      this.#setGraph(addSketchOp(this.#getGraph(), this.editingSketchId, this.sketchTool as any, vIdx));
    }
    this.selectedCornerOpIdx = vIdx + 1;
  };
  /** Canvas click with the fillet/chamfer tool → round the NEAREST vertex. */
  applyCornerAt = (c: [number, number]) => {
    if (!this.editingSketchId) return;
    const se = this.sketchEditor;
    if (!se || !se.anchors.length) {
      this.#setGraph(addSketchOp(this.#getGraph(), this.editingSketchId, this.sketchTool as any));
      this.selectedCornerOpIdx = (this.#getGraph().nodes[this.editingSketchId] as any).ops.length - 1;
      return;
    }
    let bestOpIdx = -1, bestD = Infinity;
    for (const a of se.anchors) {
      const d = Math.hypot(a.r - c[0], a.z - c[1]);
      if (d < bestD) { bestD = d; bestOpIdx = a.opIdx; }
    }
    this.cornerAtOpIdx(bestOpIdx);
  };
  setCornerValue = (v: number) => {
    const sc = this.selectedCorner; if (!sc || !this.editingSketchId) return;
    this.#setGraph(setSketchOpField(this.#getGraph(), this.editingSketchId, sc.idx, sc.field as any, { kind: 'literal', value: Math.max(0, Math.round(v * 1000) / 1000) }));
  };
  removeSelectedCorner = () => {
    if (this.selectedCornerOpIdx == null || !this.editingSketchId) return;
    this.#setGraph(removeSketchOp(this.#getGraph(), this.editingSketchId, this.selectedCornerOpIdx));
    this.selectedCornerOpIdx = null;
  };

  // ─── Phase 2: spline-as-entity editing ───────────────────────────────────
  splineCompDown = (ev: PointerEvent, which: 'pt' | 'h0' | 'h1', ptIdx?: number) => {
    ev.stopPropagation();
    if (this.sketchTool !== 'select') return;
    this.splineDrag = { which, ptIdx };
    (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId);
  };
  splineCompMove = (ev: PointerEvent) => {
    if (!this.splineDrag || !this.editingSketchId) return;
    const ss = this.selectedSpline; if (!ss) return;
    const c = this.sketchEventToCoord(ev); if (!c) return;
    const { a, b } = ss;
    if (this.splineDrag.which === 'pt') {
      const [u, v] = absToChord(a, b, c);
      this.#setGraph(setSketchSplinePoint(this.#getGraph(), this.editingSketchId, ss.opIdx, this.splineDrag.ptIdx!, 'u', asLiteral(r3(u))));
      this.#setGraph(setSketchSplinePoint(this.#getGraph(), this.editingSketchId, ss.opIdx, this.splineDrag.ptIdx!, 'v', asLiteral(r3(v))));
    } else {
      // h0 displaces off a (use the pointer directly); h1 displaces off b —
      // shift the pointer into a's frame so absToChord yields the (u,v) of the
      // displacement off b.
      const which = this.splineDrag.which;
      const p: [number, number] = which === 'h0' ? c : [a[0] + (c[0] - b[0]), a[1] + (c[1] - b[1])];
      const [u, v] = absToChord(a, b, p);
      this.#setGraph(setSketchSplineHandle(this.#getGraph(), this.editingSketchId, ss.opIdx, which, 'u', asLiteral(r3(u))));
      this.#setGraph(setSketchSplineHandle(this.#getGraph(), this.editingSketchId, ss.opIdx, which, 'v', asLiteral(r3(v))));
    }
  };
  splineCompUp = (ev: PointerEvent) => { releaseImplicitCapture(ev); this.splineDrag = null; };
  addSplinePt = () => {
    if (this.selectedSplineOpIdx == null || !this.editingSketchId) return;
    this.#setGraph(addSketchSplinePoint(this.#getGraph(), this.editingSketchId, this.selectedSplineOpIdx));
  };
  removeSplinePt = () => {
    const ss = this.selectedSpline; if (!ss || ss.pts.length === 0 || !this.editingSketchId) return;
    this.#setGraph(removeSketchSplinePoint(this.#getGraph(), this.editingSketchId, ss.opIdx, ss.pts.length - 1));
  };
  autoTangentSpline = () => {
    if (this.selectedSplineOpIdx == null || !this.editingSketchId) return;
    this.#setGraph(clearSketchSplineHandle(this.#getGraph(), this.editingSketchId, this.selectedSplineOpIdx, 'h0'));
    this.#setGraph(clearSketchSplineHandle(this.#getGraph(), this.editingSketchId, this.selectedSplineOpIdx, 'h1'));
  };

  // ─── canvas click (add op, edge-aware insert) ────────────────────────────
  sketchCanvasClick = (ev: PointerEvent) => {
    if (!this.editingSketchId) return;
    if (this.sketchTool === 'select') {
      this.selectedSplineOpIdx = null;
      // Begin a view PAN — drag the empty canvas to reposition the view for
      // better visibility. (Anchors/sockets stopPropagation on their own
      // pointerdown, so this only fires on empty canvas.) A click with no
      // movement leaves the frame unchanged (just deselects, above).
      const se2 = this.sketchEditor;
      if (se2 && this.sketchSvgEl) {
        const f = this.frame ?? se2.ext;
        const pad = Math.max(f.maxX - f.minX, f.maxY - f.minY) * 0.12 + 0.2;
        const vbW = (f.maxX - f.minX) + 2 * pad, vbH = (f.maxY - f.minY) + 2 * pad;
        const rect = this.sketchSvgEl.getBoundingClientRect();
        this.sketchPanDrag = { minX: f.minX, maxX: f.maxX, minY: f.minY, maxY: f.maxY,
          px: ev.clientX, py: ev.clientY, sx: vbW / rect.width, sy: vbH / rect.height };
        try { (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
      }
      return;
    }
    const c = this.sketchEventToCoord(ev); if (!c) return;
    if (this.sketchTool === 'fillet' || this.sketchTool === 'chamfer') { this.applyCornerAt(c); return; }
    // Edge-aware insertion (line/spline): find the nearest edge between
    // consecutive vertices (incl. the closing edge back to the first), then
    // insert the op after that edge's START vertex so it lands between them.
    let afterIdx: number | undefined;
    const se = this.sketchEditor;
    if (se && se.anchors.length >= 2) {
      const an = se.anchors;
      const f = this.frame ?? se.ext;
      const span = Math.max(f.maxX - f.minX, f.maxY - f.minY) || 1;
      const thresh = span * 0.15;
      let bestD = Infinity, bestStart = -1;
      for (let i = 0; i < an.length; i++) {
        const a = an[i], b = an[(i + 1) % an.length];
        const d = ptSegDist(c[0], c[1], a.r, a.z, b.r, b.z);
        if (d < bestD) { bestD = d; bestStart = i; }
      }
      if (bestStart >= 0 && bestD <= thresh) {
        const start = an[bestStart];
        // Skip past the start vertex's own corner op (if any) so the fillet/
        // chamfer stays attached to the original vertex, not the new one.
        afterIdx = start.cornerOpIdx ?? start.opIdx;
      }
    }
    this.#setGraph(addSketchOp(this.#getGraph(), this.editingSketchId, this.sketchTool, afterIdx));
    const node = this.#getGraph().nodes[this.editingSketchId] as any;
    const idx = typeof afterIdx === 'number' ? afterIdx + 1 : node.ops.length - 1;
    this.#setGraph(setSketchOpField(this.#getGraph(), this.editingSketchId, idx, 'r', { kind: 'literal', value: c[0] }));
    this.#setGraph(setSketchOpField(this.#getGraph(), this.editingSketchId, idx, 'z', { kind: 'literal', value: c[1] }));
  };

  // ─── pan + zoom the sketcher VIEW ────────────────────────────────────────
  sketchCanvasWheel = (ev: WheelEvent) => {
    if (!this.editingSketchId) return;
    const f = this.frame ?? this.sketchEditor?.ext;
    if (!f) return;
    ev.preventDefault();
    const c = this.sketchEventToCoord(ev as unknown as PointerEvent); if (!c) return;
    const k = ev.deltaY > 0 ? 1.12 : 1 / 1.12;   // out / in, zoom toward cursor
    this.frame = {
      minX: c[0] - (c[0] - f.minX) * k, maxX: c[0] + (f.maxX - c[0]) * k,
      minY: c[1] - (c[1] - f.minY) * k, maxY: c[1] + (f.maxY - c[1]) * k,
    };
  };

  // ─── draggable top toolbar ───────────────────────────────────────────────
  sketchBarDown = (ev: PointerEvent) => {
    ev.stopPropagation();
    this.sketchBarDrag = { sx: this.sketchBarPos.x, sy: this.sketchBarPos.y, px: ev.clientX, py: ev.clientY };
    try { (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  };
  sketchBarMove = (ev: PointerEvent) => {
    if (!this.sketchBarDrag) return;
    this.sketchBarPos = { x: this.sketchBarDrag.sx + (ev.clientX - this.sketchBarDrag.px), y: this.sketchBarDrag.sy + (ev.clientY - this.sketchBarDrag.py) };
  };
  sketchBarUp = (ev: PointerEvent) => {
    if (!this.sketchBarDrag) return;
    this.sketchBarDrag = null;
    try { (ev.currentTarget as Element).releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  };

  // ─── S.2: floating PARAMS + sketch cards over the 2D canvas ──────────────
  sketchCardResizeDown = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    const w = this.sketchCardSize?.w ?? MINI_SCW;
    const h = this.sketchCardSize?.h ?? (this.miniLayout?.sch ?? 200);
    this.sketchCardResize = { sw: w, sh: h, px: ev.clientX, py: ev.clientY };
    try { (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  };
  sketchCardResizeMove = (ev: PointerEvent) => {
    if (!this.sketchCardResize) return;
    const d = this.sketchCardResize;
    this.sketchCardSize = {
      w: Math.max(140, d.sw + (ev.clientX - d.px)),
      h: Math.max(120, d.sh + (ev.clientY - d.py)),
    };
  };
  sketchCardResizeUp = (ev: PointerEvent) => {
    if (!this.sketchCardResize) return;
    this.sketchCardResize = null;
    releaseImplicitCapture(ev);
  };
  sketchCardDown = (ev: PointerEvent, which: 'params' | 'sketch') => {
    if (ev.button !== 0) return;
    ev.stopPropagation();
    releaseImplicitCapture(ev);
    const p = this.sketchCardPos[which];
    this.sketchCardDrag = { which, sx: p.x, sy: p.y, px: ev.clientX, py: ev.clientY };
  };
  /** Stage-level pointermove. The cards overlay is pointer-events:none over
   *  its empty area (so drawing passes through), so an in-flight wire over the
   *  empty canvas would lose its move events — the STAGE always gets them. One
   *  handler covers both: a card-title drag OR in-flight wire tracking. */
  sketchStageMove = (ev: PointerEvent) => {
    if (this.sketchPanDrag) {
      const d = this.sketchPanDrag;
      const dx = (ev.clientX - d.px) * d.sx, dy = (ev.clientY - d.py) * d.sy;
      this.frame = { minX: d.minX - dx, maxX: d.maxX - dx, minY: d.minY - dy, maxY: d.maxY - dy };
      return;
    }
    if (this.sketchCardDrag) {
      const d = this.sketchCardDrag;
      this.sketchCardPos = { ...this.sketchCardPos, [d.which]: { x: d.sx + (ev.clientX - d.px), y: d.sy + (ev.clientY - d.py) } };
      return;
    }
    if (this.wire.from) { const p = this.miniEventToCoord(ev); if (p) this.wire.mouse = p; }
  };
  sketchStageUp = (_ev: PointerEvent) => {
    if (this.sketchPanDrag) { this.sketchPanDrag = null; return; }
    if (this.sketchCardDrag) { this.sketchCardDrag = null; return; }
    this.miniPointerUp();
  };
  /** Param OUTPUT socket centre, ABS in cards-overlay px — tracks the params
   *  card as it drags (mirrors miniParamSock but offset by sketchCardPos). */
  miniParamSockAbs = (i: number) => {
    return {
      x: this.sketchCardPos.params.x + CARD_PAD + this.getParamW() + CARD_PAD + 4,
      y: this.sketchCardPos.params.y + CARD_TITLE_H + CARD_PAD + i * (PARAM_H + PARAM_GAP) + PARAM_H / 2,
    };
  };
  /** S.3: map a sketch (r,z) coord → cards-overlay px so a param→point wire can
   *  be drawn in the overlay (where the PARAMS card lives) but land on the
   *  point as it actually renders in the 2D SVG. Replicates the SVG's
   *  preserveAspectRatio="xMidYMid meet" letterboxing. */
  sketchPtToOverlay = (r: number, z: number): { x: number; y: number } | null => {
    const f = this.frame ?? this.sketchEditor?.ext;
    if (!f || !this.sketchSvgEl) return null;
    const rect = this.sketchSvgEl.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const span = Math.max(f.maxX - f.minX, f.maxY - f.minY) || 1;
    const pad = span * 0.12 + 0.2;
    const minVX = f.minX - pad, minVY = f.minY - pad;
    const vbW = (f.maxX - f.minX) + 2 * pad, vbH = (f.maxY - f.minY) + 2 * pad;
    const scale = Math.min(rect.width / vbW, rect.height / vbH);
    const ox = (rect.width - vbW * scale) / 2;
    const oy = (rect.height - vbH * scale) / 2;
    const sx = rect.left + ox + (r - minVX) * scale;
    const sy = rect.top + oy + (z - minVY) * scale;
    if (!this.miniSvgEl) return { x: sx, y: sy };
    const orect = this.miniSvgEl.getBoundingClientRect();
    return { x: sx - orect.left, y: sy - orect.top };
  };

  // ─── Sketch coord expression popover (S.2) ───────────────────────────────
  /** The ƒ button on a sketch-card coord row (r / z / fillet radius /
   *  chamfer dist) opens this. Edit a JS expression → the coord becomes
   *  kind:'expr'. Keyed to a sketch op field, written via setSketchOpField. */
  openSketchExprPop = (ev: MouseEvent, sid: NodeId, opIdx: number, field: 'r' | 'z' | 'radius' | 'dist', currentExpr: string) => {
    ev.stopPropagation();
    // For a point coordinate (line/spline r/z) populate BOTH axis drafts so
    // the popover shows r AND z behind a tab strip. fillet radius / chamfer
    // dist are single-value, no tabs.
    let drafts: { r: string; z: string } | undefined;
    if (field === 'r' || field === 'z') {
      const op = (this.#getGraph().nodes[sid] as any)?.ops?.[opIdx];
      const other: 'r' | 'z' = field === 'r' ? 'z' : 'r';
      drafts = { [field]: currentExpr, [other]: argToDraftStr(op?.[other]) } as { r: string; z: string };
    }
    this.sketchExprPop = { sid, opIdx, field, draft: currentExpr, drafts, x: ev.clientX, y: ev.clientY };
    this.sketchDelArmed = false;
  };
  /** Flip the popover's point between abs and Δ relative, then refresh the
   *  drafts from the (possibly converted) stored coords. */
  toggleSketchExprPopMode = () => {
    if (!this.sketchExprPop || !this.sketchExprPop.drafts) return;
    const op = (this.#getGraph().nodes[this.sketchExprPop.sid] as any)?.ops?.[this.sketchExprPop.opIdx];
    if (!op || (op.op !== 'line' && op.op !== 'spline')) return;
    this.toggleSketchOpMode(this.sketchExprPop.sid, this.sketchExprPop.opIdx, op);
    const op2 = (this.#getGraph().nodes[this.sketchExprPop.sid] as any)?.ops?.[this.sketchExprPop.opIdx];
    if (!op2) return;
    const drafts = { r: argToDraftStr(op2.r), z: argToDraftStr(op2.z) } as { r: string; z: string };
    const field = this.sketchExprPop.field === 'z' ? 'z' : 'r';
    this.sketchExprPop = { ...this.sketchExprPop, drafts, draft: drafts[field] };
  };
  switchSketchExprAxis = (newAxis: 'r' | 'z') => {
    if (!this.sketchExprPop || !this.sketchExprPop.drafts) return;
    const old = this.sketchExprPop.field;
    if (old === newAxis) return;
    this.sketchExprPop = {
      ...this.sketchExprPop,
      drafts: { ...this.sketchExprPop.drafts, [old]: this.sketchExprPop.draft } as { r: string; z: string },
      field: newAxis,
      draft: this.sketchExprPop.drafts[newAxis],
    };
  };
  // Per-line abs/relative coord toggle. The axis label doubles as the control:
  // click it to flip the op between absolute (r/z) and incremental (Δr/Δz).
  // For LITERAL coords we convert the value (abs↔delta vs the previous vertex)
  // so the point doesn't jump; expr/param coords just flip the flag.
  toggleSketchOpMode = (sid: NodeId, idx: number, op: any) => {
    const toRel = op?.mode !== 'rel';
    const se = this.sketchEditor;
    if (se && op?.r?.kind === 'literal' && op?.z?.kind === 'literal') {
      const ai = se.anchors.findIndex((a) => a.opIdx === idx);
      if (ai > 0) {
        const prev = se.anchors[ai - 1], curAbs = se.anchors[ai]; // anchors are resolved absolutes
        const r = toRel ? +(curAbs.r - prev.r).toFixed(3) : +curAbs.r.toFixed(3);
        const z = toRel ? +(curAbs.z - prev.z).toFixed(3) : +curAbs.z.toFixed(3);
        this.#setGraph(setSketchOpField(this.#getGraph(), sid, idx, 'r', { kind: 'literal', value: r }));
        this.#setGraph(setSketchOpField(this.#getGraph(), sid, idx, 'z', { kind: 'literal', value: z }));
      }
    }
    this.#setGraph(setSketchOpMode(this.#getGraph(), sid, idx, toRel ? 'rel' : 'abs'));
  };
  /** Axis label that reflects the op's coord mode: Δr/Δz when relative,
   *  r/z (or spl r/spl z for splines) when absolute. */
  sketchAxisLabel = (op: any, axis: 'r' | 'z'): string => {
    if (op?.mode === 'rel') return axis === 'r' ? 'Δr' : 'Δz';
    return op?.op === 'spline' ? (axis === 'r' ? 'spl r' : 'spl z') : axis;
  };
  closeSketchExprPop = () => { this.sketchExprPop = null; this.sketchDelArmed = false; };
  // Two-step delete confirm (no native dialog — that blocks the extension):
  // first click ARMS the button, second click within the armed state deletes.
  onSketchDeleteClick = () => {
    if (!this.sketchDelArmed) { this.sketchDelArmed = true; return; }
    this.deleteSketchExprPopPoint();
  };
  /** Delete the point (op) the popover is editing, then close. */
  deleteSketchExprPopPoint = () => {
    if (!this.sketchExprPop) return;
    this.#setGraph(removeSketchOp(this.#getGraph(), this.sketchExprPop.sid, this.sketchExprPop.opIdx));
    this.sketchExprPop = null;
    this.sketchDelArmed = false;
  };
  // Drag the point popover by its header (grab the title bar). Mirrors the
  // sketch-toolbar drag — offset-based so the cursor stays where you grabbed.
  sketchExprPopDown = (ev: PointerEvent) => {
    if (!this.sketchExprPop) return;
    ev.preventDefault(); ev.stopPropagation();
    this.sketchExprPopDrag = { dx: ev.clientX - this.sketchExprPop.x, dy: ev.clientY - this.sketchExprPop.y };
    try { (ev.currentTarget as Element).setPointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  };
  sketchExprPopMove = (ev: PointerEvent) => {
    if (!this.sketchExprPopDrag || !this.sketchExprPop) return;
    this.sketchExprPop = { ...this.sketchExprPop, x: ev.clientX - this.sketchExprPopDrag.dx, y: ev.clientY - this.sketchExprPopDrag.dy };
  };
  sketchExprPopUp = (ev: PointerEvent) => {
    if (!this.sketchExprPopDrag) return;
    this.sketchExprPopDrag = null;
    try { (ev.currentTarget as Element).releasePointerCapture?.(ev.pointerId); } catch { /* ignore */ }
  };
  applySketchExprPop = () => {
    if (!this.sketchExprPop) return;
    if (this.sketchExprPop.drafts) {
      // Dual r/z: fold the active tab's live draft back in, write both axes.
      const drafts = { ...this.sketchExprPop.drafts, [this.sketchExprPop.field]: this.sketchExprPop.draft } as { r: string; z: string };
      this.#setGraph(setSketchOpField(this.#getGraph(), this.sketchExprPop.sid, this.sketchExprPop.opIdx, 'r', asExpr(drafts.r)));
      this.#setGraph(setSketchOpField(this.#getGraph(), this.sketchExprPop.sid, this.sketchExprPop.opIdx, 'z', asExpr(drafts.z)));
    } else {
      this.#setGraph(setSketchOpField(this.#getGraph(), this.sketchExprPop.sid, this.sketchExprPop.opIdx, this.sketchExprPop.field, asExpr(this.sketchExprPop.draft)));
    }
    this.sketchExprPop = null;
  };
  insertParamIntoSketchDraft = (name: string) => {
    if (!this.sketchExprPop) return;
    const ref = `p.${name}`;
    const draft = this.sketchExprPop.draft;
    const sep = draft.length > 0 && !/\s$/.test(draft) ? ' ' : '';
    this.sketchExprPop = { ...this.sketchExprPop, draft: draft + sep + ref };
  };

  // ─── layout: column count ────────────────────────────────────────────────
  setSketchCols = (id: NodeId, cols: 1 | 2 | 3) => {
    const cur = this.#getGraph().layout[id] ?? { x: 0, y: 0 };
    this.#setGraph(setLayout(this.#getGraph(), id, { ...cur, cols }));
  };
}
