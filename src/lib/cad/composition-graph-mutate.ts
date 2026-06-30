/**
 * composition-graph-mutate.ts — mutators + queries over a Graph.
 *
 * Every exported mutation returns a NEW Graph (immutable shape for Svelte 5
 * shallow reactivity). Also holds the edge/import indexers (collectEdges /
 * finalize), the alias allocator, layout/position helpers, and the
 * topological walk. Depends only on the leaf types module. Re-exported by the
 * composition-graph.ts barrel.
 */

import type {
  NodeId, ArgValue, CsgOp, CallNode, ContainerNode, MethodNode, MvNode, RotNode, TxfmnNode,
  RepeatOp, RepeatNode, NodeTransform, PolygonPoint, PolygonRepeat, PolygonRepeatRef, PolygonExprListRef, PolygonEntry,
  PolygonNode, PolyRepeatBinding, PolyRepeatNode, SketchOpEntry, SketchNode,
  SketchRepeatNode, SketchRepeatRef, SketchExprListRef,
  ExprNode, ExprDef, ExprOut, ExprOutShape, ExprOutElem, SplineNode,
  GraphNode, ParamSchema, Edge, LayoutXY, Viewport, Graph,
} from './composition-graph-types';
import { newNodeId, asLiteral, asParam } from './composition-graph-types';

/** Update a node's canvas position. Pure (returns new graph). */
export function setLayout(graph: Graph, id: NodeId, xy: LayoutXY): Graph {
  return { ...graph, layout: { ...graph.layout, [id]: xy } };
}

/** Compute a default position for a newly-added Call based on how many Calls
 *  already exist — rough grid so a freshly-dropped node doesn't overlap. */
export function defaultCallPosition(graph: Graph): LayoutXY {
  // Count droppable nodes (calls + polygons + methods + transforms +
  // repeats) so the placement counter advances on every drop, not just
  // Call drops. Otherwise polygon + revolve land on the same xy slot
  // and the cards stack invisibly.
  const dropped = Object.values(graph.nodes).filter((n) =>
    n.type === 'call' || n.type === 'polygon' || n.type === 'method' ||
    n.type === 'mv'   || n.type === 'rot'     || n.type === 'repeat' ||
    n.type === 'txfmn' || n.type === 'poly_repeat',
  ).length;
  return { x: 80 + (dropped % 4) * 240, y: 80 + Math.floor(dropped / 4) * 180 };
}

// ─── aliases ──────────────────────────────────────────────────────────────

/** Allocate the next unused alphabet alias. A, B, …, Z, AA, AB, … */
export function nextAlias(taken: ReadonlySet<string>): string {
  for (let i = 0; i < 100_000; i++) {
    let n = i, name = '';
    do {
      name = String.fromCharCode(65 + (n % 26)) + name;
      n = Math.floor(n / 26) - 1;
    } while (n >= 0);
    if (!taken.has(name)) return name;
  }
  return 'X' + Math.random().toString(36).slice(2, 5);
}

export function takenAliases(graph: Graph): Set<string> {
  const out = new Set<string>();
  for (const n of Object.values(graph.nodes)) {
    if (n.type === 'call') out.add(n.alias);
  }
  return out;
}

// ─── edges ────────────────────────────────────────────────────────────────

/** Walk the graph, collecting every 'param' edge. Rebuilds graph.edges
 *  from the canonical (in-arg) representation. Pure. */
export function collectEdges(graph: Graph): Edge[] {
  const edges: Edge[] = [];
  for (const node of Object.values(graph.nodes)) {
    if (node.type === 'call') {
      for (const [k, v] of Object.entries(node.args)) {
        if (v.kind === 'param') edges.push({ from: `p.${v.param}`, to: `${node.id}.args.${k}` });
      }
    } else if (node.type === 'mv') {
      node.offset.forEach((v, i) => {
        if (v.kind === 'param') edges.push({ from: `p.${v.param}`, to: `${node.id}.offset.${i}` });
      });
    } else if (node.type === 'rot') {
      node.rot.forEach((v, i) => {
        if (v.kind === 'param') edges.push({ from: `p.${v.param}`, to: `${node.id}.rot.${i}` });
      });
    } else if (node.type === 'txfmn') {
      // Both families ride one node: `<id>.rot.<i>` + `<id>.offset.<i>` — same
      // edge shape the legacy mv/rot nodes produced, so wiring round-trips.
      node.rot.forEach((v, i) => {
        if (v.kind === 'param') edges.push({ from: `p.${v.param}`, to: `${node.id}.rot.${i}` });
      });
      node.offset.forEach((v, i) => {
        if (v.kind === 'param') edges.push({ from: `p.${v.param}`, to: `${node.id}.offset.${i}` });
      });
    } else if (node.type === 'repeat') {
      // The repeat's count slot can be wired to a param (e.g. p.n on `stand`).
      if (node.count.kind === 'param') {
        edges.push({ from: `p.${node.count.param}`, to: `${node.id}.count` });
      }
      // Patterned-repeat (#7): per-copy modifier axes + per-iteration bindings.
      ((node as any).modifiers as any[] ?? []).forEach((m, k) =>
        (m?.vec ?? []).forEach((v: any, ax: number) => {
          if (v?.kind === 'param') edges.push({ from: `p.${v.param}`, to: `${node.id}.modifiers.${k}.vec.${ax}` });
        }));
      ((node as any).bindings as any[] ?? []).forEach((b, k) => {
        if (b?.value?.kind === 'param') edges.push({ from: `p.${b.value.param}`, to: `${node.id}.bindings.${k}.value` });
      });
      // Per-part modifier axes can also be wired to params.
      Object.entries(((node as any).partModifiers ?? {}) as Record<string, any[]>).forEach(([cid, ms]) =>
        (ms ?? []).forEach((m, k) =>
          (m?.vec ?? []).forEach((v: any, ax: number) => {
            if (v?.kind === 'param') edges.push({ from: `p.${v.param}`, to: `${node.id}.partModifiers.${cid}.${k}.vec.${ax}` });
          })));
    } else if (node.type === 'polygon') {
      // Each vertex's r + z can be wired to a param — same edge shape as
      // mv.offset, indexed by point index and axis. Repeat-refs + legacy
      // inline repeats have no per-entry r/z to wire here (the source
      // PolyRepeatNode carries those expressions; its own branch below
      // emits the edges).
      node.points.forEach((p: any, i: number) => {
        if (p?.kind !== 'point' && p?.kind !== undefined) return;
        if (p.r?.kind === 'param') edges.push({ from: `p.${p.r.param}`, to: `${node.id}.points.${i}.r` });
        if (p.z?.kind === 'param') edges.push({ from: `p.${p.z.param}`, to: `${node.id}.points.${i}.z` });
      });
    } else if (node.type === 'poly_repeat') {
      // The loop's count + r + z slots can all be wired to params.
      if (node.count?.kind === 'param') edges.push({ from: `p.${node.count.param}`, to: `${node.id}.count` });
      if (node.r?.kind === 'param')     edges.push({ from: `p.${node.r.param}`,     to: `${node.id}.r` });
      if (node.z?.kind === 'param')     edges.push({ from: `p.${node.z.param}`,     to: `${node.id}.z` });
    } else if (node.type === 'sketch') {
      // Every per-op ArgValue component is param-wireable: line/spline r+z,
      // each spline through-point's u/v, the two end handles' u/v, fillet
      // radius, chamfer dist, plus the sampling `segments`. Missing today —
      // wiring a param into a sketch coord silently produced no edge.
      const push = (v: any, to: string) => {
        if (v?.kind === 'param') edges.push({ from: `p.${v.param}`, to: `${node.id}.${to}` });
      };
      node.ops.forEach((o: any, i: number) => {
        if (o.op === 'line' || o.op === 'spline') {
          push(o.r, `ops.${i}.r`);
          push(o.z, `ops.${i}.z`);
        }
        if (o.op === 'spline') {
          (o.pts ?? []).forEach((pt: any, k: number) => {
            push(pt?.[0], `ops.${i}.pts.${k}.u`);
            push(pt?.[1], `ops.${i}.pts.${k}.v`);
          });
          if (o.h0) { push(o.h0[0], `ops.${i}.h0.u`); push(o.h0[1], `ops.${i}.h0.v`); }
          if (o.h1) { push(o.h1[0], `ops.${i}.h1.u`); push(o.h1[1], `ops.${i}.h1.v`); }
        }
        if (o.op === 'fillet')  push(o.radius, `ops.${i}.radius`);
        if (o.op === 'chamfer') push(o.dist,   `ops.${i}.dist`);
      });
      push(node.segments, 'segments');
    } else if (node.type === 'sketch_repeat') {
      // The repeat's count/advance + each binding value + each prototype op
      // ArgValue are param-wireable (#805). Same edge shapes as the sketch arm
      // (prototype ops live on `ops`) plus count/dr/dz and bindings.
      const push = (v: any, to: string) => {
        if (v?.kind === 'param') edges.push({ from: `p.${v.param}`, to: `${node.id}.${to}` });
      };
      push(node.count, 'count');
      push((node as any).dr, 'dr');
      push((node as any).dz, 'dz');
      ((node as any).bindings as any[] ?? []).forEach((b, k) => {
        if (b?.value?.kind === 'param') edges.push({ from: `p.${b.value.param}`, to: `${node.id}.bindings.${k}.value` });
      });
      node.ops.forEach((o: any, i: number) => {
        if (o.op === 'line' || o.op === 'spline') { push(o.r, `ops.${i}.r`); push(o.z, `ops.${i}.z`); }
        if (o.op === 'spline') {
          (o.pts ?? []).forEach((pt: any, k: number) => { push(pt?.[0], `ops.${i}.pts.${k}.u`); push(pt?.[1], `ops.${i}.pts.${k}.v`); });
          if (o.h0) { push(o.h0[0], `ops.${i}.h0.u`); push(o.h0[1], `ops.${i}.h0.v`); }
          if (o.h1) { push(o.h1[0], `ops.${i}.h1.u`); push(o.h1[1], `ops.${i}.h1.v`); }
        }
        if (o.op === 'fillet')  push(o.radius, `ops.${i}.radius`);
        if (o.op === 'chamfer') push(o.dist,   `ops.${i}.dist`);
      });
    } else if (node.type === 'expr') {
      // An Expr block's input can be wired to a param — surfaced so the orphan
      // check (slotsForParam) catches a param that's only used by a block input.
      for (const [inName, v] of Object.entries(node.bindings ?? {})) {
        if (v?.kind === 'param') edges.push({ from: `p.${v.param}`, to: `${node.id}.bindings.${inName}` });
      }
    }
  }
  return edges;
}

/** Slots that reference a param name (used when the user tries to delete a
 *  param — we surface the orphan list before destruction). */
export function slotsForParam(graph: Graph, paramName: string): Edge[] {
  return collectEdges(graph).filter((e) => e.from === `p.${paramName}`);
}

// ─── mutations ────────────────────────────────────────────────────────────
// All mutations return a NEW Graph. The caller (typically Svelte 5 $state)
// reassigns the whole graph; the immutability lets shallow reactivity work
// and lets us undo by snapshotting the old reference.

function withNodes(graph: Graph, updates: Record<NodeId, GraphNode>): Graph {
  return { ...graph, nodes: { ...graph.nodes, ...updates }, edges: [] /* recomputed below */ };
}

/** Finalize a mutation by recomputing the edge index + de-duped imports list.
 *  Pure. Exported so callers that build a node replacement by hand (e.g. the
 *  editor's drift-refresh) still rebuild graph.edges instead of leaving it
 *  stale. */
export function finalize(graph: Graph): Graph {
  const importsSet = new Set<string>(graph.imports);
  for (const n of Object.values(graph.nodes)) {
    if (n.type === 'call') importsSet.add(n.src);
  }
  return { ...graph, edges: collectEdges(graph), imports: [...importsSet].sort() };
}

/** Add a Call node to a parent container. Returns the new graph + the
 *  new node id. If parentId is omitted, appends to the root. The Call gets
 *  a default canvas layout position so the visual editor can place it. */
export function addCall(
  graph: Graph,
  src: string,
  defaultArgs: Record<string, ArgValue> = {},
  parentId?: NodeId,
): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const alias = nextAlias(takenAliases(graph));
  const callNode: CallNode = { id, type: 'call', src, alias, args: { ...defaultArgs } };
  const xy = defaultCallPosition(graph);
  const next: Graph = { ...withNodes(graph, { [id]: callNode }), layout: { ...graph.layout, [id]: xy } };
  const finalGraph = appendChild(next, parentId ?? graph.root, id);
  return { graph: finalize(finalGraph), id };
}

