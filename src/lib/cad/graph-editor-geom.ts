/**
 * graph-editor-geom.ts — pure position / socket / card geometry helpers for
 * the node-graph CAD editor (`GraphEditorPane.svelte`).
 *
 * EXTRACTED 2026-06-16 (modularize plan P1 / G1, `docs/plans/modularize.md`).
 * These are the "crown jewel of fragility" socket↔DOM Y-math functions: they
 * compute SVG circle/wire positions that MUST match the pixel heights of the
 * HTML rows rendered inside `<foreignObject>` node cards. Co-locating them in
 * ONE documented + tested module is the whole point of the extraction.
 *
 * RULE: every function here is PURE — no component `$state`, no DOM, no
 * closures over `graph`/`zoom`/`pan`. Anything they previously captured is now
 * an EXPLICIT parameter (usually `graph` first). Outputs are byte-identical to
 * the in-component originals for the same inputs — the editor's whole
 * socket/wire alignment depends on that.
 *
 * Z-down convention holds (top = LOWER z); none of this math touches the sign.
 */
import {
  inlineTransformOf,
  type Graph,
  type NodeId,
  type MvNode,
  type RotNode,
} from '$lib/cad/composition-graph';
import { sketchColLayout, SKETCH_COL_W, SKETCH_COL_GAP } from '$lib/cad/sketch-layout';

// ─── Params-card geometry constants ────────────────────────────────────────
// Outer card sits at (CARD_X0, CARD_Y0); the title bar takes CARD_TITLE_H;
// chips fill the body below. Each chip is PARAM_W × PARAM_H with PARAM_GAP
// between rows. (CARD_Y0 is component-derived from the Properties card height,
// so it is passed IN to the functions that need it — not a constant here.)
export const CARD_X0 = 8;
export const CARD_PAD = 8;
export const CARD_TITLE_H = 26;
export const PARAM_W_MIN = 124;
export const PARAM_H = 22;
export const PARAM_GAP = 2;
export const PARAM_PIN_W = 14;     // 📌 column (icon only)
export const PARAM_INPUT_W = 48;   // numeric input column
export const PARAM_TRASH_W = 18;   // 🗑 column
export const PARAM_GAPS = 4 * 6;   // 4× 6 px gap between pin/name/val/trash
export const PARAM_CHIP_PAD = 12;  // 6 px L + R chip padding

// ─── Polygon card row geometry ─────────────────────────────────────────────
// The left-edge sockets + incoming wires are SVG, but the rows are HTML inside
// a foreignObject — these constants MUST mirror the CSS:
//   .ge-poly-vertex  43px + 2px margin-bottom → 45px pitch
//   .ge-poly-rref    36px border-box + 2px     → 38px pitch
//   .ge-poly-repeat  (deprecated inline) ≈ 72px + 2px margin
// Rows are heterogeneous, so socket Y is a cumulative walk, not idx*pitch.
export const POLY_VTX_PITCH = 45;
export const POLY_RREF_PITCH = 38;

// ─── Inline mv/rot transform STRIP geometry ────────────────────────────────
// Inline transforms render as compact STRIPS hanging off the Call card's RIGHT
// edge, cascading down-then-right. Per-axis socket positions, param→axis wire
// endpoints, and the wrapper OUTPUT socket are ALL derived from the helpers
// below so the visible circle and the wire endpoint can never diverge.
export const STRIP_W = 92;
export const STRIP_H = 44;
export const STRIP_GAP = 2;       // card right edge → first strip column (flush)
export const STRIP_ROW_GAP = 10;  // vertical gap between row 0 and row 1
export const STRIP_COL_GAP = 8;   // horizontal gap between columns (≥3 transforms)
export const STRIP_TOP = 2;       // cluster top, relative to card top
export const STRIP_PAD = 6;       // strip inner horizontal padding (socket x math)

// ─── Mini sketch-overlay canvas constants ──────────────────────────────────
export const MINI_PX = 10;
export const MINI_PY = 10;

