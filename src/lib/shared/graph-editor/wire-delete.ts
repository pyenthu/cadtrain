/**
 * wire-delete.ts — click-a-connection → delete (unwire) support for the graph
 * editor. WireLayer renders a fat invisible HIT-PATH behind each visible wire
 * carrying a {@link WireRef} that identifies the TARGET slot; the GEP shell opens
 * a small popover at the click and calls {@link unwireGraph} to clear that one
 * slot. Pure data transform (no Svelte/DOM) so it's unit-testable.
 *
 * Scope: the node→node CONNECTION wires (method obj/arg · mv/rot/txfmn/cutaway
 * child · warp solids + path · repeat parts · container output slots · material
 * binding) + Call args (param/expr/node-ref → reset to a literal). The per-coord
 * param wires on polygon/sketch/txfmn axes are NOT covered here (they unwire by
 * editing the value field); a follow-up can extend WireRef for those.
 */
import {
  removeContainerChildAt,
  removeRepeatChildAt,
  removeWarpChild,
  removeCutawayChild,
  unbindMaterial,
  setMethodInput,
  setTransformChild,
  setWarpPath,
  setCallArg,
  setPartsTableDataInput,
  asLiteral,
  type Graph,
  type NodeId,
} from '$lib/graph/composition/composition-graph';

/** Identifies the ONE input slot a wire feeds — what "delete this wire" clears. */
export type WireRef =
  | { kind: 'method'; nodeId: NodeId; slot: 'obj' | 'arg' }
  | { kind: 'child'; nodeId: NodeId }                       // mv / rot / txfmn single child
  | { kind: 'warp-child'; nodeId: NodeId; index: number }   // warp children[i] (or the single child)
  | { kind: 'cutaway-child'; nodeId: NodeId; index: number } // cutaway children[i] (or the single child)
  | { kind: 'warp-path'; nodeId: NodeId }
  | { kind: 'repeat-child'; nodeId: NodeId; index: number }
  | { kind: 'container-child'; nodeId: NodeId; index: number }
  | { kind: 'material'; partId: NodeId }
  | { kind: 'parts-table-data'; nodeId: NodeId }           // parts_table external data-input (#38c)
  | { kind: 'call-arg'; nodeId: NodeId; key: string };

/** Apply a wire deletion — clear exactly the slot named by `ref`. Returns a new
 *  Graph (each branch routes through a finalize-ing mutator). A removed transform/
 *  warp/method input leaves the source node in place (unreferenced = the pre-wire
 *  state, still a card on the canvas); container/repeat removals reparent to root. */
export function unwireGraph(graph: Graph, ref: WireRef): Graph {
  switch (ref.kind) {
    case 'method':
      return setMethodInput(graph, ref.nodeId, ref.slot, null as unknown as NodeId);
    case 'child':
      return setTransformChild(graph, ref.nodeId, null as unknown as NodeId);
    case 'warp-child':
      return removeWarpChild(graph, ref.nodeId, ref.index);
    case 'cutaway-child':
      return removeCutawayChild(graph, ref.nodeId, ref.index);
    case 'warp-path':
      return setWarpPath(graph, ref.nodeId, null as unknown as never);
    case 'repeat-child':
      return removeRepeatChildAt(graph, ref.nodeId, ref.index);
    case 'container-child':
      return removeContainerChildAt(graph, ref.nodeId, ref.index);
    case 'material':
      return unbindMaterial(graph, ref.partId);
    case 'parts-table-data':
      // Clear the external data-input → the table falls back to its inline rows.
      return setPartsTableDataInput(graph, ref.nodeId, null);
    case 'call-arg': {
      // Reset the arg to a literal so the Call still bakes: a param wire → that
      // param's default; an expr/node-ref wire → 0. The user re-edits from there.
      const node = graph.nodes[ref.nodeId] as { args?: Record<string, { kind: string; param?: string }> } | undefined;
      const cur = node?.args?.[ref.key];
      const dflt = cur?.kind === 'param' && cur.param ? graph.params?.[cur.param]?.default : undefined;
      return setCallArg(graph, ref.nodeId, ref.key, asLiteral(typeof dflt === 'number' ? dflt : 0));
    }
    default:
      return graph;
  }
}

/** Build the WireRef for a container (list/stack/group) output wire feeding
 *  `child`. The ref MUST carry the child's TRUE index in `container.children` —
 *  NOT its position among the VISIBLE slots. The root Output card filters out
 *  consumed children from its visible slots, so the visible index and the true
 *  index disagree whenever a consumed child precedes a wired one; since
 *  `unwireGraph`→`removeContainerChildAt` clears `children[index]`, a
 *  visible-index ref would delete a SIBLING wire. */
export function containerChildRef(graph: Graph, containerId: NodeId, child: NodeId): WireRef {
  const kids = (graph.nodes[containerId] as { children?: NodeId[] } | undefined)?.children;
  return { kind: 'container-child', nodeId: containerId, index: kids ? kids.indexOf(child) : -1 };
}

/** Human-readable label for the delete popover ("delete <this>"). */
export function describeWireRef(graph: Graph, ref: WireRef): string {
  const nm = (id: NodeId): string => {
    const n = graph.nodes[id] as { alias?: string; src?: string; type?: string } | undefined;
    return n?.alias || n?.src || n?.type || id;
  };
  switch (ref.kind) {
    case 'method': return `${ref.slot} input → ${nm(ref.nodeId)}`;
    case 'child': return `input → ${nm(ref.nodeId)}`;
    case 'warp-child': return `solid ${ref.index + 1} → warp`;
    case 'cutaway-child': return `solid ${ref.index + 1} → section`;
    case 'warp-path': return `path → warp`;
    case 'repeat-child': return `part → repeat`;
    case 'container-child': return `output slot`;
    case 'material': return `material → ${nm(ref.partId)}`;
    case 'parts-table-data': return `rows → ${nm(ref.nodeId)}`;
    case 'call-arg': return `${ref.key} → ${nm(ref.nodeId)}`;
    default: return 'connection';
  }
}
