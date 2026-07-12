# Repeat windowed editor + Sketch repeat — combined plan

> Status: design (read-only study, 2026-06-16). **No `src/` changes yet.**
> Covers two related graph-editor features that both reuse the `poly_repeat`
> loop architecture (#157, memory `polygon_repeat_loop_architecture`) and the
> full-tab **sketch-editor overlay** pattern:
>
> - **Feature 1 — Sketch REPEAT** (user item #5): a repeat/loop affordance in
>   the 2D sketch editor so a contiguous run of sketch ops tiles N times.
> - **Feature 2 — Repeat card WINDOWED editor** (user item #7): the `Repeat`
>   node opens in its own full-tab overlay (like the sketch window): PARAMS +
>   iterators on top, then **two tabs** — *Loop* (the repeated body) and
>   *Graphical modifiers* (per-iteration transforms).
>
> **This doc folds in and SUPERSEDES `docs/plans/sketch-repeat.md`** (its full
> design is reproduced as §3). Read this file; that one is now historical.
>
> Line numbers were read against the tree on 2026-06-16 and **will drift** —
> anchor on function / type / CSS-class names, not integers. The editor was
> modularized (K.65): the sketch UI + node cards now live in
> `src/lib/shared/graph-editor/GraphEditorPane.svelte` (the consolidated shell),
> NOT the old `src/lib/shared/GraphEditorPane.svelte` path some older plans cite.

---

## 1. Shared foundations (both features build on these)

### 1.1 The `poly_repeat` reference pattern (#157)

The canonical loop in the editor. Mirror it beat-for-beat:

- `PolyRepeatNode = { id; type:'poly_repeat'; count:ArgValue; loopVar:string;
  r:ArgValue; z:ArgValue; bindings?:PolyRepeatBinding[] }` — a **separate
  free-floating card** (`addPolygonRepeat`), referenced by a ref entry, never
  appended to any list (so it never shows as an Output).
- `PolygonRepeatRef = { kind:'repeat-ref'; sourceId }` — one entry in the
  polygon's flat `points[]`.
- **Emit** (`composition-emit.ts` `case 'polygon'` ~L458-491): the ref expands
  to `...Array.from({ length: count }, (_, i) => { const NPts = count;
  <bindings>; return [r, z]; })` spliced into the points literal. `NPts`,
  `loopVar`, and each binding are in scope for the `i`-indexed exprs; bindings
  emit as `const <name> = <value>;` after `NPts` (left-to-right cascade).
- **Round-trip**: `meta.graph` is the source of truth; the `Array.from` text is
  lossy. `hydrateGraph` reconstructs both nodes; `serialiseGraph` type→tag map
  carries `poly_repeat`.
- **Consumed-set** (`computeConsumedSet`, `composition-emit.ts` ~L553): the
  referenced source node is marked consumed so it doesn't double-emit as an
  Output and its delete button greys out.

### 1.2 The sketch-editor overlay pattern (the UX template)

`src/lib/shared/graph-editor/GraphEditorPane.svelte`:

- **State**: `editingSketchId` (~L2341); `openSketchEditor`/`closeSketchEditor`
  (~L2344-2345) reset selection + frame + scroll. Opened by a `✎` button on the
  sketch node card (`ge-sketch-edit-btn`, ~L5312).
- **Derived**: `sketchEditor = $derived.by(...)` (~L2350) computes the editor
  geometry/extents from the node being edited; recomputes on every `graph`
  reassignment.
- **Overlay markup** (`{#if editingSketchId && sketchEditor}` ~L5658+):
  `.ge-sketch-editor` = a **left vertical tool rail** (`.ge-sketch-vtools`) + a
  `.ge-sketch-stage` (a `pointer-events:none` SVG draw surface) + **floating
  draggable cards** (`.ge-sketch-cards`, a second `<svg>` `miniSvgEl`) for the
  PARAMS list and the op list (the "floating mini node-graph"). Cards drag by
  their title bar via `sketchCardPos` (~L2782) / `sketchBarPos` (~L2759);
  `miniLayout` (~L5772) lays them out.
- Mutations write **straight back into the bound `graph`** (`graph =
  setSketchOpField(...)`, etc.); the parent's live-bake `$effect` re-renders the
  right pane on every reassignment — no extra plumbing.

Both features add their own `editing<X>Id` state + open/close fns + an
`{#if editing<X>Id}` overlay branch, copying this skeleton.

### 1.3 The `NodeTransform` array (shared with `part-editor-window.md`)

`docs/plans/part-editor-window.md` already specifies an **embedded ordered
transform array** for placing a single part on its own card:

```ts
export type NodeTransform = { kind:'mv'|'rot'; vec:[ArgValue,ArgValue,ArgValue] };
```

Feature 2's "graphical modifiers" tab is the **per-iteration** generalisation of
that same array: the transform `vec` ArgValues may be `expr`s that reference the
loop variable `i` and `N`. **Land `part-editor-window.md` PR-1 first** (it adds
`NodeTransform` + the emit fold + the pure mutations); Feature 2 reuses that type
and the `mv()`/`rot()` emit fold verbatim, only changing the wrapping context
from "once" to "inside the `Array.from((_, i) => …)`".

---

## 2. Feature 2 — Repeat card windowed editor (user item #7)

### 2.1 What the Repeat node is today

`composition-graph-types.ts`:

```ts
export type RepeatOp = 'stack' | 'list' | 'place';
export type RepeatNode = { id; type:'repeat'; child:NodeId; count:ArgValue; op?:RepeatOp };
```

Emit (`composition-emit.ts` `case 'repeat'` ~L442-457):
`Array.from({ length: count }, () => <child>)`, wrapped `stack(...)` (default) /
`place(...)` / bare for `op:'list'`. **Every copy is identical** — there is no
per-iteration variation, no loop variable, no transform. The canvas card
(~L4777-4855) shows only: `↻ Repeat × N` (count input + left count-socket), a
`builds a list of N ×` subtitle, the child label, a `child` input socket, and an
output socket. Mutators: `addRepeat`, `addRepeatPlaceholder`, `setRepeatChild`,
`setRepeatCount`, `setRepeatOp` (`composition-graph-mutate.ts` ~L278-331).

**The gap the feature fills**: a Repeat is the natural home for a *pattern*
(linear array, circular array, graded stack), but today it can only clone. The
user wants a focused window where you (a) tune the iterators, (b) edit the body
being repeated, and (c) add **graphical modifiers** — per-copy transforms keyed
to the iteration index — turning Repeat into a real parametric pattern.

### 2.2 Data-model additions (`composition-graph-types.ts`)

Extend `RepeatNode` with **sparse, optional** fields (round-trip for free, like
`ContainerNode.childRefs`/`childCounts` and `PolyRepeatNode.bindings` — no
migration code, `serialiseGraph` emits `graph.nodes` verbatim and `hydrateGraph`
spreads them):

```ts
export type RepeatNode = {
  id: NodeId; type: 'repeat';
  child: NodeId; count: ArgValue; op?: RepeatOp;
  /** Iteration variable in scope for modifier/binding exprs. Default 'i'.
   *  `N` is auto-injected as the resolved count (mirrors poly_repeat's NPts). */
  loopVar?: string;
  /** Local symbols evaluated per-iteration, in scope for modifiers (reuse the
   *  poly_repeat binding type + its UI verbatim). */
  bindings?: PolyRepeatBinding[];
  /** Per-iteration transform stack applied to each copy, innermost-first.
   *  vec ArgValues may be exprs referencing `i` / `N` / bindings — that is the
   *  "graphical modifier". Empty/absent ⇒ today's identity clone. */
  modifiers?: NodeTransform[];   // NodeTransform from part-editor-window.md
};
```

No new node type, no new ref entry — the Repeat already owns its `child` and is
already a first-class node. This is purely additive on an existing node.

### 2.3 Emit (`composition-emit.ts` `case 'repeat'`)

When `modifiers`/`bindings`/`loopVar` are present, the arrow gains the index and
folds the transforms (reusing `part-editor-window.md`'s `mv()`/`rot()` fold):

```js
// identity clone (today) — unchanged when no modifiers/bindings:
Array.from({ length: count }, () => child)

// patterned (modifiers present):
Array.from({ length: count }, (_, i) => {
  const N = count;
  const pitch = (p.pitch);            // bindings, cascade after N
  return rot(mv(child, [i*pitch, 0, 0]), [0, 0, i*30]);   // modifiers fold
});
```

- `i` = `loopVar` (validated `/^[A-Za-z_$][\w$]*$/`, else `'i'`); `N` injected as
  a const — **exact `NPts` analog**.
- Modifier fold order = array order, innermost-first (`modifiers[0]` closest to
  the part) — identical to `part-editor-window.md` §4.4. `mv` carries datums,
  `rot` drops them (`manifold-helpers` `mv`/`rot`).
- `op` wrapping (`stack`/`place`/bare list) is applied to the whole
  `Array.from(...)` exactly as today.
- **Backward-compat**: when `modifiers`+`bindings` are both empty/absent AND
  `loopVar` is unset, emit the *current* `() => child` form byte-for-byte so the
  existing parts' baked source is unchanged. Gate on that.

Factor the per-copy arrow body into a small helper so the canvas card preview and
emit agree (low-risk; the fold is one expression).

`collectEdges` / `validateGraph` (`composition-graph-mutate.ts` ~L81-96 /
`composition-emit.ts` ~L121): the `case 'repeat'` arm already walks `count`; add
a sub-walk over `modifiers[k].vec[axis]` and `bindings[k].value` for
`kind:'param'` edges (mirror the mv/rot/poly_repeat arms) so modifier param-wires
show up in the orphan check and any wire rendering.

### 2.4 The window UI — overlay reusing the sketch skeleton

GraphEditorPane gains, mirroring `editingSketchId`:

- `editingRepeatId = $state<string|null>(null)` + `openRepeatEditor(id)` /
  `closeRepeatEditor()`.
- A `repeatEditor = $derived.by(...)` resolving the node + a numeric preview of
  the expanded copies (count/loopVar/bindings/modifiers eval'd via the existing
  param scope + expr evaluator, clamped count).
- Open trigger: a `✎` / `⤢` button on the Repeat node card title (next to the
  `×` at ~L4832), mirroring `ge-sketch-edit-btn`.
- Mount: `{#if editingRepeatId}<div class="ge-repeat-editor"> … </div>{/if}` —
  same overlay shell as `.ge-sketch-editor`.

**Layout** (top-down):

```
┌──────────────── ↻ Repeat editor ───────────────────────────[×]┐
│ PARAMS + ITERATORS  (always visible, top strip)               │
│   count [ p.n  ƒ ◦ ]   op (stack▾)   loopVar [ i ]            │
│   bindings ƒ(i):  pitch = [ p.pitch ƒ ]  +                     │
├───────────────────────────────────────────────────────────────┤
│ ( Loop body )  ( Graphical modifiers )      ← TWO TABS         │
├───────────────────────────────────────────────────────────────┤
│  …active tab body…                                            │
└───────────────────────────────────────────────────────────────┘
```

- **Top strip — PARAMS + iterators** (always visible above the tabs):
  `count` (ArgValue input + `ƒ` chip + wire socket → reuse `setRepeatCount` /
  `endWireOnRepeatCount`), `op` selector (`stack`/`list`/`place` → `setRepeatOp`),
  `loopVar` text input, and the **bindings ƒ(i)** rows (reuse the poly_repeat
  bindings UI verbatim — `name = value-expr` with ƒ-popover + `×`). `N` is in
  scope, documented inline ("`N` = count, `i` = 0…N−1").

- **Tab 1 — Loop body**: edits what is repeated (the `child`). Two sub-modes by
  child type:
  - If `child` is empty or simple → a compact **child picker** (drop-socket
    parity with the canvas `child` socket; or a "pick a part" list) that sets
    `child` via `setRepeatChild`.
  - If `child` is a `call` → render that part's **PARAMS inline** (reuse
    `ParamsCard.svelte` against the child Call's args) so the user tunes the
    repeated unit without leaving the window. (A full nested node-graph for the
    body is out of v1 scope; the body is one node — pick it + tune its args.)

- **Tab 2 — Graphical modifiers**: the `modifiers[]` editor. This is the
  `PartTransformEditor` row UI from `part-editor-window.md` §6.2, parameterised
  by `i`:
  - one row per `NodeTransform`: kind selector (`mv ⇄` / `rot ↻`), three
    coordinate inputs (x/y/z or rx/ry/rz) with `dragNumber` + **commit on Enter**
    (memory `feedback_apply_on_enter`), a per-axis **`ƒ` chip** (memory
    `feedback_keep_fx_button`) opening an **expression popover** so you write
    `i*pitch` / `i*360/N` (memory `feedback_popup_over_inline` — popovers, not
    inline cells), and `↑`/`↓` reorder + `×` delete.
  - `+ mv` / `+ rot` append a zero transform.
  - **Preset chips** (sugar over the array, the "graphical" part): *Linear*
    (`mv [i*dx, i*dy, i*dz]`), *Circular* (`rot [0,0, i*360/N]` + a radius `mv`),
    *Graded* — each just seeds the right modifier rows with `i`/`N` exprs. This
    is where Repeat becomes a visible pattern tool.
  - **Live preview**: the right pane re-bakes on every `graph` reassignment, so
    each edit shows the pattern immediately. (Optional: a small ghost preview of
    copy `i=0,1,2` inside the window.)

Reuse the body-portaled `FloatingPanel` z-index contract (memory
`floating_panel_z_index`: fixed 1000). **No drag-to-socket wiring inside the
window** — param wiring is via the `ƒ`/wire popover, sidestepping the fragile
cumulative socket-Y math (same decision as `part-editor-window.md` §6.2).

### 2.5 New mutations (`composition-graph-mutate.ts`, pure, `finalize`-wrapped)

```ts
setRepeatLoopVar(graph, repeatId, name)
addRepeatBinding / setRepeatBindingName / setRepeatBindingValue / removeRepeatBinding   // reuse poly_repeat binding helpers' shape
addRepeatModifier(graph, repeatId, kind, vec?)        // append a NodeTransform
setRepeatModifierAxis(graph, repeatId, idx, axis, ArgValue)
setRepeatModifierKind(graph, repeatId, idx, kind)
moveRepeatModifier(graph, repeatId, idx, dir:-1|1)
removeRepeatModifier(graph, repeatId, idx)
```

All rebuild `edges` (so modifier param-wires appear in the orphan check). Model
them on `setSketchOp*` + the poly_repeat binding mutators.

### 2.6 Canvas card badge

On the canvas, the Repeat card gains a compact modifier/iterator badge (e.g.
`ƒ(i) ×2` when modifiers/bindings exist), tinted when non-empty, mirroring the
sketch `✎`. Click opens the window. The card stays small; all detail lives in
the window — the de-clutter payoff the user wants from item #3/#7.

---

## 3. Feature 1 — Sketch REPEAT (user item #5)

> Reproduced from the superseded `docs/plans/sketch-repeat.md`. Adds a REPEAT
> affordance to the 2D sketch editor so a contiguous run of sketch ops (line /
> spline / fillet / chamfer) tiles N times — threads, serrations, racks, stacked
> grooves — directly analogous to `poly_repeat`, but for the `(r,z)` profile.

### 3.0 Surfaces it plugs into

- **Op model** — `composition-graph-types.ts`: `SketchOpEntry` (line/spline with
  `r,z` ArgValues + optional `mode:'abs'|'rel'`; fillet `radius`; chamfer
  `dist`), `SketchNode = { id; type:'sketch'; ops; segments? }`. Mutators in
  `composition-graph-mutate.ts` (`addSketch`, `addSketchOp`, `setSketchOpField`,
  `setSketchOpMode`, `setSketchOpKind`, `moveSketchOp`, `removeSketchOp`,
  `setSketchSegments`, spline-point helpers).
- **Compile** — `src/lib/graph/sketch.ts`: `compileSketch(ops, segments)`→`(r,z)[]`.
  `toVerts` walks ops with a **running cursor**: `mode:'rel'` ops accumulate
  `(Δr,Δz)` from the previous vertex (first point op forced absolute);
  fillet/chamfer attach a `corner` mod to the **preceding** vertex; the op list
  is a **closed loop** (`% n` wraparound). compileSketch sees **numeric** ops.
- **Emit** — `composition-emit.ts` `case 'sketch'` (~L492+): emits
  `sketch([ {op:'line', r:…, z:…}, … ], seg)`; each field via `emitValueExpr`.
  Wired to a consumer via the `__POLY__<id>` sentinel (same channel as polygon).
- **Live preview** — `sketchEditor` derived (~L2350) maps `node.ops` → resolved
  **numeric** `SketchOp[]` and calls `compileSketch` client-side for the outline.
  This is the SECOND expansion site that MUST agree with emit (§3.3).
- **Card geometry** — `src/lib/graph/sketch-layout.ts`: `sketchEntryH(op)` +
  `sketchColLayout(ops, cols)` is the single source of truth for row Y / column X;
  `sketchSock*` / `nodeSize` / `miniLayout` delegate. Sockets key on a **flat
  integer `idx`** into `ops`.

### 3.1 Op model — chosen design

**Mirror `poly_repeat` exactly: a separate `sketch_repeat` card + a flat
`repeat-ref` op entry.** NOT a nested child-ops array inside the parent sketch,
because the card geometry keys on a **flat integer `idx`** — nesting would break
every socket. A flat ref entry costs one new `sketchEntryH` case, exactly as
`poly_repeat` did for the polygon.

```ts
export type SketchRepeatNode = {
  id: NodeId; type: 'sketch_repeat';
  count: ArgValue;                 // iterations; clamp ≥0
  loopVar: string;                 // default 'i'; in scope for proto op exprs
  /** Per-iteration ADVANCE of the iteration origin (stride between copies).
   *  Realised as a leading rel move; 0/absent ⇒ pure self-tiling (§3.1.2). */
  dr?: ArgValue;
  dz?: ArgValue;
  bindings?: PolyRepeatBinding[];  // reuse poly_repeat's binding type
  /** Prototype run to repeat — same op vocab as a sketch, NO nested refs (v1). */
  ops: SketchOpEntry[];
};
export type SketchRepeatRef = { op: 'repeat-ref'; sourceId: NodeId };
export type SketchNode = {
  id: NodeId; type: 'sketch';
  ops: Array<SketchOpEntry | SketchRepeatRef>;
  segments?: ArgValue;
};
```

`GraphNode` union gains `SketchRepeatNode`. `SketchRepeatRef` keeps `op` as its
discriminant so existing `if (op.op === 'line' || …)` switches get a clean branch.

#### 3.1.1 compileSketch is UNCHANGED — expand upstream

`sketch.ts` stays untouched. The repeat is expanded into a flat numeric op stream
BEFORE `compileSketch`, at the two existing expansion sites (emit + client
preview). One continuous flat op list ⇒ `toVerts`'s running cursor walks across
iteration boundaries for free → rel-mode prototype ops **tile seamlessly**. Key
reuse: no new compile math.

#### 3.1.2 Per-iteration advance (tri-modal)

- **dr=dz=0** (threads / continuous serrations): prototype's own rel ops sum to
  the pitch (returns to baseline, steps along one period); iterations tile with no
  synthetic vertex.
- **dr/dz set** (racks / combs with a land): expansion **prepends one leading
  `{op:'line', mode:'rel', r:dr, z:dz}`** per iteration, creating the land/gap.
- **Tapering / non-uniform**: `i` and `NPts` are in scope (poly_repeat parity) so
  proto coords can be exprs like `r: baseR + i*taper`.

Default a new repeat to `count=4, dr=0, dz=<pitch>` with a 2-op V-tooth prototype
so the first drop bakes something visibly periodic.

### 3.2 Editor UI

- **`+ repeat`** in BOTH sketch-card footers (`.ge-sketch-foot`, the on-graph card
  + the full-tab card) and a `↻` button in the full-tab left rail
  (`.ge-sketch-vtools`). Calls `addSketchRepeat(graph, sketchId, afterIdx?)`
  mirroring `addPolygonRepeat`: creates the floating `SketchRepeatNode` (280px
  right + per-sibling 40px fan), seeds the default prototype, splices a
  `{op:'repeat-ref', sourceId}` into the parent `ops`.
- **Ref row in the parent card**: a single compact summary row (new `sketchEntryH`
  case ~40px, like `polyEntryH`'s repeat-ref=38): `↻ ×{count}` + a `Δz {dz}` chip
  + left-edge **input socket** + move ▲▼ / ×. Does NOT expose prototype ops
  inline (keeps flat socket math intact).
- **The repeat card**: a PARAMS strip (`count` + ƒ + socket, `loopVar`, `dr`/`dz`
  + ƒ, bindings reused) + a **prototype ops list** rendered with the EXISTING
  op-row markup driven by `sketchColLayout(repeatNode.ops, 1)` (sockets reuse
  `sketchSock*` unchanged) + the `+ line / +spline / +fillet / +chamfer` footer
  minus `+ repeat` (no nesting) + an **output socket** wired to the parent ref row.
- **Socket alignment**: only a new `sketchEntryH` branch for `op==='repeat-ref'`;
  the `sketch-layout.ts` pixel contract is otherwise untouched. Verify in 1/2/3
  columns.

```
┌── ✐ sketch ──────────┐          ┌── ↻ sketch repeat ───────────┐
│ r 0.5   z 0      ▲    │          │ count [ 12 ] ƒ ◦             │
│ r 0.5   z 2      ▲▼×  │          │ loopVar [ i ]                │
│ ↻ ×12  Δz 0.1  ◦ ▲▼× │◀────────▶│ dr [ 0 ] ƒ   dz [ 0.1 ] ƒ    │
│ r 1.5   z 8      ▲▼×  │  wire    │ ── prototype ops ──          │
│ + line +spline +fillet│          │ Δr  0.3   Δz 0.05   ▲        │
│ +chamfer  + repeat    │          │ Δr -0.3   Δz 0.05   ▲▼×      │
└───────────────────────┘          │ + line +spline +fillet +ch  │
                                    └──────────────────────────────┘
```

### 3.3 Emit + the two expansion sites (must agree)

**Emit** (`composition-emit.ts` `case 'sketch'`): a `repeat-ref` expands to an
`Array.from` spread spliced into the `sketch([...])` array; each iteration returns
an **array of op objects** that is `.flat()`-ened:

```js
sketch([
  { op:'line', r:0.5, z:0 },
  { op:'line', r:0.5, z:2 },
  ...Array.from({ length: (p.teeth) }, (_, i) => {
    const NPts = (p.teeth);
    return [
      { op:'line', mode:'rel', r:(p.dr), z:(p.dz) },   // only if dr||dz
      { op:'line', mode:'rel', r: 0.3, z: 0.05 },      // prototype ops,
      { op:'line', mode:'rel', r:-0.3, z: 0.05 },      // i/NPts in scope
    ];
  }).flat(),
  { op:'line', r:1.5, z:8 },
], 64)
```

Factor the per-op object renderer out of `case 'sketch'` into a shared
`emitSketchOpObject(op)` so the parent loop and the repeat spread share one
serializer. Add `sketch_repeat` to the `serialiseGraph` type→tag map; extend
`computeConsumedSet` (scan a sketch's `ops`, add each `repeat-ref`'s `sourceId`).

**Client preview** (`sketchEditor` derived): for a `repeat-ref`, look up the
`SketchRepeatNode`, eval `count`, loop `i=0..count-1` binding `loopVar`/`NPts`/
bindings, resolve each prototype op's ArgValues numerically (prepend the
`(dr,dz)` rel move when set), concatenate. Factor into a **pure shared expander**:

```ts
export function expandSketchOps(
  ops: Array<SketchOpEntry | SketchRepeatRef>,
  lookup: (id: NodeId) => SketchRepeatNode | undefined,
  evalArg: (a: ArgValue, scope: Record<string, number>) => number,
  scope: Record<string, number>,
): SketchOp[];
```

**This is the highest-correctness-risk surface**: the emitted `Array.from` source
and `expandSketchOps` must yield byte-identical geometry. Lock it with a unit test
(§3.5 PR-1) running both an inline hand-unrolled ops list and the repeat-expanded
one through `compileSketch` and asserting equal points.

**Round-trip**: `meta.graph` is the source of truth. `serialiseGraph` writes the
node + the parent's `repeat-ref`; `hydrateGraph` reconstructs both; add a guard
dropping a `repeat-ref` whose `sourceId` is missing. No legacy migration (new
entry kind; old sketches have none).

### 3.4 Edge cases

- **count = 0** → `[]`; clamp negative → 0. **count = 1** → one copy, no stride.
- **Nested repeats FORBIDDEN in v1** — repeat card footer omits `+ repeat`;
  emit/expander skip stray nested refs with a `// SKIPPED nested` comment.
- **fillet/chamfer at a boundary** — corner mods attach to the preceding vertex;
  flat splice ⇒ a first prototype op rounds the **seam** between teeth, mid rounds
  within-tooth, last rounds the tooth's final vertex. Add a seam-fillet test.
- **rel accumulation across iterations** — automatic via the continuous cursor;
  unit-test that 4 copies of a `(Δr,Δz)`-summing prototype reach the expected z.
- **The closing point** — compileSketch closes the loop; the surrounding ops must
  bring the profile back to start (author responsibility; ship a starter template).
- **abs prototype ops** — allowed but discouraged mid-sketch; default prototype
  point ops to `mode:'rel'` and hint.

### 3.5 Risk-sequenced PRs (Feature 1)

1. **Model + compile expander (PURE, no UI, no emit).** Types, widen
   `SketchNode.ops`, `GraphNode` union, `sketchEntryH` `repeat-ref` case,
   `expandSketchOps` + node mutators (`addSketchRepeat`, count/loopVar/advance
   setters, prototype-op mutators delegating to existing sketch-op mutators keyed
   by the repeat node id, bindings reused). Vitest `sketch-repeat.test.ts`:
   hand-unrolled vs expanded compile identically; count 0/1; rel tiling sum; seam
   fillet. LOWEST risk; load-bearing seam.
2. **Emit + round-trip.** `emitSketchOpObject` factor; the `repeat-ref`
   `Array.from` spread; `sketch_repeat` serialise tag; `computeConsumedSet`;
   hydrate guard. Test: emit → sandbox-eval → equals `expandSketchOps` +
   `compileSketch`; save→load preserves the repeat.
3. **Editor UI.** `+ repeat` in both footers + `↻` rail; the compact ref summary
   row; the `SketchRepeatNode` card; wire pairing; collapse/expand. Verify sockets
   in 1/2/3 columns and the live preview matches the bake.
4. **(Optional) starter template + docs.** A "threaded section" preset; note in
   `docs/CAD_AUTHORING.md`.

---

## 4. Combined phasing (both features)

Each phase ends green on `bun run build` + `bun test` / `bun run test:graph`.
Commit per numbered step (Rule 7).

| Phase | Feature | Scope | Risk |
|---|---|---|---|
| **P0** | shared | Land `part-editor-window.md` PR-1 (`NodeTransform` + emit fold + pure mutations). Prereq for F2 modifiers. | low (pure + tests) |
| **P1** | F1 | Sketch-repeat model + `expandSketchOps` + mutators (§3.5.1). | low |
| **P2** | F1 | Sketch-repeat emit + round-trip (§3.5.2). | med (two-site agreement) |
| **P3** | F2 | RepeatNode model additions (`loopVar`/`bindings`/`modifiers`) + emit fold + walks + mutations (§2.2/2.3/2.5). No UI. Unit tests: identity-clone byte-compat; patterned emit equals expander; param-edge collection. | low |
| **P4** | F1 | Sketch-repeat editor UI (§3.5.3). | med (socket-Y) |
| **P5** | F2 | Repeat window overlay + PARAMS/iterators strip + two tabs + canvas badge (§2.4/2.6). | med (overlay reuse) |
| **P6** | both | Starter templates, modifier preset chips (linear/circular/graded), docs, e2e spec (Rule 12/23). | low |

Sequencing notes:
- **P0 before P3** — F2 modifiers reuse `NodeTransform` + its emit fold.
- **F1 model/emit (P1-P2) is independent of F2** — can run in parallel by another
  agent (worktree isolation), but UI phases (P4/P5) both touch GraphEditorPane, so
  serialize those or rebase carefully (the file is large; HMR churns the live
  `:3333`, memory `feedback_substantive_edits_in_subprocess`).
- The UI phases should land **after / alongside** the GraphEditorPane
  modularization (`docs/plans/graph-editor-pane.md`, `modularize.md`) — ideally
  the sketch UI and the new repeat window are extracted into their own components
  (`SketchEditorPane` / `RepeatEditor.svelte`) rather than growing the shell.

## 5. Files touched

**Feature 1 (Sketch repeat):**
- `src/lib/graph/composition-graph-types.ts` — `SketchRepeatNode`,
  `SketchRepeatRef`, widen `SketchNode.ops`, `GraphNode` union.
- `src/lib/graph/composition-graph-mutate.ts` — `addSketchRepeat` (model on
  `addPolygonRepeat`), count/loopVar/advance/binding/prototype-op mutators,
  hydrate guard (in `composition-graph-hydrate.ts`).
- `src/lib/graph/sketch.ts` — UNCHANGED (re-exports `SketchOp`); house
  `expandSketchOps` here or in a new `sketch-repeat.ts`.
- `src/lib/graph/composition-emit.ts` — `case 'sketch'` spread,
  `emitSketchOpObject` factor, `serialiseGraph` tag, `computeConsumedSet`.
- `src/lib/graph/sketch-layout.ts` — `sketchEntryH` `repeat-ref` case.
- `src/lib/shared/graph-editor/GraphEditorPane.svelte` (or `SketchEditorPane`
  post-split) — footers, rail, op-row markup, `sketchEditor` derived.
- Tests: new `src/lib/graph/sketch-repeat.test.ts`; extend
  `tests/e2e/graph-editor.spec.ts`.

**Feature 2 (Repeat window):**
- `src/lib/graph/composition-graph-types.ts` — extend `RepeatNode`
  (`loopVar?`/`bindings?`/`modifiers?`); reuse `NodeTransform` (P0).
- `src/lib/graph/composition-graph-mutate.ts` — `setRepeatLoopVar`, repeat-binding
  helpers, `add/set/move/removeRepeatModifier`; extend `collectEdges` repeat arm.
- `src/lib/graph/composition-emit.ts` — `case 'repeat'` per-iteration arrow + fold
  (backward-compat gate); `validateGraph` repeat arm.
- `src/lib/shared/graph-editor/GraphEditorPane.svelte` — `editingRepeatId` state +
  open/close + `repeatEditor` derived + overlay mount + canvas badge; or a new
  `src/lib/shared/graph-editor/RepeatEditor.svelte` (preferred — modularization
  payoff, mirrors `PartTransformEditor.svelte`).
- Reuse `ParamsCard.svelte` (child-args tab) + the poly_repeat bindings UI +
  the sketch-overlay CSS (`.ge-sketch-editor` → `.ge-repeat-editor`).
- Tests: extend `composition-graph.test.ts` (repeat emit/round-trip); e2e spec.

## 6. Open questions / risks

- **Two-site agreement (F1)** is the top correctness risk — the emitted source and
  the client `expandSketchOps` must compile identically. PR-1's unit test is the
  gate; do not skip it.
- **F2 backward-compat (P3)** — the `case 'repeat'` emit MUST stay byte-identical
  when no modifiers/bindings/loopVar are set, or every existing part with a Repeat
  re-bakes differently. Gate explicitly + unit-test the identity form.
- **`stack`/`place` + modifiers interaction (F2)** — a per-iteration `mv` already
  offsets each copy; `op:'stack'` then *also* mates them end-to-end via datums.
  Decide + document the intended composition (likely: `op:'list'` is the natural
  partner for a fully-positioned pattern; `stack` for graded stacks where the
  modifier tweaks each copy but mating still drives placement). Surface a hint.
- **Nested editing (F2 Loop tab)** — v1 edits the body as a single picked node +
  its args; a full nested graph for the loop body is deferred.
- Both UI phases touch the large GraphEditorPane shell — prefer isolated
  components + worktree subagents; build + browser-verify per phase.