/** Add a container node (list / stack / group) under a parent. */
export function addContainer(
  graph: Graph,
  type: 'list' | 'stack' | 'group',
  parentId?: NodeId,
): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const node: ContainerNode = { id, type, children: [] };
  const next = withNodes(graph, { [id]: node });
  const final = appendChild(next, parentId ?? graph.root, id);
  return { graph: finalize(final), id };
}

/** Add a method (CSG op) node — combines obj + arg via op. */
export function addMethod(
  graph: Graph,
  op: CsgOp,
  obj: NodeId,
  arg: NodeId,
  parentId?: NodeId,
): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const node: MethodNode = { id, type: 'method', op, obj, arg };
  const xy = defaultCallPosition(graph);
  const next: Graph = { ...withNodes(graph, { [id]: node }), layout: { ...graph.layout, [id]: xy } };
  const final = appendChild(next, parentId ?? graph.root, id);
  return { graph: finalize(final), id };
}

/** Drop an UNWIRED method node — its obj + arg are empty strings until the
 *  user drags wires onto them. Emitter renders empty refs as the missing-comment. */
export function addMethodPlaceholder(graph: Graph, op: CsgOp, parentId?: NodeId) {
  return addMethod(graph, op, '', '', parentId);
}

/** Rebind a method node's obj or arg socket to point at another node. */
export function setMethodInput(graph: Graph, methodId: NodeId, slot: 'obj' | 'arg', targetId: NodeId): Graph {
  const node = graph.nodes[methodId];
  if (!node || node.type !== 'method') return graph;
  const updated: MethodNode = { ...node, [slot]: targetId } as MethodNode;
  return finalize({ ...graph, nodes: { ...graph.nodes, [methodId]: updated } });
}

/** Add a mv transform around a child. */
export function addMv(
  graph: Graph,
  child: NodeId,
  offset: [ArgValue, ArgValue, ArgValue] = [asLiteral(0), asLiteral(0), asLiteral(0)],
  parentId?: NodeId,
): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const node: MvNode = { id, type: 'mv', child, offset };
  const xy = defaultCallPosition(graph);
  const next: Graph = { ...withNodes(graph, { [id]: node }), layout: { ...graph.layout, [id]: xy } };
  const final = appendChild(next, parentId ?? graph.root, id);
  return { graph: finalize(final), id };
}

/** Drop an empty stack node. Like addContainer('stack') but the picker
 *  uses this to scaffold a visible stack card on the canvas — emit and
 *  output-filter both treat its children as consumed inputs, so the
 *  stack itself is the output of its own expression. */
export function addStackPlaceholder(graph: Graph, parentId?: NodeId) {
  return addContainer(graph, 'stack', parentId);
}

/** Append a child to a stack/list/group container, in order. Pure — used
 *  by the editor when the user drag-wires a node into a stack's slot. */
export function appendContainerChild(graph: Graph, containerId: NodeId, childId: NodeId): Graph {
  const node = graph.nodes[containerId];
  if (!node || (node.type !== 'stack' && node.type !== 'list' && node.type !== 'group')) return graph;
  if (node.children.includes(childId)) return graph; // already wired
  // Detach childId from any previous parent container so a node doesn't end up
  // double-parented (root-list + the stack). Idempotent for orphans.
  const detached = { ...graph.nodes };
  for (const [pid, p] of Object.entries(detached)) {
    if ((p.type === 'list' || p.type === 'stack' || p.type === 'group') && p.children.includes(childId)) {
      detached[pid] = { ...p, children: p.children.filter((c) => c !== childId) } as typeof p;
    }
  }
  const updated = { ...node, children: [...node.children, childId] } as typeof node;
  detached[containerId] = updated;
  return finalize({ ...graph, nodes: detached });
}

/** Remove the i-th child of a stack/list/group AND reparent it onto the
 *  root list so it doesn't become orphaned (the editor would otherwise
 *  lose track of it). */
export function removeContainerChildAt(graph: Graph, containerId: NodeId, index: number): Graph {
  const node = graph.nodes[containerId];
  if (!node || (node.type !== 'stack' && node.type !== 'list' && node.type !== 'group')) return graph;
  if (index < 0 || index >= node.children.length) return graph;
  const detachedId = node.children[index]!;
  const newChildren = node.children.filter((_, i) => i !== index);
  const updated = { ...node, children: newChildren } as typeof node;
  const next = { ...graph, nodes: { ...graph.nodes, [containerId]: updated } };
  // Hoist the detached node back to the root list so it stays addressable.
  if (containerId === graph.root) return finalize(next);
  return finalize(appendChild(next, graph.root, detachedId));
}

/** Add a repeat node — instantiates a child N times + stacks them
 *  end-to-end. `count` is an ArgValue (literal / param / expression) so the
 *  multiplicity can be a dial-able knob. Used by `stand` (3 joints) + future
 *  drilling-string compositions. */
export function addRepeat(
  graph: Graph,
  child: NodeId,
  count: ArgValue = asLiteral(1),
  parentId?: NodeId,
): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const node: RepeatNode = { id, type: 'repeat', children: child ? [child] : [], count };
  const xy = defaultCallPosition(graph);
  const next: Graph = { ...withNodes(graph, { [id]: node }), layout: { ...graph.layout, [id]: xy } };
  const final = appendChild(next, parentId ?? graph.root, id);
  return { graph: finalize(final), id };
}

/** Drop an UNWIRED Repeat node — count defaults to 3, child is the empty
 *  string until the user drag-wires another node into the child slot.
 *  Default op is 'list': the Repeat is a pure "build N copies as a list"
 *  primitive. The user wires its output into a Stack (or any other
 *  consumer) to decide how the list is combined. This separation makes
 *  the composition explicit + visually obvious.
 *
 *  Legacy parts (saved before this change) have no op field; the emit
 *  defaults to 'stack' for those — preserves dt_stand etc. */
export function addRepeatPlaceholder(graph: Graph, parentId?: NodeId) {
  const r = addRepeat(graph, '', asLiteral(3), parentId);
  const next = setRepeatOp(r.graph, r.id, 'list');
  return { graph: next, id: r.id };
}

/** Walk UP from `id` through any mv/rot/txfmn wrappers (a node whose `.child`
 *  is the current id) to the OUTERMOST transform, returning that wrapper id.
 *  Returns `id` unchanged when nothing wraps it. Cycle-guarded.
 *
 *  Why a repeat child needs this: a part's z-move (and any translate/rotate) is
 *  an INLINE transform wrapper around its Call. The Call card's output socket is
 *  supposed to wire that wrapper, but the socket-source resolver only recognises
 *  mv/rot — NOT the unified `txfmn` a lone mv folds into on save+reload
 *  (hydrateGraph Pass 3). After a reload the socket falls back to the bare Call
 *  id, so wiring the part into a Repeat would drop its transform (the repeated
 *  copies collapse to the origin). Promoting the wired id to its outermost
 *  transform here makes the Repeat keep the part's own placement regardless of
 *  whether the Call id or the wrapper id arrives. A part with NO wrapper is
 *  returned unchanged → existing repeats stay byte-identical. */
function outermostTransformOf(graph: Graph, id: NodeId): NodeId {
  let cur = id;
  const seen = new Set<NodeId>();
  for (;;) {
    if (seen.has(cur)) break;
    seen.add(cur);
    let wrapper: NodeId | null = null;
    for (const n of Object.values(graph.nodes)) {
      if ((n.type === 'mv' || n.type === 'rot' || n.type === 'txfmn') &&
          (n as MvNode | RotNode | TxfmnNode).child === cur) {
        wrapper = n.id;
        break;
      }
    }
    if (!wrapper) break;
    cur = wrapper;
  }
  return cur;
}

/** Append a PART to a Repeat's repeated unit (the PARTS section). Multiple
 *  parts combine per-iteration via place([...]); see RepeatNode doc. The wired
 *  id is promoted to its outermost transform wrapper so the part keeps its own
 *  mv/rot placement (see outermostTransformOf). */
export function addRepeatChild(graph: Graph, repeatId: NodeId, childId: NodeId): Graph {
  const resolved = outermostTransformOf(graph, childId);
  return updateRepeat(graph, repeatId, (n) => ({ ...n, children: [...(n.children ?? []), resolved] }));
}

/** Rebind the part at `idx` to a different node (drag onto an existing row).
 *  Promotes the wired id to its outermost transform wrapper (see
 *  outermostTransformOf) so the part's placement survives. */
export function setRepeatChildAt(graph: Graph, repeatId: NodeId, idx: number, childId: NodeId): Graph {
  const resolved = outermostTransformOf(graph, childId);
  return updateRepeat(graph, repeatId, (n) => {
    const children = [...(n.children ?? [])];
    if (idx < 0 || idx >= children.length) return n;
    children[idx] = resolved;
    return { ...n, children };
  });
}

/** Remove the part at `idx` from the Repeat's PARTS list. */
export function removeRepeatChildAt(graph: Graph, repeatId: NodeId, idx: number): Graph {
  return updateRepeat(graph, repeatId, (n) => {
    const children = [...(n.children ?? [])];
    if (idx < 0 || idx >= children.length) return n;
    children.splice(idx, 1);
    return { ...n, children };
  });
}

/** Reorder a part up (-1) or down (+1) — order = place([...]) order. */
export function moveRepeatChild(graph: Graph, repeatId: NodeId, idx: number, dir: -1 | 1): Graph {
  return updateRepeat(graph, repeatId, (n) => {
    const children = [...(n.children ?? [])];
    const j = idx + dir;
    if (idx < 0 || idx >= children.length || j < 0 || j >= children.length) return n;
    [children[idx], children[j]] = [children[j], children[idx]];
    return { ...n, children };
  });
}

/** Legacy single-slot setter — kept for the primary wire path. Replaces the
 *  FIRST part (or appends if the Repeat has none). New code prefers
 *  addRepeatChild / setRepeatChildAt. */
export function setRepeatChild(graph: Graph, repeatId: NodeId, childId: NodeId): Graph {
  return updateRepeat(graph, repeatId, (n) => {
    const children = [...(n.children ?? [])];
    if (children.length === 0) children.push(childId);
    else children[0] = childId;
    return { ...n, children };
  });
}

/** Set the RAW per-iteration body override (windowed editor code mode). Emits
 *  verbatim, overriding the children-derived body. */
export function setRepeatBodyExpr(graph: Graph, repeatId: NodeId, src: string): Graph {
  return updateRepeat(graph, repeatId, (n) => ({ ...n, bodyExpr: src }));
}

/** Clear the body override → back to the wired children body. */
export function clearRepeatBodyExpr(graph: Graph, repeatId: NodeId): Graph {
  return updateRepeat(graph, repeatId, (n) => {
    const { bodyExpr: _drop, ...rest } = n;
    return { ...rest };
  });
}

/** Update a Repeat node's count slot. */
export function setRepeatCount(graph: Graph, repeatId: NodeId, count: ArgValue): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'repeat') return graph;
  const updated: RepeatNode = { ...node, count };
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: updated } });
}

/** Choose how the Repeat's N copies are combined (stack / list / place). */
export function setRepeatOp(graph: Graph, repeatId: NodeId, op: RepeatOp): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'repeat') return graph;
  const updated: RepeatNode = { ...node, op };
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: updated } });
}

// ─── Patterned-repeat helpers (#7) — loop var · per-iteration bindings ·
//     per-copy modifier transform stack. All immutable + finalize-wrapped so
//     modifier/binding param-wires land in the edge index + orphan check. ───
/** Internal: apply `fn` to the repeat node, no-op when id isn't a repeat. */
function updateRepeat(graph: Graph, repeatId: NodeId, fn: (n: RepeatNode) => RepeatNode): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'repeat') return graph;
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: fn(node) } });
}

/** Set the iteration variable name (blank ⇒ emit falls back to 'i'). */
export function setRepeatLoopVar(graph: Graph, repeatId: NodeId, name: string): Graph {
  return updateRepeat(graph, repeatId, (n) => ({ ...n, loopVar: name }));
}

