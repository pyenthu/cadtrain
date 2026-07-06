# Plan — Hierarchical / Class-Based Redesign of the Composition Graph

> **Status:** DRAFT / proposal (2026-07-06). No code changed. This is a design
> study + phased migration map, to be reconciled into `/plan` (Rule 19) if
> adopted. It is deliberately *conservative*: the recommendation is a **hybrid**
> (behaviour in classes, persisted graph stays plain data), NOT a wholesale OOP
> rewrite. Read alongside `docs/plans/modularize-round2.md` (the mechanical
> file-splitting effort already in flight) and `docs/plans/graph-editor-pane.md`
> (the GEP phase ledger). This plan is the *architectural* layer those two are
> groping toward without naming.

---

## 1. Motivation

Two files carry almost all of the domain's growth pain:

| File | LOC | Shape |
|---|---|---|
| `src/lib/shared/graph-editor/GraphEditorPane.svelte` | **4,380** | one giant component, 128 top-level functions, ~85 `$state` |
| `src/lib/cad/composition-graph-mutate.ts` | **2,252** | ~180 free functions `(graph, …) => Graph` |
| `src/lib/cad/composition-emit.ts` | 1,177 | 6+ `switch(node.type)` dispatch sites |
| `src/lib/shared/graph-editor/NodeCard.svelte` | 2,453 | one component, `{#if node.type === …}` per variant |

The core domain model (`composition-graph-types.ts`) is a **15-variant
discriminated union** `GraphNode` (`CallNode | ContainerNode | MethodNode |
MvNode | RotNode | TxfmnNode | RepeatNode | PolygonNode | PolyRepeatNode |
SketchNode | SketchRepeatNode | ExprNode | SplineNode | WarpNode |
MaterialNode`). Every behaviour that varies by node type is written as a
hand-rolled `switch (node.type)` or a family-prefixed batch of free functions.
Adding one node type today means editing, by hand, **at least eight sites**:

1. the union in `composition-graph-types.ts`
2. `validateGraph` — `switch` at `composition-emit.ts:118`
3. `emitNodeExpr` — `switch` at `composition-emit.ts:534`
4. `computeConsumedSet` (childrenOf/uses walk) — `if/else` chain at `composition-emit.ts:1009`
5. `nodeSize` layout dispatch — `composition-layout.ts:87`
6. `hydrateGraph` migrations — `composition-graph-hydrate.ts`
7. a batch of `add*/set*/remove*` mutators in `composition-graph-mutate.ts`
   (Repeat alone has ~30: `addRepeat`, `setRepeatCount`, `addRepeatModifier`,
   `setPartModifierAxis`, …)
8. a `{#if node.type === …}` arm plus its sockets/CSS in `NodeCard.svelte`

That is the *polymorphism-by-hand* a class hierarchy exists to collapse. The
symptom is real: `RepeatNode`, `SketchNode`, and `ExprDef` each carry ~25–30
mutator functions that are conceptually **methods on that node** but live in a
flat 2,252-line namespace with no cohesion boundary.

**Non-goals.** This is not a plea to make the persisted graph object-oriented.
The graph is serialised verbatim as a JSON literal into `meta.graph` on every
`.asm.ts` file on the volume (see `composition-emit.ts` header). That
serialisation simplicity is a feature, not debt — see §7.

---

## 2. Current-state map (what actually exists)

### 2.1 The data layer (functional, and fine as data)

- **`composition-graph-types.ts`** — pure types + tiny value constructors
  (`asLiteral`/`asExpr`/`asParam`, `newNodeId`). `ArgValue` is the unified
  slot value (`literal | expr | param`) used by *every* wireable field. `Graph`
  is `{ nodes: Record<NodeId, GraphNode>, root, params, edges, imports, layout,
  … }` plus a long tail of sparse view-only fields (`colorOuter`, `opacity`,
  `partAppearance`, `materialBindings`, `exprDefs`, `exprs`, `viewport`).
