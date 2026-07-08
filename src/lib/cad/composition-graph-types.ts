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
   *  param surfaces every slot referencing it as "orphaned".
   *
   *  `field` (#38 complex params) — OPTIONAL dotted access into a RECORD
   *  param: `{param:'spec', field:'od'}` emits `p.spec.od`. Sparse/optional →
   *  absent ⇒ the whole param (`p.<name>`), byte-identical to every existing
   *  param slot. */
  | { kind: 'param'; param: string; field?: string };

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
/** A reference to an expression INSTANCE's `list<point>` OUTPUT, whose emitted
 *  array of `[r,z]` pairs is spliced into the polygon's point list at this row
 *  (#11 expression-as-builder). Mirrors `PolygonRepeatRef`, but the source is
 *  an `ExprNode` instance + one of its DEF outputs (typed `shape:'list',
 *  elem:'point'`) instead of a `PolyRepeatNode`. Wired via the polygon's
 *  per-row input socket, paired with the expr's typed output socket. Lets ONE
 *  map-expression generate the whole spiral profile (the canonical Case 1). */
export type PolygonExprListRef = {
  kind: 'expr-list-ref';
  sourceId: NodeId;   // → the ExprNode instance whose output supplies the points
  output: string;     // the def OUTPUT name (shape:'list', elem:'point')
};
export type PolygonEntry = PolygonPoint | PolygonRepeat | PolygonRepeatRef | PolygonExprListRef;
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

/** Sketch REPEAT node (B.2 / id 805) — the `poly_repeat` analog for the 2D
 *  sketch surface. Holds a PROTOTYPE run of sketch ops that tiles `count`
 *  times when the sketch is compiled. Like `poly_repeat` it is a SEPARATE
 *  free-floating card (never appended to any list, referenced only by a
 *  `SketchRepeatRef` entry in a parent sketch's `ops`), so it never shows as
 *  an Output. The expansion happens UPSTREAM of `compileSketch` (at both the
 *  emit + client-preview sites via `expandSketchOps`), so `compileSketch` /
 *  `sketch.ts` stay untouched and rel-mode prototype ops tile seamlessly
 *  across iteration boundaries (the running cursor walks the flat op list).
 *
 *  The per-iteration ADVANCE `(dr,dz)` is the stride between copies: when set,
 *  expansion prepends one leading `{op:'line', mode:'rel', r:dr, z:dz}` per
 *  iteration (the land/gap vertex for racks/combs). `dr=dz=0` ⇒ pure
 *  self-tiling (threads — the prototype's own rel ops sum to the pitch). `i`
 *  (loopVar) + `NPts` (= resolved count) + bindings are in scope for prototype
 *  op exprs (the tapering escape hatch). */
export type SketchRepeatNode = {
  id: NodeId;
  type: 'sketch_repeat';
  count: ArgValue;                 // iterations (literal/param/expr); clamped ≥0 at eval
  loopVar: string;                 // default 'i'; in scope for prototype op exprs
  /** Per-iteration advance of the iteration origin (stride between copies).
   *  0/absent ⇒ pure self-tiling; non-zero ⇒ a leading rel move per copy. */
  dr?: ArgValue;
  dz?: ArgValue;
  /** Reuse poly_repeat's binding type verbatim — per-iteration named values
   *  evaluated inside the loop, in scope for the prototype op exprs. */
  bindings?: PolyRepeatBinding[];
  /** The prototype run to repeat — same op vocabulary as a sketch, but NO
   *  nested repeat-refs (forbidden in v1). */
  ops: SketchOpEntry[];
};

/** One flat entry in a parent sketch's `ops` list pointing at a separate
 *  `SketchRepeatNode` whose expanded prototype is spliced in at this row
 *  (mirrors `PolygonRepeatRef`). The `op` discriminant keeps it distinct from
 *  the point/corner ops in every `if (op.op === 'line' | …)` switch. */
export type SketchRepeatRef = { op: 'repeat-ref'; sourceId: NodeId };

/** A reference to an expression INSTANCE's `list<point>` OUTPUT whose emitted
 *  array of `[r,z]` pairs is spliced into the parent sketch's `ops` at this row
 *  as a run of `line` ops (#11 expression-as-builder, sketch edition). The
 *  sketch sibling of `PolygonExprListRef`: the source is an `ExprNode` instance
 *  + one of its DEF outputs (typed `shape:'list', elem:'point'`). The `op`
 *  discriminant keeps it distinct from the point/corner/repeat-ref ops in every
 *  `if (op.op === …)` switch. Lets ONE map-expression generate the whole sketch
 *  profile (e.g. a parametric spiral), visualised live on the 2D stage AND
 *  baked parametrically (recomputed at bake, never statically expanded). */
export type SketchExprListRef = { op: 'expr-list-ref'; sourceId: NodeId; output: string };

export type SketchNode = {
  id: NodeId;
  type: 'sketch';
  /** Ordered ops — point/corner ops and/or repeat-refs / expr-list-refs. A
   *  repeat-ref splices its source SketchRepeatNode's expanded prototype in at
   *  its position; an expr-list-ref splices an expression instance's
   *  `list<point>` output as `line` ops. Pre-#805 files have only SketchOpEntry
   *  rows and round-trip unchanged. */
  ops: Array<SketchOpEntry | SketchRepeatRef | SketchExprListRef>;
  /** Sampling density of curved sections; defaults to a literal 64. */
  segments?: ArgValue;
  /** Whole-sketch scale in the r (x) and z (y) directions. Absent / undefined
   *  ⇒ 1 (no scale), so pre-scale parts hydrate + bake byte-identically. Both
   *  are ArgValue so the scale can be param/expr-driven. Applied as a final
   *  multiply on the compiled (r,z) points (see `compileSketch`). */
  scaleX?: ArgValue;
  scaleY?: ArgValue;
};

// ─── Expression DEFINITIONS + instances (B.7 / id 914, v3) ──────────────────
//
// v3 splits the v2 self-contained Expr block into a reusable per-part
// DEFINITION (`ExprDef`, on `graph.exprDefs[]`) + thin INSTANCE nodes
// (`ExprNode{defId,bindings}`). Editing a def updates every instance at once;
// instances differ only by their per-PARAM input wiring. A def declares ALL of
// its own names across FOUR sections — it never references the host graph's
// `p.*`/`e.*`. See docs/plans/expression-builder.md §v3.

/** PARAMS section — a declared INPUT. Each param becomes an input socket on
 *  every instance, wired per instance (else falls back to `default`, else 0). */
export type ExprParam = { name: string; default?: number };
/** CONSTS section — a fixed local value, the same for every instance (no
 *  socket). */
export type ExprConst = { name: string; value: number };
/** VARIABLES section — an internal intermediate, evaluated in topo order. Its
 *  formula references earlier-declared names + the function/constant allowlist;
 *  no socket. */
export type ExprVar = { name: string; formula: string };
/** The SHAPE an OUTPUT socket carries (#11 expression-as-builder). Absent /
 *  `'scalar'` = a single number (today's behaviour — byte-identical emit).
 *  `'list'` = a FLAT array materialised by a `map(range(N), f(i)=…)` formula
 *  (one element-shape per socket; no nested data trees — the research's
 *  flat-list-only decision). `'object'` is reserved (structured arg).
 *  `'auto'` (typed-expression-outputs, Phase A) = INFER the shape structurally
 *  from the formula (struct-type.inferStructure): a literal `[[x,y,z],…]` types
 *  as a list, a bare arithmetic expression as a scalar. It is the popup's
 *  default for a freshly-added output; the popup resolves it to a concrete
 *  `'list'`/scalar on commit so persisted files never carry `'auto'` (hydrate
 *  keeps only `'list'`/`'object'`). Emit is `'auto'`-tolerant defensively. */
export type ExprOutShape = 'scalar' | 'object' | 'list' | 'auto';
/** For `shape:'list'`, the ELEMENT shape — the kind of thing each list slot
 *  holds. `'point'` = `[r,z]` pairs (wired into a polygon points slot / a
 *  profile arg). `'op'`/`'transform'`/`'scalar'`/`'object'` are reserved for
 *  the sketch-ops / repeat-transform / scalar-list / record-list consumers.
 *  Wiring rules reject a mismatched element shape (a point-list into a
 *  transform slot, etc.). */
export type ExprOutElem = 'point' | 'op' | 'transform' | 'scalar' | 'object';
/** OUTPUTS section — an exposed result. Each output becomes an output socket on
 *  every instance; its formula references earlier-declared names + the allowlist.
 *  `shape`/`elem` are SPARSE + optional: absent ⇒ scalar ⇒ byte-identical emit
 *  (no migration). A `list` output's formula is compiled to a JS array
 *  expression (composition-emit.emitExprBlocks → graph-exprs.compileListFormula). */
export type ExprOut = {
  name: string;
  formula: string;
  shape?: ExprOutShape;
  elem?: ExprOutElem;   // only meaningful when shape === 'list'
};

/** A reusable per-part expression DEFINITION (B.7 v3). One flat name scope:
 *  `params ∪ consts ∪ vars ∪ outputs` names must be unique. A `vars`/`outputs`
 *  formula may reference any name declared EARLIER in the eval order
 *  (params → consts → vars(topo) → outputs(topo)) + the allow-listed
 *  functions/constants; any other free symbol is a validation error (sockets
 *  come ONLY from `params`/`outputs`). Lives on `graph.exprDefs[]`,
 *  serialised in `meta.graph`. */
export type ExprDef = {
  id: NodeId;            // stable; instances reference it via `defId`
  name: string;         // shown in the Σ menu + on the instance card
  params:  ExprParam[]; // declared INPUTS → input sockets (wired per instance)
  consts:  ExprConst[]; // fixed local values, same for every instance
  vars:    ExprVar[];   // internal intermediates (topo order)
  outputs: ExprOut[];   // exposed results → output sockets
};

/** Expr INSTANCE node (B.7 v3) — a thin reference to an `ExprDef`. NOT a
 *  geometry producer: it contributes numeric `const` bindings to the emit
 *  prelude (params → consts → vars → outputs, namespaced per-instance by
 *  `exprBlockVar(node.id)`) rather than a Manifold expression. Instances differ
 *  ONLY by their per-PARAM input wiring (`bindings`). */
export type ExprNode = {
  id: NodeId;
  type: 'expr';
  /** → ExprDef.id. The def supplies the params/consts/vars/outputs. */
  defId: NodeId;
  /** Input WIRES, keyed by the def's PARAM NAME → the wired source value (a
   *  `p.*` param, a literal, or an `expr` referencing another block's emitted
   *  output const). A param absent here falls back to its `default`, else 0.
   *  SPARSE/optional → absent ⇒ every param emits with its default / 0. */
  bindings?: Record<string, ArgValue>;
};

/** Spline PATH producer (TODO #15) — a free-floating node that holds a set of
 *  3D CONTROL POINTS edited interactively in the three.js SplineEditorPopup, and
 *  OUTPUTS the centripetal-Catmull-Rom curve through them sampled to `samples`
 *  equally-spaced (arc-length) `[x,y,z]` points (a `list<point3>`). Its output
 *  socket wires into a Call's `path` arg (r_sweep) the same way an Expr block's
 *  `list<point>` output wires into a consumer.
 *
 *  Like an ExprNode it is NEVER a root-list child — it contributes a PRELUDE
 *  const (`emitSplineBlocks` → `const _x_<id>_path = resampleSpline([...], N)`),
 *  not a geometry value. The bake recomputes the points with the PURE-JS
 *  `resampleSpline` (no three.js in the Manifold sandbox); the editor uses
 *  three.js only for the GUI. `samples` is an ArgValue so it can later be
 *  param/expr-wired. */
export type SplineNode = {
  id: NodeId;
  type: 'spline';
  /** Control points `[x,y,z]` — dragged in the popover. ≥ 2 for a curve. */
  points: [number, number, number][];
  /** WIRED control-points source (TODO #26). When present it OVERRIDES the
   *  manual `points` array: the spline resamples the wired producer's
   *  `list<point2|3>` output instead of the literal points. Encoded like every
   *  other wired arg — `{kind:'expr', expr:'_x_<srcId>_<out>'}` (exprBlockMember)
   *  for an expr instance's output. The spline STILL smooths + arc-length-
   *  resamples the wired points (its value-add over a plain expr→sweep). SPARSE +
   *  optional → absent ⇒ manual points ⇒ byte-identical emit. Unwiring
   *  (setSplinePointsExpr(…, null)) deletes the field and restores the manual
   *  array. Per-point manual-edit-over-expression OVERRIDE tracking (#26) is
   *  deferred — for now wired ⇒ expr points, unwired ⇒ manual points. */
  pointsExpr?: ArgValue;
  /** N output points (equally arc-length spaced). Default ~32. */
  samples: ArgValue;
  /** CLOSED loop — the curve wraps last→first, so the resampled path forms a
   *  ring with no reflected endpoints. The PATH PRODUCER owns loop-ness: a
   *  sweep whose `path` arg is wired to this spline AUTO-FOLLOWS it (emit forces
   *  `closedPath: closed, caps: !closed`). SPARSE + optional → absent ⇒ false ⇒
   *  an OPEN curve, byte-identical to today. */
  closed?: boolean;
  /** PLOT-in-the-main-3D-bake diagnostic overlay (VIEW-ONLY, TODO #24). When
   *  true the editor draws this spline's resolved curve + control points as a
   *  coloured overlay INSIDE the main bake scene (so several splines — e.g. an
   *  r_sweep path + section — can be seen RELATIVE to each other + the swept
   *  mesh, not just each in its own popup). Never touches emit / bake / the GLB.
   *  SPARSE + optional → absent/false ⇒ no overlay, zero overhead. */
  plot?: boolean;
  /** Optional explicit overlay colour (`#rrggbb`) for the plot. Absent ⇒ the
   *  editor auto-assigns a distinct colour per plotted spline (path vs section
   *  read apart). VIEW-ONLY, like `plot`. */
  plotColor?: string;
};

/** Warp / bend MODIFIER node (#36, plan docs/plans/warp-part-along-spline.md
 *  items 1 & 5) — takes a BUILT solid (`child`) and BENDS it along a spline
 *  `path`, emitting `warpSpline(<child>, <path>, opts)` (the sandbox-injected
 *  `warpManifoldAlongSpline`). Distinct from the warp_along_spline / r_sweep
 *  PRIMITIVES, which GENERATE a swept surface from a cross-section; this DEFORMS
 *  an already-composed solid by displacing its vertices (`Manifold.warp`).
 *
 *  MODE is AUTO-selected inside `warpManifoldAlongSpline` by the path's arity —
 *  a planar (x,z) path stays on the world-Y frame, a genuinely 3D path routes
 *  through the rotation-minimizing frame (RMF); the node does not carry a mode.
 *  The tunable opts are `refine` (build-time subdivision so flat walls bend as
 *  arcs, not chords — self-limited on already-dense meshes), `stretch` (elongate
 *  the part to span the whole spline vs keep its own length), and `validate`
 *  (opt-in genus/volume sanity WARN on an inverted / self-intersecting bend).
 *
 *  `child` is nullable for an unwired placeholder drop (mirrors TxfmnNode).
 *  `path` is an ArgValue — normally an `expr` referencing a wired SplineNode's
 *  output const (`_x_<splineId>_path`, exprBlockMember(id,'path')), exactly like
 *  an r_sweep `path` arg — but it can also be a literal/expr point array.
 *  `refine` is an ArgValue so it can be param/expr-driven; `stretch`/`validate`
 *  are sparse booleans (absent ⇒ false ⇒ the minimal `warpSpline(child, path)`
 *  emit). */
export type WarpNode = {
  id: NodeId;
  type: 'warp';
  /** Legacy SINGLE child (one solid bent along `path`). Retained for byte-identical
   *  emit of existing parts; new multi-input warps use `children[]`. When both are
   *  present, `children` wins. */
  child: NodeId | null;
  /** MULTI-INPUT (#36b): warp EACH wired solid SEPARATELY along the same `path`,
   *  emitting `[warpSpline(a,path), warpSpline(b,path), …]` — a LIST producer so the
   *  parent Stack / root spreads the warped parts as SEPARATE bodies (they never
   *  compose, so a part inside a transparent open-hole stays independent — same
   *  separate-parts rule as autoPlace/finalizeManifold). Absent / ≤1 entry ⇒ the
   *  single `warpSpline(child,path)` emit (byte-identical). */
  children?: NodeId[];
  path: ArgValue;
  refine?: ArgValue;
  stretch?: boolean;
  validate?: boolean;
  /** Absolute depth-origin for the z→arc-length map (#36c b): the child's local z is
   *  measured from `z − originZ` so a part placed down-hole at depth `originZ` (via
   *  mv) bends at its TRUE arc-length station on the spline. This lets several parts
   *  share ONE spline at different depths. Sparse — ABSENT ⇒ the legacy part-relative
   *  map (`s = z − boundingBox.min.z`), byte-identical emit. */
  originZ?: ArgValue;
};

/** CUTAWAY / cross-section MODIFIER node — subtracts an AUTHORED angular wedge
 *  from a built solid (`child`), emitting `sectionCut(child, { az, offset })`.
 *  Unlike the view-only bake-time cutaway (a render toggle), this is a real
 *  geometry op baked into the part: it removes a pie-wedge of `az` degrees of
 *  the revolution around the part's Z axis (Z-down), positioned at `offset`
 *  along Z. `az` = HOW MUCH to cut (0 = no cut, 180 = half-section, 360 = full
 *  removal); `offset` = the axial position of the cut.
 *
 *  Structural sibling of WarpNode: appended to the root (a geometry OUTPUT), its
 *  `child` (the solid being sectioned) wires in on the LEFT edge, and both `az`
 *  and `offset` are ArgValues (literal/param/expr) so they can be param/expr-
 *  driven exactly like the warp card's `refine`. `child` is nullable for an
 *  unwired placeholder drop (mirrors WarpNode / TxfmnNode). */
export type CutawayNode = {
  id: NodeId;
  type: 'cutaway';
  child: NodeId | null;
  az: ArgValue;
  offset: ArgValue;
};

/** MATERIAL node (G-MAT-CARD) — a FLOATING, view-only node holding a reusable
 *  appearance bundle (same fields as PartAppearance) plus a user `name`. It is
 *  NOT part of the render tree and emits NO body: like a param source it lives
 *  in `graph.nodes` purely so the editor can render + wire it. A wire from a
 *  material node to a Call node's material socket records
 *  `graph.materialBindings[callId] = matId`; that part's EFFECTIVE appearance
 *  then resolves to this bundle (see resolveEffectiveAppearance in
 *  composition-graph-mutate). Round-trips for free — serialiseGraph writes
 *  graph.nodes wholesale, and every `node.type` switch simply has no case for
 *  it (silently skipped by validation / emit-body / uses walks). */
export type MaterialNode = {
  id: NodeId;
  type: 'material';
  name?: string;
  colorOuter?: string;
  colorInner?: string;
  /** Phong preset — 'steel'|'aluminum'|'titanium'|'brass'|'none'. */
  material?: string;
  /** Render opacity 0–1 (<1 = see-through). */
  opacity?: number;
  /** Procedural texture map name — 'rock'|'cement'|'steel'|…. */
  texture?: string;
};

/** PARTS-MAP producer node (#38 Phase 3) — the geometry-valued sibling of the
 *  `list<point>` expression builder. Maps a `list<record>` param to N part
 *  INSTANCES via ONE node: `Array.from(p.<list>, (s, i) => <src>({…}))`, replacing
 *  a hand-wired wall of Call cards (the 18-string well → 1 producer).
 *
 *  - `src` — the volume part id to instantiate per row (`g_casing`); also added
 *    to `meta.uses` so the loader fetches it as a dependency.
 *  - `list` — the ROWS to iterate; normally `{kind:'param', param:'strings'}` (a
 *    `list<record>` param), but any ArgValue resolving to an array works.
 *  - `loopVar` (default `'s'`) — the per-row binding; the index is always `i`
 *    (like Repeat). Record-field access in `argMap` reads `s.<field>` via an
 *    `expr` ArgValue (`{kind:'expr', expr:'s.od'}`).
 *  - `argMap` — part-arg NAME → how to fill it from the row `s` / index `i`. Each
 *    value is an ArgValue: an `expr` for a field (`s.od`), or a literal/param.
 *  - `op` (default `'list'`) — `'list'` returns the bare array (spread by a parent
 *    Stack / returned from the root list for the loader to autoPlace); `'stack'`
 *    mates the copies end-to-end; `'place'` composes without mating.
 *
 *  Marked a LIST PRODUCER (op:'list') in computeListProducers so a parent Stack
 *  spreads its N results with `...`, exactly like a Repeat with op:'list'. */
export type PartsMapNode = {
  id: NodeId;
  type: 'parts_map';
  src: string;
  list: ArgValue;
  loopVar?: string;
  argMap: Record<string, ArgValue>;
  op?: 'list' | 'stack' | 'place';
};

export type GraphNode = CallNode | ContainerNode | MethodNode | MvNode | RotNode | TxfmnNode | RepeatNode | PolygonNode | PolyRepeatNode | SketchNode | SketchRepeatNode | ExprNode | SplineNode | WarpNode | CutawayNode | MaterialNode | PartsMapNode;

// ─── graph ────────────────────────────────────────────────────────────────

// ─── params — a discriminated union on an OPTIONAL `kind` (#38) ──────────────
//
// A param row carries one of THREE shapes: a scalar (today's number param), a
// RECORD (an object keyed by a volume `types/<id>.json` TypeDef's fields), or a
// LIST (of records or scalars — the rows that drive a data-driven producer).
// The discriminant `kind` is OPTIONAL on the number variant so EVERY existing
// file — which has NO `kind` field — reads back as a NumberParam, byte-identical
// (serialize + hydrate stay structural: `stringifyTyped` already emits nested
// object/array defaults, hydrate round-trips them). `hasKind(p)` is the single
// narrowing point (`p.kind ?? 'number'`). Editor + producer node are Phases 2/3.
// Plan: docs/plans/complex-params-list-of-parts.md §1.

/** A scalar param — today's ParamSchema, verbatim. `kind` absent on every
 *  legacy file ⇒ treated as 'number' (no migration write). */
export type NumberParam = {
  kind?: 'number';
  default: number | string | boolean;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  label?: string;
};
/** A RECORD param — an object whose fields come from a volume `types/<id>.json`
 *  TypeDef (`typeId`). Field access into it emits `p.<name>.<field>` via the
 *  ArgValue `field?`. */
export type RecordParam = {
  kind: 'record';
  typeId: string;                                       // → a <volume>/types/<id>.json TypeDef
  default: Record<string, number | string | boolean>;   // { od: 9.625, wall: 0.5, … }
  label?: string;
};
/** A LIST param — the rows that drive a data-driven `list<part>` producer. `of`
 *  names the element type: a record (`{record:'Casing'}` → list<Casing>) or the
 *  degenerate scalar list (`{scalar:true}` → list<number>). */
export type ListParam = {
  kind: 'list';
  of: { record: string } | { scalar: true };
  default: Array<Record<string, number | string | boolean> | number>;
  label?: string;
};

export type ParamSchema = NumberParam | RecordParam | ListParam;

/** The single narrowing point — the EFFECTIVE kind of a param (absent ⇒
 *  'number'). Every reader that branches on the union goes through here so a
 *  legacy `{default:5}` (no `kind`) reads as a number param. */
export function hasKind(p: ParamSchema): 'number' | 'record' | 'list' {
  return (p as { kind?: 'number' | 'record' | 'list' }).kind ?? 'number';
}
/** Narrowing type-guards over the ParamSchema union — all routed through
 *  `hasKind` so absent-kind ⇒ number. */
export function isNumberParam(p: ParamSchema): p is NumberParam { return hasKind(p) === 'number'; }
export function isRecordParam(p: ParamSchema): p is RecordParam { return hasKind(p) === 'record'; }
export function isListParam(p: ParamSchema): p is ListParam { return hasKind(p) === 'list'; }

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
  /** Part-level render OPACITY (0–1) — surfaced by the Properties card + the
   *  scene x-ray slider. <1 renders the part semi-transparent (well-schematic
   *  essential: see the inner strings through casing). SPARSE/optional: absent
   *  (or 1) ⇒ fully opaque, byte-identical to today. Round-trips through emit
   *  (`meta.opacity` + the serialised graph block) and `hydrateGraph`. VIEW-ONLY
   *  (a material property) — never touches geometry/bake. */
  opacity?: number;
  /** PER-PART named material TEXTURE (G-MAT2) — a procedural map applied to the
   *  render (`cement` = hatched aggregate, `steel` = brushed metal, `rock` =
   *  open-hole face). SPARSE/optional: absent ⇒ no map, byte-identical to today.
   *  VIEW-ONLY (a material property) — never touches geometry/bake. Round-trips
   *  through emit (`meta.texture` + the serialised graph block) and
   *  `hydrateGraph`, exactly like `opacity`. The name is resolved to a shared
   *  `THREE.Texture` by `$lib/shared/material-textures.getMaterialTexture`;
   *  unknown names resolve to `undefined` (no map). PER-SUBPART texture in a
   *  composed assembly is NOT supported (one vertex-coloured mesh has no
   *  per-subpart UVs) — this is a PER-PART property. */
  texture?: string;
  /** PER-PART editor VIEW scale (VIEW-ONLY exaggeration — never geometry/bake).
   *  `viewZScale` = Z/length exaggeration, `viewXScale` = X/diameter ("xDia")
   *  exaggeration; they mirror `scene.zScale` / `scene.xScale`. SPARSE/optional:
   *  present only when the user set a MANUAL scale (i.e. `scene.scaleAuto` was
   *  off at save time) — absent means "no saved scale", so the editor
   *  auto-normalizes on open as before. Captured scene→graph at save and
   *  restored ONLY when the part is the editor's PRIMARY open part (a nested
   *  subpart defers to the parent/viewer scale — its saved value is never read).
   *  Round-trips via serialiseGraph/hydrateGraph + a top-level meta mirror. */
  viewZScale?: number;
  viewXScale?: number;
  /** PER-PART appearance overrides, keyed by output-part node id (the Output
   *  list's Call children, shown as A/B/C…). Sparse: a part absent here uses
   *  the part-level colour above. Round-trips via `meta.partAppearance` +
   *  hydrate. Like the part-level colours, these are stored + round-tripped
   *  now; the actual per-part 3D VIEWER tint is the deferred #86 (GeomAcc
   *  segment refactor). Per-part z-offset is NOT here — it uses the Stack's
   *  existing per-child ref (`setStackChildRef`). */
  partAppearance?: Record<NodeId, PartAppearance>;
  /** MATERIAL wire bindings — output-part Call node id → MaterialNode id. A Call
   *  whose id is a key here resolves its appearance from the referenced
   *  MaterialNode (winning over `partAppearance[callId]` + the part-level
   *  default). One material node may be bound to many parts (reusable). SPARSE +
   *  optional → absent ⇒ nothing wired, byte-identical emit. Round-trips via
   *  serialiseGraph + hydrateGraph exactly like `partAppearance`. See
   *  resolveEffectiveAppearance (composition-graph-mutate). */
  materialBindings?: Record<NodeId, NodeId>;
  /** CALCULATED expressions (B.6 / id 914). SPARSE + optional → absent/empty
   *  ⇒ the emitted source is byte-identical to today (no migration). When
   *  non-empty, composition-emit prepends the topo-ordered `const e_<name> =
   *  …;` block ahead of the body; references to `e.<name>` in any ArgValue
   *  `expr` resolve to those consts. See src/lib/cad/graph-exprs.ts. */
  exprs?: GraphExpr[];
  /** Expression DEFINITIONS (B.7 / id 914, v3) — reusable per-part calc defs,
   *  instanced by `ExprNode{defId}` nodes. SPARSE + optional → absent/empty ⇒
   *  byte-identical emit (no instances ⇒ no prelude). Editing a def updates
   *  every instance. Round-trips via serialiseGraph/hydrateGraph. See
   *  docs/plans/expression-builder.md §v3 + src/lib/cad/graph-exprs.ts. */
  exprDefs?: ExprDef[];
};

/** One part's appearance overrides (all sparse/optional). `opacity` (0–1) is
 *  reserved for the per-SUBPART alpha path (stretch C); the part-level
 *  `Graph.opacity` above is what stage A/B render today. */
export type PartAppearance = { colorOuter?: string; colorInner?: string; material?: string; opacity?: number; texture?: string };

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