export function addRepeatBinding(graph: Graph, repeatId: NodeId): Graph {
  return updateRepeat(graph, repeatId, (n) => ({ ...n, bindings: [...(n.bindings ?? []), { name: '', value: asLiteral(0) }] }));
}
export function setRepeatBindingName(graph: Graph, repeatId: NodeId, idx: number, name: string): Graph {
  return updateRepeat(graph, repeatId, (n) => {
    const bindings = [...(n.bindings ?? [])];
    if (!bindings[idx]) return n;
    bindings[idx] = { ...bindings[idx], name };
    return { ...n, bindings };
  });
}
export function setRepeatBindingValue(graph: Graph, repeatId: NodeId, idx: number, value: ArgValue): Graph {
  return updateRepeat(graph, repeatId, (n) => {
    const bindings = [...(n.bindings ?? [])];
    if (!bindings[idx]) return n;
    bindings[idx] = { ...bindings[idx], value };
    return { ...n, bindings };
  });
}
export function removeRepeatBinding(graph: Graph, repeatId: NodeId, idx: number): Graph {
  return updateRepeat(graph, repeatId, (n) => ({ ...n, bindings: (n.bindings ?? []).filter((_, i) => i !== idx) }));
}

export function addRepeatModifier(graph: Graph, repeatId: NodeId, kind: 'mv' | 'rot', vec?: [ArgValue, ArgValue, ArgValue]): Graph {
  const v: [ArgValue, ArgValue, ArgValue] = vec ?? [asLiteral(0), asLiteral(0), asLiteral(0)];
  return updateRepeat(graph, repeatId, (n) => ({ ...n, modifiers: [...(n.modifiers ?? []), { kind, vec: v } as NodeTransform] }));
}
export function setRepeatModifierAxis(graph: Graph, repeatId: NodeId, idx: number, axis: 0 | 1 | 2, value: ArgValue): Graph {
  return updateRepeat(graph, repeatId, (n) => {
    const modifiers = [...(n.modifiers ?? [])];
    if (!modifiers[idx]) return n;
    const vec = [...modifiers[idx].vec] as [ArgValue, ArgValue, ArgValue];
    vec[axis] = value;
    modifiers[idx] = { ...modifiers[idx], vec };
    return { ...n, modifiers };
  });
}
export function setRepeatModifierKind(graph: Graph, repeatId: NodeId, idx: number, kind: 'mv' | 'rot'): Graph {
  return updateRepeat(graph, repeatId, (n) => {
    const modifiers = [...(n.modifiers ?? [])];
    if (!modifiers[idx]) return n;
    modifiers[idx] = { ...modifiers[idx], kind };
    return { ...n, modifiers };
  });
}
export function moveRepeatModifier(graph: Graph, repeatId: NodeId, idx: number, dir: -1 | 1): Graph {
  return updateRepeat(graph, repeatId, (n) => {
    const modifiers = [...(n.modifiers ?? [])];
    const j = idx + dir;
    if (idx < 0 || idx >= modifiers.length || j < 0 || j >= modifiers.length) return n;
    [modifiers[idx], modifiers[j]] = [modifiers[j], modifiers[idx]];
    return { ...n, modifiers };
  });
}
export function removeRepeatModifier(graph: Graph, repeatId: NodeId, idx: number): Graph {
  return updateRepeat(graph, repeatId, (n) => ({ ...n, modifiers: (n.modifiers ?? []).filter((_, i) => i !== idx) }));
}

// ─── Per-PART modifiers — each repeated part gets its own mv/rot stack,
//     keyed by child id, folded around just that part inside place([…]). ──────
function updatePartMods(graph: Graph, repeatId: NodeId, childId: NodeId,
  fn: (mods: NodeTransform[]) => NodeTransform[]): Graph {
  return updateRepeat(graph, repeatId, (n) => {
    const all = { ...(n.partModifiers ?? {}) };
    const next = fn([...(all[childId] ?? [])]);
    if (next.length) all[childId] = next; else delete all[childId];
    return { ...n, partModifiers: all };
  });
}
export function addPartModifier(graph: Graph, repeatId: NodeId, childId: NodeId, kind: 'mv' | 'rot', vec?: [ArgValue, ArgValue, ArgValue]): Graph {
  const v: [ArgValue, ArgValue, ArgValue] = vec ?? [asLiteral(0), asLiteral(0), asLiteral(0)];
  return updatePartMods(graph, repeatId, childId, (mods) => [...mods, { kind, vec: v } as NodeTransform]);
}
export function setPartModifierAxis(graph: Graph, repeatId: NodeId, childId: NodeId, idx: number, axis: 0 | 1 | 2, value: ArgValue): Graph {
  return updatePartMods(graph, repeatId, childId, (mods) => {
    if (!mods[idx]) return mods;
    const vec = [...mods[idx].vec] as [ArgValue, ArgValue, ArgValue];
    vec[axis] = value;
    mods[idx] = { ...mods[idx], vec };
    return mods;
  });
}
export function setPartModifierKind(graph: Graph, repeatId: NodeId, childId: NodeId, idx: number, kind: 'mv' | 'rot'): Graph {
  return updatePartMods(graph, repeatId, childId, (mods) => {
    if (!mods[idx]) return mods;
    mods[idx] = { ...mods[idx], kind };
    return mods;
  });
}
export function movePartModifier(graph: Graph, repeatId: NodeId, childId: NodeId, idx: number, dir: -1 | 1): Graph {
  return updatePartMods(graph, repeatId, childId, (mods) => {
    const j = idx + dir;
    if (idx < 0 || idx >= mods.length || j < 0 || j >= mods.length) return mods;
    [mods[idx], mods[j]] = [mods[j], mods[idx]];
    return mods;
  });
}
export function removePartModifier(graph: Graph, repeatId: NodeId, childId: NodeId, idx: number): Graph {
  return updatePartMods(graph, repeatId, childId, (mods) => mods.filter((_, i) => i !== idx));
}

// ─── Polygon helpers ────────────────────────────────────────────────────────
//
// PolygonNode is profile-mode's sole producer (replaces pen_* Call chains).
// A polygon owns a flat ordered list of {r, z} ArgValue pairs. The editor
// renders each row with a ƒ-popup so points can be wired to PARAMS sliders
// or expressions just like Call args. Reorder / add / remove are direct
// mutations on `points`; emit walks the array literally into a `return
// [[r0, z0], …];` body via composition-emit-profile.ts.

/** Drop a Polygon node with three default vertices — enough geometry that
 *  /resolve doesn't trip the "≥ 3 points" guard, gives the user something
 *  visible immediately. Defaults trace a small triangle in (r, z) space. */
export function addPolygon(
  graph: Graph,
  initialPoints?: PolygonEntry[],
  parentId?: NodeId,
): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const points: PolygonEntry[] = initialPoints ?? [
    { kind: 'point', r: asLiteral(0), z: asLiteral(0) },
    { kind: 'point', r: asLiteral(1), z: asLiteral(0) },
    { kind: 'point', r: asLiteral(1), z: asLiteral(1) },
  ];
  const node: PolygonNode = { id, type: 'polygon', points };
  const xy = defaultCallPosition(graph);
  const next: Graph = { ...withNodes(graph, { [id]: node }), layout: { ...graph.layout, [id]: xy } };
  const finalGraph = appendChild(next, parentId ?? graph.root, id);
  return { graph: finalize(finalGraph), id };
}

// ─── Sketch node helpers (plan M.1) ────────────────────────────────────────

/** Create a `sketch` node seeded with a flat collar (4 line ops) so it bakes
 *  immediately; the user adds curves/fillets/chamfers from there. */
export function addSketch(graph: Graph, parentId?: NodeId): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const node: SketchNode = {
    id, type: 'sketch',
    ops: [
      { op: 'line', r: asLiteral(0.5), z: asLiteral(0) },
      { op: 'line', r: asLiteral(0.5), z: asLiteral(2) },
      { op: 'line', r: asLiteral(1.5), z: asLiteral(2) },
      { op: 'line', r: asLiteral(1.5), z: asLiteral(0) },
    ],
    segments: asLiteral(64),
  };
  const xy = defaultCallPosition(graph);
  const next: Graph = { ...withNodes(graph, { [id]: node }), layout: { ...graph.layout, [id]: xy } };
  const finalGraph = appendChild(next, parentId ?? graph.root, id);
  return { graph: finalize(finalGraph), id };
}

/** Insert a sketch op after `afterIdx` (default end). line/spline carry a
 *  point; fillet/chamfer are corner mods on the preceding point. */
export function addSketchOp(graph: Graph, sketchId: NodeId, op: SketchOpEntry['op'], afterIdx?: number): Graph {
  const node = graph.nodes[sketchId];
  // Accepts a sketch OR a sketch_repeat node — both own an `ops` list (the
  // repeat node's `ops` is the prototype run; #805).
  if (!node || (node.type !== 'sketch' && node.type !== 'sketch_repeat')) return graph;
  let entry: SketchOpEntry;
  if (op === 'fillet') entry = { op: 'fillet', radius: asLiteral(0.25) };
  else if (op === 'chamfer') entry = { op: 'chamfer', dist: asLiteral(0.3) };
  else if (op === 'spline') entry = { op: 'spline', r: asLiteral(1), z: asLiteral(1) };
  else entry = { op: 'line', r: asLiteral(1), z: asLiteral(1) };
  const at = (typeof afterIdx === 'number' && afterIdx >= -1 && afterIdx < node.ops.length) ? afterIdx + 1 : node.ops.length;
  const ops = [...node.ops.slice(0, at), entry, ...node.ops.slice(at)];
  return finalize({ ...graph, nodes: { ...graph.nodes, [sketchId]: { ...node, ops } } });
}

/** Set one ArgValue field (r/z/radius/dist) on a sketch op. */
export function setSketchOpField(graph: Graph, sketchId: NodeId, idx: number, field: 'r' | 'z' | 'radius' | 'dist', arg: ArgValue): Graph {
  const node = graph.nodes[sketchId];
  if (!node || (node.type !== 'sketch' && node.type !== 'sketch_repeat')) return graph;
  if (idx < 0 || idx >= node.ops.length) return graph;
  const ops = node.ops.map((o, i) => (i === idx ? ({ ...o, [field]: arg } as SketchOpEntry) : o));
  return finalize({ ...graph, nodes: { ...graph.nodes, [sketchId]: { ...node, ops } } });
}

/** Toggle a point op between absolute and relative (Δr,Δz) coords. No-op on
 *  fillet/chamfer or on the first point op (always absolute). */
export function setSketchOpMode(graph: Graph, sketchId: NodeId, idx: number, mode: 'abs' | 'rel'): Graph {
  const node = graph.nodes[sketchId];
  if (!node || (node.type !== 'sketch' && node.type !== 'sketch_repeat')) return graph;
  const o = node.ops[idx] as any;
  if (!o || (o.op !== 'line' && o.op !== 'spline')) return graph;
  // On a top-level sketch the FIRST point op has no predecessor → always
  // absolute. On a repeat PROTOTYPE the first op is intentionally relative
  // (it tiles off the previous iteration's end), so the rule doesn't apply.
  const firstPointIdx = node.ops.findIndex((e) => (e as any).op === 'line' || (e as any).op === 'spline');
  if (node.type === 'sketch' && idx === firstPointIdx) return graph;
  const ops = node.ops.map((e, i) => (i === idx ? ({ ...e, mode } as SketchOpEntry) : e));
  return finalize({ ...graph, nodes: { ...graph.nodes, [sketchId]: { ...node, ops } } });
}

/** Switch a point op between line and spline (preserves r/z). No-op on
 *  fillet/chamfer. */
export function setSketchOpKind(graph: Graph, sketchId: NodeId, idx: number, kind: 'line' | 'spline'): Graph {
  const node = graph.nodes[sketchId];
  if (!node || (node.type !== 'sketch' && node.type !== 'sketch_repeat')) return graph;
  const o = node.ops[idx] as any;
  if (!o || (o.op !== 'line' && o.op !== 'spline')) return graph;
  const ops = node.ops.map((e, i) => (i === idx ? ({ op: kind, r: o.r, z: o.z } as SketchOpEntry) : e));
  return finalize({ ...graph, nodes: { ...graph.nodes, [sketchId]: { ...node, ops } } });
}

export function moveSketchOp(graph: Graph, sketchId: NodeId, idx: number, dir: -1 | 1): Graph {
  const node = graph.nodes[sketchId];
  if (!node || (node.type !== 'sketch' && node.type !== 'sketch_repeat')) return graph;
  const j = idx + dir;
  if (idx < 0 || idx >= node.ops.length || j < 0 || j >= node.ops.length) return graph;
  const ops = [...node.ops];
  [ops[idx], ops[j]] = [ops[j], ops[idx]];
  return finalize({ ...graph, nodes: { ...graph.nodes, [sketchId]: { ...node, ops } } });
}

