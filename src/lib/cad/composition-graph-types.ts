/**
 * composition-graph-types.ts — leaf module of the composition-graph trio.
 *
 * Pure type declarations + value-constructor helpers (NodeId / ArgValue /
 * node types / Graph). Imports nothing from its sibling modules
 * (composition-graph-hydrate, composition-graph-mutate); they import from
 * here. Re-exported by the composition-graph.ts barrel.
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
  /** Per-child STACK REFERENCE override (stack nodes only). Keyed by child
   *  NodeId → the value that overrides that child's part-level `stack_ref` for
   *  THIS stack instance. A child absent from this map inherits the part's own
   *  `stack_ref` (the value its emitted geom stamps as `_stackRef`). Sparse +
   *  optional → no migration; emit only re-stamps the children listed here. */
  childRefs?: Record<NodeId, number>;
  /** Per-child COUNT (stack nodes only). Keyed by child NodeId → an ArgValue
   *  (literal OR `p.<param>`) for how many copies of that child the stack
   *  places, mated end-to-end, WITHOUT a separate Repeat node. Absent / 1 =
   *  a single copy (today's behaviour). Sparse + optional → no migration. */
  childCounts?: Record<NodeId, ArgValue>;
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

/** Unified transform node (TXFMN card) — carries BOTH a rotation and a
 *  translation on ONE node so the editor can render a single compact card
 *  instead of two nested mv/rot wrapper strips. Mirrors the field NAMES of
 *  MvNode (`offset`) + RotNode (`rot`) so the edge/emit/value machinery needs
 *  the smallest possible diff.
 *
 *  APPLICATION ORDER (load-bearing, Z-down convention): rotate FIRST, then
 *  translate — `A.rotate(rot).translate(offset)` = `mv(rot(A, rot), offset)`.
 *  So `rot` is the INNER helper call, `mv` is the OUTER one (see
 *  composition-emit `case 'txfmn'`). All-zero rot+offset emits the bare child
 *  (identity passthrough).
 *
 *  MvNode/RotNode are KEPT as resolvable legacy types (mirror PolygonRepeat):
 *  hydrateGraph folds them into TxfmnNode at load time; new code creates only
 *  TxfmnNode. `child` is nullable for an unwired placeholder drop. */
export type TxfmnNode = {
  id: NodeId;
  type: 'txfmn';
  child: NodeId | null;
  rot:    [ArgValue, ArgValue, ArgValue];   // [rx, ry, rz] degrees   — applied FIRST  (inner)
  offset: [ArgValue, ArgValue, ArgValue];   // [x, y, z] translate    — applied SECOND (outer)
};

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
/** A single per-copy transform step (the "graphical modifier"). `vec` axis
 *  values are ArgValues so they can be exprs referencing the loop var `i`,
 *  the resolved count `N`, or per-iteration bindings. */
export type NodeTransform = { kind: 'mv' | 'rot'; vec: [ArgValue, ArgValue, ArgValue] };
/** A Repeat clones its repeated UNIT `count` times. The unit is `children`
 *  combined per-iteration via `place([...])` (compose — each part keeps its own
 *  position); a single child emits bare so legacy parts stay byte-identical.
 *  The optional fields turn it into a parametric pattern (linear/circular
 *  array): `loopVar` (default 'i') + `N` (auto = resolved count) are in scope
 *  for `bindings` (per-iteration named values — the "PARAMS" section, value is
 *  any ArgValue so it can be wired to a graph param) and `modifiers` (per-copy
 *  transform stack, innermost-first). `bodyExpr`, when set, is a RAW per-
 *  iteration body that emits verbatim (the windowed editor's code mode),
 *  overriding the `children`-derived body; `i`/`N`/bindings/part var-names are
 *  in scope. All optional+sparse — absent ⇒ today's identity clone.
 *
 *  `child` is the LEGACY single-slot field (pre-2026-06-17). hydrateGraph folds
 *  it into `children: [child]`; new code writes only `children`. */
export type RepeatNode = {
  id: NodeId; type: 'repeat'; children: NodeId[]; count: ArgValue; op?: RepeatOp;
  child?: NodeId;                 // legacy single child — folded into children[] at hydrate
  loopVar?: string;
  bindings?: PolyRepeatBinding[]; // the "PARAMS" section — per-iteration named values
  modifiers?: NodeTransform[];    // GLOBAL per-copy transforms (wrap the whole place([…]))
  partModifiers?: Record<NodeId, NodeTransform[]>; // PER-PART transforms, keyed by child id
  bodyExpr?: string;              // raw per-iteration body override (verbatim emit)
};

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
/** Local symbol bound on a PolyRepeatNode. Each binding is a name +
 *  value expression (ArgValue). Bindings are evaluated INSIDE the loop
 *  (so they can reference the loop var); their resolved values are in
 *  scope for the r and z expressions. Lets the user pull out repeated
 *  sub-expressions (`amplitude = p.thread_height`) so the loop body
 *  stays readable. */
