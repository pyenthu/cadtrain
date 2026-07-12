/**
 * wire-splice.ts — drop-a-node-on-a-wire → auto-splice (bisect + insert).
 *
 * Companion to wire-delete.ts. When the user DRAGS an existing node card D and
 * releases it while the pointer is over a connection wire's `.ge-wire-hit`, we
 * SPLICE D into that wire: the wire runs SOURCE (a node output S) → TARGET
 * (nodeId T + slot, per {@link WireRef}); after the splice S → D (D's input) and
 * D → T (T's slot now points at D), so D sits between S and T.
 *
 * A {@link SpliceWire} is a WireRef plus the SOURCE node id S — WireRef alone
 * only names the TARGET slot, so WireLayer passes the source it already computed
 * for each structural wire (outSock(srcId)) alongside it.
 *
 * Only the node→node SOLID wires can be splice targets — `child` (mv / rot /
 * txfmn / cutaway / warp single child), `warp-child`, `method` (obj / arg),
 * `container-child`, `repeat-child`. `warp-path` / `material` / `call-arg` are
 * NOT node→node solid wires you can insert a solid into, so they're rejected.
 *
 * Pure data transform (no Svelte/DOM) so it's unit-testable — mirrors
 * wire-delete.ts.
 */
import {
  setMethodInput,
  setTransformChild,
  setWarpChildAt,
  setRepeatChildAt,
  setContainerChildAt,
  type Graph,
  type GraphNode,
  type NodeId,
} from '$lib/graph/composition-graph';
import type { WireRef } from './wire-delete';

/** A splice target = the wire's target-slot ref + the SOURCE node feeding it. */
export type SpliceWire = { ref: WireRef; sourceId: NodeId };

/** WireRef kinds a solid CAN be spliced into (node→node solid wires). Excludes
 *  warp-path / material / call-arg — see the module doc. */
export function canSpliceInto(ref: WireRef): boolean {
  return ref.kind === 'child'
      || ref.kind === 'warp-child'
      || ref.kind === 'method'
      || ref.kind === 'container-child'
      || ref.kind === 'repeat-child';
}

/** The single SOLID input slot on the dragged node D — where the wire's source
 *  S gets re-wired. `'child'` for the transform/modifier wrappers, `'obj'` for a
 *  method (CSG) node. `null` = a pure PRODUCER (call / polygon / sketch / expr /
 *  spline / container / repeat / …) with no single solid input ⇒ can't splice. */
export function inputSlotOf(node: GraphNode | undefined): 'child' | 'obj' | null {
  if (!node) return null;
  switch (node.type) {
    case 'mv':
    case 'rot':
    case 'txfmn':
    case 'cutaway':
    case 'warp':
      return 'child';
    case 'method':
      return 'obj';
    default:
      return null;
  }
}

/** Stable key identifying a splice target — used by the editor to highlight the
 *  hovered wire during a drag (WireLayer `.ge-wire-hit.splice-target`). */
export function spliceWireKey(wire: SpliceWire): string {
  const r = wire.ref;
  const slot =
    r.kind === 'method' ? r.slot :
    (r.kind === 'warp-child' || r.kind === 'container-child' || r.kind === 'repeat-child') ? String(r.index) :
    '';
  const nodeId = r.kind === 'material' ? r.partId : (r as { nodeId?: NodeId }).nodeId ?? '';
  return `${r.kind}:${nodeId}:${slot}:${wire.sourceId}`;
}

/** True when D can be spliced into this wire — target kind is spliceable, D has
 *  a solid input slot, the wire has a real source, and D isn't already an
 *  endpoint of the wire (no self-loop / no-op). */
export function canSplice(graph: Graph, draggedId: NodeId, wire: SpliceWire): boolean {
  const { ref, sourceId } = wire;
  if (!canSpliceInto(ref)) return false;
  const T = (ref as { nodeId?: NodeId }).nodeId;
  if (!T) return false;
  if (draggedId === sourceId || draggedId === T) return false;
  if (!sourceId || !graph.nodes[sourceId]) return false;
  if (!graph.nodes[draggedId] || !graph.nodes[T]) return false;
  if (inputSlotOf(graph.nodes[draggedId]) === null) return false; // pure producer
  return true;
}

/**
 * Splice the dragged node D into the wire S → T. Returns a NEW graph (each step
 * routes through a finalize-ing mutator). No-op (returns the graph unchanged)
 * when the splice is invalid (see {@link canSplice}) — notably when D is a pure
 * producer with no input slot.
 *
 *  1. S → D  — feed D's input from the wire's old source.
 *  2. D → T  — retarget T's slot at D (was pointing at S).
 */
export function spliceNodeIntoWire(graph: Graph, draggedId: NodeId, wire: SpliceWire): Graph {
  if (!canSplice(graph, draggedId, wire)) return graph;
  const { ref, sourceId } = wire;
  const D = graph.nodes[draggedId]!;

  // 1) Wire S → D (the dragged node's solid input = the old source).
  let g: Graph;
  if (D.type === 'warp') g = setWarpChildAt(graph, draggedId, 0, sourceId);
  else if (D.type === 'method') g = setMethodInput(graph, draggedId, 'obj', sourceId);
  else g = setTransformChild(graph, draggedId, sourceId); // mv / rot / txfmn / cutaway

  // 2) Retarget T's slot → D (T now consumes D instead of S).
  switch (ref.kind) {
    case 'child':
      return setTransformChild(g, ref.nodeId, draggedId);
    case 'warp-child':
      return setWarpChildAt(g, ref.nodeId, ref.index, draggedId);
    case 'method':
      return setMethodInput(g, ref.nodeId, ref.slot, draggedId);
    case 'repeat-child':
      return setRepeatChildAt(g, ref.nodeId, ref.index, draggedId);
    case 'container-child':
      return setContainerChildAt(g, ref.nodeId, ref.index, draggedId);
    default:
      return graph; // unreachable — canSpliceInto already filtered
  }
}