- **`composition-graph-hydrate.ts`** — `hydrateGraph(serialised)` +
  `newGraph()`. Owns **one-way legacy migrations** (inline `{kind:'repeat'}`
  polygon entries → `PolyRepeatNode`; absolute spline `ctrl` → chord-relative
  `pts`; legacy `Repeat.child` → `children[]`; `MvNode`/`RotNode` → `TxfmnNode`).
  This is real, load-bearing serialization logic.
- **`composition-graph-mutate.ts`** — the ~180 pure `(graph, …) => Graph`
  editor operations, grouped by node family by naming convention only.

### 2.2 The behaviour layer (dispatched by hand)

Every one of these is a `switch (node.type)` / `if (node.type === …)` that a
polymorphic `node.emit()` / `node.childRefs()` / `node.validate()` would absorb:

| Behaviour | Site | Dispatch |
|---|---|---|
| Validation | `validateGraph`, `composition-emit.ts:118` | `switch` over 8 cases |
| Emit expression | `emitNodeExpr`, `composition-emit.ts:534` | `switch` over ~11 cases |
| Consumed-set / input walk | `computeConsumedSet`, `composition-emit.ts:1009` | `if/else` chain |
| Output-kind label | `composition-emit.ts:1079` | `?:` ladder |
| Layout size | `nodeSize`, `composition-layout.ts:87` | `if` chain |
| Hydrate/migrate | `composition-graph-hydrate.ts` | per-type `if` blocks |
| Card render + sockets | `NodeCard.svelte` | `{#if}` arms |

### 2.3 The editor already grew classes (the key precedent)

The GEP modularization has *already* discovered the class pattern for reactive
state — there are **seven** `export class` singletons-per-pane today:

```
CanvasInteractionState  canvas-interaction.svelte.ts
DeleteConfirm           delete-confirm.svelte.ts
PolyPreviewState        poly-preview-state.svelte.ts
SplineState             spline-state.svelte.ts
ProfilePreviewState     profile-preview-state.svelte.ts
SketchState             sketch-state.svelte.ts
WireState               wire-state.svelte.ts
```

`modularize-round2.md` §0 lesson 5 states the rule explicitly: *"Per-instance
reactive state = class, not module singleton"* — because `/primitives` mounts
every tab pane at once and a module-level `$state` singleton leaks across panes.
**This plan formalises that direction** rather than inventing it. The
controller layer in §5 is the missing top of that hierarchy.

---

## 3. Recommendation in one line