export function removeSketchOp(graph: Graph, sketchId: NodeId, idx: number): Graph {
  const node = graph.nodes[sketchId];
  if (!node || (node.type !== 'sketch' && node.type !== 'sketch_repeat')) return graph;
  if (node.ops.length <= 1) return graph;
  if (idx < 0 || idx >= node.ops.length) return graph;
  const removed = node.ops[idx] as any;
  const ops = node.ops.filter((_, i) => i !== idx);
  let nodes = { ...graph.nodes, [sketchId]: { ...node, ops } };
  let layout = graph.layout;
  // Removing a repeat-ref whose SketchRepeatNode is no longer referenced by
  // any other entry drops the orphaned source node + its layout (mirrors
  // removePolygonPoint's repeat-ref cleanup, #805).
  if (removed?.op === 'repeat-ref') {
    const srcId = (removed as SketchRepeatRef).sourceId;
    const stillReferenced = (ops as any[]).some((o) => o?.op === 'repeat-ref' && o.sourceId === srcId);
    if (!stillReferenced && nodes[srcId]) {
      const { [srcId]: _drop, ...rest } = nodes; nodes = rest;
      const { [srcId]: _dropL, ...restL } = layout; layout = restL;
    }
  }
  return finalize({ ...graph, nodes, layout });
}

export function setSketchSegments(graph: Graph, sketchId: NodeId, seg: ArgValue): Graph {
  const node = graph.nodes[sketchId];
  if (!node || node.type !== 'sketch') return graph;
  return finalize({ ...graph, nodes: { ...graph.nodes, [sketchId]: { ...node, segments: seg } } });
}

/** Set the whole-sketch scale on the r (`'x'`) or z (`'y'`) axis. Mirrors
 *  setSketchSegments — immutable, no-op on a non-sketch node. */
export function setSketchScale(graph: Graph, sketchId: NodeId, axis: 'x' | 'y', value: ArgValue): Graph {
  const node = graph.nodes[sketchId];
  if (!node || node.type !== 'sketch') return graph;
  const field = axis === 'x' ? 'scaleX' : 'scaleY';
  return finalize({ ...graph, nodes: { ...graph.nodes, [sketchId]: { ...node, [field]: value } } });
}

// ─── Spline through-points + end-handles (redesign 2026-06-13) ─────────────
// A spline op is one grouped entity: its `(r,z)` endpoint plus chord-relative
// through-points (`pts`) and optional end-tangent handles (`h0`/`h1`). All
// edits go through these finalize-wrapped helpers (no-op on a non-spline op).

/** Internal — apply `mut` to the spline op at `idx`, no-op otherwise. */
function withSplineOp(
  graph: Graph,
  sketchId: NodeId,
  idx: number,
  mut: (o: Extract<SketchOpEntry, { op: 'spline' }>) => SketchOpEntry,
): Graph {
  const node = graph.nodes[sketchId];
  if (!node || (node.type !== 'sketch' && node.type !== 'sketch_repeat')) return graph;
  const o = node.ops[idx] as any;
  if (!o || o.op !== 'spline') return graph;
  const ops = node.ops.map((e, i) => (i === idx ? mut(o) : e));
  return finalize({ ...graph, nodes: { ...graph.nodes, [sketchId]: { ...node, ops } } });
}

/** Add a through-point to a spline op's `pts[]`. Inserts after `afterPtIdx`
 *  (or appends when omitted / out of range). Defaults to mid-chord, no bulge
 *  (u=0.5, v=0). */
export function addSketchSplinePoint(
  graph: Graph,
  sketchId: NodeId,
  idx: number,
  afterPtIdx?: number,
  u: ArgValue = asLiteral(0.5),
  v: ArgValue = asLiteral(0),
): Graph {
  return withSplineOp(graph, sketchId, idx, (o) => {
    const pts = [...(o.pts ?? [])];
    const at = (typeof afterPtIdx === 'number' && afterPtIdx >= -1 && afterPtIdx < pts.length)
      ? afterPtIdx + 1 : pts.length;
    pts.splice(at, 0, [u, v]);
    return { ...o, pts };
  });
}

/** Set one component (`u` or `v`) of one through-point on a spline op. */
export function setSketchSplinePoint(
  graph: Graph,
  sketchId: NodeId,
  idx: number,
  ptIdx: number,
  axis: 'u' | 'v',
  arg: ArgValue,
): Graph {
  return withSplineOp(graph, sketchId, idx, (o) => {
    const pts = [...(o.pts ?? [])];
    if (ptIdx < 0 || ptIdx >= pts.length) return o;
    const pair: [ArgValue, ArgValue] = [...pts[ptIdx]];
    pair[axis === 'u' ? 0 : 1] = arg;
    pts[ptIdx] = pair;
    return { ...o, pts };
  });
}

/** Remove a through-point from a spline op. Drops the `pts` field entirely
 *  when the last point is removed (so emit/migration stay clean). */
export function removeSketchSplinePoint(
  graph: Graph,
  sketchId: NodeId,
  idx: number,
  ptIdx: number,
): Graph {
  return withSplineOp(graph, sketchId, idx, (o) => {
    const pts = (o.pts ?? []).filter((_, k) => k !== ptIdx);
    if (pts.length === 0) { const { pts: _drop, ...rest } = o; return rest; }
    return { ...o, pts };
  });
}

/** Set one component (`u` or `v`) of an end-tangent handle (`h0` = off the
 *  start, `h1` = off the end). Creates the handle at the origin (0,0) of the
 *  chord frame first if absent. */
export function setSketchSplineHandle(
  graph: Graph,
  sketchId: NodeId,
  idx: number,
  which: 'h0' | 'h1',
  axis: 'u' | 'v',
  arg: ArgValue,
): Graph {
  return withSplineOp(graph, sketchId, idx, (o) => {
    const cur: [ArgValue, ArgValue] = o[which] ? [...o[which]!] : [asLiteral(0), asLiteral(0)];
    cur[axis === 'u' ? 0 : 1] = arg;
    return { ...o, [which]: cur };
  });
}

/** Drop an end-tangent handle, reverting that end to the auto Catmull-Rom
 *  tangent. */
export function clearSketchSplineHandle(
  graph: Graph,
  sketchId: NodeId,
  idx: number,
  which: 'h0' | 'h1',
): Graph {
  return withSplineOp(graph, sketchId, idx, (o) => {
    if (!o[which]) return o;
    const { [which]: _drop, ...rest } = o;
    return rest;
  });
}

/** Update one coordinate of one entry in a polygon. Works on both vertex
 *  rows AND repeat-block rows — for a vertex it's the single (r, z) pair,
 *  for a repeat it's the EXPRESSION the loop iterates (r(i) / z(i)). */
export function setPolygonCoord(
  graph: Graph,
  polygonId: NodeId,
  idx: number,
  axis: 'r' | 'z',
  arg: ArgValue,
): Graph {
  const node = graph.nodes[polygonId];
  if (!node || node.type !== 'polygon') return graph;
  if (idx < 0 || idx >= node.points.length) return graph;
  const points = node.points.map((p, i) => (i === idx ? { ...p, [axis]: arg } : p));
  const updated: PolygonNode = { ...node, points };
  return finalize({ ...graph, nodes: { ...graph.nodes, [polygonId]: updated } });
}

/** Update the repeat block's `count` (the number of points it expands to).
 *  No-op on a vertex row — repeat-only field. */
export function setPolygonRepeatCount(
  graph: Graph,
  polygonId: NodeId,
  idx: number,
  count: ArgValue,
): Graph {
  const node = graph.nodes[polygonId];
  if (!node || node.type !== 'polygon') return graph;
  const entry = node.points[idx];
  if (!entry || entry.kind !== 'repeat') return graph;
  const points = node.points.map((p, i) => (i === idx ? { ...p, count } : p));
  const updated: PolygonNode = { ...node, points };
  return finalize({ ...graph, nodes: { ...graph.nodes, [polygonId]: updated } });
}

/** Rename the repeat block's loop variable (the symbol bound to the
 *  iteration index in r/z expressions). Defaults to `i` on add; the user
 *  can switch to `j` etc. when nesting repeats inside a parent loop. */
export function setPolygonRepeatLoopVar(
  graph: Graph,
  polygonId: NodeId,
  idx: number,
  loopVar: string,
): Graph {
  const node = graph.nodes[polygonId];
  if (!node || node.type !== 'polygon') return graph;
  const entry = node.points[idx];
  if (!entry || entry.kind !== 'repeat') return graph;
  const points = node.points.map((p, i) => (i === idx ? { ...p, loopVar } : p));
  const updated: PolygonNode = { ...node, points };
  return finalize({ ...graph, nodes: { ...graph.nodes, [polygonId]: updated } });
}

/** Insert a new VERTEX into a polygon, after `afterIdx` (or at the end
 *  when afterIdx is omitted / out of range). New vertex defaults to the
 *  same coords as the row above so the user can tweak from a known base.
 *  Pass `afterIdx = -1` to PREPEND at index 0 (insert above the first row);
 *  seed falls back to the original first point in that case. */
export function addPolygonPoint(graph: Graph, polygonId: NodeId, afterIdx?: number): Graph {
  const node = graph.nodes[polygonId];
  if (!node || node.type !== 'polygon') return graph;
  const insertAt = (typeof afterIdx === 'number' && afterIdx >= -1 && afterIdx < node.points.length)
    ? afterIdx + 1
    : node.points.length;
  // Seed from the previous entry IF it's a vertex; a repeat block's r/z
  // are expressions in the loop var (e.g. `cos(i*2*PI/N)`), and copying
  // those into a literal vertex would produce garbage. Fall back to 0,0
  // when the seed isn't a plain vertex.
  const prev = node.points[insertAt - 1];
  const seedPt: PolygonPoint = (prev && prev.kind === 'point')
    ? { kind: 'point', r: { ...prev.r }, z: { ...prev.z } }
    : { kind: 'point', r: asLiteral(0), z: asLiteral(0) };
  const points = [...node.points.slice(0, insertAt), seedPt, ...node.points.slice(insertAt)];
  const updated: PolygonNode = { ...node, points };
  return finalize({ ...graph, nodes: { ...graph.nodes, [polygonId]: updated } });
}

/** Insert a new REPEAT-REF row into a polygon AND drop the corresponding
 *  PolyRepeatNode as a separate card on the canvas (#157, 2026-06-10).
 *  Default = 6-point polar n-gon: count=6, loopVar='i', r='cos(i*2*PI/6)',
 *  z='sin(i*2*PI/6)'. The new card lands to the RIGHT of the polygon
 *  with a 40-px vertical offset stacked per existing repeat sibling so
 *  consecutive `+ repeat` clicks don't pile cards on top of each other.
 *
 *  Same `afterIdx` semantics as addPolygonPoint (-1 = prepend, omitted
 *  = append). */
export function addPolygonRepeat(graph: Graph, polygonId: NodeId, afterIdx?: number): Graph {
  const node = graph.nodes[polygonId];
  if (!node || node.type !== 'polygon') return graph;
  const insertAt = (typeof afterIdx === 'number' && afterIdx >= -1 && afterIdx < node.points.length)
    ? afterIdx + 1
    : node.points.length;

  // Create the PolyRepeatNode + its canvas layout entry.
  const repeatId = newNodeId();
  const repeatNode: PolyRepeatNode = {
    id: repeatId,
    type: 'poly_repeat',
    count: asLiteral(6),
    loopVar: 'i',
    r: { kind: 'expr', expr: 'cos(i*2*PI/6)' },
    z: { kind: 'expr', expr: 'sin(i*2*PI/6)' },
  };
  // Layout: 280 px right of the polygon's left edge + stack vertically
  // so multiple `+ repeat` clicks fan out instead of overlapping.
  const polyXY = graph.layout[polygonId] ?? { x: 80, y: 80 };
  const existingRepeats = Object.values(graph.nodes)
    .filter((n) => n.type === 'poly_repeat').length;
  const xy: LayoutXY = { x: polyXY.x + 280, y: polyXY.y + existingRepeats * 40 };

  // Insert the repeat-ref entry into the polygon at insertAt.
  const ref: PolygonRepeatRef = { kind: 'repeat-ref', sourceId: repeatId };
  const points = [...node.points.slice(0, insertAt), ref, ...node.points.slice(insertAt)];
  const updatedPoly: PolygonNode = { ...node, points };

  return finalize({
    ...graph,
    nodes: { ...graph.nodes, [polygonId]: updatedPoly, [repeatId]: repeatNode },
    layout: { ...graph.layout, [repeatId]: xy },
  });
}

