# Dedicated part-editor window — embedded `mv` / `rot` transforms

Plan owner: graph-editor / transforms. Status: **PLAN ONLY** (no `src/`
changes yet). Target files: `src/lib/graph/composition-graph.ts`,
`src/lib/graph/composition-emit.ts`, `src/lib/shared/GraphEditorPane.svelte`
(+ a new `src/lib/shared/PartTransformEditor.svelte`).

> Line numbers below were read against the current tree on 2026-06-15 and
> **will drift** — anchor on the function / type / CSS-class names, not the
> integers.

## 1. The problem (user TODO item 3, verbatim intent)

> "Possibility of having a dedicated window for a part editing. This should
> allow us to embed transformations like mv and rotate inside the part and
> save it in the card. This is similar to the sketch window which gives us a
> better editing experience. Right now, while we have the move and rotate,
> those are not very user-friendly and cause a little messy graph."

The user wants the **sketch-window experience** applied to a part's placement
transforms: a focused floating editor where a part's `mv` (translate) + `rot`
(rotate) stack lives **on the part's own card**, so the main graph canvas is
no longer cluttered with transform wrapper nodes and their param wires.

## 2. How transforms work today

### 2.1 Data model — wrapper nodes

`composition-graph.ts`:

- `MvNode` (~L97): `{ id, type:'mv', child: NodeId, offset: [ArgValue×3] }`
- `RotNode` (~L98): `{ id, type:'rot', child: NodeId, rot: [ArgValue×3] }`

Both are **wrapper nodes** that own exactly one `child` and three coordinate
`ArgValue`s (`literal | expr | param`, ~L43). They are first-class members of
the `GraphNode` union (~L215) and the `graph.nodes` map.

Mutations: `addMv` (~L682), `addRot` (~L1280),
`addMvPlaceholder`/`addRotPlaceholder` (~L1295-1301),
`setTransformChild` (~L1304), `setTransformAxis` / `setTransformAxisValue`
(~L1312-1328), `wrapInTransform` (~L1345), `unwrapTransform` (~L1372),
`inlineTransformOf` (~L1394), `findParentContainer` (~L1332).

Traversal / bookkeeping that knows about mv/rot:
- `collectEdges` (~L534-541): emits `param` edges for `offset[i]` / `rot[i]`.
- `validateGraph` (`composition-emit.ts` ~L121-128): checks `child` exists +
  each axis `ArgValue`.
