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
  type Graph,
  type NodeId,
  type MvNode,
  type RotNode,
} from '$lib/cad/composition-graph';
import { sketchColLayout, SKETCH_COL_W, SKETCH_COL_GAP } from '$lib/cad/sketch-layout';
import { kindOf } from '$lib/cad/nodes/registry';
import type { SizeConsts } from '$lib/cad/nodes/node-kind';

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

// ─── ▶ Output (root container) compact geometry (#13) ──────────────────────
// The root container renders as a small input box + a big right-pointing arrow.
// The arrow occupies a fixed-width head on the card's RIGHT; the box holds the
// input sockets (left edge, cx=0) + child labels. A min box width + min card
// height keep the arrow legible even with zero / one output wired in.
export const OUTPUT_ARROW_W = 30;   // arrow-head column on the card's right
export const OUTPUT_BOX_MIN_W = 24; // narrow socket column + a small × (no labels)
export const OUTPUT_MIN_H = 56;     // keeps the arrow head legible

// ─── mv/rot transforms — always STANDALONE chainable icon nodes (#25) ───────
// mv/rot render as compact icon cards (nodeSize → {40,40}); child wires IN on
// the left edge, the transformed result OUT on the right. They are NEVER
// attached as strips to a Call — "attached" was a pure rendering choice that
// has been removed. The emit (`rot(mv(A,…),…)`) + graph data (`.child` chain)
// are unchanged; only the rendering decoupled.

// ─── Mini sketch-overlay canvas constants ──────────────────────────────────
export const MINI_PX = 10;
export const MINI_PY = 10;

// ─── Expr block (B.7 v2) card geometry ──────────────────────────────────────
// The Expr block is a floating calculation node (prior art: poly_repeat): N
// AUTO-DERIVED input sockets on the LEFT edge (one per deriveExprInputs name)
// + N DECLARED output sockets on the RIGHT edge (one per output, line-aligned
// to that output's row — the Dynamo Code-Block pattern). Body starts under the
// title + divider at EXPR_BODY_TOP; every row is EXPR_ROW_H tall. Input and
// output indices are INDEPENDENT (different counts) but share the same row
// pitch so a left socket and the right socket on the same visual row line up.
export const EXPR_BODY_TOP = 32;   // title text y≈20 + divider y=28 + 4px gap
export const EXPR_ROW_H = 26;      // one output row / one input socket slot
/** Card-local Y of the idx-th row's TOP edge (0 = card top). */
export function exprRowTop(idx: number): number { return EXPR_BODY_TOP + idx * EXPR_ROW_H; }
/** Card-local Y of the idx-th INPUT socket centre (left edge). */
export function exprInputSockY(idx: number): number { return exprRowTop(idx) + EXPR_ROW_H / 2; }
/** Card-local Y of the idx-th OUTPUT socket centre (right edge), aligned to
 *  that output's row (line-aligned outputs). */
export function exprOutputSockY(idx: number): number { return exprRowTop(idx) + EXPR_ROW_H / 2; }

// ─── Node-kind SizeCtx constant bag (docs/plans/hierarchical-class-design.md) ─
// The single source of truth for these layout numbers stays HERE (the shared
// layer); nodeSize passes this bag into each cad-layer size descriptor so they
// reproduce their arm byte-identically without importing shared.
export const SIZE_CONSTS: SizeConsts = {
  OUTPUT_BOX_MIN_W, OUTPUT_ARROW_W, OUTPUT_MIN_H,
  POLY_VTX_PITCH, POLY_RREF_PITCH,
  EXPR_BODY_TOP, EXPR_ROW_H,
};

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
  if (node.type === 'txfmn') return 150; // combined ROT/MV table
  if (node.type === 'repeat') return 170;
  if (node.type === 'list' || node.type === 'stack' || node.type === 'group') return 110;
  if (node.type === 'polygon') return 180; // input + chrome fits at 180
  if (node.type === 'expr') return 200;    // input-col + output-row (name=formula)
  if (node.type === 'spline') return 92;   // min width — inline row (+20%, bigger click targets)
  if (node.type === 'warp') return 150;    // title + solid/path sockets + opts
  return 130;
}

