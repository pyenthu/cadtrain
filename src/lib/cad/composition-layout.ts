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