/** Wire an existing expression INSTANCE's `list<point>` OUTPUT into a polygon's
 *  point list (#11 expression-as-builder) — inserts an `expr-list-ref` entry.
 *  The ExprNode + its def (with a `shape:'list', elem:'point'` output) must
 *  already exist; this only adds the splice row. Same `afterIdx` semantics as
 *  addPolygonPoint (-1 = prepend, omitted = append). No-op if the polygon or
 *  the source expr instance is missing. */
export function addPolygonExprListRef(
  graph: Graph, polygonId: NodeId, sourceId: NodeId, output: string, afterIdx?: number,
): Graph {
  const node = graph.nodes[polygonId];
  const src = graph.nodes[sourceId];
  if (!node || node.type !== 'polygon') return graph;
  if (!src || src.type !== 'expr' || !output) return graph;
  const insertAt = (typeof afterIdx === 'number' && afterIdx >= -1 && afterIdx < node.points.length)
    ? afterIdx + 1
    : node.points.length;
  const ref: PolygonExprListRef = { kind: 'expr-list-ref', sourceId, output };
  const points = [...node.points.slice(0, insertAt), ref, ...node.points.slice(insertAt)];
  const updated: PolygonNode = { ...node, points };
  return finalize({ ...graph, nodes: { ...graph.nodes, [polygonId]: updated } });
}

/**
 * "+ expr" on a polygon (#11 create-affordance) — the single-action analog of
 * addPolygonRepeat. Creates a fresh expression DEF with a `list<point>` output
 * seeded with a baking `map(range(N), f(i)=[r,z])`, drops an INSTANCE, and
 * splices that output into the polygon's points (an `expr-list-ref`). The user
 * then edits the formula on the expression (Σ menu / the ◇/Σ popovers). Returns
 * the new defId/instanceId so the caller can open the editor. No-op (returns
 * just { graph }) if `polygonId` isn't a polygon.
 */
export function addPolygonExprList(
  graph: Graph, polygonId: NodeId,
): { graph: Graph; defId?: NodeId; instanceId?: NodeId } {
  const poly = graph.nodes[polygonId];
  if (!poly || poly.type !== 'polygon') return { graph };
  const made = addExprDef(graph);
  let g = made.graph;
  const defId = made.id;
  // A seeded octagon profile (r = 0.5 ± 0.4·cos, z = 0.4·sin) — valid geometry
  // out of the box so the polygon bakes immediately; the formula is the edit point.
  const seed: ExprOut = {
    name: 'pts',
    formula: 'map(range(0, 8), f(i) = [0.5 + 0.4 * cos(i / 8 * tau), 0.4 * sin(i / 8 * tau)])',
    shape: 'list', elem: 'point',
  };
  g = mapDef(g, defId, (d) => ({ ...d, outputs: [...d.outputs, seed] }));
  const inst = addExprInstance(g, defId);
  g = inst.graph;
  g = addPolygonExprListRef(g, polygonId, inst.id, 'pts');
  return { graph: g, defId, instanceId: inst.id };
}

// ─── Sketch REPEAT (B.2 / id 805) ──────────────────────────────────────────
// Mirrors addPolygonRepeat: a separate free-floating SketchRepeatNode card +
// a flat {op:'repeat-ref', sourceId} entry spliced into the parent sketch's
// ops. The prototype run is edited on the repeat card via the SAME sketch-op
// mutators (addSketchOp/setSketchOpField/…), which now accept a sketch_repeat
// node. Default = a visibly-periodic 2-op V-tooth that self-tiles 4×.

/** Insert a REPEAT-REF row into a sketch AND drop the corresponding
 *  SketchRepeatNode as a separate card. `afterIdx` matches addSketchOp
 *  (-1 = prepend, omitted = append). Returns the new graph + the repeat id. */
export function addSketchRepeat(graph: Graph, sketchId: NodeId, afterIdx?: number): { graph: Graph; id: NodeId } {
  const node = graph.nodes[sketchId];
  if (!node || node.type !== 'sketch') return { graph, id: '' };
  const insertAt = (typeof afterIdx === 'number' && afterIdx >= -1 && afterIdx < node.ops.length)
    ? afterIdx + 1
    : node.ops.length;

  const repeatId = newNodeId();
  const repeatNode: SketchRepeatNode = {
    id: repeatId,
    type: 'sketch_repeat',
    count: asLiteral(4),
    loopVar: 'i',
    // A 2-op V-tooth prototype whose own rel ops net a pitch in z (pure
    // self-tiling — no synthetic advance), so the first drop bakes something
    // visibly periodic. The user adds a dr/dz stride for racks/combs.
    ops: [
      { op: 'line', r: asLiteral(0.3), z: asLiteral(0.25), mode: 'rel' },
      { op: 'line', r: asLiteral(-0.3), z: asLiteral(0.25), mode: 'rel' },
    ],
  };
  // Layout: 280px right of the sketch + a per-sibling vertical fan.
  const skXY = graph.layout[sketchId] ?? { x: 80, y: 80 };
  const existing = Object.values(graph.nodes).filter((n) => n.type === 'sketch_repeat').length;
  const xy: LayoutXY = { x: skXY.x + 280, y: skXY.y + existing * 40 };

  const ref: SketchRepeatRef = { op: 'repeat-ref', sourceId: repeatId };
  const ops = [...node.ops.slice(0, insertAt), ref, ...node.ops.slice(insertAt)];
  const updatedSketch: SketchNode = { ...node, ops };

  const g = finalize({
    ...graph,
    nodes: { ...graph.nodes, [sketchId]: updatedSketch, [repeatId]: repeatNode },
    layout: { ...graph.layout, [repeatId]: xy },
  });
  return { graph: g, id: repeatId };
}

/** Wire an existing expression INSTANCE's `list<point>` OUTPUT into a sketch's
 *  ops (#11 expression-as-builder, sketch edition) — inserts an `expr-list-ref`
 *  entry. The ExprNode + its def (with a `shape:'list', elem:'point'` output)
 *  must already exist; this only adds the splice row. Same `afterIdx` semantics
 *  as addSketchOp (-1 = prepend, omitted = append). No-op if the sketch or the
 *  source expr instance is missing. Mirrors `addPolygonExprListRef`. */
export function addSketchExprListRef(
  graph: Graph, sketchId: NodeId, sourceId: NodeId, output: string, afterIdx?: number,
): Graph {
  const node = graph.nodes[sketchId];
  const src = graph.nodes[sourceId];
  if (!node || node.type !== 'sketch') return graph;
  if (!src || src.type !== 'expr' || !output) return graph;
  const insertAt = (typeof afterIdx === 'number' && afterIdx >= -1 && afterIdx < node.ops.length)
    ? afterIdx + 1
    : node.ops.length;
  const ref: SketchExprListRef = { op: 'expr-list-ref', sourceId, output };
  const ops = [...node.ops.slice(0, insertAt), ref, ...node.ops.slice(insertAt)];
  const updated: SketchNode = { ...node, ops };
  return finalize({ ...graph, nodes: { ...graph.nodes, [sketchId]: updated } });
}

/**
 * "+ expr" on a sketch (#11 create-affordance) — the single-action analog of
 * addSketchRepeat / addPolygonExprList. Creates a fresh expression DEF with a
 * `list<point>` output seeded with a baking `map(range(0,8), f(i)=[r,z])`
 * octagon, drops an INSTANCE, and splices that output into the sketch's ops (an
 * `expr-list-ref`). The user then edits the formula on the expression (Σ menu).
 * Returns the new defId/instanceId so the caller can open the editor. No-op
 * (returns just { graph }) if `sketchId` isn't a sketch.
 */
export function addSketchExprList(
  graph: Graph, sketchId: NodeId, afterIdx?: number,
): { graph: Graph; defId?: NodeId; instanceId?: NodeId } {
  const sk = graph.nodes[sketchId];
  if (!sk || sk.type !== 'sketch') return { graph };
  const made = addExprDef(graph);
  let g = made.graph;
  const defId = made.id;
  // A seeded octagon profile (r = 0.5 ± 0.4·cos, z = 0.4·sin) — valid geometry
  // out of the box so the sketch bakes immediately; the formula is the edit point.
  const seed: ExprOut = {
    name: 'pts',
    formula: 'map(range(0, 8), f(i) = [0.5 + 0.4 * cos(i / 8 * tau), 0.4 * sin(i / 8 * tau)])',
    shape: 'list', elem: 'point',
  };
  g = mapDef(g, defId, (d) => ({ ...d, outputs: [...d.outputs, seed] }));
  const inst = addExprInstance(g, defId);
  g = inst.graph;
  g = addSketchExprListRef(g, sketchId, inst.id, 'pts', afterIdx);
  return { graph: g, defId, instanceId: inst.id };
}

/** Set a SketchRepeatNode's iteration count. */
export function setSketchRepeatCount(graph: Graph, repeatId: NodeId, count: ArgValue): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'sketch_repeat') return graph;
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: { ...node, count } } });
}

/** Set a SketchRepeatNode's loop-variable name. */
export function setSketchRepeatLoopVar(graph: Graph, repeatId: NodeId, loopVar: string): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'sketch_repeat') return graph;
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: { ...node, loopVar } } });
}

/** Set a SketchRepeatNode's per-iteration advance on the r (`'dr'`) or z
 *  (`'dz'`) axis. */
export function setSketchRepeatAdvance(graph: Graph, repeatId: NodeId, axis: 'dr' | 'dz', value: ArgValue): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'sketch_repeat') return graph;
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: { ...node, [axis]: value } } });
}

// SketchRepeat bindings — reuse the poly_repeat binding shape verbatim.
export function addSketchRepeatBinding(graph: Graph, repeatId: NodeId): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'sketch_repeat') return graph;
  const existing = node.bindings ?? [];
  const used = new Set(existing.map((b) => b.name));
  let k = existing.length + 1; let name = `b${k}`;
  while (used.has(name)) name = `b${++k}`;
  const bindings: PolyRepeatBinding[] = [...existing, { name, value: asLiteral(0) }];
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: { ...node, bindings } } });
}
export function setSketchRepeatBindingName(graph: Graph, repeatId: NodeId, idx: number, name: string): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'sketch_repeat') return graph;
  const bindings = (node.bindings ?? []).map((b, i) => (i === idx ? { ...b, name } : b));
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: { ...node, bindings } } });
}
export function setSketchRepeatBindingValue(graph: Graph, repeatId: NodeId, idx: number, value: ArgValue): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'sketch_repeat') return graph;
  const bindings = (node.bindings ?? []).map((b, i) => (i === idx ? { ...b, value } : b));
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: { ...node, bindings } } });
}
export function removeSketchRepeatBinding(graph: Graph, repeatId: NodeId, idx: number): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'sketch_repeat') return graph;
  const bindings = (node.bindings ?? []).filter((_, i) => i !== idx);
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: { ...node, bindings } } });
}

// ─── Expr definitions + instances (B.7 / id 914, v3) ───────────────────────
// A reusable per-part calc DEFINITION (graph.exprDefs[]) with four declared
// sections (PARAMS · CONSTS · VARIABLES · OUTPUTS), instanced by thin
// ExprNode{defId,bindings} nodes (referenced by wires, like poly_repeat — not
// in the root list). Editing a def updates every instance; instances differ
// only by their per-PARAM wiring. All mutators return a new Graph (immutable).

/** The full flat name set a def declares — for unique auto-naming new rows. */
function exprDefNames(d: ExprDef): Set<string> {
  return new Set<string>([...d.params, ...d.consts, ...d.vars, ...d.outputs].map((r) => r.name));
}
/** First `<base><k>` (k≥1) not already declared in the def. */
function uniqueExprDefName(d: ExprDef, base: string): string {
  const used = exprDefNames(d);
  let k = 1; let name = `${base}${k}`;
  while (used.has(name)) name = `${base}${++k}`;
  return name;
}

/** Add an EMPTY expression definition to the part. Returns its id. */
export function addExprDef(graph: Graph): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const existing = graph.exprDefs ?? [];
  const used = new Set(existing.map((d) => d.name));
  let k = existing.length + 1;
  let name = `expr_${k}`;
  while (used.has(name)) name = `expr_${++k}`;
  const def: ExprDef = { id, name, params: [], consts: [], vars: [], outputs: [] };
  const g = finalize({ ...graph, exprDefs: [...existing, def] });
  return { graph: g, id };
}

