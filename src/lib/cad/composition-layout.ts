/**
 * composition-layout.ts — heuristic layered auto-layout for the graph editor.
 *
 * Phase 20 of docs/plans/auto-layout.md. Zero deps, ~120 LOC. Reads a Graph
 * and returns a new Graph with `layout` populated so that:
 *   • nodes flow left-to-right in topological depth columns
 *   • columns within a column are ordered by the barycenter of their inputs
 *     (median Y of nodes they depend on in the previous columns) — minimises
 *     wire crossings the cheap way
 *   • the root list / ▶ Output card naturally ends up in the rightmost column
 *     because every other node feeds into it
 *
 * Pure function. Returns a NEW Graph. Caller (the editor) reassigns the
 * whole graph; the editor's one-step undo just snapshots the prior layout.
 *
 * Skipped from the layout:
 *   • inline mv/rot wrappers (their xyz row renders inside their Call card,
 *     so they don't get their own canvas position — same rule hydrateGraph
 *     uses when filling missing layout entries)
 *
 * Honoured at the layout level:
 *   • opts.pinned[id] === true → that node's existing graph.layout entry is
 *     preserved. The editor uses this for tacked / user-locked nodes.
 *
 * Phase 21 (deferred) — dagre integration when N > ~15 starts straining the
 * heuristic. See docs/plans/auto-layout.md for the comparison table.
 */
import {
  topoOrder,
  setLayout,
  inlineTransformOf,
  type Graph,
  type NodeId,
  type LayoutXY,
} from './composition-graph';

export interface AutoLayoutOptions {
  /** Horizontal spacing between depth columns (px). Default 280. */
  columnGap?: number;
  /** Vertical spacing between rows within a column (px). Default 40. */
  rowGap?: number;
  /** Top-left origin for the layout. Default { x: 80, y: 80 }. */
  origin?: LayoutXY;
  /** When true, keep the node's existing layout if pinned[node.id] is true.
   *  Used by the editor to honour "tacked" / user-locked nodes. */
  pinned?: Record<NodeId, boolean>;
}

/** Same predicate hydrateGraph uses when filling missing layout entries —
 *  an inline mv/rot wrapper for a Call doesn't render on the main canvas,
 *  so it doesn't get its own laid-out position. */
function isInlineWrapper(graph: Graph, id: NodeId): boolean {
  const n = graph.nodes[id];
  if (!n || (n.type !== 'mv' && n.type !== 'rot')) return false;
  const childId = (n as any).child;
  if (!childId) return false;
  const child = graph.nodes[childId];
  if (child?.type !== 'call') return false;
  // The wrapper "belongs" to the Call iff inlineTransformOf points back at it.
  return inlineTransformOf(graph, childId, n.type) === id;
}

/** Walk this node's data-flow predecessors (the nodes whose output it
 *  consumes). Calls have no predecessors; mv/rot/repeat have one (child);
 *  method has two (obj + arg); list/stack/group have N (children).
 *  Empty / missing references are skipped. */
function predecessorsOf(graph: Graph, id: NodeId): NodeId[] {
  const n = graph.nodes[id];
  if (!n) return [];
  if (n.type === 'call') return [];
  if (n.type === 'method') {
    const out: NodeId[] = [];
    if (n.obj && graph.nodes[n.obj]) out.push(n.obj);
    if (n.arg && graph.nodes[n.arg]) out.push(n.arg);
    return out;
  }
  if (n.type === 'mv' || n.type === 'rot' || n.type === 'repeat') {
    return n.child && graph.nodes[n.child] ? [n.child] : [];
  }
  // list / stack / group — children flow INTO this container.
  return n.children.filter((c) => !!graph.nodes[c]);
}

/** Median of a number array. Returns +Infinity for an empty array so that
 *  nodes with no preceding-column inputs sort to the bottom of their column
 *  (stable + deterministic, while still letting wired nodes float to their
 *  parent's Y). */