export type PolyRepeatBinding = { name: string; value: ArgValue };
export type PolyRepeatNode = {
  id: NodeId;
  type: 'poly_repeat';
  count: ArgValue;
  loopVar: string;
  r: ArgValue;
  z: ArgValue;
  /** Optional local bindings — undefined / [] means "no bindings". */
  bindings?: PolyRepeatBinding[];
};

/** Sketch node (plan M.1) — a richer profile producer than `polygon`: an
 *  ordered list of CAD operators (line · spline · fillet · chamfer) that
 *  emit a runtime `sketch([...], segments)` call (compileSketch via Maker.js)
 *  → the same `(r,z)` point list r_revolve/r_extrude consume. Wired to a
 *  consumer's profile arg through the SAME `__POLY__<id>` sentinel as a
 *  polygon. Every op field is an ArgValue so radius/dist/coords can be
 *  param/expr-driven. */
export type SketchOpEntry =
  /** `mode:'rel'` makes (r,z) a delta from the previous vertex (Δr,Δz); 'abs'
   *  (default, forced on the first op) is an absolute coordinate. */
  | { op: 'line'; r: ArgValue; z: ArgValue; mode?: 'abs' | 'rel' }
  /** Smooth curve to (r,z). `pts` are chord-relative through-points `(u,v)`,
   *  `h0`/`h1` chord-relative end-tangent handles — every component an ArgValue
   *  so coords/bulge/handles are param- or expr-wireable. See sketch.ts for the
   *  chord-affine frame. */
  | { op: 'spline'; r: ArgValue; z: ArgValue;
      pts?: Array<[ArgValue, ArgValue]>;
      h0?: [ArgValue, ArgValue];
      h1?: [ArgValue, ArgValue];
      mode?: 'abs' | 'rel' }
  | { op: 'fillet'; radius: ArgValue }
  | { op: 'chamfer'; dist: ArgValue };
export type SketchNode = {
  id: NodeId;
  type: 'sketch';
  ops: SketchOpEntry[];
  /** Sampling density of curved sections; defaults to a literal 64. */
  segments?: ArgValue;
  /** Whole-sketch scale in the r (x) and z (y) directions. Absent / undefined
   *  ⇒ 1 (no scale), so pre-scale parts hydrate + bake byte-identically. Both
   *  are ArgValue so the scale can be param/expr-driven. Applied as a final
   *  multiply on the compiled (r,z) points (see `compileSketch`). */
  scaleX?: ArgValue;
  scaleY?: ArgValue;
};

export type GraphNode = CallNode | ContainerNode | MethodNode | MvNode | RotNode | TxfmnNode | RepeatNode | PolygonNode | PolyRepeatNode | SketchNode;

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
export type LayoutXY = { x: number; y: number; w?: number; h?: number; cols?: 1 | 2 | 3 };

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
  /** Part-level appearance — surfaced by the editor's Properties card.
   *  All SPARSE/optional: absent means "unset" (the viewer falls back to its
   *  default colour-by-source / red-outer-grey-inner convention). They
   *  round-trip through emit (`meta.colorOuter` / `meta.colorInner` /
   *  `meta.material` + the serialised graph block) and `hydrateGraph`, AND
   *  apply to the baked geometry (outside ← outer body, inside ← bore/cut).
   *  A legacy single `color` migrates to `colorOuter` on hydrate. */
  colorOuter?: string;
  colorInner?: string;
  material?: string;
  /** PER-PART appearance overrides, keyed by output-part node id (the Output
   *  list's Call children, shown as A/B/C…). Sparse: a part absent here uses
   *  the part-level colour above. Round-trips via `meta.partAppearance` +
   *  hydrate. Like the part-level colours, these are stored + round-tripped
   *  now; the actual per-part 3D VIEWER tint is the deferred #86 (GeomAcc
   *  segment refactor). Per-part z-offset is NOT here — it uses the Stack's
   *  existing per-child ref (`setStackChildRef`). */
  partAppearance?: Record<NodeId, PartAppearance>;
  /** CALCULATED expressions (B.6 / id 914). SPARSE + optional → absent/empty
   *  ⇒ the emitted source is byte-identical to today (no migration). When
   *  non-empty, composition-emit prepends the topo-ordered `const e_<name> =
   *  …;` block ahead of the body; references to `e.<name>` in any ArgValue
   *  `expr` resolve to those consts. See src/lib/cad/graph-exprs.ts. */
  exprs?: GraphExpr[];
};

/** One part's appearance overrides (all sparse/optional). */
export type PartAppearance = { colorOuter?: string; colorInner?: string; material?: string };

/** One CALCULATED expression (B.6 / id 914 — the expression builder).
 *  `name` is the `e.<name>` output identifier (must be a unique, ident-safe
 *  symbol); `src` is the expression source in the constrained mathjs grammar
 *  (arithmetic + allowlisted CAD math, no assignments / no arbitrary JS).
 *  An `e.*` is DERIVED from `p.*` params and other `e.*` exprs and lives in a
 *  separate namespace from `p.*` so the positional bake signature never shifts.
 *  See docs/plans/expression-builder.md §3 + src/lib/cad/graph-exprs.ts. */
export type GraphExpr = {
  name: string;
  src: string;
};