/** Drop an INSTANCE of a def onto the canvas (a thin ExprNode). Returns its id. */
export function addExprInstance(graph: Graph, defId: NodeId, at?: LayoutXY): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const node: ExprNode = { id, type: 'expr', defId };
  const existing = Object.values(graph.nodes).filter((n) => n.type === 'expr').length;
  const xy: LayoutXY = at ?? { x: 120 + (existing % 4) * 240, y: 120 + existing * 40 };
  const g = finalize({
    ...graph,
    nodes: { ...graph.nodes, [id]: node },
    layout: { ...graph.layout, [id]: xy },
  });
  return { graph: g, id };
}

// ─── Spline PATH producer helpers (TODO #15) ────────────────────────────────

/** Create a `spline` node seeded with a gentle 3-point bend so it bakes a
 *  visible curve immediately. Like an Expr INSTANCE it is FREE-FLOATING — added
 *  to nodes + layout only, NEVER appended to the root list (it's a value
 *  producer, not a geometry output). Wire its output socket into a Call's `path`
 *  arg (r_sweep) to use it. */
export function addSpline(graph: Graph, at?: LayoutXY): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const node: SplineNode = {
    id, type: 'spline',
    points: [
      [0, 0, 0],
      [3, 1.5, 0],
      [6, 0, 0],
    ],
    samples: asLiteral(32),
  };
  const existing = Object.values(graph.nodes).filter((n) => n.type === 'spline').length;
  const xy: LayoutXY = at ?? { x: 120 + (existing % 4) * 240, y: 360 + existing * 40 };
  const g = finalize({
    ...graph,
    nodes: { ...graph.nodes, [id]: node },
    layout: { ...graph.layout, [id]: xy },
  });
  return { graph: g, id };
}

/** Replace a spline node's control points. */
export function setSplinePoints(graph: Graph, id: NodeId, points: [number, number, number][]): Graph {
  const node = graph.nodes[id];
  if (!node || node.type !== 'spline') return graph;
  return finalize({ ...graph, nodes: { ...graph.nodes, [id]: { ...node, points } } });
}

/** Set the spline's output sample count (N equally-spaced points). */
export function setSplineSamples(graph: Graph, id: NodeId, samples: ArgValue): Graph {
  const node = graph.nodes[id];
  if (!node || node.type !== 'spline') return graph;
  return finalize({ ...graph, nodes: { ...graph.nodes, [id]: { ...node, samples } } });
}

/** Immutable update of one def by id (no-op if the id is unknown). */
function mapDef(graph: Graph, defId: NodeId, fn: (d: ExprDef) => ExprDef): Graph {
  const defs = graph.exprDefs ?? [];
  const idx = defs.findIndex((d) => d.id === defId);
  if (idx < 0) return graph;
  const next = defs.slice();
  next[idx] = fn(defs[idx]!);
  return finalize({ ...graph, exprDefs: next });
}

/** Rename a def (shown in the Σ menu + on instance cards). */
export function setExprDefName(graph: Graph, defId: NodeId, name: string): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, name }));
}

/** Remove a def (caller decides what to do with dangling instances — PR-3/4). */
export function removeExprDef(graph: Graph, defId: NodeId): Graph {
  const defs = graph.exprDefs ?? [];
  if (!defs.some((d) => d.id === defId)) return graph;
  return finalize({ ...graph, exprDefs: defs.filter((d) => d.id !== defId) });
}

// ── PARAMS section ──────────────────────────────────────────────────────────
export function addExprDefParam(graph: Graph, defId: NodeId): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, params: [...d.params, { name: uniqueExprDefName(d, 'p') }] }));
}
export function setExprDefParamName(graph: Graph, defId: NodeId, idx: number, name: string): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, params: d.params.map((p, i) => (i === idx ? { ...p, name } : p)) }));
}
/** Set (or clear, via `undefined`) a param's numeric default. */
export function setExprDefParamDefault(graph: Graph, defId: NodeId, idx: number, value: number | undefined): Graph {
  return mapDef(graph, defId, (d) => ({
    ...d,
    params: d.params.map((p, i) => {
      if (i !== idx) return p;
      if (value == null || Number.isNaN(value)) { const { default: _drop, ...rest } = p; return rest; }
      return { ...p, default: value };
    }),
  }));
}
export function removeExprDefParam(graph: Graph, defId: NodeId, idx: number): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, params: d.params.filter((_, i) => i !== idx) }));
}

// ── CONSTS section ──────────────────────────────────────────────────────────
export function addExprDefConst(graph: Graph, defId: NodeId): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, consts: [...d.consts, { name: uniqueExprDefName(d, 'c'), value: 0 }] }));
}
export function setExprDefConstName(graph: Graph, defId: NodeId, idx: number, name: string): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, consts: d.consts.map((c, i) => (i === idx ? { ...c, name } : c)) }));
}
export function setExprDefConstValue(graph: Graph, defId: NodeId, idx: number, value: number): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, consts: d.consts.map((c, i) => (i === idx ? { ...c, value } : c)) }));
}
export function removeExprDefConst(graph: Graph, defId: NodeId, idx: number): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, consts: d.consts.filter((_, i) => i !== idx) }));
}

// ── VARIABLES section ───────────────────────────────────────────────────────
export function addExprDefVar(graph: Graph, defId: NodeId): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, vars: [...d.vars, { name: uniqueExprDefName(d, 'v'), formula: '' }] }));
}
export function setExprDefVarName(graph: Graph, defId: NodeId, idx: number, name: string): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, vars: d.vars.map((v, i) => (i === idx ? { ...v, name } : v)) }));
}
export function setExprDefVarFormula(graph: Graph, defId: NodeId, idx: number, formula: string): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, vars: d.vars.map((v, i) => (i === idx ? { ...v, formula } : v)) }));
}
export function removeExprDefVar(graph: Graph, defId: NodeId, idx: number): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, vars: d.vars.filter((_, i) => i !== idx) }));
}

// ── OUTPUTS section ─────────────────────────────────────────────────────────
export function addExprDefOutput(graph: Graph, defId: NodeId): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, outputs: [...d.outputs, { name: uniqueExprDefName(d, 'out'), formula: '' }] }));
}
export function setExprDefOutputName(graph: Graph, defId: NodeId, idx: number, name: string): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, outputs: d.outputs.map((o, i) => (i === idx ? { ...o, name } : o)) }));
}
export function setExprDefOutputFormula(graph: Graph, defId: NodeId, idx: number, formula: string): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, outputs: d.outputs.map((o, i) => (i === idx ? { ...o, formula } : o)) }));
}
export function removeExprDefOutput(graph: Graph, defId: NodeId, idx: number): Graph {
  return mapDef(graph, defId, (d) => ({ ...d, outputs: d.outputs.filter((_, i) => i !== idx) }));
}
/** Set an output's SHAPE/ELEM typing (#11 expression-as-builder). Passing
 *  `shape:'scalar'` (or undefined) CLEARS the fields so the output reverts to a
 *  byte-identical scalar emit. `elem` only applies when `shape === 'list'`. */
export function setExprDefOutputShape(
  graph: Graph, defId: NodeId, idx: number, shape: ExprOutShape | undefined, elem?: ExprOutElem,
): Graph {
  return mapDef(graph, defId, (d) => ({
    ...d,
    outputs: d.outputs.map((o, i) => {
      if (i !== idx) return o;
      const next = { name: o.name, formula: o.formula } as typeof o;
      if (shape && shape !== 'scalar') {
        next.shape = shape;
        if (shape === 'list' && elem) next.elem = elem;
      }
      return next;
    }),
  }));
}

// ── Instance PARAM bindings ─────────────────────────────────────────────────
function mapExprInstance(graph: Graph, id: NodeId, fn: (n: ExprNode) => ExprNode): Graph {
  const n = graph.nodes[id];
  if (!n || n.type !== 'expr') return graph;
  return finalize({ ...graph, nodes: { ...graph.nodes, [id]: fn(n) } });
}

/** Bind an instance's PARAM (by def param name) to a wired source value — a
 *  `p.*` param, a literal, or an `expr` referencing another block's output. */
export function setExprInputBinding(graph: Graph, id: NodeId, paramName: string, arg: ArgValue): Graph {
  return mapExprInstance(graph, id, (n) => ({ ...n, bindings: { ...(n.bindings ?? {}), [paramName]: arg } }));
}

/** Remove an instance PARAM binding (back to the param default / 0). Drops the
 *  whole `bindings` field when it empties. */
export function clearExprInputBinding(graph: Graph, id: NodeId, paramName: string): Graph {
  return mapExprInstance(graph, id, (n) => {
    if (!n.bindings || !(paramName in n.bindings)) return n;
    const { [paramName]: _drop, ...rest } = n.bindings;
    if (Object.keys(rest).length === 0) { const { bindings: _b, ...node } = n; return node as ExprNode; }
    return { ...n, bindings: rest };
  });
}

/** Mutate a PolyRepeatNode's `count` (number of points it generates). */
export function setPolyRepeatCount(graph: Graph, repeatId: NodeId, count: ArgValue): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'poly_repeat') return graph;
  const updated: PolyRepeatNode = { ...node, count };
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: updated } });
}

/** Mutate a PolyRepeatNode's loop variable name. */
export function setPolyRepeatLoopVar(graph: Graph, repeatId: NodeId, loopVar: string): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'poly_repeat') return graph;
  const updated: PolyRepeatNode = { ...node, loopVar };
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: updated } });
}

/** Mutate a PolyRepeatNode's r or z expression. */
export function setPolyRepeatCoord(graph: Graph, repeatId: NodeId, axis: 'r' | 'z', arg: ArgValue): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'poly_repeat') return graph;
  const updated: PolyRepeatNode = { ...node, [axis]: arg };
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: updated } });
}

// ─── PolyRepeat bindings (#157, 2026-06-11) ────────────────────────────
// Local symbols on a loop card — let the user pull repeated sub-expressions
// into named constants (e.g. `amplitude = p.thread_height`) so the r/z
// expressions stay terse. Each binding's value is an ArgValue, so it can
// be a literal, a wired param, or a JS expression itself.

/** Append a new binding to a PolyRepeatNode. Default name picks the next
 *  unused single letter (a, b, c, …) so the user can rename without
 *  conflict; default value is a literal 0. */
export function addPolyRepeatBinding(graph: Graph, repeatId: NodeId): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'poly_repeat') return graph;
  const existing = node.bindings ?? [];
  const taken = new Set(existing.map((b) => b.name));
  // Find the next free single-letter name skipping the loop var so the
  // user doesn't accidentally shadow it.
  let name = 'a';
  for (const ch of 'abcdefghjklmnoqstuvwxyz') {
    if (ch !== node.loopVar && !taken.has(ch)) { name = ch; break; }
  }
  const updated: PolyRepeatNode = {
    ...node,
    bindings: [...existing, { name, value: asLiteral(0) }],
  };
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: updated } });
}

/** Rename a binding. No-op on duplicates / empty names — caller is expected
 *  to validate before calling. */
export function setPolyRepeatBindingName(graph: Graph, repeatId: NodeId, idx: number, name: string): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'poly_repeat') return graph;
  const bindings = (node.bindings ?? []).slice();
  if (idx < 0 || idx >= bindings.length) return graph;
  bindings[idx] = { ...bindings[idx], name };
  const updated: PolyRepeatNode = { ...node, bindings };
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: updated } });
}

/** Update a binding's value expression. */
export function setPolyRepeatBindingValue(graph: Graph, repeatId: NodeId, idx: number, value: ArgValue): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'poly_repeat') return graph;
  const bindings = (node.bindings ?? []).slice();
  if (idx < 0 || idx >= bindings.length) return graph;
  bindings[idx] = { ...bindings[idx], value };
  const updated: PolyRepeatNode = { ...node, bindings };
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: updated } });
}

/** Remove a binding from a PolyRepeatNode. */
export function removePolyRepeatBinding(graph: Graph, repeatId: NodeId, idx: number): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'poly_repeat') return graph;
  const bindings = (node.bindings ?? []).filter((_, i) => i !== idx);
  const updated: PolyRepeatNode = { ...node, bindings };
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: updated } });
}

/** Remove a vertex at idx. Keeps the polygon at ≥ 1 point — fully empty
 *  triggers the "needs ≥ 3 points" resolve error and the user loses the
 *  node entirely. Use removeNode for delete-the-whole-polygon. */