function median(xs: number[]): number {
  if (xs.length === 0) return Number.POSITIVE_INFINITY;
  const sorted = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function autoLayoutGraph(graph: Graph, opts: AutoLayoutOptions = {}): Graph {
  const columnGap = opts.columnGap ?? 280;
  const rowGap = opts.rowGap ?? 40;
  const origin = opts.origin ?? { x: 80, y: 80 };
  const pinned = opts.pinned ?? {};

  // ── 1. assign topological depth to every node we WILL position.
  // depth[id] = 1 + max(depth of every predecessor); calls / nodes with no
  // predecessors land at depth 0. topoOrder visits children before parents,
  // so by the time we evaluate any node its predecessors already have a
  // depth assigned.
  const order = topoOrder(graph);
  const depth: Record<NodeId, number> = {};
  for (const id of order) {
    if (isInlineWrapper(graph, id)) continue;
    const preds = predecessorsOf(graph, id).filter((p) => !isInlineWrapper(graph, p));
    if (preds.length === 0) {
      depth[id] = 0;
    } else {
      let maxD = -1;
      for (const p of preds) {
        const pd = depth[p];
        if (pd !== undefined && pd > maxD) maxD = pd;
      }
      depth[id] = maxD + 1;
    }
  }

  // ── 2. group by depth → columns. Preserve insertion order within each
  // column as the stable tiebreaker for the first column (no predecessors
  // means no barycenter to sort by).
  const columns: NodeId[][] = [];
  for (const id of Object.keys(depth)) {
    const d = depth[id]!;
    while (columns.length <= d) columns.push([]);
    columns[d]!.push(id);
  }

  // ── 3. for columns 1..N, sort each by the barycenter (median Y) of its
  // predecessors as already laid out in prior columns. We compute positions
  // column-by-column so the median read at column k uses the freshly
  // assigned Y's from columns 0..k-1.
  const result: Record<NodeId, LayoutXY> = {};
  // Carry over pinned positions verbatim.
  for (const id of Object.keys(depth)) {
    if (pinned[id] && graph.layout[id]) {
      result[id] = { ...graph.layout[id]! };
    }
  }

  for (let d = 0; d < columns.length; d++) {
    const col = columns[d]!;
    if (d === 0) {
      // Stable order by id for the first column — deterministic across runs
      // regardless of object-key iteration order.
      col.sort((a, b) => a.localeCompare(b));
    } else {
      // Sort by median Y of predecessors that already have an assigned Y.
      col.sort((a, b) => {
        const ay = median(
          predecessorsOf(graph, a)
            .filter((p) => !isInlineWrapper(graph, p))
            .map((p) => result[p]?.y)
            .filter((y): y is number => typeof y === 'number'),
        );
        const by = median(
          predecessorsOf(graph, b)
            .filter((p) => !isInlineWrapper(graph, p))
            .map((p) => result[p]?.y)
            .filter((y): y is number => typeof y === 'number'),
        );
        if (ay !== by) return ay - by;
        // Stable tiebreaker — id order.
        return a.localeCompare(b);
      });
    }

    // Assign positions for non-pinned nodes; pinned ones keep their saved
    // entry but still consume a row slot? No — they keep their own y, and
    // the rest of the column fills around them.
    let row = 0;
    for (const id of col) {
      if (result[id]) continue; // pinned — already populated
      result[id] = {
        x: origin.x + d * columnGap,
        y: origin.y + row * rowGap,
      };
      row++;
    }
  }

  // ── 4. apply via setLayout (immutable update).
  let out = graph;
  for (const [id, xy] of Object.entries(result)) {
    out = setLayout(out, id, xy);
  }
  return out;
}

// ─── force-separate ──────────────────────────────────────────────────────
// Phase 22 — pairwise overlap resolver. Pure function. Walks every pair of
// visible nodes; when two overlap (their bounding boxes intersect), pushes
// them apart along the center-to-center vector until they no longer
// overlap. Iterates up to `iterations` times — for small graphs (typical
// editor case, N < 30) usually converges in 3–10 passes.
//
// Doesn't try to be a real physics simulator (no force model, no momentum,
// no edge tension). Just untangles overlaps. Use after the user clicks
// 📐 Auto-layout but two columns still got cramped, OR after a series of
// manual drags piled cards on top of each other.

export interface ForceSeparateOptions {
  /** Max iterations. Default 50; usually converges far sooner. */
  iterations?: number;
  /** Padding (px in graph space) to keep between nodes after separation. */
  padding?: number;
  /** Per-node bounding sizes in graph space. Required since this file has
   *  no Svelte deps — the editor passes nodeSize from its own helper. */
  nodeSize: (id: NodeId) => { w: number; h: number };
  /** Map of nodeId → true for nodes whose layout MUST NOT move. */
  pinned?: Record<NodeId, boolean>;
  /** Extra virtual obstacles in GRAPH space — used for viewport-tacked
   *  elements (params card, future fixed legends) that aren't part of
   *  graph.layout but should still push other nodes away. Treated as
   *  permanently pinned. The id prefix `__obs_` is reserved for these;
   *  no graph node can ever collide. */
  obstacles?: { id: string; x: number; y: number; w: number; h: number }[];
}

export function forceSeparate(graph: Graph, opts: ForceSeparateOptions): Graph {
  const iterations = opts.iterations ?? 50;
  const padding = opts.padding ?? 20;
  const pinned: Record<string, boolean> = { ...(opts.pinned ?? {}) };

  // Snapshot positions for the visible nodes (skip inline xform wrappers).
  const ids: string[] = [];
  const pos: Record<string, LayoutXY> = {};
  const size: Record<string, { w: number; h: number }> = {};
  for (const id of Object.keys(graph.nodes)) {
    const n = graph.nodes[id]!;
    // Inline-wrapper test mirrors hydrateGraph's check.
    if ((n.type === 'mv' || n.type === 'rot') && n.child) {
      const child = graph.nodes[n.child];
      if (child?.type === 'call' && inlineTransformOf(graph, n.child, n.type) === id) continue;
    }
    const layoutXY = graph.layout[id];
    if (!layoutXY) continue; // no position to push around
    ids.push(id);
    pos[id] = { ...layoutXY };
    size[id] = opts.nodeSize(id);
  }
  // Merge in virtual obstacles — viewport-tacked elements (params card,
  // future fixed legends). They participate in pair iteration so nodes
  // get pushed away, but they're always pinned so they never move.
  for (const obs of opts.obstacles ?? []) {
    ids.push(obs.id);
    pos[obs.id] = { x: obs.x, y: obs.y };
    size[obs.id] = { w: obs.w, h: obs.h };
    pinned[obs.id] = true;
  }
  if (ids.length < 2) return graph;

  // Tiny deterministic jitter for nodes occupying the EXACT same position
  // (otherwise the center-to-center vector is zero and they never separate).
  // 13/17 prime spread keeps jitter spread-out modulo i, no two nodes share.
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const a = pos[ids[i]!]!, b = pos[ids[j]!]!;
      if (Math.abs(a.x - b.x) < 0.5 && Math.abs(a.y - b.y) < 0.5) {
        b.x += ((j * 13) % 17) - 8;
        b.y += ((j * 17) % 13) - 6;
      }
    }
  }

  for (let iter = 0; iter < iterations; iter++) {
    let moved = false;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const ai = ids[i]!, bj = ids[j]!;
        const a = pos[ai]!, b = pos[bj]!;
        const aw = size[ai]!.w, ah = size[ai]!.h;
        const bw = size[bj]!.w, bh = size[bj]!.h;
        // Axis-aligned bounding box overlap test.
        const ax2 = a.x + aw, ay2 = a.y + ah;
        const bx2 = b.x + bw, by2 = b.y + bh;
        const overlapX = Math.min(ax2, bx2) - Math.max(a.x, b.x);
        const overlapY = Math.min(ay2, by2) - Math.max(a.y, b.y);
        if (overlapX <= -padding || overlapY <= -padding) continue;
        // Separate along the smaller axis to minimise displacement.
        const ax = a.x + aw / 2, ay = a.y + ah / 2;
        const bx = b.x + bw / 2, by = b.y + bh / 2;
        const aPinned = !!pinned[ai];
        const bPinned = !!pinned[bj];
        if (aPinned && bPinned) continue; // can't move either
        // Distribute the push: half each, or full if one is pinned.
        const share = (aPinned || bPinned) ? 1 : 0.5;
        if (overlapX + padding < overlapY + padding) {
          // push along X
          const push = overlapX + padding;
          if (bx >= ax) {
            if (!aPinned) a.x -= push * share;
            if (!bPinned) b.x += push * share;
          } else {
            if (!aPinned) a.x += push * share;
            if (!bPinned) b.x -= push * share;
          }
        } else {
          // push along Y
          const push = overlapY + padding;
          if (by >= ay) {
            if (!aPinned) a.y -= push * share;
            if (!bPinned) b.y += push * share;
          } else {
            if (!aPinned) a.y += push * share;
            if (!bPinned) b.y -= push * share;
          }
        }
        moved = true;
      }
    }
    if (!moved) break; // converged
  }

  // Apply via setLayout (immutable). Skip obstacle ids — they're not in
  // graph.nodes; setLayout would still write the entry but it's wasted.
  let out = graph;
  for (const id of ids) {
    if (id.startsWith('__obs_')) continue;
    if (!graph.nodes[id]) continue;
    out = setLayout(out, id, pos[id]!);
  }
  return out;
}
