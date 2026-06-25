/**
 * poly-preview-state.svelte.ts — PER-INSTANCE state + handlers for the polygon
 * 2D-preview overlay (R6a, GEP modularize; mirrors SketchState / WireState).
 *
 * Owns the floating SVG vertex editor: the pinned popover that shows a polygon's
 * (r,z) points and lets you drag / insert / delete vertices, plus the popover's
 * own chrome (open/close, fit/zoom, resize, drag-to-move, snap-back).
 *
 * NOT a module singleton — `/primitives` mounts N panes, so each pane gets its
 * own `new PolyPreviewState(...)` (a module-level `$state` would leak drag state
 * across panes). Construct with getters/setters into the pane's `graph` +
 * `profileSet`, and a callback to open the SHELL-owned `polyExprPop` (that
 * popover is shared by the polygon/poly_repeat node cards AND the mv/rot/txfmn
 * transform axes, so it stays in the GEP shell — the Phase-E precedent).
 *
 * Handlers are arrow-function FIELDS so `this` is always bound (they're used as
 * event handlers in markup AND passed by reference, e.g. `polygonModeFor` →
 * NodeCard).
 */
import {
  addPolygonPoint, removePolygonPoint, setPolygonCoord,
  type Graph, type NodeId,
} from '$lib/cad/composition-graph';
import { entryIdxForEvalIdx } from './geom';

type Mode = 'revolve' | 'cartesian';

export class PolyPreviewState {
  #getGraph: () => Graph;
  #setGraph: (g: Graph) => void;
  #getProfileSet: () => Mode;
  /** Open the shell-owned coord ƒ-popover. */
  openExprPop: (ev: any, polygonId: string, idx: number, axis: 'r' | 'z', currentExpr: string) => void;

