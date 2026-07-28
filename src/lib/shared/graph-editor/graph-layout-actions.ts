// Auto-layout + push-apart actions for the graph editor (modularize K.65 —
// extracted from GraphEditorPane.svelte). PURE functions: the editor's
// viewport / left-card state is captured into a `LayoutContext` and passed
// IN (mirrors the geom.ts captured-state pattern), so nothing here reads
// `$state`. The shell keeps the thin `autoLayout`/`undoAutoLayout`/`pushApart`
// entry points (they own the `undoLayout` snapshot + assign `graph`).
import { type Graph, type NodeId } from '$lib/graph/composition/composition-graph';
import { autoLayoutGraph, forceSeparate, forceLayoutGraph } from '$lib/graph/composition/composition-layout';
import {
  nodeSize,
  outputSocketAt,
  inputSocketAt,
  containerSlotInputAt,
  paramCardSize,
} from './geom';

export type LayoutObstacle = { id: string; x: number; y: number; w: number; h: number };
export type LayoutWire = { fromId?: NodeId; toId?: NodeId; ax: number; ay: number; bx: number; by: number };
export type PushApartOpts = { useBounds?: boolean; useObstacles?: boolean; useWires?: boolean };

/** Viewport + left-card state captured from the editor shell, in the units
 *  the layout math needs. Passed IN so this module stays pure (no reactive
 *  deps). `canvasEl` is read only for its bounding rect; `document` is read
 *  only for measured card heights — both guarded. */
export type LayoutContext = {
  pan: { x: number; y: number };
  zoom: number;
  leftTab: string;
  propsBodyH: number;
  paramEntriesLen: number;
  PARAM_W: number;
  PROPS_X0: number;
  PROPS_Y0: number;
  PROPS_W: number;
  TAB_HEADER_H: number;
  canvasEl: HTMLElement | null;
  boundLeft: string;
  boundRight: string;
  boundTop: string;
};

/** The single viewport-tacked overlay card — the combined tab card (header +
 *  the ACTIVE tab's body) — projected from screen-fixed coords into GRAPH
 *  space at the current pan/zoom, as a forceSeparate/autoLayoutGraph obstacle
 *  so node cards get pushed clear of it. */
export function overlayCardObstacles(ctx: LayoutContext): LayoutObstacle[] {
  // Card height = tab header + whichever tab body is showing. The params body
  // socket spills ~14 px past the card's right edge, so pad the width.
  const pcardSize = paramCardSize(ctx.paramEntriesLen, ctx.PARAM_W);
  const bodyH = ctx.leftTab === 'params' ? pcardSize.h : ctx.propsBodyH;
  const w = Math.max(ctx.PROPS_W, pcardSize.w + 14);
  return [{
    id: '__obs_left_card',
    x: (ctx.PROPS_X0 - ctx.pan.x) / ctx.zoom,
    y: (ctx.PROPS_Y0 - ctx.pan.y) / ctx.zoom,
    w: w / ctx.zoom,
    h: (ctx.TAB_HEADER_H + bodyH) / ctx.zoom,
  }];
}

/** Enumerate every visible wire in the graph as a line segment in GRAPH
 *  space. Used by push-apart so wires push non-endpoint cards perpendicular
 *  to the segment. Mirrors the SVG render path's wire enumeration (method
 *  obj/arg, mv/rot/repeat child, container child → output). */
export function collectWires(graph: Graph): LayoutWire[] {
  const out: LayoutWire[] = [];
  for (const [id, node] of Object.entries(graph.nodes)) {
    if (!node) continue;
    const addInputWire = (srcId: NodeId, slot: 'obj' | 'arg' | 'child') => {
      if (!graph.nodes[srcId]) return;
      const a = outputSocketAt(graph, srcId);
      const b = inputSocketAt(graph, id, slot);
      out.push({ fromId: srcId, toId: id, ax: a.x, ay: a.y, bx: b.x, by: b.y });
    };
    if (node.type === 'method') {
      if (node.obj) addInputWire(node.obj, 'obj');
      if (node.arg) addInputWire(node.arg, 'arg');
    } else if (node.type === 'mv' || node.type === 'rot' || node.type === 'txfmn' || node.type === 'repeat') {
      if (node.child) addInputWire(node.child, 'child');
    } else if (node.type === 'stack' || node.type === 'group') {
      node.children.forEach((c, i) => {
        if (!graph.nodes[c]) return;
        const a = outputSocketAt(graph, c);
        const b = containerSlotInputAt(graph, id, i);
        out.push({ fromId: c, toId: id, ax: a.x, ay: a.y, bx: b.x, by: b.y });
      });
    } else if (node.type === 'list' && id === graph.root) {
      // Root-list children draw a wire to the Output card's slots.
      node.children.forEach((c, i) => {
        if (!graph.nodes[c]) return;
        const a = outputSocketAt(graph, c);
        const b = containerSlotInputAt(graph, id, i);
        out.push({ fromId: c, toId: id, ax: a.x, ay: a.y, bx: b.x, by: b.y });
      });
    }
  }
  return out;
}

