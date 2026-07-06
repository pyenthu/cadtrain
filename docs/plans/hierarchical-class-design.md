# Plan — Hierarchical / Class-Based Redesign of the Composition Graph

> **Status:** ✅ **FINALIZED (2026-07-06)** — execution-ready. Recommendation
> LOCKED (§3), §8 open questions all RESOLVED + folded into the body, Phase 0 is
> fully specified in §6a (implementable from this doc alone). No code changed by
> this doc. Reconcile into `/plan` (Rule 19) when the first phase is scheduled.
> Still deliberately *conservative*: the recommendation is a **hybrid**
> (behaviour in a registry of stateless descriptors, persisted graph stays plain
> data), NOT a wholesale OOP rewrite. Read alongside
> `docs/plans/modularize-round2.md` (the mechanical file-splitting effort) and
> `docs/plans/graph-editor-pane.md` (the GEP phase ledger). This plan is the
> *architectural* layer those two are groping toward without naming.
>
> **Warm-up already shipped.** `buildSolidDrop` was extracted from GEP into
> `src/lib/shared/graph-editor/node-palette.ts` (with `node-palette.test.ts`) as
> an unrelated modularize step — GEP **4456 → 4380**. That is the promote-to-class
> target for the `NodePalette` sub-controller in §5.3; the file already exists.
>
> **Subagent-safety (binding — from `modularize-round2.md` §0 lessons 1–2).**
> **Phases 0–2 are pure-TS, headless-verifiable, and subagent-safe** (a bare
> worktree can `bun run test` them — Rule 26 default). **Phases 3–5 touch live
> Svelte (GEP / NodeCard) and are INLINE-ONLY**: every background subagent that
> attempted a large GEP extraction this cycle *stalled at the watchdog mid-write*,
> and `bun run build` green ≠ working for Svelte (Phase E built clean yet threw
> two `ReferenceError`s on mount). Do 3–5 one at a time, inline, browser-mount-
> verified against `g_dp_box` / `g_mule_shoe` / a polygon part.

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
Adding one node type today means editing, by hand, **at least ten sites**
(all line numbers verified 2026-07-06):

1. the union in `composition-graph-types.ts` (`GraphNode`, line 515)
2. `validateGraph` — `switch (node.type)` at `composition-emit.ts:118`
   (**12 case labels** today: call/list/stack/group/method/mv/rot/txfmn/repeat/
   sketch/expr/warp — polygon/poly_repeat/sketch_repeat/spline/material silently
   fall through with no arm)
3. `emitNodeExpr` — `switch (node.type)` at `composition-emit.ts:532` (**14 case
   labels / 13 arm bodies**, list+group share one; expr/spline return `null`;
   poly_repeat/sketch_repeat/material fall off → `undefined`)
4. `computeConsumedSet` (input walk) — `if/else` chain at `composition-emit.ts:1006`
   (8 branches: method/mv|rot|txfmn/warp/repeat/stack|group/list/sketch/call)
5. `nodeSize` layout dispatch — **`src/lib/shared/graph-editor/geom.ts:341`**
   (an `if` chain over ~14 node types; NOT `composition-layout.ts` — that file's
   `nodeSize` is only an injected option). `composition-layout.ts` ALSO carries a
   parallel `predecessorsOf` `switch` (line 75) that must learn each new type or
   `autoLayoutGraph` throws on it.
6. `assignVarNames` var-name-prefix `?:` ladder — `composition-emit.ts:1078`
   (+ `computeListProducers`, line 997)
7. `hydrateGraph` migrations — `composition-graph-hydrate.ts` (per-type `if` blocks)
8. a batch of `add*/set*/remove*` mutators in `composition-graph-mutate.ts`
   (Repeat alone has ~30: `addRepeat`, `setRepeatCount`, `addRepeatModifier`,
   `setPartModifierAxis`, …)