- `topoOrder` (~L1632): visits `node.child`.
- `defaultCallPosition` (~L494): counts mv/rot toward grid placement.
- `hydrateGraph` (~L470-473): an inline mv/rot wrapping a Call gets **no
  layout slot** (it renders inside the child's card, not as its own node).
- `removeNode` (~L1432): severs the wrapper when its child is deleted.
- `computeConsumedSet` (`composition-emit.ts` ~L571): marks `node.child`
  consumed so the wrapped Call doesn't double-appear as an output.

### 2.2 Emit + bake

`composition-emit.ts` `emitNodeExpr`:
- mv (~L432): `mv(<child>, [x, y, z])`
- rot (~L437): `rot(<child>, [rx, ry, rz])`

The bake path (`composition-bake.ts` `bakeGraphPreview`) emits source then
POSTs to `/api/primitives/preview`; the server sandbox
(`primitive-sandbox.ts` ~L36/L50) injects `mv` / `rot` / `place` from
`manifold-helpers.ts`:
- `mv` (~L306): `m.translate(v)`, **carries `_refHead`/`_refTail`/`_stackRef`
  datums** along z so stacking still works after a move.
- `rot` (~L318): `m.rotate(v)` — **drops** connection datums (no carry).
- `place` (~L338): `M.compose(parts)` — combine without a boolean union.

Ghost-preview mode (~L255-295) walks **forward** through mv/rot wrappers
(`resolveGhostNode`) so the 👁 overlay shows the *placed* part, not the raw
call at origin.

### 2.3 The existing "inline transform" half-solution (what the user dislikes)

There is already an inline mode, and it is exactly what feels "messy":

- `toggleInlineTransform(callId, kind)` (GraphEditorPane ~L4457) calls
  `wrapInTransform` / `unwrapTransform`.
- The Call card renders the wrapper inline as a `<foreignObject>` block —
  `{#if mvNode}` / `{#if rotNode}` (~L5434-5508), each with three x/y/z
  inputs (`dragNumber` + `oninput`), param chips, and left-edge wire sockets;
  `⇄` / `↻` toggle buttons sit in the card title (~L5284-5288); the card
  grows by 80px per active transform (`cardH`, ~L5247).
- On the canvas, transform **param wires** are drawn from each axis socket to
  the PARAMS chip (~L4990-5041).

**Limitations that motivate the rebuild:**
1. **Only one mv AND one rot, fixed order.** Once a Call is wrapped, the Call
   is the wrapper's `child` and no longer a container child, so
   `findParentContainer(call)` returns `null` and a second
   `wrapInTransform` is a no-op (`wrapInTransform` ~L1346 bails). You cannot
   build `mv → rot → mv`, and the mv-then-rot order is hard-coded by the
   render (mv block above rot block, ~L5434/L5472).
2. **They are still graph nodes** — counted in topo, edges, consumed-set,
   delete-cascade. They inflate `graph.nodes` and complicate every walk.
3. **Canvas clutter** — the param wires (~L4990-5041) and the 80px card
   growth per transform are the visible "mess."
4. A wrapper whose child is *not* a Call (e.g. mv around a stack output)
   renders as its own standalone canvas card — more nodes.

## 3. The sketch window — the UX template to mirror

`GraphEditorPane.svelte`:
- State: `editingSketchId` (~L3053); `openSketchEditor` / `closeSketchEditor`
  (~L3056-3057) reset selection + frame + scroll.
- `sketchEditor = $derived.by(...)` (~L3073) computes geometry/extents from
  the node being edited.
- Opened by a `✎` button on the sketch node card
  (`ge-sketch-edit-btn`, ~L6201).
- Full overlay markup (~L6619+): `.ge-sketch-editor` = a **left vertical tool
  rail** (`.ge-sketch-vtools`) + a `.ge-sketch-stage` (the 2D SVG draw
  surface) + **floating draggable cards** (`.ge-sketch-cards`, pointer-events
  gated) for the PARAMS list and the op list. Cards drag by their title bar
  via `sketchCardPos` (~L3520) / `sketchBarPos` (~L3497).
- Mutations write straight back into the graph
  (`graph = setSketchOpField(...)`, etc.); the parent's live-bake effect
  re-renders the right pane on every graph reassignment.

The transform window will copy this skeleton: a focused floating panel opened
from the part card, listing an ordered, reorderable stack, writing back into
the graph immutably, with the right-pane bake refreshing live.

## 4. Data-model decision (the core choice) — **RECOMMENDED: Option A**

> **Embed an ordered `transforms` array directly on the node, keep the
> `MvNode`/`RotNode` wrapper types alive for legacy bake + advanced
> graph-level placement.** Wrapper nodes are no longer *created* from the
> card UI; the array is the canonical embedded representation.

### 4.1 The type change (`composition-graph.ts`)

```ts
/** One embedded transform applied to a node's own output, in array order.
 *  `vec` reuses the ArgValue union so each axis is literal / expr / param —
 *  identical to MvNode.offset / RotNode.rot today. */
export type NodeTransform = {
  kind: 'mv' | 'rot';
  vec: [ArgValue, ArgValue, ArgValue];
};
```

Add an optional, sparse field to `CallNode` (~L62):

```ts
export type CallNode = {
  id: NodeId; type: 'call'; src: string; alias: string;
  args: Record<string, ArgValue>;
  /** Embedded placement stack, applied innermost-first (transforms[0] is
   *  closest to the part). Absent / [] = no transform (today's behaviour). */
  transforms?: NodeTransform[];
};
```

Scope step 1 to **`CallNode` only** (the overwhelmingly common case: place a
part). Methods/containers can gain it in a later lane if needed.

### 4.2 Why Option A wins

1. **Round-trip is FREE — the decisive point.** `serialiseGraph`
   (`composition-emit.ts` ~L649) emits `nodes: graph.nodes` verbatim, and
   `hydrateGraph` (~L340) spreads `serialised.nodes`. A new **optional array
   field on a node object persists automatically** with zero serialise /
   hydrate plumbing — exactly the precedent set by `ContainerNode.childRefs`
   / `childCounts` (~L81-86) and `PolyRepeatNode.bindings` (~L182), all sparse
   optional node fields that needed **no migration code**. `LayoutXY.w/h/cols`
   round-trip the same way.
2. **Kills the clutter at the source** (the user's actual complaint): no
   wrapper node in `graph.nodes`, no canvas card, no transform param-wires,
   no per-transform 80px card growth. The transform lives *in* the card.
3. **No new node-graph bookkeeping.** Embedded transforms are not nodes →
   nothing to add to `topoOrder`, `computeConsumedSet`, `removeNode`
   cascade, `defaultCallPosition`, orphan validation, or layout slots. The
   only walks that must learn the new field are `collectEdges` and
   `validateGraph` (param ArgValues), and emit — all localized.
4. **Emit is a one-node-local wrap.** When a Call has `transforms`, wrap its
   emitted expression in nested `mv()`/`rot()` calls. Because the wrap
   happens at the node-expression level, a transformed Call still works as a
   child of `place()` / `stack()` / a Repeat — which directly *helps* the
   `place([...])` emit gap flagged for `g_dt_joint` (#167): a placed,
   transformed part is just `place([mv(A,[…]), …])`.
5. **No new limitation** — an array supports arbitrarily many transforms in
   any order, fixing limitation (1) above.

### 4.3 Why NOT the alternatives

- **Option B (keep wrappers, allow chains, edit in window).** Every wrapper
  in a chain is still a node: more `graph.nodes` entries, each needs a
  consumed-set mark, a topo visit, a delete-cascade rule, and orphan-ref
  validation. Reordering = re-pointing `child` links (fiddly + error-prone).
  The window would be editing a linked list spread across the node map. All
  cost, none of the round-trip-for-free benefit. Rejected.
- **Option C (true hybrid: card array AND wrappers coexist for the same
  part).** Two sources of truth for "where does this part sit" → emit
  ordering ambiguity and a confusing UX. Rejected as the *primary* model. We
  keep wrappers only for (a) **legacy bake** and (b) **graph-level**
  transforms whose child is *not* a Call (rare; e.g. mv a stack output before
  a method) — these stay standalone canvas nodes and are out of the window's
  scope.

### 4.4 Emit ordering + Z-down (`composition-emit.ts`)

In `emitNodeExpr`, after computing a Call's base expr, fold the transforms:

```ts
let expr = emitCallExpr(node.src, node.args);
for (const t of node.transforms ?? []) {
  const v = t.vec.map(emitValueExpr).join(', ');
  expr = t.kind === 'mv' ? `mv(${expr}, [${v}])` : `rot(${expr}, [${v}])`;
}
return expr;
```

- **Order:** `transforms[0]` is applied first (closest to the part), wrapping
  outward — so the array reads top-to-bottom = innermost-to-outermost.
  Document in the window UI ("applied top → bottom"). The common CAD order is
  **rotate then translate**; the user controls it by row order, so put `rot`
  above `mv` by default when both are added.
- **Z-down convention** (`src/lib/graph/CLAUDE.md`): `mv(part,[0,0,+N])` moves
  *down-hole*. The window's z input keeps that sign meaning; no transform on
  the convention itself — we reuse the exact `mv`/`rot` helpers, so geometry
  is identical to a wrapper today.
- **Datum carry:** `mv` carries `_refHead`/`_refTail`/`_stackRef`; `rot`
  drops them — unchanged from wrappers (manifold-helpers ~L306/L318). A rot in
  the stack drops connection datums exactly as a rot wrapper does today.

`collectEdges` (~L527) — add a `case 'call'` sub-walk over
`node.transforms` mirroring the mv/rot arms (emit edge
`${node.id}.transforms.${k}.${axis}` for each `kind:'param'`).
`validateGraph` (~L107) — same, in the `case 'call'` arm.

## 5. Migration — existing parts keep baking

**The emit + bake path for `MvNode`/`RotNode` is left completely untouched**,
so the 19+ saved parts (e.g. `g_dp_joint`, which builds `mv` wrappers around
`r_revolve` Calls — see `scripts/build_g_parts.ts` ~L366/L374) bake
byte-identically. There is **no forced data migration** and the graph cannot
break.

Two opt-in conversion paths (cosmetic, never automatic-and-silent):

1. **Explicit "embed transforms" action.** A button (on the card or in the
   window header) calls a new `absorbInlineWrappers(graph, callId)` that, for
   each wrapper qualifying under the existing `inlineTransformOf` condition
   (wrapper's child is this Call AND wrapper has a container parent), appends
   `{kind, vec}` to `call.transforms` (preserving order) and then
   `unwrapTransform`s it. Net geometry is identical (same `mv`/`rot` nesting),
   verified by an emit-equivalence unit test.
2. **Optional hydrate fold (guarded, default OFF first).** `hydrateGraph`
   could fold the *unambiguous* inline case automatically, but ship it behind
   a flag and only enable after step 1 + the equivalence test bank are green,
   so a surprise fold never lands on a user's saved file unverified. Note
   `g_dp_joint`'s mv wrappers already satisfy `inlineTransformOf` (child is a
   Call, parent is the root container), so they are the prime fold targets.

Standalone wrappers whose child is **not** a Call are left as canvas nodes
(out of scope) — they remain editable via the existing per-node transform
card (~L5560-5650).

## 6. The window UI — `PartTransformEditor.svelte`

### 6.1 Where it lives — a NEW component (modularization payoff)

GraphEditorPane is **9455 lines** (Rule K.65 / `todo_modularize_grapheditorpane`).
The sketch editor is currently *inline* in that file and is one of the
reasons it's unmaintainable. **Build the transform editor as a new
`src/lib/shared/PartTransformEditor.svelte`** — it delivers the feature AND
sets the extraction precedent the modularization lane wants. Contract:

- Props: `{ graph = $bindable(), nodeId, paramNames, onClose }`. It mutates
  the bound `graph` via the new composition-graph helpers; the parent's
  existing live-bake `$effect` already re-bakes on graph reassignment, so the
  right pane updates live with no extra plumbing.
- Pass STABLE memoised props (Rule: `fresh_array_props_effect_loops` /
  `feedback_rapid_ui_iteration`) — derive `paramNames` once.

GraphEditorPane only gains: `editingTransformsId` state +
`openTransformEditor` / `closeTransformEditor` (mirroring
`editingSketchId`), a draggable `txCardPos`, and the `{#if
editingTransformsId}<PartTransformEditor … />{/if}` mount.

### 6.2 Interaction (mirror the sketch window, honour the UI memories)

- **Open:** a transform **badge button** on the Call card title (mirrors the
  `✎` sketch button ~L6201). The badge doubles as the de-clutter indicator
  (§7).
- **Layout:** a draggable `FloatingPanel`-style card (drag by title bar) over
  the canvas — same overlay pattern as `.ge-sketch-cards`. Use the body-
  portaled `FloatingPanel` z-index contract (memory `floating_panel_z_index`:
  fixed 1000).
- **Rows:** one row per `NodeTransform`, in order. Each row =
  - a kind selector (`mv` ⇄ / `rot` ↻),
  - three coordinate inputs (x/y/z or rx/ry/rz) — number inputs with
    `dragNumber`, **commit on Enter** (memory `feedback_apply_on_enter`),
  - an explicit **`ƒ` chip** per axis (memory `feedback_keep_fx_button`) that
    opens an **expression popover** (reuse `openArgExprPop` /
    `setTransformAxisValue` → `asExpr` pattern, ~L4130) and a param-wire
    picker — **popovers, not inline cells** (memory `feedback_popup_over_inline`),
  - `↑` / `↓` reorder + `×` delete.
- **Add:** `+ mv` / `+ rot` buttons append a zero transform (`asLiteral(0)×3`).
- **Live preview:** the right pane already re-bakes the whole graph on every
  `graph` reassignment, so transforms reflect immediately. (Optional follow-up:
  an isolated single-part preview inside the window.)
- **No drag-to-socket wiring inside the window** → we sidestep the fragile
  cumulative-height socket-Y math that the sketch / polygon cards fight
  (memory in `docs/plans/sketch-multicolumn.md`: "row height MUST equal
  sketchEntryH or sockets drift"). Param wiring is done via the `ƒ`/wire
  popover instead, which is also the established convention.

### 6.3 New composition-graph mutations (pure, return new graph)

```ts
addNodeTransform(graph, callId, kind, vec?)        // append
setNodeTransformAxis(graph, callId, idx, axis, ArgValue)
moveNodeTransform(graph, callId, idx, dir: -1|1)   // reorder
removeNodeTransform(graph, callId, idx)
setNodeTransformKind(graph, callId, idx, kind)     // mv<->rot
```

All `finalize(...)`-wrapped (rebuilds `edges` so transform param-wires show in
the orphan check + any wire rendering). Mirror the `setSketchOp*` family
(~L850-919).

## 7. Graph de-clutter payoff (the user's actual ask)

- **Remove** the inline `<foreignObject>` mv/rot blocks on the Call card
  (~L5434-5508) and the transform param-wire rendering (~L4990-5041) for the
  embedded case. The card stops growing by 80px per transform (`cardH`,
  ~L5247).
- **Replace** with a single compact **transform badge** in the card title —
  e.g. `⇄↻ ×3` showing the stack depth, tinted when non-empty. Click → open
  the window. This is the only canvas footprint for placement.
- The `⇄` / `↻` title buttons (~L5284-5288) re-point from
  `toggleInlineTransform` (wrapper create) to `addNodeTransform` (array
  append) + open the window.
- Net: a placed part is **one card with a badge**, no wrapper nodes, no
  transform wires — the graph reads as "these parts, composed," with
  placement tucked into each card, exactly like the sketch window tucks the
  profile away.

## 8. Risk-sequenced steps (each `bun run build` + `bun run test:graph` green)

**PR 1 — data model + emit + walks (NO UI). RECOMMENDED SMALLEST-FIRST.**
- Add `NodeTransform` type + `CallNode.transforms?`.
- `emitNodeExpr` Call arm wraps in `mv()`/`rot()` (§4.4).
- `collectEdges` + `validateGraph` walk `transforms`.
- New pure mutations (§6.3).
- Unit tests: emit-equivalence (a Call with `transforms:[{mv},{rot}]` emits
  the same string as the equivalent wrapper nesting); round-trip
  (serialise→hydrate preserves the array); param-edge collection; validate
  catches a deleted param in a transform. Fully testable headless via
  `bun test` / `bun run test:graph`. Zero UI risk.

**PR 2 — read-path badge.** Render the transform badge on Call cards from
`node.transforms`. Existing wrapper inline UI untouched. No behaviour change
for legacy parts.

**PR 3 — `PartTransformEditor.svelte` + open/close.** Mount the window,
wire the mutations, add/edit/reorder/delete rows, `ƒ` expression + param
popover. Right-pane live bake via the existing effect.

**PR 4 — migration + retire inline wrappers from the card.** Add
`absorbInlineWrappers` + the "embed transforms" action; re-point `⇄`/`↻`
buttons to the array; delete the inline `<foreignObject>` mv/rot blocks +
their canvas param-wires. Keep standalone (non-Call-child) wrapper rendering.
Run the e2e graph spec; record per Rule 12.

**PR 5 — polish.** Optional guarded hydrate-fold (§5.2), isolated in-window
preview, default rot-above-mv ordering, keyboard reorder.

## 9. Complications found in the current code

1. **Existing inline mode must not break.** The Call card already renders mv/rot
   inline (`mvNode`/`rotNode`, ~L5245); PR 4 removes those blocks only after
   the array path is live, and the wrapper *bake* path stays forever for
   legacy files.
2. **Ghost preview of a transformed Call.** `resolveGhostNode`
   (`composition-emit.ts` ~L267) walks forward through mv/rot *wrappers* to
   ghost the placed part. Embedded transforms don't change the Call's var
   name, so a ghost of an embedded-transform Call would render at origin
   (untransformed). Follow-up: when ghosting a Call with `transforms`, wrap
   the ghost var in the same `mv`/`rot` fold. Minor; note in PR 3.
3. **`place([...])` emit gap (#167).** Embedded transforms *help* here — a
   transformed Call inside a place/stack child emits as the already-wrapped
   expr, so `place([mv(A,[…]), …])` falls out naturally. Validate against
   `g_dt_joint` as the acceptance part.
4. **`stack_ref` / datum carry.** `mv` carries `_stackRef`/`_refHead/Tail`;
   `rot` does not (manifold-helpers ~L306/L318). The fold preserves this
   exactly (same helper calls in the same nesting), so a transformed part in a
   `stack()` mates identically to the wrapper case. Worth one explicit test.
5. **GraphEditorPane size.** Adding the window inline would push the 9455-line
   file further past maintainability; §6.1 mandates a new component instead.
6. **Sketch-multicolumn interaction.** Both features touch the editor's
   floating-card overlay system. The transform window deliberately avoids the
   SVG drag-to-socket wiring that the sketch/polygon cards rely on (the
   socket-Y cumulative-walk fragility), so the two are largely independent;
   they share only the title-drag pattern.