// ─── Warp / bend node card geometry (#36) ───────────────────────────────────
// A small card: title row + a `solid` child input + a `path` input on the LEFT,
// the bent solid out the RIGHT, and a compact opts row. The two left-socket Y's
// are shared by the NodeCard render AND the WireLayer wire endpoints so they
// can't drift.
export const WARP_CHILD_CY = 40;   // `solid` (child) input socket cy
export const WARP_PATH_CY = 64;    // `path` input socket cy

/** Auto-fit width from the card's content (title + longest arg key + value
 *  footprint). The DEFAULT width when no user override is set. */
export function cardAutoWidth(graph: Graph, node: any): number {
  if (node.type === 'call') {
    const argKeys = Object.keys(node.args ?? {});
    const titleChars = (node.alias?.length ?? 0) + 3 + (node.src?.length ?? 0); // "A · dt_tube"
    const longestKey = argKeys.length ? Math.max(...argKeys.map((k) => k.length)) : 4;
    const keyW = Math.max(64, longestKey * 8 + 8);
    const valueW = 100; // input + ƒ + × (tightened to save horizontal space)
    const padding = 18;
    const fromArgs = keyW + valueW + padding;
    const fromTitle = titleChars * 7 + 44; // ⇄ ↻ × glyphs + side padding
    return Math.max(184, fromArgs, fromTitle);
  }
  if (node.type === 'method') return 110;
  if (node.type === 'mv' || node.type === 'rot') return 136;
  if (node.type === 'txfmn') return 168;
  if (node.type === 'repeat') return 230;
  if (node.type === 'polygon') return 200; // narrowed for the vertical-stack layout
  if (node.type === 'expr') return 260;    // input gutter + name=formula row
  if (node.type === 'spline') return 110;  // inline row: edit | curve | x | socket (+20%)
  if (node.type === 'warp') return 172;    // solid/path labels + opts row
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
        child.type === 'txfmn'  ? 'xform(…)' :
        child.type === 'warp'   ? 'warp(…)' :
        child.type === 'stack'  ? 'stack(…)' :
        child.type === 'repeat' ? `repeat × ${(child as any).count?.kind === 'literal' ? (child as any).count.value : '…'}` :
        '(missing)',
      );
    }
    const longest = labels.length ? Math.max(...labels.map((s) => s.length)) : 12;
    const titleW = 86; // ▶ Output + gear with padding
    const inlineFieldsW = node.type === 'stack' ? 96 : 0;
    // Tightened (#10) — child labels are short ("A · r_revolve"); the old
    // 7px/char + 74px chrome made the Output card wider than it needs to be.
    const rowW = longest * 6 + 16 + inlineFieldsW + 38;
    return Math.max(104, Math.max(rowW, titleW));
  }
  return 180;
}

export function polyEntryH(pt: any): number {
  if (pt?.kind === 'repeat-ref' || pt?.kind === 'expr-list-ref') return POLY_RREF_PITCH;
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
  // Registry (docs/plans/hierarchical-class-design.md): every node type sizes
  // through its descriptor — byte-identical to the old per-type if-chain
  // (pinned by geom.test.ts), now collapsed away (Phase 2). The graph-dependent
  // kinds (container root branch, polygon/sketch persisted h + cols, expr def
  // row-count) read their inputs from the INJECTED ctx (layout slot / exprDefs /
  // geom-owned SizeConsts) so the cad-layer descriptor never imports this module.
  const k = kindOf(node as any);
  if (k) return k.size(node as any, {
    width: w,
    root: (graph as any).root,
    layout: graph.layout[node.id] as any,
    exprDefs: graph.exprDefs,
    consts: SIZE_CONSTS,
  });
  // All 17 node types are registered — the descriptor above returns for every
  // one. This default only guards an unknown/unmigrated type (Phase 2).
  return { w, h: 80 };
}