export function removePolygonPoint(graph: Graph, polygonId: NodeId, idx: number): Graph {
  const node = graph.nodes[polygonId];
  if (!node || node.type !== 'polygon') return graph;
  if (idx < 0 || idx >= node.points.length) return graph;
  if (node.points.length <= 1) return graph;
  const removed = node.points[idx];
  const points = node.points.filter((_, i) => i !== idx);
  const updated: PolygonNode = { ...node, points };
  // When the removed entry was a repeat-ref AND no other entry still
  // references the same source, drop the orphaned PolyRepeatNode + its
  // layout entry. Multiple refs to the same source would be unusual but
  // would be preserved by the "still referenced?" check.
  let nodes = { ...graph.nodes, [polygonId]: updated };
  let layout = graph.layout;
  if (removed?.kind === 'repeat-ref') {
    const srcId = (removed as PolygonRepeatRef).sourceId;
    const stillReferenced = points.some((p) => p.kind === 'repeat-ref' && p.sourceId === srcId);
    if (!stillReferenced && nodes[srcId]) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [srcId]: _drop, ...rest } = nodes;
      nodes = rest;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { [srcId]: _dropL, ...restL } = layout;
      layout = restL;
    }
  }
  return finalize({ ...graph, nodes, layout });
}

/** Move a vertex up (delta = -1) or down (delta = +1) in the list.
 *  Clamps at the ends so ▲ on the first row or ▼ on the last is a no-op. */
export function movePolygonPoint(graph: Graph, polygonId: NodeId, idx: number, delta: number): Graph {
  const node = graph.nodes[polygonId];
  if (!node || node.type !== 'polygon') return graph;
  const j = idx + delta;
  if (idx < 0 || idx >= node.points.length) return graph;
  if (j  < 0 || j  >= node.points.length) return graph;
  const points = [...node.points];
  const tmp = points[idx]; points[idx] = points[j]; points[j] = tmp;
  const updated: PolygonNode = { ...node, points };
  return finalize({ ...graph, nodes: { ...graph.nodes, [polygonId]: updated } });
}

/** Add a rot transform around a child. */
export function addRot(
  graph: Graph,
  child: NodeId,
  rot: [ArgValue, ArgValue, ArgValue] = [asLiteral(0), asLiteral(0), asLiteral(0)],
  parentId?: NodeId,
): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const node: RotNode = { id, type: 'rot', child, rot };
  const xy = defaultCallPosition(graph);
  const next: Graph = { ...withNodes(graph, { [id]: node }), layout: { ...graph.layout, [id]: xy } };
  const final = appendChild(next, parentId ?? graph.root, id);
  return { graph: finalize(final), id };
}

/** Drop an UNWIRED mv node — child is empty string until wired. */
export function addMvPlaceholder(graph: Graph, parentId?: NodeId) {
  return addMv(graph, '', undefined, parentId);
}
/** Drop an UNWIRED rot node — child is empty string until wired. */
export function addRotPlaceholder(graph: Graph, parentId?: NodeId) {
  return addRot(graph, '', undefined, parentId);
}

/** Rebind a transform node's child to point at another node. Generic over the
 *  legacy mv/rot wrappers AND the unified txfmn node. */
export function setTransformChild(graph: Graph, transformId: NodeId, childId: NodeId): Graph {
  const node = graph.nodes[transformId];
  if (!node || (node.type !== 'mv' && node.type !== 'rot' && node.type !== 'txfmn')) return graph;
  const updated = { ...node, child: childId } as MvNode | RotNode | TxfmnNode;
  return finalize({ ...graph, nodes: { ...graph.nodes, [transformId]: updated } });
}

/** Rebind a TXFMN node's child socket. Thin alias over the generic
 *  `setTransformChild` so callers reading as "txfmn-specific" stay clear. */
export function setTxfmnChild(graph: Graph, txfmnId: NodeId, childId: NodeId): Graph {
  return setTransformChild(graph, txfmnId, childId);
}

/** Edit one of a transform's three xyz literal values. */
export function setTransformAxis(graph: Graph, transformId: NodeId, axis: 0 | 1 | 2, value: number): Graph {
  return setTransformAxisValue(graph, transformId, axis, asLiteral(value));
}

/** Replace one of a transform's three xyz slots with any ArgValue —
 *  literal, param-wire, or expression. Used by the editor's drag-to-wire
 *  on mv/rot axes (analogous to setCallArg for Call slots). */
export function setTransformAxisValue(graph: Graph, transformId: NodeId, axis: 0 | 1 | 2, value: ArgValue): Graph {
  const node = graph.nodes[transformId];
  if (!node || (node.type !== 'mv' && node.type !== 'rot')) return graph;
  const field = node.type === 'mv' ? 'offset' : 'rot';
  const current = (node as any)[field] as [ArgValue, ArgValue, ArgValue];
  const updated = [...current] as [ArgValue, ArgValue, ArgValue];
  updated[axis] = value;
  const newNode = { ...node, [field]: updated } as MvNode | RotNode;
  return finalize({ ...graph, nodes: { ...graph.nodes, [transformId]: newNode } });
}

// ─── TXFMN (unified transform) ─────────────────────────────────────────────
// One node carrying BOTH a rotation (`rot`) and a translation (`offset`).
// Replaces the nested mv(rot(...)) wrapper pair; emits to the identical nested
// helper calls (composition-emit `case 'txfmn'`). New code creates TxfmnNode;
// hydrateGraph migrates legacy mv/rot wrappers into it.

/** Add a TXFMN transform wrapping a child. Identity defaults (all-zero rot +
 *  offset) emit the bare child. `child` may be null for an unwired drop. */
export function addTxfmn(
  graph: Graph,
  child: NodeId | null,
  rot: [ArgValue, ArgValue, ArgValue] = [asLiteral(0), asLiteral(0), asLiteral(0)],
  offset: [ArgValue, ArgValue, ArgValue] = [asLiteral(0), asLiteral(0), asLiteral(0)],
  parentId?: NodeId,
): { graph: Graph; id: NodeId } {
  const id = newNodeId();
  const node: TxfmnNode = { id, type: 'txfmn', child, rot, offset };
  const xy = defaultCallPosition(graph);
  const next: Graph = { ...withNodes(graph, { [id]: node }), layout: { ...graph.layout, [id]: xy } };
  const final = appendChild(next, parentId ?? graph.root, id);
  return { graph: finalize(final), id };
}

/** Drop an UNWIRED TXFMN node — child is null until the user wires a shape in. */
export function addTxfmnPlaceholder(graph: Graph, parentId?: NodeId) {
  return addTxfmn(graph, null, undefined, undefined, parentId);
}

/** Replace one axis of a TXFMN node's ROT or MV (offset) triple with any
 *  ArgValue — literal, param-wire, or expression. `section` selects the
 *  triple: 'rot' → the rotation, 'mv' → the translation (`offset` field).
 *  Mirrors setTransformAxisValue but the field is explicit (both live on one
 *  node now). No-op when the node isn't a txfmn. */
export function setTxfmnAxis(
  graph: Graph,
  id: NodeId,
  section: 'rot' | 'mv',
  axis: 0 | 1 | 2,
  value: ArgValue,
): Graph {
  const node = graph.nodes[id];
  if (!node || node.type !== 'txfmn') return graph;
  const field = section === 'rot' ? 'rot' : 'offset';
  const current = node[field] as [ArgValue, ArgValue, ArgValue];
  const updated = [...current] as [ArgValue, ArgValue, ArgValue];
  updated[axis] = value;
  const newNode: TxfmnNode = { ...node, [field]: updated };
  return finalize({ ...graph, nodes: { ...graph.nodes, [id]: newNode } });
}

/** Find the parent container (list/stack/group) whose children include nodeId.
 *  Returns null if none (e.g. root or an orphan). */
export function findParentContainer(graph: Graph, nodeId: NodeId): NodeId | null {
  for (const n of Object.values(graph.nodes)) {
    if ((n.type === 'list' || n.type === 'stack' || n.type === 'group') && n.children.includes(nodeId)) {
      return n.id;
    }
  }
  return null;
}

/** Wrap an existing Call (or any node) in a fresh mv/rot transform that takes
 *  its place in the parent container's children. Used by inline-transform UI:
 *  clicking ⇄ on a Call card wraps the Call in a mv node and the wrapper is
 *  then rendered as part of the Call's visual card. */
export function wrapInTransform(graph: Graph, targetId: NodeId, kind: 'mv' | 'rot'): { graph: Graph; id: NodeId } {
  const parentId = findParentContainer(graph, targetId);
  if (!parentId) return { graph, id: '' };
  const parent = graph.nodes[parentId];
  if (!parent || (parent.type !== 'list' && parent.type !== 'stack' && parent.type !== 'group')) {
    return { graph, id: '' };
  }
  const id = newNodeId();
  const defOffset: [ArgValue, ArgValue, ArgValue] = [asLiteral(0), asLiteral(0), asLiteral(0)];
  const wrapper: GraphNode = kind === 'mv'
    ? { id, type: 'mv',  child: targetId, offset: defOffset }
    : { id, type: 'rot', child: targetId, rot:    defOffset };
  // Replace targetId with id in the parent's children, preserving position.
  const newChildren = parent.children.map((c) => (c === targetId ? id : c));
  const newParent = { ...parent, children: newChildren } as typeof parent;
  return {
    graph: finalize({
      ...graph,
      nodes: { ...graph.nodes, [id]: wrapper, [parentId]: newParent },
      // No layout slot for inline wrappers — they render inside their child.
    }),
    id,
  };
}

/** Inverse of wrapInTransform — drop the wrapper, hoist its child back into
 *  the parent at the wrapper's position. */
export function unwrapTransform(graph: Graph, wrapperId: NodeId): Graph {
  const wrapper = graph.nodes[wrapperId];
  if (!wrapper || (wrapper.type !== 'mv' && wrapper.type !== 'rot')) return graph;
  const childId = (wrapper as MvNode | RotNode).child;
  if (!childId) return removeNode(graph, wrapperId);
  const parentId = findParentContainer(graph, wrapperId);
  if (!parentId) return graph;
  const parent = graph.nodes[parentId];
  if (!parent || (parent.type !== 'list' && parent.type !== 'stack' && parent.type !== 'group')) return graph;
  const newChildren = parent.children.map((c) => (c === wrapperId ? childId : c));
  const { [wrapperId]: _, ...rest } = graph.nodes;
  const { [wrapperId]: __, ...restLayout } = graph.layout;
  return finalize({
    ...graph,
    nodes: { ...rest, [parentId]: { ...parent, children: newChildren } as typeof parent },
    layout: restLayout,
  });
}

/** Look up an inline mv/rot wrapper for a node — used by the editor to detect
 *  "this Call has an inline transform" and render the xyz row inside the Call
 *  card instead of as a standalone canvas node. */
export function inlineTransformOf(graph: Graph, nodeId: NodeId, kind: 'mv' | 'rot'): NodeId | null {
  for (const n of Object.values(graph.nodes)) {
    if (n.type === kind && (n as MvNode | RotNode).child === nodeId) {
      // Inline only if this wrapper has a parent container (i.e. it's in the
      // composition tree, not orphan) — bake/emit pick it up regardless.
      if (findParentContainer(graph, n.id) !== null) return n.id;
    }
  }
  return null;
}

/** Append a child reference to a container. Idempotent. */
function appendChild(graph: Graph, parentId: NodeId, childId: NodeId): Graph {
  const parent = graph.nodes[parentId];
  if (!parent) return graph;
  if (parent.type === 'list' || parent.type === 'stack' || parent.type === 'group') {
    if (parent.children.includes(childId)) return graph;
    const updated: ContainerNode = { ...parent, children: [...parent.children, childId] };
    return { ...graph, nodes: { ...graph.nodes, [parentId]: updated } };
  }
  // Method/mv/rot — single-child slots; we don't append here. Caller responsible.
  return graph;
}

/** Remove a node and any references to it. Cascade-removes orphaned subtrees. */
export function removeNode(graph: Graph, id: NodeId): Graph {
  if (id === graph.root) return graph;     // can't remove the root
  const next: Record<NodeId, GraphNode> = {};
  // Drop the target node entirely.
  for (const [nid, n] of Object.entries(graph.nodes)) {
    if (nid === id) continue;
    // Sever references in container children + method obj/arg + mv/rot child.
    if (n.type === 'list' || n.type === 'stack' || n.type === 'group') {
      next[nid] = { ...n, children: n.children.filter((c) => c !== id) };
    } else if (n.type === 'method') {
      // If we'd orphan the method (obj or arg gone), drop it too.
      if (n.obj === id || n.arg === id) continue;
      next[nid] = n;
    } else if (n.type === 'mv' || n.type === 'rot' || n.type === 'txfmn') {
      if (n.child === id) continue;
      next[nid] = n;
    } else {
      next[nid] = n;
    }
  }
  return finalize({ ...graph, nodes: next });
}