  get graph(): Graph { return this.#getGraph(); }
  get profileSet(): Mode { return this.#getProfileSet(); }

  // ─── state ─────────────────────────────────────────────────────────────
  polyPreviewFor = $state<string | null>(null);
  polyPreviewPos = $state<{ left: number; top: number }>({ left: 0, top: 0 });
  polyPreviewPinned = $state<boolean>(true);
  polyPreviewView = $state<{ cx: number; cy: number; half: number }>({ cx: 0.5, cy: 0.5, half: 0.7 });
  polyPreviewSize = $state<{ w: number; h: number }>({ w: 240, h: 240 });
  polyPreviewResize = $state<{ startW: number; startH: number; startX: number; startY: number } | null>(null);
  polyPreviewDrag = $state<{ startX: number; startY: number; startLeft: number; startTop: number } | null>(null);
  polyDeleteMode = $state<boolean>(false);
  polyDrag = $state<{
    polyId: string; idx: number; svgEl: SVGSVGElement; mode: Mode;
    startX: number; startY: number; startTime: number; moved: boolean; parametric: boolean;
  } | null>(null);
  polyInsertMode = $state<boolean>(false);
  polyInsertHover = $state<null | {
    i: number; ax: number; ay: number; bx: number; by: number; px: number; py: number; blocked: boolean;
  }>(null);
  polyHoverVertex = $state<null | { i: number; px: number; py: number; parametric: boolean; inRepeat: boolean }>(null);

  constructor(
    getGraph: () => Graph,
    setGraph: (g: Graph) => void,
    getProfileSet: () => Mode,
    openExprPop: PolyPreviewState['openExprPop'],
  ) {
    this.#getGraph = getGraph;
    this.#setGraph = setGraph;
    this.#getProfileSet = getProfileSet;
    this.openExprPop = openExprPop;
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem('ge-poly-preview-size');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed?.w === 'number' && typeof parsed?.h === 'number') {
            this.polyPreviewSize = { w: Math.max(160, Math.round(parsed.w)), h: Math.max(160, Math.round(parsed.h)) };
          }
        }
      } catch { /* ignore */ }
    }
  }

  // ─── mode helpers (pure over graph + profileSet) ─────────────────────────
  polyRepeatModeFor = (repeatId: string): Mode => {
    for (const n of Object.values(this.graph.nodes)) {
      if ((n as any).type !== 'polygon') continue;
      const pts = (n as any).points ?? [];
      for (const p of pts) {
        if (p?.kind === 'repeat-ref' && p.sourceId === repeatId) return this.polygonModeFor((n as any).id);
      }
    }
    return this.profileSet;
  };
  polygonModeFor = (polyId: string): Mode => {
    for (const n of Object.values(this.graph.nodes)) {
      if ((n as any).type !== 'call') continue;
      const args = (n as any).args ?? {};
      for (const v of Object.values(args)) {
        if ((v as any).kind !== 'expr') continue;
        const expr = String((v as any).expr ?? '');
        if (!expr.includes('__POLY__' + polyId)) continue;
        const src = String((n as any).src ?? '');
        if (src === 'r_weld_extrude' || src === 'r_extrude') return 'cartesian';
        if (src === 'r_revolve') return 'revolve';
      }
    }
    return this.profileSet;
  };

  // ─── popover chrome (resize / drag / snap / open / fit / zoom) ────────────
  startPolyPreviewResize = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    this.polyPreviewResize = { startW: this.polyPreviewSize.w, startH: this.polyPreviewSize.h, startX: ev.clientX, startY: ev.clientY };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.stopPropagation(); ev.preventDefault();
  };
  polyPreviewResizeMove = (ev: PointerEvent) => {
    if (!this.polyPreviewResize) return;
    const r = this.polyPreviewResize;
    this.polyPreviewSize = {
      w: Math.max(160, Math.round(r.startW + (ev.clientX - r.startX))),
      h: Math.max(160, Math.round(r.startH + (ev.clientY - r.startY))),
    };
  };
  polyPreviewResizeEnd = (ev: PointerEvent) => {
    if (!this.polyPreviewResize) return;
    (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
    this.polyPreviewResize = null;
    try { localStorage.setItem('ge-poly-preview-size', JSON.stringify(this.polyPreviewSize)); } catch { /* ignore */ }
  };
  startPolyPreviewDrag = (ev: PointerEvent) => {
    if (ev.button !== 0) return;
    this.polyPreviewDrag = { startX: ev.clientX, startY: ev.clientY, startLeft: this.polyPreviewPos.left, startTop: this.polyPreviewPos.top };
    (ev.currentTarget as Element).setPointerCapture(ev.pointerId);
    ev.stopPropagation(); ev.preventDefault();
  };
  polyPreviewDragMove = (ev: PointerEvent) => {
    if (!this.polyPreviewDrag) return;
    const d = this.polyPreviewDrag;
    this.polyPreviewPos = { left: Math.max(0, d.startLeft + (ev.clientX - d.startX)), top: Math.max(0, d.startTop + (ev.clientY - d.startY)) };
  };
  polyPreviewDragEnd = (ev: PointerEvent) => {
    if (!this.polyPreviewDrag) return;
    (ev.currentTarget as Element).releasePointerCapture(ev.pointerId);
    this.polyPreviewDrag = null;
  };
  snapPolyPreviewToCard = () => {
    if (!this.polyPreviewFor) return;
    if (typeof document === 'undefined') return;
    const cardEl = document.querySelector(`[data-node-id="${this.polyPreviewFor}"]`) as Element | null;
    const r = cardEl?.getBoundingClientRect();
    if (r) this.polyPreviewPos = { left: r.right + 24, top: r.top };
  };
  openPolyPreview = (ev: PointerEvent, polyId: string) => {
    ev.stopPropagation();
    if (this.polyPreviewFor === polyId) { this.polyPreviewFor = null; this.polyPreviewPinned = true; return; }
    const target = ev.currentTarget as Element | null;
    const card = (target as any)?.closest?.('.ge-node') as Element | null;
    const r = (card ?? target)?.getBoundingClientRect();
    if (r) this.polyPreviewPos = { left: r.right + 24, top: r.top };
    this.polyPreviewFor = polyId;
    this.fitPolyPreview();
  };
  fitPolyPreview = () => {
    if (!this.polyPreviewFor) return;
    const node = this.graph.nodes[this.polyPreviewFor];
    if (!node || node.type !== 'polygon') return;
    const pts = this.polyToPoints(node);
    const isCart = this.polygonModeFor(this.polyPreviewFor) === 'cartesian';
    let xMin = 0, xMax = 1, yMin = 0, yMax = 1;
    if (pts.length > 0) {
      const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
      xMin = Math.min(...xs); xMax = Math.max(...xs); yMin = Math.min(...ys); yMax = Math.max(...ys);
    }
    if (isCart) {
      const half = Math.max(Math.abs(xMin), Math.abs(xMax), Math.abs(yMin), Math.abs(yMax), 0.001) * 1.16;
      this.polyPreviewView = { cx: 0, cy: 0, half };
    } else {
      const w = Math.max(xMax - xMin, 0.001); const h = Math.max(yMax - yMin, 0.001);
      this.polyPreviewView = { cx: (xMin + xMax) / 2, cy: (yMin + yMax) / 2, half: Math.max(w, h) / 2 * 1.16 };
    }
  };
  zoomPolyPreview = (factor: number) => {
    this.polyPreviewView = { ...this.polyPreviewView, half: Math.max(0.001, this.polyPreviewView.half * factor) };
  };
  appendPolyPoint = () => {
    if (!this.polyPreviewFor) return;
    this.#setGraph(addPolygonPoint(this.graph, this.polyPreviewFor));
  };
  togglePolyDeleteMode = () => { this.polyDeleteMode = !this.polyDeleteMode; this.polyDrag = null; };
  deletePolyVertexAt = (polyId: string, idx: number) => {
    const n = this.graph.nodes[polyId] as any;
    if (!n?.points || n.points.length <= 1) return;
    this.#setGraph(removePolygonPoint(this.graph, polyId, idx));
  };

  // ─── point evaluation ────────────────────────────────────────────────────
  polyToPoints = (node: any): [number, number][] => {
    if (!node || node.type !== 'polygon') return [];
    const params: Record<string, number> = {};
    for (const [k, v] of Object.entries(this.graph.params ?? {})) params[k] = Number((v as any)?.default ?? 0);
    const evalCoord = (val: any, extra?: Record<string, number>): number => {
      try {
        if (!val) return 0;
        if (val.kind === 'literal') return Number(val.value) || 0;
        if (val.kind === 'param') return Number(params[val.param]) || 0;
        if (val.kind === 'expr') {
          const env = { ...params, ...(extra ?? {}) };
          const keys = Object.keys(env);
          const args = keys.map((k) => env[k]);
          const fn = new Function('p', 'Math', 'PI', 'tau', 'cos', 'sin', 'tan', 'sqrt', 'abs', ...keys, `return (${String(val.expr)});`);
          const out = fn(params, Math, Math.PI, 2 * Math.PI, Math.cos, Math.sin, Math.tan, Math.sqrt, Math.abs, ...args);
          return Number.isFinite(out) ? Number(out) : 0;
        }
      } catch { /* ignore */ }
      return 0;
    };
    const out: [number, number][] = [];
    for (const entry of (node.points as any[])) {
      if (entry?.kind === 'repeat-ref') {
        const src = this.graph.nodes[entry.sourceId] as any;
        if (!src || src.type !== 'poly_repeat') continue;
        const n = Math.max(0, Math.min(2048, Math.round(evalCoord(src.count))));
        const loopVar = String(src.loopVar || 'i');
        const bindings = Array.isArray(src.bindings) ? src.bindings : [];
        for (let i = 0; i < n; i++) {
          const extra: Record<string, number> = { [loopVar]: i, NPts: n };
          for (const b of bindings) { if (!b || typeof b.name !== 'string' || !b.name) continue; extra[b.name] = evalCoord(b.value, extra); }
          out.push([evalCoord(src.r, extra), evalCoord(src.z, extra)]);
        }
        continue;
      }
      if (entry?.kind === 'repeat') {
        const n = Math.max(0, Math.min(2048, Math.round(evalCoord(entry.count))));
        const loopVar = String(entry.loopVar || 'i');
        for (let i = 0; i < n; i++) out.push([evalCoord(entry.r, { [loopVar]: i }), evalCoord(entry.z, { [loopVar]: i })]);
        continue;
      }
      out.push([evalCoord(entry?.r), evalCoord(entry?.z)]);
    }
    return out;
  };

  // ─── vertex drag ──────────────────────────────────────────────────────────
  startPolyVertexDrag = (ev: PointerEvent, polyId: string, idx: number, mode: Mode) => {
    if (ev.button !== 0) return;
    const node: any = this.graph.nodes[polyId];
    if (!node || node.type !== 'polygon') return;
    const pt = node.points?.[idx];
    if (!pt) return;
    const parametric = pt.r?.kind !== 'literal' || pt.z?.kind !== 'literal';
    const circle = ev.currentTarget as SVGCircleElement;
    const svgEl = circle.ownerSVGElement;
    if (!svgEl) return;
    ev.stopPropagation(); ev.preventDefault();
    try { circle.setPointerCapture(ev.pointerId); } catch { /* older browsers */ }
    this.polyDrag = { polyId, idx, svgEl, mode, parametric, startX: ev.clientX, startY: ev.clientY, startTime: (typeof performance !== 'undefined' ? performance : Date).now(), moved: false };
  };
  polyDragMove = (ev: PointerEvent) => {
    if (!this.polyDrag) return;
    const d = this.polyDrag;
    const dist = Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY);
    if (dist < 3) return;
    this.polyDrag.moved = true;
    if (d.parametric) return;
    const svgEl = d.svgEl;
    const vb = svgEl.viewBox?.baseVal;
    const rect = svgEl.getBoundingClientRect();
    if (!vb || rect.width === 0 || rect.height === 0) return;
    const svgX = vb.x + (ev.clientX - rect.left) * vb.width / rect.width;
    const svgY = vb.y + (ev.clientY - rect.top) * vb.height / rect.height;
    const rRounded = Math.round(svgX * 1000) / 1000;
    const zRounded = Math.round((d.mode === 'cartesian' ? -svgY : svgY) * 1000) / 1000;
    let g = setPolygonCoord(this.graph, d.polyId, d.idx, 'r', { kind: 'literal', value: rRounded });
    g = setPolygonCoord(g, d.polyId, d.idx, 'z', { kind: 'literal', value: zRounded });
    this.#setGraph(g);
  };
  polyDragEnd = (ev: PointerEvent) => {
    if (!this.polyDrag) return;
    const d = this.polyDrag;
    const target = ev.currentTarget as SVGCircleElement | null;
    try { target?.releasePointerCapture(ev.pointerId); } catch { /* ignore */ }
    this.polyDrag = null;
    const dt = (typeof performance !== 'undefined' ? performance : Date).now() - d.startTime;
    if (d.moved || dt >= 250) return;
    if (this.polyDeleteMode) { this.deletePolyVertexAt(d.polyId, d.idx); return; }
    const node: any = this.graph.nodes[d.polyId];
    const pt = node?.points?.[d.idx];
    if (!pt) return;
    const axis: 'r' | 'z' = (pt.r.kind !== 'literal') ? 'r' : (pt.z.kind !== 'literal') ? 'z' : 'r';
    const cur = pt[axis];
    const initialExpr = cur.kind === 'expr' ? cur.expr : cur.kind === 'param' ? `p.${cur.param}` : String(cur.value ?? 0);
    this.openExprPop(ev as any, d.polyId, d.idx, axis, initialExpr);
  };

  // ─── insert mode + vertex-proximity hover ─────────────────────────────────
  togglePolyInsertMode = () => {
    this.polyInsertMode = !this.polyInsertMode;
    if (this.polyInsertMode) this.polyDeleteMode = false;
    if (!this.polyInsertMode) this.polyInsertHover = null;
    this.polyDrag = null;
  };
  clearPolyInsertHover = () => { this.polyInsertHover = null; this.polyHoverVertex = null; };
  handleSvgInsertMove = (ev: PointerEvent, polyId: string, isCart: boolean) => {
    const svgEl = ev.currentTarget as SVGSVGElement;
    const vb = svgEl?.viewBox?.baseVal;
    const rect = svgEl?.getBoundingClientRect();
    if (!vb || !rect || rect.width === 0 || rect.height === 0) { this.polyInsertHover = null; this.polyHoverVertex = null; return; }
    const svgX = vb.x + (ev.clientX - rect.left) * vb.width / rect.width;
    const svgY = vb.y + (ev.clientY - rect.top) * vb.height / rect.height;
    const graphX = svgX;
    const graphY = isCart ? -svgY : svgY;
    const node: any = this.graph.nodes[polyId];
    if (!node || node.type !== 'polygon') { this.polyInsertHover = null; this.polyHoverVertex = null; return; }
    const pts = this.polyToPoints(node);
    if (pts.length === 0) { this.polyInsertHover = null; this.polyHoverVertex = null; return; }
    const hitR = this.polyPreviewView.half * 0.09;
    let bestVi = -1, bestVd = Infinity;
    for (let i = 0; i < pts.length; i++) {
      const d = Math.hypot(graphX - pts[i][0], graphY - pts[i][1]);
      if (d < hitR && d < bestVd) { bestVd = d; bestVi = i; }
    }
    if (bestVi >= 0) {
      const entryIdx = entryIdxForEvalIdx(this.graph, node, bestVi);
      const inRepeat = entryIdx === null;
      const entry = entryIdx !== null ? node.points[entryIdx] : null;
      const parametric = inRepeat || (entry && (entry.r?.kind !== 'literal' || entry.z?.kind !== 'literal'));
      this.polyHoverVertex = { i: bestVi, px: pts[bestVi][0], py: pts[bestVi][1], parametric: !!parametric, inRepeat };
    } else { this.polyHoverVertex = null; }
    if (!this.polyInsertMode) { this.polyInsertHover = null; return; }
    if (pts.length < 2) { this.polyInsertHover = null; return; }
    let bestI = -1, bestD = Infinity, bestPx = 0, bestPy = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; const b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0]; const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) continue;
      let t = ((graphX - a[0]) * dx + (graphY - a[1]) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a[0] + t * dx; const py = a[1] + t * dy;
      const d = Math.hypot(graphX - px, graphY - py);
      if (d < bestD) { bestD = d; bestI = i; bestPx = px; bestPy = py; }
    }
    if (bestI < 0) { this.polyInsertHover = null; return; }
    const b = pts[(bestI + 1) % pts.length];
    const blocked = entryIdxForEvalIdx(this.graph, node, bestI) === null;
    this.polyInsertHover = { i: bestI, ax: pts[bestI][0], ay: pts[bestI][1], bx: b[0], by: b[1], px: bestPx, py: bestPy, blocked };
  };
  handleSvgInsertClick = (ev: MouseEvent, polyId: string, isCart: boolean) => {
    if (!this.polyInsertMode) return;
    const svgEl = (ev.currentTarget as SVGSVGElement);
    const vb = svgEl?.viewBox?.baseVal;
    const rect = svgEl?.getBoundingClientRect();
    if (!vb || !rect || rect.width === 0 || rect.height === 0) return;
    const svgX = vb.x + (ev.clientX - rect.left) * vb.width / rect.width;
    const svgY = vb.y + (ev.clientY - rect.top) * vb.height / rect.height;
    const graphX = svgX;
    const graphY = isCart ? -svgY : svgY;
    const node: any = this.graph.nodes[polyId];
    if (!node || node.type !== 'polygon') return;
    const pts = this.polyToPoints(node);
    if (pts.length < 2) { this.#setGraph(addPolygonPoint(this.graph, polyId)); return; }
    let bestI = -1, bestD = Infinity, bestPx = 0, bestPy = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]; const b = pts[(i + 1) % pts.length];
      const dx = b[0] - a[0]; const dy = b[1] - a[1];
      const len2 = dx * dx + dy * dy;
      if (len2 < 1e-9) continue;
      let t = ((graphX - a[0]) * dx + (graphY - a[1]) * dy) / len2;
      t = Math.max(0, Math.min(1, t));
      const px = a[0] + t * dx; const py = a[1] + t * dy;
      const d = Math.hypot(graphX - px, graphY - py);
      if (d < bestD) { bestD = d; bestI = i; bestPx = px; bestPy = py; }
    }
    if (bestI < 0) return;
    const entryIdx = entryIdxForEvalIdx(this.graph, node, bestI);
    if (entryIdx === null) return;  // edge inside a repeat block — refuse
    const r = Math.round(bestPx * 1000) / 1000;
    const z = Math.round(bestPy * 1000) / 1000;
    let g = addPolygonPoint(this.graph, polyId, entryIdx);
    g = setPolygonCoord(g, polyId, entryIdx + 1, 'r', { kind: 'literal', value: r });
    g = setPolygonCoord(g, polyId, entryIdx + 1, 'z', { kind: 'literal', value: z });
    this.#setGraph(g);
  };
}