> **Hybrid.** Keep the persisted `Graph` a plain-data discriminated union.
> Introduce a **behaviour registry keyed by `node.type`** (a "node kind
> descriptor" object per variant) that owns `emit / validate / inputs / size /
> migrate`, collapsing the seven hand-written switches into one dispatch table.
> Separately, decompose `GraphEditorPane` into a `GraphEditorController` +
> command objects + the existing state classes. Do **not** hydrate the graph
> into class instances on the hot path.

The two halves are independent and independently shippable. §4 is the model
half; §5 is the editor half.

---

## 4. Proposed model layer — a Node-Kind registry (the "class hierarchy", done right)

A literal `abstract class GraphNode` with 15 subclasses would force the graph to
(de)serialise through a factory on every load/save/bake/worker-postMessage — the
graph crosses the Web Worker boundary (`bake-worker.ts`) as structured-clone
JSON, and lives on disk as a JSON literal. Class instances don't survive
`structuredClone` with methods intact. So the "hierarchy" is best expressed as a
**registry of stateless descriptors**, one per `node.type`, each implementing a
common interface. This *is* a class hierarchy in the Gang-of-Four sense (Strategy
+ Registry) — it just keeps the *data* separate from the *behaviour*.

### 4.1 The descriptor interface (the abstract base)

```ts
// src/lib/cad/nodes/node-kind.ts  (NEW)
import type { Graph, GraphNode, NodeId, ArgValue } from '../composition-graph-types';

/** Emit context threaded through every node's emitExpr — replaces the closure
 *  vars (`ref`, `varNames`, `listProducers`, `nodes`) currently captured inside
 *  emitNodeExpr. */
export interface EmitCtx {
  ref(id: NodeId, slot: string): string;          // var name or missingRef sentinel
  emitValue(v: ArgValue): string;                 // ArgValue → JS expr
  varNames: ReadonlyMap<NodeId, string>;
  listProducers: ReadonlySet<NodeId>;
  nodes: Readonly<Record<NodeId, GraphNode>>;
}

export interface ValidationError { nodeId: NodeId; slot: string; badRef: string;
  kind: 'missing-node' | 'missing-param'; }

/** One entry per node.type. Stateless — the node DATA is the first arg.
 *  This is the "abstract base class": every variant implements it. */
export interface NodeKind<N extends GraphNode = GraphNode> {
  readonly type: N['type'];

  /** N copies of the hand-written switch arms, now co-located per kind. */
  emitExpr(node: N, ctx: EmitCtx): string | null;      // was emitNodeExpr case
  validate(node: N, graph: Graph): ValidationError[];  // was validateGraph case
  /** NodeIds this node consumes as inputs (drives computeConsumedSet + the
   *  Output-root filter + delete-button greying). */
  inputRefs(node: N): NodeId[];
  /** Canvas footprint for auto-layout (was composition-layout.nodeSize). */
  size(node: N): [w: number, h: number] | null;
  /** Optional one-way hydrate migration for legacy files of this kind. */
  migrate?(raw: any): N | null;
  /** The editor-facing socket schema (input slots + output arity) — lets
   *  NodeCard.svelte render generically instead of a {#if} arm. */
  sockets(node: N): SocketSchema;
}
```

### 4.2 Three-to-four representative implementations

```ts
// src/lib/cad/nodes/kinds/method.ts
export const MethodKind: NodeKind<MethodNode> = {
  type: 'method',
  emitExpr: (n, c) => `${c.ref(n.obj, 'obj')}.${n.op}(${c.ref(n.arg, 'arg')})`,
  validate: (n, g) => [
    ...(g.nodes[n.obj] ? [] : [err(n.id, 'obj', n.obj, 'missing-node')]),
    ...(g.nodes[n.arg] ? [] : [err(n.id, 'arg', n.arg, 'missing-node')]),
  ],
  inputRefs: (n) => [n.obj, n.arg].filter(Boolean),
  size: () => null,                       // auto-fit
  sockets: () => ({ inputs: ['obj', 'arg'], output: true }),
};

// src/lib/cad/nodes/kinds/txfmn.ts   (identity-elision preserved verbatim)
export const TxfmnKind: NodeKind<TxfmnNode> = {
  type: 'txfmn',
  emitExpr: (n, c) => {
    const child = c.ref(n.child ?? '', 'child');
    let e = child;
    if (!n.rot.every(isLiteralZero))    e = `rot(${e}, [${n.rot.map(c.emitValue).join(', ')}])`;
    if (!n.offset.every(isLiteralZero)) e = `mv(${e}, [${n.offset.map(c.emitValue).join(', ')}])`;
    return e;
  },
  validate: (n, g) => [
    ...(n.child && g.nodes[n.child] ? [] : [err(n.id, 'child', String(n.child ?? ''), 'missing-node')]),
    ...checkArgs(n.id, 'rot', n.rot, g), ...checkArgs(n.id, 'offset', n.offset, g),
  ],
  inputRefs: (n) => n.child ? [n.child] : [],
  size: () => null,
  sockets: () => ({ inputs: ['child'], output: true }),
};

// src/lib/cad/nodes/kinds/material.ts   (view-only, emits nothing — the current
//   "silently skipped by every switch" node becomes explicit + discoverable)
export const MaterialKind: NodeKind<MaterialNode> = {
  type: 'material',
  emitExpr: () => null,                   // never in the render tree
  validate: () => [],
  inputRefs: () => [],
  size: () => [200, 120],
  sockets: () => ({ inputs: [], output: 'material' }),
};

// RepeatKind is the fat one — its emitExpr keeps the foldMods/partModifiers
// logic from composition-emit.ts:624-680 verbatim; its ~30 mutators (§5.3)
// move onto a companion RepeatOps object.
```

### 4.3 The registry + the collapsed switches

```ts
// src/lib/cad/nodes/registry.ts
const KINDS: Record<GraphNode['type'], NodeKind> = Object.fromEntries(
  [CallKind, ContainerKind /*list|stack|group*/, MethodKind, TxfmnKind,
   RepeatKind, PolygonKind, PolyRepeatKind, SketchKind, SketchRepeatKind,
   ExprKind, SplineKind, WarpKind, MaterialKind, /* Mv/RotKind: legacy hydrate-only */]
    .flatMap(k => (Array.isArray(k.type) ? k.type : [k.type]).map(t => [t, k]))
) as any;

export const kindOf = (n: GraphNode): NodeKind => KINDS[n.type];
```

Then the seven switches become one-liners that delegate:

```ts
// composition-emit.ts — emitNodeExpr shrinks to:
function emitNodeExpr(node, varNames, listProducers, nodes) {
  return kindOf(node).emitExpr(node, makeEmitCtx(node, varNames, listProducers, nodes));
}
// validateGraph — the whole 100-line switch becomes:
for (const node of Object.values(graph.nodes)) errs.push(...kindOf(node).validate(node, graph));
// computeConsumedSet:
for (const n of Object.values(graph.nodes)) for (const id of kindOf(n).inputRefs(n)) consumed.add(id);
// composition-layout.nodeSize → kindOf(n).size(n)
```

**`ArgValue` / params / edges do not change.** They stay plain data; a slot is
still `{ kind: 'literal' | 'expr' | 'param' }`. `checkArg`/`emitValueExpr`
become shared helpers the descriptors call. `Graph.edges` stays the denormalised
`collectEdges` cache — descriptors expose `inputRefs` (node→node) but the
param-edge denormalisation is a graph-level concern, not per-node.

### 4.4 Serialization + Svelte reactivity: why NOT class instances

- **Serialization.** `serialiseGraph`/`hydrateGraph` keep writing/reading plain
  JSON. `hydrateGraph`'s migrations move onto `kind.migrate?()` but still return
  **plain objects**. No factory-on-load; `meta.graph` round-trips byte-identical;
  the bake worker still `structuredClone`s the graph across the thread boundary
  with zero method loss because there are no methods on the data.
- **Svelte reactivity.** Svelte 5 `$state` deep-proxies plain objects/arrays
  transparently; the editor does `graph = setCallArg(graph, …)` immutably today
  and the proxy tracks it. If nodes were class instances, `$state` still proxies
  them, but (a) immutable spread `{ ...node, count }` silently drops the
  prototype → the instance degrades to a plain object mid-edit, and (b) the
  hydrate/clone boundary needs a factory. Keeping nodes plain sidesteps both.
  **Behaviour classes (descriptors) are stateless singletons** — never reactive,
  never cloned, safe to import anywhere including the worker.

---

## 5. Proposed editor layer — decompose GraphEditorPane

`GraphEditorPane.svelte` is the god-component: it owns the graph `$state`, undo
history, all pointer/drag/wire interaction, the node/CSG picker, bake
orchestration, part save/load, keymap, and ~1,300 lines of CSS. The existing
state classes (§2.3) are the leaves; this adds the trunk.

### 5.1 `GraphEditorController` (owns graph state + command history)

```ts
// src/lib/shared/graph-editor/controller.svelte.ts  (NEW — per-pane class)
export class GraphEditorController {
  graph = $state<Graph>(newGraph());
  #undo: GraphCommand[] = [];
  #redo: GraphCommand[] = [];

  // The existing leaf-state classes become owned members (composition):
  readonly wire = new WireState();
  readonly canvas = new CanvasInteractionState();
  readonly sketch = new SketchState();
  readonly spline = new SplineState();
  readonly deleteConfirm = new DeleteConfirm();

  /** Every mutation goes through a command → free undo/redo, and the
   *  ~180 mutate free-functions become the command bodies (see §5.3). */
  apply(cmd: GraphCommand) {
    const next = cmd.run(this.graph);
    if (next === this.graph) return;
    this.#undo.push(cmd); this.#redo.length = 0;
    this.graph = finalize(next);          // reuse composition-graph-mutate.finalize
  }
  undo() { const c = this.#undo.pop(); if (c) this.graph = finalize(c.invert(this.graph)); }
}
```

### 5.2 The Command pattern (undo/redo — a real gap today)

GEP has no first-class undo/redo; every handler reassigns `graph = someMutator(graph, …)`.
Wrapping the *existing* mutators as commands is nearly free and immediately buys
undo:

```ts
export interface GraphCommand { run(g: Graph): Graph; invert(g: Graph): Graph; label: string; }

// A thin adapter that turns any existing mutate fn into a command:
export const cmd = (label: string, fwd: (g: Graph) => Graph): GraphCommand => {
  let before: Graph;
  return { label,
    run: (g) => { before = g; return fwd(g); },
    invert: () => before };          // snapshot-based inverse (graphs are small + immutable)
};
// usage in a handler:  ctrl.apply(cmd('set count', g => setRepeatCount(g, id, v)));
```

Snapshot-inverse is honest here because the graph is small and every mutator is
already pure + immutable — no need to hand-write inverse deltas.

### 5.3 Sub-controllers + mapping the 7 extraction candidates

The controller composes focused services. This is where the 2,252-line mutate
file gets its cohesion boundary: **the family-prefixed mutators become methods on
per-family "ops" objects** that the sub-controllers call.

| Extraction candidate (round-2 plan) | New home | Absorbs |
|---|---|---|
| **node-palette** | `NodePalette` (exists: `node-palette.ts`) — promote to class | `openPicker`/`dropCall`/`dropCsg`/`dropMv`/… (GEP ~1494–1756), `addCall/addMethodPlaceholder/addMvPlaceholder/…` |
| **canvas-interaction** | `CanvasInteractionState` (exists) + `SelectionModel` (new) | `onNodePointerDown/Move/Up`, `onResize*`, `bringToFront`, `dragShift`, `nodePos` (GEP ~1173–1300) |
| **wiring** | `WireState` (exists) + `WiringController` | `outSock/inSock/slotIn` (GEP ~1465), `wireArg/unwireArg/setMethodInput/setWarpChild/…` |
| **expr-actions** | `ExprController` | `addExprDefAndEdit/commitExpr/dropExprInstance/deleteExprDef` (GEP ~332–367) + the ~30 `*ExprDef*` mutators |
| **bake-orchestration** | `BakeController` (partly exists: `graph-editor-bake.svelte.ts`) | `runBake/loadCutaway/rebuildCache/setAutoBake/toggleNodeGhost` (GEP ~498–940) |
| **part-actions** | `PartController` | load/save/`generateMdWithAi`, part-level appearance mutators (`setPartColorOuter/…`, GEP + mutate ~2039–2100) |
| **keymap / save** | `EditorKeymap` | `onWindowKeydown` (GEP ~656), split-drag, save shortcut |
| **CSS** | co-located `.svelte` module styles per extracted card | ~1,300 CSS lines ride out with their markup |

The per-node-family mutator batches in `composition-graph-mutate.ts` regroup as:

```ts
// src/lib/cad/nodes/kinds/repeat.ops.ts   (the ~30 Repeat mutators, co-located
//   with RepeatKind — still pure (graph, …) => Graph, just cohesive)
export const RepeatOps = {
  add: addRepeat, setCount: setRepeatCount, setOp: setRepeatOp,
  addModifier: addRepeatModifier, setModifierAxis: setRepeatModifierAxis,
  addPartModifier, setPartModifierAxis, /* … */
};
```

They stay **free functions re-exported behind a namespace object** — no `this`,
still tree-shakeable, still unit-testable without Svelte, but now the "these 30
belong together" is expressed structurally.

---

## 6. Phased migration plan

Each phase is independently shippable to Railway, reversible, and hides behind
the existing free-function API via a facade so nothing breaks at once. Ordered
lowest-risk-first. LOC figures are *moved*, not new.

| Phase | Scope | Behind-facade trick | LOC moved | Risk | Ship gate |
|---|---|---|---|---|---|
| **0. Registry scaffold** | Create `src/lib/cad/nodes/{node-kind.ts, registry.ts}` + descriptors for the **3 leaf kinds** (`method`, `txfmn`, `material`). Route only `nodeSize` (layout) + `validate` for those 3 through `kindOf()`; every other path untouched. | New module; `validateGraph`/`nodeSize` fall through to old switch for unmapped types (`kindOf(n) ?? legacySwitch`). | ~120 | **Very low** — pure functions, unit-tested, no editor/UI, works headless. | `bun run test` + a golden-emit diff on 3 volume parts is byte-identical |
| **1. Emit through the registry** | Move all ~11 `emitNodeExpr` arms into descriptors; delete the switch. This is the highest-value collapse. | Descriptor `emitExpr` reproduces each arm verbatim (Repeat/Stack keep every comment). Keep `emitNodeExpr(node, …)` signature as a thin delegating wrapper. | ~250 | **Low-med** — emit is deterministic + golden-testable. Byte-identical `.asm.ts` is the gate. | Golden-emit diff = 0 across ALL ~40 volume parts (`bun run test:graph` + a full re-emit dry run) |
| **2. Validate + consumed-set + hydrate** | Collapse `validateGraph`, `computeConsumedSet`, output-kind ladder, and per-type hydrate migrations into descriptor methods. | Same wrapper approach. `migrate?` is optional; unmigrated kinds no-op. | ~300 | **Low-med** — covered by existing hydrate/validate tests + migration fixtures. | `composition-graph.test.ts` green + legacy-file open test |
| **3. Command layer (undo/redo)** | Add `GraphCommand` + `cmd()` adapter + wrap GEP's `graph = mutator(…)` call-sites. Add `GraphEditorController` owning `graph` + history; existing state classes become members. | Controller is *additive*; GEP keeps working, handlers call `ctrl.apply(cmd(...))` incrementally. No mutator changes. | ~400 (GEP call-sites rewired) | **Medium** — touches live GEP; browser-mount-verify per `modularize-round2.md` lesson 2. INLINE only (lesson 1). | Browser-verify `g_dp_box`/`g_mule_shoe`/a polygon part; undo/redo smoke; graph e2e |
| **4. Sub-controller extraction** | Pull the 7 candidates (§5.3) out of GEP into controller classes; regroup mutator batches into `*.ops.ts` namespace objects co-located with descriptors. | Each extraction is one PR; GEP imports the new controller and deletes the moved block. Free functions stay exported (re-exported from `.ops.ts`). | ~2,000 (GEP 4,380 → ~1,500 target) | **Med-high** — the fragile part. One candidate per PR, browser-verify each. | Per-PR browser-mount + `bun run build` + graph e2e; GEP shrinks monotonically |
| **5. NodeCard generic render** | Drive `NodeCard.svelte` sockets/output-arity from `kind.sockets(node)` instead of `{#if node.type}` arms where the arm is pure chrome (sockets, delete-greying). Keep bespoke bodies (Sketch/Poly/Expr cards) as-is. | Generic socket row reads the schema; bespoke `{#if}` bodies remain until each is worth carving. | ~400 | **Med-high** — Svelte markup; SVG socket Y-math is delicate (`geom.ts`/`geom.test.ts`, memory `entry_idx_eval_idx_gotcha`). | Extend `geom.test.ts` to pin socket contract; browser-verify sockets align |

**Sequencing note.** Phases 0–2 are pure-TS, headless-verifiable (Rule 26
default), and can land fast with golden-emit as the safety net. Phases 3–5 touch
live Svelte and MUST be done inline + browser-mount-verified (`modularize-round2.md`
§0 lessons 1–2: every background subagent that attempted a large GEP extraction
stalled; `bun run build` green ≠ working for Svelte). If Phase 4 stalls, it
degrades gracefully — the mechanical file-split in `modularize-round2.md` already
covers the same candidates without the controller class; the controller is the
*better* home, not a prerequisite.

---

## 7. Honest tradeoffs

### Where the class/registry hierarchy genuinely helps

- **Adding a node type collapses from 8 edit-sites to 1 descriptor file.** This
  is the whole thesis and it is real — Warp and Material were each added by
  touching every switch by hand; `WarpNode` even documents "silently skipped by
  every switch" for `MaterialNode`, i.e. an *invisible contract* the registry
  makes explicit via `emitExpr: () => null`.
- **Cohesion.** The 30 Repeat mutators + the Repeat emit arm + the Repeat card
  finally live together. Today they're spread across three 1,000+-line files.
- **Testability.** A descriptor is a stateless object; `RepeatKind.emitExpr` and
  `RepeatKind.validate` unit-test with a literal node + fake `EmitCtx`, no graph
  scaffolding, no Svelte.
- **Undo/redo** falls out of the command layer nearly free (§5.2) — a feature
  the god-component never had.

### Where the current functional style is actually better — keep it

- **The persisted graph must stay plain data.** It is a JSON literal on disk,
  structured-cloned across the bake Web Worker, and diffed in git for
  human-readable review (`composition-emit.ts` header). Class instances break all
  three. *This is the single most important constraint and the reason the
  recommendation is a registry-of-descriptors, not `abstract class GraphNode`.*
- **Immutable spread mutators are correct for Svelte 5 `$state`.** `graph =
  {...}` + deep-proxy tracking is idiomatic and drift-free. Methods that mutate
  `this` in place would fight the reactivity model and the immutable-history
  design.
- **Tree-shaking + worker bundle.** Free functions + stateless descriptor
  singletons tree-shake; the bake worker imports only `emitExpr` paths, not an
  editor controller. A deep class graph with cross-references would drag the
  editor into the worker bundle.
- **Serialization simplicity.** No factory, no `@type` tags, no versioned
  reviver. `hydrateGraph` stays a plain transform; migrations become `migrate?`
  hooks but still return plain objects.

### The verdict

A **hybrid**: *behaviour* in a class-shaped registry (Strategy pattern keyed by
`node.type`) + a `GraphEditorController` with command objects; *data* stays the
plain discriminated union it is today. This captures ~90% of the maintainability
win (single edit-site per node type, cohesion, undo/redo, testability) while
paying none of the serialization/reactivity/bundle costs a literal object model
would incur.

---

## 8. Open questions

1. **`ContainerNode` triple-type** (`list | stack | group`). One descriptor with
   internal branching, or three? Stack carries the fat `childRefs`/`childCounts`
   emit logic (`composition-emit.ts:540`); list/group are trivial. Lean: one
   `ContainerKind` with a sub-switch, since they share the children array shape.
2. **Where do `MvNode`/`RotNode` live?** They're hydrate-only legacy (folded into
   `TxfmnNode`). Give them `migrate`-only descriptors with no `emitExpr` (assert
   never reached post-hydrate), or handle them purely inside `hydrateGraph`? Lean:
   keep in hydrate; don't pollute the registry with dead render paths.
3. **`ExprDef` is graph-level, not a node.** It lives on `graph.exprDefs[]`, not
   `graph.nodes`, and its ~30 mutators don't fit the per-node registry. Give it
   its own `ExprDefOps` namespace + an `ExprController` (§5.3), separate from the
   node registry. Confirm the `ExprNode` *instance* (which IS a node) delegates
   its emit to the def.
4. **Golden-emit harness.** Phases 0–2 lean entirely on "re-emit every volume
   part, diff = 0." Does a fixture set of all ~40 parts' `.asm.ts` exist to diff
   against, or must Phase 0 build it first? (Likely build it first — cheap
   insurance, reusable by `modularize-round2.md` too.)
5. **Command granularity for drag.** Node-drag emits many intermediate positions
   (`dragLive` overlay, commit on pointerup — memory `graph_editor_drag_bake_perf`).
   The command should capture only the *committed* move, not every frame — align
   with the existing overlay-then-commit pattern so undo doesn't record 60
   micro-moves.

---

## 9. Relationship to existing plans

- **`docs/plans/modularize-round2.md`** — the mechanical file-split. This plan
  gives its 7 extraction candidates a *destination architecture* (controllers +
  descriptors) instead of just "smaller files." Phases 4–5 here ARE round-2's
  R6–R10, re-homed. If this plan is not adopted, round-2 still stands alone.
- **`docs/plans/graph-editor-pane.md`** — the GEP phase ledger; §3 (Command
  layer) is the piece it never had.
- **Rule 26 / lessons in round-2 §0** — Phases 0–2 are headless (the right
  default); 3–5 are inline-only Svelte work. Honour both.
