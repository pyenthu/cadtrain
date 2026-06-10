/**
 * composition-graph.ts — graph as the source of truth for assemblies.
 *
 * Per docs/plans/composition-architecture.md (signed off 2026-06-06).
 *
 * The composition graph replaces composition-tree.ts (which round-tripped
 * through source text on every edit). This file is pure data + pure
 * functions: every mutation returns a new graph (immutable shape so the
 * editor can use Svelte 5 $state with shallow reactivity).
 *
 * Companion: composition-emit.ts (graph → meta + body). The reverse
 * direction (parse body → graph) does NOT exist by design — edits go to
 * the graph, the body is regenerated.
 *
 * Companion: composition-bake.ts (graph → Manifold) — Phase B; not yet.
 */

// ─── identity ─────────────────────────────────────────────────────────────

export type NodeId = string;   // 'n_abc123' — random 6-char base36 suffix

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function rand6(): string {
  let out = '';
  for (let i = 0; i < 6; i++) out += ID_ALPHABET[Math.floor(Math.random() * ID_ALPHABET.length)];
  return out;
}
/** Generate a fresh NodeId. Random; not collision-checked against the graph
 *  because the 36^6 ≈ 2.2 G space makes collisions astronomically unlikely
 *  for the assembly sizes we care about. The graph-level addNode() helpers
 *  retry on the rare clash. */
export function newNodeId(): NodeId { return 'n_' + rand6(); }

// ─── value types ──────────────────────────────────────────────────────────

/** Unified value for every Call arg + every mv/rot offset slot. The parent
 *  decides whether the slot is keyed (Call.args[name]) or positional
 *  (mv.offset[i]); the value type is the same. */
export type ArgValue =
  | { kind: 'literal'; value: number | string | boolean }
  /** Arbitrary expression evaluated at bake time (Math.PI, p.od/2 - p.wall).
   *  The string is JS that runs in the bake interpreter's scope (assembly
   *  params bound as `p.<name>`, sibling calls bound as their aliases). */
  | { kind: 'expr'; expr: string }
  /** Typed edge — wires from a meta.params row to this slot. Bake time
   *  resolves to the param's current value (or its default). Removing the
   *  param surfaces every slot referencing it as "orphaned". */
  | { kind: 'param'; param: string };

export function asLiteral(v: number | string | boolean): ArgValue { return { kind: 'literal', value: v }; }
export function asExpr(expr: string): ArgValue { return { kind: 'expr', expr }; }
export function asParam(param: string): ArgValue { return { kind: 'param', param }; }

// ─── nodes ────────────────────────────────────────────────────────────────

export type CsgOp = 'subtract' | 'add' | 'intersect';

export type CallNode = {
  id: NodeId;
  type: 'call';
  src: string;            // volume primitive id ('dt_mule_shoe', 'r_revolve', …)
  alias: string;          // user-facing label (A, B, …) — assigned at create-time
  /** Args keyed by the imported function's param names. Missing keys fall
   *  through to the import's defaults at bake time. */
  args: Record<string, ArgValue>;
};

export type ContainerNode = {
  id: NodeId;
  type: 'list' | 'stack' | 'group';
  children: NodeId[];     // ordered references; node objects live in graph.nodes
};

export type MethodNode = {
  id: NodeId;
  type: 'method';
  op: CsgOp;
  obj: NodeId;            // base shape
  arg: NodeId;            // operand
};

export type MvNode  = { id: NodeId; type: 'mv';  child: NodeId; offset: [ArgValue, ArgValue, ArgValue] };
export type RotNode = { id: NodeId; type: 'rot'; child: NodeId; rot:    [ArgValue, ArgValue, ArgValue] };

/** Repeat — instantiate the child N times. The `op` decides how the N
 *  copies are combined:
 *    'stack' (default) — end-to-end mate via manifold-helpers.stack().
 *      Emit: stack(Array.from({length: <count>}, () => <child>))
 *    'list'  — bare array of N instances; the caller decides what to do.
 *      Emit: Array.from({length: <count>}, () => <child>)
 *    'place' — combined without mating (overlapping at origin).
 *      Emit: place(Array.from({length: <count>}, () => <child>))
 *  count is an ArgValue (literal, param, or expression). child is a single
 *  NodeId (any node type can be the repeating unit). */
export type RepeatOp = 'stack' | 'list' | 'place';
export type RepeatNode = { id: NodeId; type: 'repeat'; child: NodeId; count: ArgValue; op?: RepeatOp };