9. a `{#if node.type === …}` arm plus its sockets/CSS in `NodeCard.svelte`
10. (view-only kinds) an appearance/binding resolver, e.g. `resolveEffectiveAppearance`
    for `MaterialNode` — the `emitGraph` instanceColors loop (`composition-emit.ts:250`)

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
| Validation | `validateGraph`, `composition-emit.ts:118` | `switch` over **12** case labels |
| Emit expression | `emitNodeExpr`, `composition-emit.ts:532` | `switch` over **14** labels / 13 bodies |
| Consumed-set / input walk | `computeConsumedSet`, `composition-emit.ts:1006` | `if/else` chain (8 branches) |
| Var-name-prefix label | `assignVarNames`, `composition-emit.ts:1078` | `?:` ladder (10-arm) |
| Layout size | `nodeSize`, **`shared/graph-editor/geom.ts:341`** | `if` chain (~14 types) |
| Layout predecessors | `predecessorsOf`, `composition-layout.ts:75` | `if`/`switch` |
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

/** Width policy is centralised in the geom.ts nodeSize wrapper (savedW override
 *  → cardAutoWidth → cardMinWidth clamp); descriptors receive the resolved
 *  content width + the root id and return the final {w,h}. This keeps `size`
 *  a pure function of (node, ctx) — no `graph` handle, no Svelte import — so
 *  it is testable and worker-safe. Kinds with a FIXED width (method/material)
 *  ignore `ctx.width`. */
export interface SizeCtx { width: number; root: NodeId; }

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
  /** Canvas footprint for auto-layout (was geom.ts:341 nodeSize). Returns the
   *  SAME {w,h} the current if-chain does — verified byte-for-byte per kind. */
  size(node: N, ctx: SizeCtx): { w: number; h: number };
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
//   emit  ← composition-emit.ts:594  ·  validate ← :129  ·  inputRefs ← :1009
//   size  ← geom.ts:351  (FIXED 40×40 CSG-operator circle — NOT auto-fit)
export const MethodKind: NodeKind<MethodNode> = {
  type: 'method',
  emitExpr: (n, c) => `${c.ref(n.obj, 'obj')}.${n.op}(${c.ref(n.arg, 'arg')})`,
  validate: (n, g) => [
    ...(has(g, n.obj) ? [] : [err(n.id, 'obj', n.obj, 'missing-node')]),
    ...(has(g, n.arg) ? [] : [err(n.id, 'arg', n.arg, 'missing-node')]),
  ],
  inputRefs: (n) => [n.obj, n.arg].filter(Boolean),
  size: () => ({ w: 40, h: 40 }),
  sockets: () => ({ inputs: ['obj', 'arg'], output: true }),
};

// src/lib/cad/nodes/kinds/txfmn.ts   (identity-elision preserved verbatim)
//   emit  ← composition-emit.ts:609  ·  validate ← :141  ·  inputRefs ← :1012
//   size  ← geom.ts:364  (width from ctx; FIXED height 226 — rot 3 rows + mv 3 rows)
export const TxfmnKind: NodeKind<TxfmnNode> = {
  type: 'txfmn',
  emitExpr: (n, c) => {
    const child = c.ref(n.child ?? '', 'child');
    let e = child;
    if (!n.rot.every(isLiteralZero))    e = `rot(${e}, [${n.rot.map(c.emitValue).join(', ')}])`;   // INNER
    if (!n.offset.every(isLiteralZero)) e = `mv(${e}, [${n.offset.map(c.emitValue).join(', ')}])`;  // OUTER
    return e;
  },
  validate: (n, g) => [
    ...(n.child != null && has(g, n.child) ? [] : [err(n.id, 'child', String(n.child ?? ''), 'missing-node')]),
    ...checkArgs(n.id, 'rot', n.rot, g), ...checkArgs(n.id, 'offset', n.offset, g),
  ],
  inputRefs: (n) => n.child ? [n.child] : [],
  size: (_n, ctx) => ({ w: ctx.width, h: 226 }),
  sockets: () => ({ inputs: ['child'], output: true }),
};