/** Set a Call arg slot to a new value. Untouched slots stay. */
export function setCallArg(graph: Graph, callId: NodeId, key: string, value: ArgValue): Graph {
  const node = graph.nodes[callId];
  if (!node || node.type !== 'call') return graph;
  const updated: CallNode = { ...node, args: { ...node.args, [key]: value } };
  return finalize({ ...graph, nodes: { ...graph.nodes, [callId]: updated } });
}

/** Sugar: wire a Call arg to a meta.params row. */
export function wireArg(graph: Graph, callId: NodeId, key: string, paramName: string): Graph {
  return setCallArg(graph, callId, key, asParam(paramName));
}
/** Sugar: replace a param-ref Call arg with a literal default value. */
export function unwireArg(graph: Graph, callId: NodeId, key: string, fallback: ArgValue): Graph {
  return setCallArg(graph, callId, key, fallback);
}

/** Add a meta.params row. Idempotent on collision. */
export function addParam(graph: Graph, name: string, schema: ParamSchema): Graph {
  if (graph.params[name]) return graph;
  return finalize({ ...graph, params: { ...graph.params, [name]: schema } });
}

// ─── Stack reference (per-part mate control) ────────────────────────────────
//
// A part can OPT IN to a reserved numeric param that controls how it mates
// when it's a child of a stack() node (see manifold-helpers.stack + emit's
// `_stackRef` stamp). Sparse/opt-in — absent means "treated as 0", i.e. the
// historical end-to-end behaviour. When present it behaves like a normal
// numeric param (drivable, has a default) EXCEPT the PARAMS card pins it at
// the top and refuses to delete it.
//   • value 0  → advance the stack cursor by the part's own length (default).
//   • negative → do NOT advance — the part sits at the same datum (overlaps).
//   • positive → advance the cursor by exactly that value.
export const STACK_REF_PARAM = 'stack_ref';

/** True when the graph has opted into the reserved stack-reference param. */
export function hasStackRef(graph: Graph): boolean {
  return Object.prototype.hasOwnProperty.call(graph.params ?? {}, STACK_REF_PARAM);
}

/** Add the reserved stack-reference param (default 0 = neutral end-to-end).
 *  Idempotent — no-op when it already exists. */
export function addStackRef(graph: Graph, def = 0): Graph {
  if (hasStackRef(graph)) return graph;
  return finalize({
    ...graph,
    params: { ...graph.params, [STACK_REF_PARAM]: { default: def, step: 0.05, label: 'stack ref' } },
  });
}

/** Set (or clear) the part-level OUTSIDE viewer COLOUR (outer body faces) —
 *  surfaced by the editor's Properties card and APPLIED to the baked geometry
 *  (the full mesh + the cutaway's non-bore faces). A `#rrggbb`/`#rgb` hex
 *  stores; `null`/empty/invalid CLEARS the field (drops the key → "unset", the
 *  historical red default). Sparse by design. Round-trips via serialiseGraph +
 *  meta.colorOuter. */
export function setPartColorOuter(graph: Graph, hex: string | null | undefined): Graph {
  const isHex = typeof hex === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
  if (!isHex) {
    if (graph.colorOuter === undefined) return graph; // already unset
    const { colorOuter: _drop, ...rest } = graph;
    return rest;
  }
  return { ...graph, colorOuter: (hex as string).trim().toLowerCase() };
}

/** Set (or clear) the part-level INSIDE viewer COLOUR (bore / cut / internal
 *  faces revealed in the cutaway) — surfaced by the editor's Properties card
 *  and APPLIED to the baked cutaway geometry. A `#rrggbb`/`#rgb` hex stores;
 *  `null`/empty/invalid CLEARS the field (drops the key → "unset", the
 *  historical grey default). Sparse by design. Round-trips via serialiseGraph +
 *  meta.colorInner. */
export function setPartColorInner(graph: Graph, hex: string | null | undefined): Graph {
  const isHex = typeof hex === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex.trim());
  if (!isHex) {
    if (graph.colorInner === undefined) return graph; // already unset
    const { colorInner: _drop, ...rest } = graph;
    return rest;
  }
  return { ...graph, colorInner: (hex as string).trim().toLowerCase() };
}

/** Set (or clear) the part-level MATERIAL tag — surfaced by the editor's
 *  Properties card. A non-empty string stores; `null`/empty/`'none'` CLEARS
 *  the field (drops the key → "unset"). Sparse by design. Round-trips via
 *  serialiseGraph + meta.material. */
export function setPartMaterial(graph: Graph, mat: string | null | undefined): Graph {
  const v = typeof mat === 'string' ? mat.trim() : '';
  if (!v || v === 'none') {
    if (graph.material === undefined) return graph; // already unset
    const { material: _drop, ...rest } = graph;
    return rest;
  }
  return { ...graph, material: v };
}

/** Patch ONE output part's appearance override (keyed by node id). Pass a
 *  field as a hex/material string to set it, or `null` to clear that field.
 *  Empty entries are pruned so `partAppearance` stays sparse (and the whole
 *  map drops when no part has any override). The actual 3D viewer tint is the
 *  deferred #86; this stores + round-trips the data. */
export function setPartAppearance(
  graph: Graph, nodeId: NodeId,
  patch: { colorOuter?: string | null; colorInner?: string | null; material?: string | null },
): Graph {
  const isHex = (h: any) => typeof h === 'string' && /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(h.trim());
  const all: Record<NodeId, any> = { ...(graph.partAppearance ?? {}) };
  const cur = { ...(all[nodeId] ?? {}) };
  if ('colorOuter' in patch) { if (isHex(patch.colorOuter)) cur.colorOuter = patch.colorOuter!.trim().toLowerCase(); else delete cur.colorOuter; }
  if ('colorInner' in patch) { if (isHex(patch.colorInner)) cur.colorInner = patch.colorInner!.trim().toLowerCase(); else delete cur.colorInner; }
  if ('material' in patch) {
    const m = typeof patch.material === 'string' ? patch.material.trim() : '';
    if (m && m !== 'none') cur.material = m; else delete cur.material;
  }
  if (Object.keys(cur).length) all[nodeId] = cur; else delete all[nodeId];
  const hasAny = Object.keys(all).length > 0;
  if (!hasAny) {
    if (graph.partAppearance === undefined) return graph;
    const { partAppearance: _drop, ...rest } = graph;
    return finalize(rest);
  }
  return finalize({ ...graph, partAppearance: all });
}

/** Set (or clear) the per-child STACK REFERENCE override on a stack node.
 *  `value` of `null`/`undefined`/non-finite CLEARS the override (the child
 *  reverts to inheriting the part's own `stack_ref`); a finite number stores
 *  the override keyed by the child's NodeId. No-op when the node isn't a
 *  stack or doesn't contain that child. Round-trips via serialiseGraph since
 *  the override lives on the node object. */
export function setStackChildRef(graph: Graph, stackId: NodeId, childId: NodeId, value: number | null): Graph {
  const node = graph.nodes[stackId];
  if (!node || node.type !== 'stack') return graph;
  const container = node as ContainerNode;
  if (!container.children.includes(childId)) return graph;
  const next: Record<NodeId, number> = { ...(container.childRefs ?? {}) };
  if (value == null || !Number.isFinite(Number(value))) {
    if (!(childId in next)) return graph; // already absent — nothing to clear
    delete next[childId];
  } else {
    next[childId] = Number(value);
  }
  const hasAny = Object.keys(next).length > 0;
  const updated: ContainerNode = { ...container, childRefs: hasAny ? next : undefined };
  return finalize({ ...graph, nodes: { ...graph.nodes, [stackId]: updated } });
}

/** Set (or clear) the per-child COUNT on a stack node — how many copies of
 *  that child the stack places, mated end-to-end, without a separate Repeat.
 *  `value` of `null`, or a literal `1` (a single copy = the default), CLEARS
 *  the count (drop the key; drop the whole map when it empties). A literal
 *  number > 1 or a param/expr ArgValue stores the override keyed by child id.
 *  No-op when the node isn't a stack or doesn't contain that child. Round-trips
 *  via serialiseGraph since the count lives on the node object. */
export function setStackChildCount(graph: Graph, stackId: NodeId, childId: NodeId, value: ArgValue | null): Graph {
  const node = graph.nodes[stackId];
  if (!node || node.type !== 'stack') return graph;
  const container = node as ContainerNode;
  if (!container.children.includes(childId)) return graph;
  const next: Record<NodeId, ArgValue> = { ...(container.childCounts ?? {}) };
  // A literal 1 (or a non-positive / non-finite literal) is "single copy" →
  // clear the override. Param/expr values always set (resolved at runtime,
  // guarded to ≥1 in emit). null also clears.
  const isOneLiteral = value != null && value.kind === 'literal' && Number(value.value) <= 1;
  if (value == null || isOneLiteral) {
    if (!(childId in next)) return graph; // already absent — nothing to clear
    delete next[childId];
  } else {
    next[childId] = value;
  }
  const hasAny = Object.keys(next).length > 0;
  const updated: ContainerNode = { ...container, childCounts: hasAny ? next : undefined };
  return finalize({ ...graph, nodes: { ...graph.nodes, [stackId]: updated } });
}

/** Remove a meta.params row. Caller is responsible for resolving the orphan
 *  slots first (use slotsForParam to surface, unwireArg to convert each
 *  back to a literal). Returns the graph unchanged if any slot still
 *  references the param.
 *
 *  REFUSES the reserved stack-reference param — it isn't a normal,
 *  user-deletable row (the PARAMS card hides its trash button too); deletion
 *  surfaces as a single synthetic orphan so the UI shows a clear message. */
export function removeParam(graph: Graph, name: string): { graph: Graph; orphans: Edge[] } {
  if (name === STACK_REF_PARAM) {
    return { graph, orphans: [{ from: `p.${STACK_REF_PARAM}`, to: '(reserved — cannot be deleted)' }] };
  }
  const orphans = slotsForParam(graph, name);
  if (orphans.length > 0) return { graph, orphans };
  const { [name]: _, ...rest } = graph.params;
  return { graph: finalize({ ...graph, params: rest }), orphans: [] };
}

/** Update an existing meta.params schema (min/max/step/etc) without touching
 *  the wires. */
export function setParamSchema(graph: Graph, name: string, schema: ParamSchema): Graph {
  if (!graph.params[name]) return graph;
  return finalize({ ...graph, params: { ...graph.params, [name]: schema } });
}

// ─── topological walk ────────────────────────────────────────────────────

/** Return node ids in topological order (children before their parents).
 *  Used by composition-emit + composition-bake. */
export function topoOrder(graph: Graph): NodeId[] {
  const visited = new Set<NodeId>();
  const order: NodeId[] = [];
  function visit(id: NodeId) {
    if (visited.has(id)) return;
    visited.add(id);
    const node = graph.nodes[id];
    if (!node) return;
    if (node.type === 'list' || node.type === 'stack' || node.type === 'group') {
      for (const c of node.children) visit(c);
    } else if (node.type === 'method') {
      visit(node.obj);
      visit(node.arg);
    } else if (node.type === 'mv' || node.type === 'rot' || node.type === 'txfmn') {
      if (node.child) visit(node.child);
    } else if (node.type === 'repeat') {
      for (const c of node.children ?? []) visit(c);
    } else if (node.type === 'call') {
      // A Call arg can carry a `__POLY__<id>` ref to a producer (polygon /
      // sketch) feeding e.g. a revolve's `profile`. Visit those producers
      // FIRST so their `const` emits before the Call that uses it — otherwise
      // `const A = r_revolve({ profile: _sketch_1 })` lands before
      // `const _sketch_1 = ...` → "Cannot access '_sketch_1' before
      // initialization" (TDZ). Mirrors composition-emit's __POLY__ handling.
      for (const arg of Object.values(node.args ?? {})) {
        const a = arg as any;
        if (a && a.kind === 'expr' && typeof a.expr === 'string') {
          const ms = a.expr.match(/__POLY__(n_[a-z0-9_]+)/gi);
          if (ms) for (const m of ms) visit(m.slice('__POLY__'.length));
        }
      }
    }
    order.push(id);
  }
  visit(graph.root);
  return order;
}