/** Input socket Y for the i-th child slot of a container (list/stack/group). */
export function containerSlotY(i: number): number { return 40 + i * 22; }

/** Card-local Y of the i-th input socket on the compact ROOT Output card (#13).
 *  The Output card vertically CENTERS its `count` visible (non-consumed) child
 *  sockets within its height (+ a trailing drop socket at i === count). BOTH the
 *  rendered socket circle AND the incoming wire endpoint MUST derive from THIS —
 *  they drifted once: the wire used the top-anchored `containerSlotY(i)` while
 *  the socket render centered, so wires terminated on the wrong socket. */
export function rootOutputSockY(cardH: number, i: number, count: number): number {
  return cardH / 2 - (count * 22) / 2 + i * 22;
}

/** Layout position of a node (graph.layout[id], origin fallback).
 *  mv/rot nodes that lack a persisted layout slot (e.g. transforms that used
 *  to render as strips ATTACHED to a Call, so were never given a position)
 *  AUTO-PLACE offset to the RIGHT of their child instead of piling at 0,0.
 *  This is a pure derived fallback — the first drag persists a real slot. */
export function nodePos(graph: Graph, id: NodeId): { x: number; y: number } {
  const saved = graph.layout[id];
  if (saved) return saved;
  const n = graph.nodes[id];
  if (n && (n.type === 'mv' || n.type === 'rot')) {
    const childId = (n as MvNode | RotNode).child;
    if (childId && graph.nodes[childId] && childId !== id) {
      const cp = nodePos(graph, childId); // child usually HAS a slot → base case
      const cs = nodeSize(graph, graph.nodes[childId]);
      return { x: cp.x + cs.w + 60, y: cp.y };
    }
  }
  return { x: 0, y: 0 };
}

export function outputSocketAt(graph: Graph, id: NodeId): { x: number; y: number } {
  const node = graph.nodes[id];
  if (!node) return { x: 0, y: 0 };
  const { w, h } = nodeSize(graph, node);
  const p = nodePos(graph, id);
  // mv / rot are STANDALONE compact icons (#25) — output on the right edge,
  // vertically centred (cy = h/2), matching the compact-icon render + the
  // left-edge child input. The `.child` chain + emit are unchanged; only the
  // rendering decoupled from the Call card.
  if (node.type === 'mv' || node.type === 'rot') {
    return { x: p.x + w, y: p.y + h / 2 };
  }
  // txfmn is always a standalone card — output on the title-row right edge.
  if (node.type === 'txfmn') return { x: p.x + w, y: p.y + 16 };
  // Method (compact CSG circle) + every other node type: output on the
  // middle-right edge.
  return { x: p.x + w, y: p.y + h / 2 };
}

export function inputSocketAt(graph: Graph, id: NodeId, slot: 'obj' | 'arg' | 'child'): { x: number; y: number } {
  const p = nodePos(graph, id);
  const node = graph.nodes[id];
  if (!node) return p;
  // CSG method circle: A (obj) wires in on TOP, B (arg) on the BOTTOM.
  if (slot === 'obj' || slot === 'arg') {
    const { w, h } = nodeSize(graph, node);
    return slot === 'obj' ? { x: p.x + w / 2, y: p.y } : { x: p.x + w / 2, y: p.y + h };
  }
  // mv / rot are now COMPACT ICONS — child socket on the LEFT EDGE, vertically
  // centred (cy = h/2), matching the render + the right-edge output.
  if (slot === 'child' && (node.type === 'mv' || node.type === 'rot')) {
    const { h } = nodeSize(graph, node);
    return { x: p.x, y: p.y + h / 2 };
  }
  // txfmn keeps its full card: child socket aligned with the title row (y=16).
  if (slot === 'child' && node.type === 'txfmn') {
    return { x: p.x, y: p.y + 16 };
  }
  // warp: the `solid` (child) input sits on the LEFT edge at WARP_CHILD_CY (the
  // `path` input is a separate socket WireLayer positions directly).
  if (slot === 'child' && node.type === 'warp') {
    return { x: p.x, y: p.y + WARP_CHILD_CY };
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