// src/lib/cad/nodes/kinds/material.ts   (view-only, emits nothing — the current
//   "silently skipped by every switch" node becomes explicit + discoverable)
//   emit  ← never in render tree (returns null)  ·  validate ← no switch arm today (→ [])
//   size  ← geom.ts:358  (label-fit pill: max(128, 88 + label.length*7.5) × 30)
export const MaterialKind: NodeKind<MaterialNode> = {
  type: 'material',
  emitExpr: () => null,                   // never in the render tree
  validate: () => [],
  inputRefs: () => [],
  size: (n) => ({ w: Math.max(128, 88 + String(n.name ?? 'material').length * 7.5), h: 30 }),
  sockets: () => ({ inputs: [], output: 'material' }),
};

// shared helpers the descriptors call (moved out of validateGraph's closure):
//   has(g, id)          = Object.prototype.hasOwnProperty.call(g.nodes, id)
//   err(id, slot, ref, kind)                → ValidationError literal
//   checkArgs(id, slot, ArgValue[], g)      → per-component missing-param check
//     (was validateGraph's `checkArg`, composition-emit.ts:111)
//   isLiteralZero(ArgValue)                 = the emit-side helper (already exists)

// RepeatKind is the fat one — its emitExpr keeps the foldMods/partModifiers
// logic from composition-emit.ts:624-680 verbatim; its ~30 mutators (§5.3)
// move onto a companion RepeatOps object.
```

### 4.3 The registry + the collapsed switches

```ts
// src/lib/cad/nodes/registry.ts
const KINDS: Record<GraphNode['type'], NodeKind> = Object.fromEntries(
  [CallKind, ContainerKind /* type: ['list','stack','group'] */, MethodKind,
   MvKind, RotKind /* LIVE transform twins — see OQ2 */, TxfmnKind /* legacy, hydrate-only */,
   RepeatKind, PolygonKind, PolyRepeatKind, SketchKind, SketchRepeatKind,
   ExprKind, SplineKind, WarpKind, MaterialKind]
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
// geom.ts:341 nodeSize (width resolved first, then delegate):
//   const k = kindOf(node); if (k) return k.size(node, { width: w, root: graph.root });
//   /* …existing if-chain for not-yet-migrated kinds… */
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
| **0. Registry scaffold** | Create `src/lib/cad/nodes/{node-kind.ts, registry.ts}` + descriptors for the **3 leaf kinds** (`method`, `txfmn`, `material`) + `kinds/index.ts`. Route `validate` (all 3) + `nodeSize` (all 3) through `kindOf()`; every other path untouched. Full spec: **§6a**. | New module; `validateGraph` (`composition-emit.ts:118`) + `nodeSize` (`geom.ts:341`) fall through to their existing switch/if-chain for unmapped types (`const k = kindOf(n); if (k) …; else legacy`). | ~140 | **Very low** — pure functions, unit-tested, no editor/UI, works headless (subagent-safe). | `bun run test` (3 descriptor unit specs + `geom.test.ts` still green) + the §6a golden-emit snapshot diff = 0 |
| **1. Emit through the registry** | Move all **13 `emitNodeExpr` bodies** (14 case labels, `composition-emit.ts:532`) into descriptors; delete the switch. Highest-value collapse. Add the remaining ~12 kinds' descriptors. | Descriptor `emitExpr` reproduces each arm verbatim (Repeat/Stack keep every comment); `null` for expr/spline/material. Keep `emitNodeExpr(node, …)` as a thin delegating wrapper: `return kindOf(node)?.emitExpr(node, ctx) ?? null`. | ~250 | **Low-med** — emit is deterministic + golden-testable. Byte-identical `.asm.ts` is the gate. | Golden-emit snapshot diff = 0 across ALL volume parts (§6a harness) + `bun run test:graph` e2e |
| **2. Validate + consumed-set + layout + hydrate** | Collapse the remaining dispatch: `validateGraph` (12 labels), `computeConsumedSet` (8 branches), `assignVarNames` prefix ladder + `computeListProducers`, `predecessorsOf` (`composition-layout.ts:75`), and per-type hydrate migrations → descriptor methods (`validate`/`inputRefs`/`varPrefix`/`migrate?`). | Same wrapper approach. `migrate?` is optional; unmigrated kinds no-op. | ~320 | **Low-med** — covered by existing hydrate/validate tests + migration fixtures. | `composition-graph.test.ts` + `composition-layout.test.ts` green + legacy-file open test |
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

## 6a. Phase 0 — execution-ready spec (implement from this section alone)

Phase 0 is the smallest self-contained slice: stand up the registry module +
the three leaf descriptors, route **`validate` and `nodeSize` for those three
kinds only** through `kindOf()`, and land the golden-emit safety net that
Phases 1–2 will lean on. No editor/Svelte changes to any *body* — only two thin
`if (k) … else legacy` guards. Headless-verifiable; subagent-safe.

### 6a.1 New files (exact paths)

```
src/lib/cad/nodes/node-kind.ts        # interfaces: EmitCtx, ValidationError, SizeCtx,
                                       #   SocketSchema, NodeKind<N>; + shared helpers
                                       #   has() / err() / checkArgs() / makeEmitCtx()
src/lib/cad/nodes/registry.ts         # KINDS record + kindOf(node) lookup (undefined for
                                       #   unregistered types → callers fall through)
src/lib/cad/nodes/kinds/method.ts     # MethodKind   (§4.2)
src/lib/cad/nodes/kinds/txfmn.ts      # TxfmnKind    (§4.2)
src/lib/cad/nodes/kinds/material.ts   # MaterialKind (§4.2)
src/lib/cad/nodes/kinds/index.ts      # re-exports the 3 leaf kinds (registry imports this)
src/lib/cad/nodes/kinds/method.test.ts   # unit spec — emit/validate/inputRefs/size
src/lib/cad/nodes/kinds/txfmn.test.ts    # unit spec — incl. identity-elision emit
src/lib/cad/nodes/kinds/material.test.ts # unit spec — emit=null, validate=[], size pill
src/lib/cad/nodes/emit-golden.test.ts    # re-emit-every-part snapshot diff (§6a.5)
scripts/snapshot-emit.ts                 # one-shot: capture the golden baseline (§6a.5)
tests/golden/emit/<id>.js                # committed baseline: one emitted body per part
```

Everything under `src/lib/cad/nodes/` is pure TS — **no Svelte, no `$state`, no
worker-hostile imports** — so `geom.ts` (a `shared/graph-editor` module) may
import `kindOf` without dragging the editor into the bake worker.

### 6a.2 The interface module (`node-kind.ts`) — canonical, final

Ship exactly §4.1 (`EmitCtx`, `ValidationError`, `SizeCtx`, `NodeKind<N>`,
`SocketSchema`) plus these shared helpers lifted out of `validateGraph`'s
closure so the descriptors are self-contained:

```ts
export const has = (g: Graph, id: NodeId): boolean =>
  Object.prototype.hasOwnProperty.call(g.nodes, id);
export const err = (nodeId: NodeId, slot: string, badRef: string,
  kind: ValidationError['kind']): ValidationError => ({ nodeId, slot, badRef, kind });
/** Per-component missing-param check — was validateGraph's `checkArg`
 *  (composition-emit.ts:111), lifted verbatim. */
export const checkArgs = (nodeId: NodeId, slot: string, vs: ArgValue[], g: Graph):
  ValidationError[] => vs.flatMap((v, i) =>
    v.kind === 'param' && !Object.prototype.hasOwnProperty.call(g.params, v.param)
      ? [err(nodeId, `${slot}[${i}]`, v.param, 'missing-param')] : []);
export interface SocketSchema { inputs: string[]; output: boolean | 'material'; }
```

`ValidationError` is structurally identical to the existing
`GraphValidationError` (`{ nodeId, slot, badRef, kind }`) — Phase 0 aliases it so
`validateGraph` can splice descriptor output straight into its `errs` array.

### 6a.3 The three leaf descriptors

Ship the three corrected descriptors in **§4.2 verbatim** (`MethodKind`,
`TxfmnKind`, `MaterialKind`). Each is a byte-for-byte transcription of one
existing switch/if arm — provenance line-refs are in the §4.2 comments. Note the
grounded corrections over the first draft: `MethodKind.size` = `{w:40,h:40}` (not
auto-fit), `TxfmnKind.size` = `{w: ctx.width, h:226}`, `MaterialKind.size` =
label-fit pill `{…, h:30}`.

> **⚠ Grounding note on `txfmn` (resolves OQ2).** As of 2026-07-01
> `hydrateGraph` (`composition-graph-hydrate.ts:250–280`) **UNFOLDS every saved
> `txfmn` back into live `mv`/`rot` nodes** (mixed → `mv` wrapping a new `rot`).
> The type-file comment that claims the reverse (types.ts:100) is **stale**. So
> **`mv` + `rot` are the LIVE transform kinds a hydrated graph actually carries;
> `txfmn`'s emit/size/validate arms are effectively legacy (pre-hydrate + unit
> tests only).** `TxfmnKind` is still a correct, exercisable transcription (kept
> as the plan's `migrate`-adjacent example), but Phase 1 MUST also add the trivial
> `MvKind` + `RotKind` (`geom.ts:355` → `{40,40}`; emit `mv(child,[…])` /
> `rot(child,[…])`, `composition-emit.ts:599`/`604`) — they are the ones the
> runtime hits. If you prefer to keep Phase 0's routed kinds to *live* types only,
> swap `txfmn` for `mv`+`rot` in §6a.1/§6a.4 (4 files instead of 3); the wiring is
> identical.

### 6a.4 Wiring `kindOf()` at the two Phase-0 call-sites

`registry.ts`:

```ts
import { MethodKind, TxfmnKind, MaterialKind } from './kinds';
const KINDS: Partial<Record<GraphNode['type'], NodeKind>> = {
  method: MethodKind, txfmn: TxfmnKind, material: MaterialKind,
};
/** undefined for not-yet-migrated kinds → every call-site keeps its legacy arm. */
export const kindOf = (n: GraphNode): NodeKind | undefined => KINDS[n.type];
```

**Call-site 1 — `validateGraph`, `composition-emit.ts:116` loop.** Inside
`for (const [id, node] of Object.entries(graph.nodes))`, right after the
`if (!node) continue;`:

```ts
const k = kindOf(node);
if (k) { errs.push(...k.validate(node, graph)); continue; }   // method/txfmn/material
switch (node.type) { /* …unchanged arms for every other type… */ }
```

The old `case 'method':` and `case 'txfmn':` arms become dead for registered
kinds (the `continue` skips them) — leave them in place for Phase 0 (Rule: no
deletion during scaffold; they're removed in Phase 2 when the whole switch goes).
The descriptor output is asserted byte-identical by the unit specs, so behaviour
is unchanged. `material` never had an arm → this makes its (empty) validation
explicit.

**Call-site 2 — `nodeSize`, `src/lib/shared/graph-editor/geom.ts:341`.** After
the `w` is computed (`const w = Math.max(cardMinWidth(node), baseW);`, line 344),
before the existing `if (node.type === 'call')` chain:

```ts
const k = kindOf(node);
if (k) return k.size(node, { width: w, root: (graph as any).root });
```

`method`/`txfmn`/`material` now resolve through the descriptor; every other type
falls to the unchanged if-chain. `geom.test.ts` (which pins `nodeSize` for method
= `{40,40}`, material pill, txfmn height) is the regression gate — it must stay
green with zero edits.

**Not touched in Phase 0:** `emitNodeExpr`, `computeConsumedSet`,
`assignVarNames`, `predecessorsOf`, `hydrateGraph`, `NodeCard.svelte`. Those are
Phases 1–2/5. `emitGraph`'s output is therefore provably unchanged in Phase 0 —
which is exactly why the golden harness can be *captured* now and *trusted* as the
Phase 1–2 gate.

### 6a.5 Test list + golden-emit harness

**Unit specs (3 files, vitest — `bun run test`).** Each descriptor tested with a
literal node + a fake `EmitCtx`, no graph scaffolding, no Svelte:

- `method.test.ts` — `emitExpr` → `"A.subtract(B)"` for a fake `ref`; `validate`
  flags a missing `obj`/`arg`; `inputRefs` = `[obj, arg]`; `size` = `{w:40,h:40}`.
- `txfmn.test.ts` — identity-elision matrix: all-zero → bare child; pure-rot →
  `rot(child, […])`; pure-mv → `mv(child, […])`; both → `mv(rot(child, […]), […])`
  (rot inner, mv outer). `size` → `{w: ctx.width, h:226}`. `validate` flags a null
  child + a since-deleted param in `rot`/`offset`.
- `material.test.ts` — `emitExpr` = `null`; `validate` = `[]`; `inputRefs` = `[]`;
  `size` pill width = `max(128, 88 + name.length*7.5)`, h = 30.

**Golden-emit harness (the Phase 1–2 safety net, built in Phase 0).** OQ4 is
resolved: no fixture set exists, so Phase 0 builds it — cheap insurance, reused by
`modularize-round2.md`.

1. `scripts/snapshot-emit.ts` (run ONCE, at Phase-0 start, before any registry
   wiring): enumerate every volume part via `/api/primitives/list`, fetch each
   `.asm.ts` via `/api/primitives/source?name=<id>` (local dev proxies these to
   prod — CLAUDE.md Rule 13), parse its `meta.graph`, `hydrateGraph()` it, run
   `emitGraph(graph, { id })`, and write the returned `.body` to
   `tests/golden/emit/<id>.js`. Commit the whole `tests/golden/emit/` tree. This
   is the frozen baseline.
2. `src/lib/cad/nodes/emit-golden.test.ts` (vitest): read every
   `tests/golden/emit/*.js`, load the matching graph fixture (either re-parse from
   a committed `meta.graph` snapshot alongside, or a JSON dump written by the same
   script into `tests/golden/graph/<id>.json`), re-`emitGraph`, and
   `expect(body).toBe(golden)` — **byte-for-byte**. Diff = 0 is the ship gate for
   Phases 0, 1, and 2. Because Phase 0 changes no emit path, this test passes the
   moment the baseline lands; it only starts *doing work* when Phase 1 moves the
   emit arms.

`bun run test:graph` (the Playwright graph-editor spec) remains the end-to-end
belt-and-braces check for Phases 1+; the golden unit test is the fast inner loop.

### 6a.6 Phase-0 done checklist

- [ ] 7 source files + 4 test/script files created (§6a.1).
- [ ] `bun run test` green — 3 new descriptor specs + `geom.test.ts` +
      `composition-graph.test.ts` unchanged.
- [ ] `tests/golden/emit/` baseline committed; `emit-golden.test.ts` green.
- [ ] `bun run build` clean.
- [ ] `validateGraph` + `nodeSize` route method/txfmn/material through `kindOf`;
      all other types untouched. No arm deleted.

---

## 7. Honest tradeoffs

### Where the class/registry hierarchy genuinely helps

- **Adding a node type collapses from ~10 edit-sites (§1) to 1 descriptor file.** This
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

## 8. Resolved decisions (formerly open questions)

All five are decided and folded into the body; kept here as a rationale ledger.

1. **`ContainerNode` triple-type (`list | stack | group`) → ONE `ContainerKind`,
   sub-switched on `node.type`.** DECIDED. Grounded: `emitNodeExpr` already shares
   ONE arm for `list`+`group` (`composition-emit.ts:537–539`) and a separate fat
   arm for `stack` (`:540–592`, the `childRefs`/`childCounts` per-child count +
   stack-ref override logic); `nodeSize` treats all three identically save the root
   `▶ Output` special-case (`geom.ts:371–380`); `validate` shares one arm
   (`:122–128`); `computeConsumedSet` splits stack|group vs nested-list-vs-root
   (`:1022–1031`). They all key off the same `children: NodeId[]`. Register ONE
   descriptor under all three types via the `KINDS` builder's array-type flatMap
   (§4.3 already supports `Array.isArray(k.type)`), with an internal
   `if (node.type === 'stack')` branch inside `emitExpr` and the
   `node.id === graph.root` branch inside `size`.
2. **`mv`/`rot` are the LIVE transform kinds; `txfmn` is hydrate-only; the
   txfmn→mv/rot unfold stays a GRAPH-LEVEL migration, NOT a per-node `migrate?`
   hook.** DECIDED — this *reverses* the draft's assumption after reading the code.
   `hydrateGraph:250–280` unfolds every saved `txfmn` into `mv`/`rot` (mixed →
   `mv` wrapping a new `rot`), so a hydrated graph never contains `txfmn`. Give
   `mv` + `rot` real first-class descriptors (they're trivial: `{40,40}` size,
   `mv(child,[…])`/`rot(child,[…])` emit, single `child` input). Keep `TxfmnKind`
   as a legacy-arm transcription (harmless, unit-tested). The unfold produces TWO
   nodes from one, which does **not** fit the 1:1 `migrate?(raw): N` signature, so
   it remains a graph-level pass in `hydrateGraph` — the same "graph-level, not
   per-node" bucket as OQ3. The per-node `migrate?` hook is reserved for 1:1 field
   migrations (PolygonPoint `kind` default, spline `ctrl`→`pts`).
3. **`ExprDef` is graph-level → its own `ExprDefOps` namespace + `ExprController`,
   OUTSIDE the node registry.** DECIDED. `ExprDef` lives on `graph.exprDefs[]`, not
   `graph.nodes`, so it has no `node.type` to key on. Its ~30 mutators become
   `ExprDefOps` (a `*.ops.ts` namespace object, §5.3) owned by `ExprController`.
   The `ExprNode` *instance* (which IS a node) gets a normal registry descriptor:
   its `emitExpr` returns `null` (confirmed — `composition-emit.ts:785`; expr
   instances contribute a PRELUDE const via `emitExprBlocks`, not a geometry
   value), and its `inputRefs` are its `bindings` sources. So the def↔instance
   split maps cleanly onto ops-namespace (def) + registry-descriptor (instance).
4. **Golden-emit fixture does NOT exist yet → Phase 0 builds it.** DECIDED +
   specified in §6a.5: `scripts/snapshot-emit.ts` captures `tests/golden/emit/<id>.js`
   (+ `tests/golden/graph/<id>.json`) once at Phase-0 start via
   `/api/primitives/{list,source}` → `hydrateGraph` → `emitGraph`;
   `emit-golden.test.ts` re-emits + diffs byte-for-byte. Reusable by
   `modularize-round2.md`.
5. **Drag commands capture only the COMMITTED move (on pointerup), never
   intermediate frames.** DECIDED (Phase 3). Align with the existing
   `dragLive`-overlay-then-commit-on-pointerup pattern (memory
   `graph_editor_drag_bake_perf`: never reassign `graph` per frame). One
   `cmd('move node', …)` is pushed to the undo stack on pointerup with the
   pre-drag position as the snapshot inverse — so undo reverts the whole gesture,
   not 60 micro-moves. The overlay drives the live visual; only the settle writes
   graph state + history.

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