/** Resolve overlapping cards via pairwise bounding-box separation. Returns a
 *  NEW graph (the shell assigns it). PURE mode (all opts false) skips the
 *  left-card obstacles + wires + viewport bounds — those pull cards toward the
 *  viewport/params channel and would COMPRESS a clean column layout; pure
 *  pairwise separation only de-overlaps. */
export function separateGraph(graph: Graph, opts: PushApartOpts, ctx: LayoutContext): Graph {
  const { useBounds = true, useObstacles = true, useWires = true } = opts;
  const obstacles: LayoutObstacle[] = [];
  if (useObstacles) {
    obstacles.push(...overlayCardObstacles(ctx));
  }
  // Boundary walls (#116): a tall thin rect JUST OUTSIDE each active edge that
  // pushes any node touching the edge back inside, plus a confinerBounds clamp.
  let confinerBounds: { minX?: number; maxX?: number; minY?: number } | undefined;
  if (useBounds && ctx.canvasEl && (ctx.boundLeft !== 'off' || ctx.boundRight !== 'off' || ctx.boundTop !== 'off')) {
    const rect = ctx.canvasEl.getBoundingClientRect();
    const FAR = 10000;
    const gxLeft = (0 - ctx.pan.x) / ctx.zoom;
    const gxRight = (rect.width - ctx.pan.x) / ctx.zoom;
    const gyTop = (0 - ctx.pan.y) / ctx.zoom;
    const gyBottom = (rect.height - ctx.pan.y) / ctx.zoom;
    const wallY = gyTop - FAR;
    const wallH = (gyBottom - gyTop) + 2 * FAR;
    if (ctx.boundLeft === 'repellant') {
      obstacles.push({ id: '__obs_wall_left', x: gxLeft - FAR, y: wallY, w: FAR, h: wallH });
      confinerBounds = { ...(confinerBounds ?? {}), minX: gxLeft };
    }
    if (ctx.boundRight === 'repellant') {
      obstacles.push({ id: '__obs_wall_right', x: gxRight, y: wallY, w: FAR, h: wallH });
      confinerBounds = { ...(confinerBounds ?? {}), maxX: gxRight };
    }
    if (ctx.boundTop === 'repellant') {
      // Pad by 24 px so cards land clear of the tab strip / PARAMS overlay.
      const topPad = 24 / ctx.zoom;
      obstacles.push({ id: '__obs_wall_top', x: gxLeft - FAR, y: gyTop + topPad - FAR, w: (gxRight - gxLeft) + 2 * FAR, h: FAR });
      confinerBounds = { ...(confinerBounds ?? {}), minY: gyTop + topPad };
    }
  }
  const wires = useWires ? collectWires(graph) : [];
  // Real rendered card heights from the DOM (the nodeSize estimate undersizes
  // cards with foreignObject bodies). getBBox is in local graph units.
  const realH = new Map<string, number>();
  if (typeof document !== 'undefined') {
    for (const el of Array.from(document.querySelectorAll('g.ge-node[data-node-id]'))) {
      const nid = el.getAttribute('data-node-id');
      if (!nid) continue;
      try { const bb = (el as any).getBBox?.(); if (bb && bb.height > 0) realH.set(nid, bb.height); } catch { /* detached */ }
    }
  }
  return forceSeparate(graph, {
    nodeSize: (id) => {
      const est = nodeSize(graph, graph.nodes[id]);
      const measured = realH.get(id);
      return { w: est.w, h: Math.max(est.h, measured ?? 0, 120) };
    },
    padding: 24,
    obstacles,
    wires,
    wirePadding: 16,
    confinerBounds,
  });
}

/** Depth-column auto-layout: run the layered heuristic (generous gaps clear
 *  the tallest cards + keep __POLY__ profile edges out of depth 0), passing
 *  the left cards as obstacles so placement shoves nodes off them from the
 *  start. Returns a NEW graph. */
export function autoLayoutOnce(graph: Graph, ctx: LayoutContext): Graph {
  return autoLayoutGraph(graph, {
    rowGap: 220,
    columnGap: 300,
    obstacles: overlayCardObstacles(ctx),
    nodeSize: (id) => nodeSize(graph, graph.nodes[id]),
  });
}

/** Force-organic layout (#75): relax the CURRENT node positions with the
 *  Fruchterman-Reingold pass — springs pull WIRED cards together (tension),
 *  charge pushes every pair apart (repulsion). REFINES the existing layout;
 *  run it after a seed layout or on a hand-placed one the user wants to relax.
 *  `nodeSize` is threaded so exactly-coincident cards get a deterministic nudge
 *  apart first. Returns a NEW graph. */
export function forceLayoutOnce(
  graph: Graph,
  dials: { tension: number; repulsion: number },
): Graph {
  return forceLayoutGraph(graph, {
    tension: dials.tension,
    repulsion: dials.repulsion,
    nodeSize: (id) => nodeSize(graph, graph.nodes[id]),
  });
}