// ─── card obstacle type (passed into `bezier`) ─────────────────────────────
export type CardObstacle = { id: string; x: number; y: number; w: number; h: number };

/**
 * Cubic-bezier wire path that ROUTES AROUND card bodies the default S-curve
 * would cut through. Endpoint cards (a socket sits on their edge) are excluded
 * from the obstacle set; remaining blockers lift the control points to a clear
 * Y level so the wire arches cleanly over/under them. `obstacles` was the
 * component-derived `cardObstacles` (now passed in).
 */
export function bezier(
  obstacles: CardObstacle[],
  x1: number, y1: number, x2: number, y2: number,
): string {
  const dx = Math.max(40, Math.abs(x2 - x1) * 0.4);
  const cx1 = x1 + dx, cy1 = y1;
  const cx2 = x2 - dx, cy2 = y2;
  const defaultPath = `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
  // Tiny wires (e.g. a self-edge or the in-flight stub) don't need routing.
  const span = Math.hypot(x2 - x1, y2 - y1);
  if (span < 60 || obstacles.length === 0) return defaultPath;

  const EDGE_TOLERANCE = 10;
  const CLEAR_BUF = 28; // px above/below blocking cards
  const onEdge = (px: number, py: number, o: CardObstacle) =>
    px >= o.x - EDGE_TOLERANCE && px <= o.x + o.w + EDGE_TOLERANCE &&
    py >= o.y - EDGE_TOLERANCE && py <= o.y + o.h + EDGE_TOLERANCE;

  // Endpoint cards — wires START and END on socket points that sit on card
  // edges; those cards are NOT obstacles for this wire.
  const endpointCards = new Set<string>();
  for (const o of obstacles) {
    if (onEdge(x1, y1, o) || onEdge(x2, y2, o)) endpointCards.add(o.id);
  }

  // Sample a cubic bezier; return the worst intrusion (top + bottom clearance
  // of every offending card). Runs on the default path AND each lifted pass.
  function intrudeBounds(ax: number, ay: number, bx: number, by: number, cAx: number, cAy: number, cBx: number, cBy: number) {
    const samples = 14;
    let topClear = Infinity, botClear = -Infinity;
    let hits = 0;
    for (let i = 1; i < samples; i++) {
      const t = i / samples;
      const t1 = 1 - t;
      const sx = t1*t1*t1*ax + 3*t1*t1*t*cAx + 3*t1*t*t*cBx + t*t*t*bx;
      const sy = t1*t1*t1*ay + 3*t1*t1*t*cAy + 3*t1*t*t*cBy + t*t*t*by;
      for (const o of obstacles) {
        if (endpointCards.has(o.id)) continue;
        if (sx >= o.x && sx <= o.x + o.w && sy >= o.y && sy <= o.y + o.h) {
          hits++;
          if (o.y < topClear) topClear = o.y - CLEAR_BUF;
          if (o.y + o.h > botClear) botClear = o.y + o.h + CLEAR_BUF;
        }
      }
    }
    return { hits, topClear, botClear };
  }

  const first = intrudeBounds(x1, y1, x2, y2, cx1, cy1, cx2, cy2);
  if (first.hits === 0) return defaultPath;
  const midY = (y1 + y2) / 2;
  let goUp = (midY - first.topClear) <= (first.botClear - midY);
  let arcY = goUp ? first.topClear : first.botClear;

  for (let pass = 0; pass < 4; pass++) {
    const re = intrudeBounds(x1, y1, x2, y2, cx1, arcY, cx2, arcY);
    if (re.hits === 0) break;
    if (goUp)  arcY = Math.min(arcY, re.topClear);
    else       arcY = Math.max(arcY, re.botClear);
  }
  return `M ${x1} ${y1} C ${cx1} ${arcY}, ${cx2} ${arcY}, ${x2} ${y2}`;
}

/** Chip width that fits the longest `p.<name>` label without clipping.
 *  Caller passes the longest label CHAR COUNT (incl. the `p.` prefix). */
export function chipWidthFor(longestLabelChars: number): number {
  const labelPx = Math.max(40, Math.ceil(longestLabelChars * 7.5));
  const w = PARAM_CHIP_PAD + PARAM_PIN_W + PARAM_GAPS + labelPx + PARAM_INPUT_W + PARAM_TRASH_W;
  return Math.max(PARAM_W_MIN, w);
}

/** Position of the i-th chip's top-left INSIDE the params card.
 *  `cardY0` was the component-derived CARD_Y0 (Properties-card height + gap). */
export function paramPos(cardY0: number, _name: string, i: number): { x: number; y: number } {
  return {
    x: CARD_X0 + CARD_PAD,
    y: cardY0 + CARD_TITLE_H + CARD_PAD + i * (PARAM_H + PARAM_GAP),
  };
}

/** Card outer rect dimensions — derived from chip count + chip width. */
export function paramCardSize(n: number, chipW: number): { w: number; h: number } {
  return {
    w: CARD_PAD * 2 + chipW,
    h: CARD_TITLE_H + CARD_PAD * 2 + Math.max(1, n) * PARAM_H + Math.max(0, n - 1) * PARAM_GAP,
  };
}

/** Pull every `p.<ident>` reference out of an expression string. Returns
 *  unique names in first-occurrence order. */
export function extractParamRefs(expr: string): string[] {
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

/** Where a param chip's OUTPUT socket sits — in GRAPH space (the wires render
 *  inside the pan/zoom group, so we convert from the chip's fixed viewport
 *  position back into graph coords). `cardY0`/`paramW`/`pan`/`zoom` were
 *  captured component state, now passed in. */
export function paramSocketPos(
  cardY0: number, paramW: number, pan: { x: number; y: number }, zoom: number,
  name: string, i: number,
): { x: number; y: number } {
  const p = paramPos(cardY0, name, i);
  const vx = p.x + paramW + CARD_PAD + 4;
  const vy = p.y + PARAM_H / 2;
  // viewport → graph: invert outer transform `translate(pan) ∘ scale(zoom)`.
  return { x: (vx - pan.x) / zoom, y: (vy - pan.y) / zoom };
}

/** Minimum content width per card type (key column + input + actions + pad). */
export function cardMinWidth(node: any): number {
  if (node.type === 'call')   return 168; // 70 key + 76 value + 22 chrome
  if (node.type === 'method') return 96;  // ⊖ + label + × (sockets sit on edges)
  if (node.type === 'mv' || node.type === 'rot') return 116;
  if (node.type === 'repeat') return 170;
  if (node.type === 'list' || node.type === 'stack' || node.type === 'group') return 110;
  if (node.type === 'polygon') return 180; // input + chrome fits at 180
  return 130;
}

/** Auto-fit width from the card's content (title + longest arg key + value
 *  footprint). The DEFAULT width when no user override is set. */
export function cardAutoWidth(graph: Graph, node: any): number {
  if (node.type === 'call') {
    const argKeys = Object.keys(node.args ?? {});
    const titleChars = (node.alias?.length ?? 0) + 3 + (node.src?.length ?? 0); // "A · dt_tube"
    const longestKey = argKeys.length ? Math.max(...argKeys.map((k) => k.length)) : 4;
    const keyW = Math.max(70, longestKey * 8 + 8);
    const valueW = 124; // input + ƒ + × comfortably
    const padding = 22;
    const fromArgs = keyW + valueW + padding;
    const fromTitle = titleChars * 7 + 50; // ⇄ ↻ × glyphs + side padding
    return Math.max(220, fromArgs, fromTitle);
  }
  if (node.type === 'method') return 110;
  if (node.type === 'mv' || node.type === 'rot') return 136;
  if (node.type === 'repeat') return 230;
  if (node.type === 'polygon') return 200; // narrowed for the vertical-stack layout
  if (node.type === 'list' || node.type === 'stack' || node.type === 'group') {
    const labels: string[] = [];
    for (const cid of (node as any).children ?? []) {
      const child = graph.nodes[cid];
      if (!child) continue;
      labels.push(
        child.type === 'call'   ? `${(child as any).alias} · ${(child as any).src}` :
        child.type === 'method' ? `${(child as any).op}(…)` :
        child.type === 'mv'     ? 'mv(…)' :
        child.type === 'rot'    ? 'rot(…)' :
        child.type === 'stack'  ? 'stack(…)' :
        child.type === 'repeat' ? `repeat × ${(child as any).count?.kind === 'literal' ? (child as any).count.value : '…'}` :
        '(missing)',
      );
    }
    const longest = labels.length ? Math.max(...labels.map((s) => s.length)) : 12;
    const titleW = 90; // ▶ Output + gear with padding
    const inlineFieldsW = node.type === 'stack' ? 96 : 0;
    const rowW = longest * 7 + 18 + inlineFieldsW + 44 + 14 + 16;
    return Math.max(120, Math.max(rowW, titleW));
  }
  return 180;
}

export function polyEntryH(pt: any): number {
  if (pt?.kind === 'repeat-ref') return POLY_RREF_PITCH;
  if (pt?.kind === 'repeat') return 74; // deprecated inline block
  return POLY_VTX_PITCH;
}
/** Y of the idx-th row's top edge, in CARD coords (0 = card top). */
export function polyRowTop(node: any, idx: number): number {
  const pts: any[] = node?.points ?? [];
  let y = 36; // header + divider = the foreignObject's y offset
  for (let i = 0; i < Math.min(idx, pts.length); i++) y += polyEntryH(pts[i]);
  return y;
}
/** Socket centers in CARD coords. r/z sit on the two stacked sub-rows; a
 *  repeat-ref row has ONE socket centered on its 36px body. */
export function polySockR(node: any, idx: number): number { return polyRowTop(node, idx) + 12; }
export function polySockZ(node: any, idx: number): number { return polyRowTop(node, idx) + 31; }
export function polySockRef(node: any, idx: number): number { return polyRowTop(node, idx) + 18; }

// ─── Sketch op row geometry (mirrors the polygon pattern) ──────────────────
// Delegates to sketchColLayout (pure, tested) so HTML rows + SVG sockets share
// ONE column partition. `cols` defaults to 1 → byte-identical to the legacy
// single-column walk (36 + Σ sketchEntryH(prior ops)).
/** Column count for a sketch node — persisted in graph.layout[id].cols. */
export function sketchCols(graph: Graph, node: any): 1 | 2 | 3 {
  const c = (graph.layout[node?.id] as any)?.cols;
  return c === 2 || c === 3 ? c : 1;
}
export function sketchRowTop(node: any, idx: number, cols: 1 | 2 | 3 = 1): number {
  return sketchColLayout(node?.ops ?? [], cols).byIdx[idx]?.yTop ?? 36;
}
export function sketchSockR(node: any, idx: number, cols: 1 | 2 | 3 = 1): number { return sketchRowTop(node, idx, cols) + 12; }
export function sketchSockZ(node: any, idx: number, cols: 1 | 2 | 3 = 1): number { return sketchRowTop(node, idx, cols) + 31; }
export function sketchSockVal(node: any, idx: number, cols: 1 | 2 | 3 = 1): number { return sketchRowTop(node, idx, cols) + 12; }
/** Column left-socket X. Col 0 keeps cx=0 (hangs on the card's left border);
 *  col>0 sits at that column's left content edge. */
export function sketchSockX(node: any, idx: number, cols: 1 | 2 | 3 = 1): number {
  const c = sketchColLayout(node?.ops ?? [], cols).byIdx[idx]?.col ?? 0;
  return c === 0 ? 0 : c * (SKETCH_COL_W + SKETCH_COL_GAP);
}
/** A row's sockets hide once its top scrolls outside the visible card band
 *  [36, scH]. `scrollTop` was component state `sketchOpsScrollTop`. */
export function sketchRowVisible(scrollTop: number, node: any, idx: number, scH: number, cols: 1 | 2 | 3 = 1): boolean {
  const top = sketchRowTop(node, idx, cols) - scrollTop;
  return top >= 36 && top <= scH;
}

/** Card outer size. Width: graph.layout[id].w (persisted) → cardAutoWidth
 *  fallback, clamped to cardMinWidth. */
export function nodeSize(graph: Graph, node: any): { w: number; h: number } {
  const savedW = graph.layout[node.id]?.w;
  const baseW = typeof savedW === 'number' ? savedW : cardAutoWidth(graph, node);
  const w = Math.max(cardMinWidth(node), baseW);
  if (node.type === 'call') {
    const argCount = Object.keys(node.args ?? {}).length;
    return { w, h: Math.max(80, 50 + argCount * 22) };
  }
  if (node.type === 'method') return { w, h: 64 };
  if (node.type === 'mv' || node.type === 'rot') return { w, h: 110 };
  if (node.type === 'repeat') return { w, h: 110 };
  if (node.type === 'list' || node.type === 'stack' || node.type === 'group') {
    const slots = (node.children?.length ?? 0) + 1;
    return { w, h: Math.max(60, 40 + slots * 22) };
  }
  if (node.type === 'polygon') {
    const MAX_VISIBLE = 8;
    const pts: any[] = (node as any).points ?? [];
    const rows = pts.slice(0, MAX_VISIBLE);
    const savedH = graph.layout[node.id]?.h;
    const rowsH = rows.length
      ? rows.reduce((a, pt) => a + polyEntryH(pt), 0)
      : POLY_VTX_PITCH;
    const autoH = 36 + rowsH + 30;
    const h = typeof savedH === 'number' ? Math.max(120, savedH) : autoH;
    return { w, h };
  }
  if (node.type === 'sketch') {
    const cols = sketchCols(graph, node);
    const cl = sketchColLayout((node as any).ops ?? [], cols);
    const savedH = graph.layout[node.id]?.h;
    const autoH = 36 + Math.max(44, cl.tallestH) + 62;
    const h = typeof savedH === 'number' ? Math.max(140, savedH) : autoH;
    const autoW = 12 + cl.innerW; // 12 = foreignObject 6px insets
    return { w: Math.max(w, 210, autoW, cols * 80), h };
  }
  if (node.type === 'poly_repeat') {
    const bindings = (node as any).bindings ?? [];
    const bindingsH = 28 + bindings.length * 22 + 24; // hdr + rows + add btn
    return { w: 240, h: 154 + bindingsH - 24 };
  }
  return { w, h: 80 };
}

/** Input socket Y for the i-th child slot of a container (list/stack/group). */
export function containerSlotY(i: number): number { return 40 + i * 22; }

/** Layout position of a node (graph.layout[id], origin fallback). */
export function nodePos(graph: Graph, id: NodeId): { x: number; y: number } {
  return graph.layout[id] ?? { x: 0, y: 0 };
}

/** Is `nodeId` an INLINE mv/rot wrapper of a Call (no layout slot of its own)?
 *  Moved with the socket math because `outputSocketAt` needs it. */
export function isInlineWrapper(graph: Graph, nodeId: NodeId): boolean {
  const n = graph.nodes[nodeId];
  if (!n || (n.type !== 'mv' && n.type !== 'rot')) return false;
  const childId = (n as MvNode | RotNode).child;
  if (!childId) return false;
  const child = graph.nodes[childId];
  return child?.type === 'call' && inlineTransformOf(graph, childId, n.type) === nodeId;
}

// ─── inline mv/rot transform STRIPS — geometry source of truth ─────────────
/** Present inline transforms for a Call, in render order (rot, then mv). */
export function inlineXformOrder(graph: Graph, callId: NodeId): ('rot' | 'mv')[] {
  const order: ('rot' | 'mv')[] = [];
  if (inlineTransformOf(graph, callId, 'rot')) order.push('rot');
  if (inlineTransformOf(graph, callId, 'mv'))  order.push('mv');
  return order;
}
/** Card-LOCAL top-left of a transform's strip (+ its grid cell), or null. */
export function inlineXformStrip(graph: Graph, callId: NodeId, kind: 'rot' | 'mv'):
    { x: number; y: number; col: number; row: number } | null {
  const i = inlineXformOrder(graph, callId).indexOf(kind);
  if (i < 0) return null;
  const col = Math.floor(i / 2), row = i % 2;
  const { w } = nodeSize(graph, graph.nodes[callId]);
  const x = w + STRIP_GAP + col * (STRIP_W + STRIP_COL_GAP);
  const y = STRIP_TOP + row * (STRIP_H + STRIP_ROW_GAP);
  return { x, y, col, row };
}
/** Card-LOCAL centre of the i-th axis socket on a transform strip. Sockets sit
 *  on the TOP edge for row-0 strips, the BOTTOM edge for row-1 strips. */
export function inlineXformSocket(graph: Graph, callId: NodeId, kind: 'rot' | 'mv', i: number):
    { x: number; y: number } | null {
  const s = inlineXformStrip(graph, callId, kind);
  if (!s) return null;
  const usable = STRIP_W - 2 * STRIP_PAD;
  const x = s.x + STRIP_PAD + (i + 0.5) * usable / 3;
  const y = s.row % 2 === 0 ? s.y : s.y + STRIP_H; // top edge / bottom edge
  return { x, y };
}
/** Card-LOCAL wrapper output socket — right edge of the strip cluster, at the
 *  outermost (row-0) strip's vertical centre. */
export function inlineXformOutput(graph: Graph, callId: NodeId): { x: number; y: number } {
  const order = inlineXformOrder(graph, callId);
  const { w } = nodeSize(graph, graph.nodes[callId]);
  const cols = Math.max(1, Math.ceil(order.length / 2));
  const x = w + STRIP_GAP + cols * STRIP_W + (cols - 1) * STRIP_COL_GAP;
  const y = STRIP_TOP + STRIP_H / 2;
  return { x, y };
}
/** Call card height — inline transforms hang off the RIGHT edge now, so they no
 *  longer grow the card. Kept for the bg rect + (legacy) callers. */
export function inlineCardH(graph: Graph, callId: NodeId): number {
  const node = graph.nodes[callId];
  if (!node) return 80;
  return nodeSize(graph, node).h;
}

export function outputSocketAt(graph: Graph, id: NodeId): { x: number; y: number } {
  const node = graph.nodes[id];
  if (!node) return { x: 0, y: 0 };
  const { w, h } = nodeSize(graph, node);
  const p = nodePos(graph, id);
  // An INLINE mv/rot wrapper renders inside its host Call card (it has no layout
  // slot of its own), so its output socket lives on the HOST card's strip-
  // cluster right edge. Uses the SAME inlineXformOutput() the render draws from.
  if ((node.type === 'mv' || node.type === 'rot') && isInlineWrapper(graph, id)) {
    const hostId = (node as MvNode | RotNode).child;
    const hp = nodePos(graph, hostId);
    const o = inlineXformOutput(graph, hostId);
    return { x: hp.x + o.x, y: hp.y + o.y };
  }
  // Standalone mv / rot put their OUTPUT socket on the title row's right edge
  // (y=16); method at y=14; other node types keep the middle-right edge.
  if (node.type === 'mv' || node.type === 'rot') return { x: p.x + w, y: p.y + 16 };
  if (node.type === 'method') return { x: p.x + w, y: p.y + 14 };
  return { x: p.x + w, y: p.y + h / 2 };
}

export function inputSocketAt(graph: Graph, id: NodeId, slot: 'obj' | 'arg' | 'child'): { x: number; y: number } {
  const p = nodePos(graph, id);
  const node = graph.nodes[id];
  if (!node) return p;
  if (slot === 'obj')  return { x: p.x, y: p.y + 42 };
  if (slot === 'arg')  return { x: p.x, y: p.y + 56 };
  // mv / rot put their child socket on the LEFT EDGE, aligned with the title
  // row (y=16). Repeat keeps the legacy bottom-edge position via its renderer.
  if (slot === 'child' && (node.type === 'mv' || node.type === 'rot')) {
    return { x: p.x, y: p.y + 16 };
  }
  /* child (legacy left-edge for method/repeat) */
  return { x: p.x, y: p.y + 50 };
}
/** Container slot input socket — the i-th child slot of a list/stack/group
 *  container's card. */
export function containerSlotInputAt(graph: Graph, containerId: NodeId, i: number): { x: number; y: number } {
  const p = nodePos(graph, containerId);
  return { x: p.x, y: p.y + containerSlotY(i) };
}

/** Cheap PARAMS-only eval for an ArgValue → number. Mirrors the evalCoord
 *  pipeline inside polyToPoints but standalone (no extra loop-var bindings).
 *  Used by entryIdxForEvalIdx to size each repeat span. */
export function evalArgValueScalar(graph: Graph, val: any): number {
  try {
    if (!val) return 0;
    if (val.kind === 'literal') return Number(val.value) || 0;
    if (val.kind === 'param') {
      return Number((graph.params as any)?.[val.param]?.default ?? 0);
    }
    if (val.kind === 'expr') {
      const params: Record<string, number> = {};
      for (const [k, v] of Object.entries(graph.params ?? {})) {
        params[k] = Number((v as any)?.default ?? 0);
      }
      const fn = new Function(
        'p', 'Math', 'PI', 'tau', 'cos', 'sin', 'tan', 'sqrt', 'abs',
        `return (${String(val.expr)});`,
      );
      const out = fn(params, Math, Math.PI, 2 * Math.PI, Math.cos, Math.sin, Math.tan, Math.sqrt, Math.abs);
      return Number.isFinite(out) ? Number(out) : 0;
    }
  } catch { /* ignore */ }
  return 0;
}

/** Map an evaluated-points-index back to the ENTRY index in the polygon's
 *  `points` array. Returns the entry index when the eval idx lands on a literal
 *  vertex; returns null when it falls inside a repeat expansion (those edges
 *  can't be UI-inserted — the user tweaks count/expressions instead). */
export function entryIdxForEvalIdx(graph: Graph, node: any, evalIdx: number): number | null {
  let cursor = 0;
  for (let i = 0; i < node.points.length; i++) {
    const entry = node.points[i];
    let span = 1;
    if (entry?.kind === 'repeat-ref') {
      const src = graph.nodes[entry.sourceId] as any;
      span = (src && src.type === 'poly_repeat')
        ? Math.max(0, Math.min(2048, Math.round(evalArgValueScalar(graph, src.count))))
        : 0;
    } else if (entry?.kind === 'repeat') {
      span = Math.max(0, Math.min(2048, Math.round(evalArgValueScalar(graph, entry.count))));
    }
    if (evalIdx < cursor + span) {
      // Fell inside this entry. Only literal vertices accept a UI insert.
      if (entry?.kind === 'point' || !entry?.kind) return i;
      return null;
    }
    cursor += span;
  }
  return null;
}

// ─── Mini sketch-overlay canvas helpers (mirror the main card math) ─────────
/** Simple cubic for the mini wire layer. (The main `bezier` routes around
 *  main-graph card obstacles whose coords don't apply in this space.) */
export function miniBez(x1: number, y1: number, x2: number, y2: number): string {
  const dx = Math.max(18, Math.abs(x2 - x1) * 0.5);
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
}
/** i-th param chip top-left in mini coords. `paramW` was component PARAM_W. */
export function miniParamPos(paramW: number, i: number) {
  return { x: MINI_PX + CARD_PAD, y: MINI_PY + CARD_TITLE_H + CARD_PAD + i * (PARAM_H + PARAM_GAP) };
}
/** i-th param OUTPUT socket centre in mini coords (mirrors the main card). */
export function miniParamSock(paramW: number, i: number) {
  const p = miniParamPos(paramW, i);
  return { x: p.x + paramW + CARD_PAD + 4, y: p.y + PARAM_H / 2 };
}