/** 2D polygon — the SOLE producer node for profile graphs (replaces the
 *  pen_mv/pen_line/lineR/lineZ chain). A compact ordered list of vertices
 *  where each (r, z) coordinate is an ArgValue → literal / expr / wired
 *  to a PARAMS slider via the same ƒ-popup as Call args. Reordering, add,
 *  delete operate directly on `points` and round-trip into the emit.
 *
 *  Why a typed node and not a Call with src='polygon': the points array
 *  is dynamic-length so encoding as named args (p0r, p0z, p1r, …) gets
 *  ugly; a first-class node also gives the editor a clean place to
 *  render the inline reorderable list. */
/** A literal vertex — one (r, z) pair. The historical shape, before #154
 *  introduced repeat blocks. Legacy files have entries with NO `kind`
 *  field; the hydrate path defaults missing kinds to 'point'. New writes
 *  always include the kind tag so the union is discriminable. */
export type PolygonPoint = { kind: 'point'; r: ArgValue; z: ArgValue };
/** DEPRECATED — inline repeat block. Kept as a TYPE only so the hydrate
 *  path can recognise + migrate legacy entries to the new shape
 *  (PolyRepeatNode + PolygonRepeatRef). New code MUST NOT emit this; it
 *  exists for one-way migration of files saved during Phase B (#154). */
export type PolygonRepeat = {
  kind: 'repeat';
  count: ArgValue;
  loopVar: string;
  r: ArgValue;
  z: ArgValue;
};
/** A reference to a SEPARATE PolyRepeatNode whose output is spliced into
 *  the polygon's point list at this entry's position (#157). Multiple
 *  refs can interleave with literal vertices in any order — each ref
 *  contributes its source node's N points at the row where it sits.
 *  Wired via the polygon's per-row repeat-ref input socket on the left
 *  edge of the card, paired with the PolyRepeatNode's output socket. */
export type PolygonRepeatRef = {
  kind: 'repeat-ref';
  sourceId: NodeId;
};
export type PolygonEntry = PolygonPoint | PolygonRepeat | PolygonRepeatRef;
export type PolygonNode = {
  id: NodeId;
  type: 'polygon';
  /** Ordered list of entries — vertices and/or repeat-refs. Both
   *  contribute points to the final polygon when emitted/evaluated. Name
   *  kept as `points` for back-compat with the pre-#154 shape; legacy
   *  files round-trip unchanged. */
  points: PolygonEntry[];
};

/** Polygon-repeat node — generates N points by iterating a loop var
 *  (default `i`, runs 0..count-1) over r and z ArgValue expressions.
 *  Output wires into one or more polygon `repeat-ref` entries.
 *
 *  Rendered as a 2-section card: PARAMS (count + loop var) and LOOP
 *  (r(i) + z(i) expression inputs). Sits on the canvas next to the
 *  polygon it feeds, with a dedicated wire showing the spread. */
export type PolyRepeatNode = {
  id: NodeId;
  type: 'poly_repeat';
  count: ArgValue;
  loopVar: string;
  r: ArgValue;
  z: ArgValue;
};

export type GraphNode = CallNode | ContainerNode | MethodNode | MvNode | RotNode | RepeatNode | PolygonNode | PolyRepeatNode;

// ─── graph ────────────────────────────────────────────────────────────────

export type ParamSchema = {
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
};

export type Edge = {
  from: string;   // 'p.<paramName>' (param wired into a slot)
  to:   string;   // '<nodeId>.args.<key>' | '<nodeId>.offset.<i>' | '<nodeId>.rot.<i>'
};

/** Per-node canvas placement. `w` is OPTIONAL — when set, the editor honours
 *  it as a user-pinned width override (drag the right-edge grip). When
 *  absent, the editor's auto-fit width (cardAutoWidth) applies. Width is
 *  layout-affecting (changes wire routing + auto-layout columns), so it
 *  round-trips through save → reload. */
/** Per-node canvas placement. `w` is the user-pinned width override
 *  (drag the corner grip's horizontal axis). `h` is the user-pinned
 *  height override — read by the polygon node's `nodeSize` so the
 *  user can grow the scrollable vertex list. Other node types don't
 *  consult `h` (their height auto-fits content); the field persists
 *  harmlessly. */
export type LayoutXY = { x: number; y: number; w?: number; h?: number };

/** Canvas viewport — the pan offset + zoom level the editor was at when
 *  this graph was last saved. Persists alongside layout so the user lands
 *  back on the same view region (not just node positions) on reload. */
export type Viewport = { pan: LayoutXY; zoom: number };

export type Graph = {
  nodes: Record<NodeId, GraphNode>;
  root: NodeId;
  /** Assembly-level meta.params. Same shape as the editor expects today. */
  params: Record<string, ParamSchema>;
  /** Denormalised — kept in sync with every ArgValue of kind 'param'.
   *  Always rebuildable via collectEdges(graph) for sanity checks. */
  edges: Edge[];
  /** Import declarations — which primitives are available to drop in. The
   *  imports are derived from the set of distinct Call.src values, but kept
   *  explicit here so the user can "import without instantiating" if they
   *  want a primitive in the picker without dropping a call yet. */
  imports: string[];
  /** Per-node visual canvas position (px). Set by the editor's drag-to-move
   *  affordance; ignored by composition-bake. Allows the visual editor to
   *  restore positions across opens. */
  layout: Record<NodeId, LayoutXY>;
  /** Canvas-level state — captured at save time, restored at hydrate time. */
  viewport?: Viewport;
};

export function newGraph(): Graph {
  const rootId = newNodeId();
  const rootNode: ContainerNode = { id: rootId, type: 'list', children: [] };
  // Default root layout — sits to the RIGHT of where new Calls land
  // (defaultCallPosition starts at x=80), so the visible ▶ Output card
  // is downstream of the workflow. Pure presentational; the user can
  // drag it anywhere afterward.
  return {
    nodes: { [rootId]: rootNode },
    root: rootId,
    params: {},
    edges: [],
    imports: [],
    layout: { [rootId]: { x: 600, y: 80 } },
    viewport: { pan: { x: 0, y: 0 }, zoom: 1 },
  };
}

/** Update the canvas viewport (pan + zoom). Called from the editor at save
 *  time so the next hydrate restores the same view region. */
export function setViewport(graph: Graph, pan: LayoutXY, zoom: number): Graph {
  return { ...graph, viewport: { pan: { ...pan }, zoom } };
}

/** Hydrate a serialised meta.graph block back into a runnable Graph.
 *
 *  serialiseGraph(g) drops `edges` (rebuildable from args) and `layout`
 *  (a visual concern, not part of the contract). This inverse rebuilds
 *  both — edges via collectEdges, layout via a default rough-grid pass
 *  so a loaded assembly has its nodes visible immediately even though
 *  the user never positioned them on this client.
 *
 *  Tolerant of partial data (returns newGraph() on missing/invalid
 *  nodes/root) so legacy or hand-edited sources fall through gracefully
 *  to the empty-canvas state. */
export function hydrateGraph(serialised: any): Graph {
  if (!serialised || typeof serialised !== 'object' || !serialised.nodes || !serialised.root) {
    return newGraph();
  }
  // Use the SAVED layout when present (any value, even partial — the loop
  // below fills only the holes). Older files saved before composition-emit
  // started preserving layout will have it undefined; those nodes still
  // get the default-grid auto-layout, so legacy files open cleanly.
  const savedLayout =
    (serialised.layout && typeof serialised.layout === 'object') ? { ...serialised.layout } : {};
  // Hydrate viewport too. Default falls back to (0, 0, zoom=1) — same as
  // newGraph() — so files saved before viewport landed open at the origin
  // view, preserving the prior behavior.
  const savedViewport: Viewport =
    (serialised.viewport && typeof serialised.viewport === 'object' &&
     serialised.viewport.pan && typeof serialised.viewport.zoom === 'number')
      ? { pan: { x: Number(serialised.viewport.pan.x) || 0, y: Number(serialised.viewport.pan.y) || 0 },
          zoom: Number(serialised.viewport.zoom) || 1 }
      : { pan: { x: 0, y: 0 }, zoom: 1 };
  // Migrate legacy inline {kind:'repeat'} polygon entries (Phase B / #154)
  // into the new separate-card model (#157): create a PolyRepeatNode per
  // inline repeat + replace the entry with a {kind:'repeat-ref', sourceId}.
  // Round-tripping a pre-#157 file no longer loses the loop data.
  const migratedNodes: Record<string, GraphNode> = { ...(serialised.nodes ?? {}) };
  const migratedLayout: Record<string, LayoutXY> = { ...savedLayout };
  for (const id of Object.keys(migratedNodes)) {
    const n = migratedNodes[id];
    if (!n || (n as any).type !== 'polygon') continue;
    const poly = n as PolygonNode;
    const newEntries: PolygonEntry[] = [];
    let migratedAny = false;
    for (const entry of (poly.points as any[])) {
      if (entry?.kind === 'repeat') {
        // Allocate a new PolyRepeatNode; preserve count/loopVar/r/z.
        const repeatId = newNodeId();
        const repeatNode: PolyRepeatNode = {
          id: repeatId,
          type: 'poly_repeat',
          count: entry.count,
          loopVar: String(entry.loopVar || 'i'),
          r: entry.r,
          z: entry.z,
        };
        migratedNodes[repeatId] = repeatNode;
        // Layout — sits to the right of the polygon if its position is
        // known, otherwise gets a default slot. The pass below filling
        // missing positions will also catch the edge cases.
        const polyXY = migratedLayout[id];
        if (polyXY) migratedLayout[repeatId] = { x: polyXY.x + 280, y: polyXY.y + 40 };
        newEntries.push({ kind: 'repeat-ref', sourceId: repeatId });
        migratedAny = true;
      } else if (entry?.kind === 'point') {
        newEntries.push(entry);
      } else if (entry?.kind === 'repeat-ref') {
        newEntries.push(entry);
      } else {
        // Untagged legacy point (pre-#154 entries with no kind).
        newEntries.push({ kind: 'point', r: entry.r, z: entry.z });
      }
    }
    if (migratedAny) {
      migratedNodes[id] = { ...poly, points: newEntries };
    }
  }

  let g: Graph = {
    nodes: migratedNodes,
    root: serialised.root,
    params: serialised.params ?? {},
    edges: [],
    imports: serialised.imports ?? [],
    layout: migratedLayout,
    viewport: savedViewport,
  };
  // Fill missing positions only — preserves any saved entry, populates the
  // rest via the same rough-grid heuristic used at create-time. Inline
  // mv/rot wrappers don't render on the main canvas (they surface inside
  // their child Call), so they don't need a layout slot.
  for (const id of Object.keys(g.nodes)) {
    if (g.layout[id]) continue; // already saved — keep it
    const n = g.nodes[id];
    if (id === g.root) {
      // Root list — visible as the ▶ Output card. Default to the right side
      // so it's downstream of new Calls (matches newGraph()).
      g = setLayout(g, id, { x: 600, y: 80 });
      continue;
    }
    if (n.type === 'list') continue;
    if ((n.type === 'mv' || n.type === 'rot') && n.child) {
      const child = g.nodes[n.child];
      if (child?.type === 'call') continue; // inline wrapper, no own card
    }
    g = setLayout(g, id, defaultCallPosition(g));
  }
  g = { ...g, edges: collectEdges(g) };
  return g;
}

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
    n.type === 'poly_repeat',
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
    } else if (node.type === 'repeat') {
      // The repeat's count slot can be wired to a param (e.g. p.n on `stand`).
      if (node.count.kind === 'param') {
        edges.push({ from: `p.${node.count.param}`, to: `${node.id}.count` });
      }
    } else if (node.type === 'polygon') {
      // Each vertex's r + z can be wired to a param — same edge shape as
      // mv.offset, indexed by point index and axis.
      node.points.forEach((p, i) => {
        if (p.r.kind === 'param') edges.push({ from: `p.${p.r.param}`, to: `${node.id}.points.${i}.r` });
        if (p.z.kind === 'param') edges.push({ from: `p.${p.z.param}`, to: `${node.id}.points.${i}.z` });
      });
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

/** Internal: finalize a mutation by recomputing the edge index + de-duped
 *  imports list. Pure. */
function finalize(graph: Graph): Graph {
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
  const node: RepeatNode = { id, type: 'repeat', child, count };
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

/** Rebind a Repeat node's child socket to point at another node. */
export function setRepeatChild(graph: Graph, repeatId: NodeId, childId: NodeId): Graph {
  const node = graph.nodes[repeatId];
  if (!node || node.type !== 'repeat') return graph;
  const updated: RepeatNode = { ...node, child: childId };
  return finalize({ ...graph, nodes: { ...graph.nodes, [repeatId]: updated } });
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

/** Rebind a transform node's child to point at another node. */
export function setTransformChild(graph: Graph, transformId: NodeId, childId: NodeId): Graph {
  const node = graph.nodes[transformId];
  if (!node || (node.type !== 'mv' && node.type !== 'rot')) return graph;
  const updated = { ...node, child: childId } as MvNode | RotNode;
  return finalize({ ...graph, nodes: { ...graph.nodes, [transformId]: updated } });
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
    } else if (n.type === 'mv' || n.type === 'rot') {
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

/** Remove a meta.params row. Caller is responsible for resolving the orphan
 *  slots first (use slotsForParam to surface, unwireArg to convert each
 *  back to a literal). Returns the graph unchanged if any slot still
 *  references the param. */
export function removeParam(graph: Graph, name: string): { graph: Graph; orphans: Edge[] } {
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
    } else if (node.type === 'mv' || node.type === 'rot' || node.type === 'repeat') {
      visit(node.child);
    }
    order.push(id);
  }
  visit(graph.root);
  return order;
}
