# Sketch REPEAT — repeat a span of sketch ops N times (B.2 / id 805)

> **Status: comprehensive plan, refreshed 2026-06-23 (post-Phase-E).** This is
> the canonical, execution-ready plan for roadmap **B.2 (id 805)**. It replaces
> the 2026-06-16 study (which referenced the pre-modularization
> `GraphEditorPane` line numbers) and is the standalone version of §3 of
> `docs/plans/repeat-and-sketch-repeat.md` (that combined doc also covers the
> separate Repeat-card windowed-editor item — read it for that half only).
>
> Adds a **REPEAT** affordance to the 2D sketch editor so a contiguous run of
> sketch ops (line / spline / fillet / chamfer) tiles N times — threads,
> serrations, racks, stacked grooves — directly analogous to the polygon
> `poly_repeat` loop (#157), but for the `(r,z)` sketch profile.
>
> **UNBLOCKED 2026-06-23.** The old plan waited on the GraphEditorPane
> modularization (the sketch UI was slated to move into `SketchEditorPane`).
> **That shipped** (Phase E Step 2, commits `800d0e7` + `08ad8c4`): the sketch
> UI now lives in `SketchNodeCard.svelte` + `SketchEditorPane.svelte` driven by
> the per-pane `SketchState` class (`sketch-state.svelte.ts`). So the UI PR
> (PR-3) lands cleanly in those files — no GraphEditorPane surgery.

## 0. What exists today (the surfaces this feature plugs into)

Verified against the tree at 2026-06-23. `composition-graph.ts` was split, so
the model + mutators now live in two files.

- **Op model** — `src/lib/cad/composition-graph-types.ts`:
  - `SketchOpEntry` = discriminated union on `op`: `line` / `spline` (each with
    `r,z` ArgValues + optional `mode:'abs'|'rel'`; spline also `pts`/`h0`/`h1`),
    `fillet` (`radius`), `chamfer` (`dist`).
  - `SketchNode = { id; type:'sketch'; ops: SketchOpEntry[]; segments?; scaleX?;
    scaleY? }`. **Note `scaleX`/`scaleY` already shipped** (whole-sketch r/z
    scale, ArgValue, default 1) — the repeat design must not disturb them; they
    apply as a final multiply in `compileSketch`, downstream of expansion.
  - `GraphNode` union ends with `… | PolygonNode | PolyRepeatNode | SketchNode`.
- **Mutators** — `src/lib/cad/composition-graph-mutate.ts`: `addSketch`,
  `addSketchOp`, `setSketchOpField`, `setSketchOpMode`, `setSketchOpKind`,
  `moveSketchOp`, `removeSketchOp`, `setSketchSegments`, the spline-point
  helpers, and the `scaleX/Y` setters. `addPolygonRepeat` (the model for
  `addSketchRepeat`) also lives here.
- **Compile** — `src/lib/cad/sketch.ts`: `compileSketch(ops: SketchOp[],
  segments, scaleX?, scaleY?)` → `(r,z)[]`. `toVerts` walks ops with a **running
  cursor**: `mode:'rel'` ops accumulate `(Δr,Δz)` from the previous vertex; the
  first point op is forced absolute. fillet/chamfer attach a `corner` mod to the
  **preceding** vertex. The op list is a **closed loop** (`% n` wraparound).
  compileSketch sees **numeric** ops only. **Stays UNCHANGED** (see §1.1).
- **Emit** — `src/lib/cad/composition-emit.ts` `case 'sketch'`: emits a runtime
  `sketch([ {op:'line', r:…, z:…}, … ], seg, scaleX, scaleY)` call; each field
  goes through `emitValueExpr(ArgValue)`. The injected sandbox `sketch(...)` runs
  `compileSketch`. The sketch node is wired to a consumer via the `__POLY__<id>`
  sentinel (same channel polygon uses). `serialiseGraph`'s type→tag map and
  `computeConsumedSet` also live here.
- **Live preview** — `src/lib/shared/graph-editor/sketch-state.svelte.ts`: the
  per-pane `SketchState` class owns the `sketchEditor` derived that maps
  `node.ops` → resolved **numeric** `SketchOp[]` via the param scope + the coord
  expr evaluator, and calls `compileSketch` **client-side** for the editor
  outline. **This is the SECOND expansion site** that must agree with emit (§3.2).
- **Card geometry** — `src/lib/cad/sketch-layout.ts`: `sketchEntryH(op)` (24 for
  corner ops, else 45) + `sketchColLayout(ops, cols)` is the SINGLE source of
  truth for row Y / column X; the node card + editor sockets all delegate to it.
  Sockets are SVG circles keyed by a **flat integer `idx`** into `ops`.
- **UI (post-Phase-E)** — `src/lib/shared/graph-editor/SketchNodeCard.svelte`
  (the in-graph sketch node card: coord rows, ✎/× chrome, foot, per-coord wire
  sockets, output socket) + `SketchEditorPane.svelte` (the full-tab editor: tool
  rail, 2D draw stage, floating PARAMS + sketch mini-cards, corner/spline dial
  topbar, Done tick). Both take the one per-pane `SketchState` + `wire` as props;
  graph mutations route through a `setGraph()` callback (parent owns `graph`).
  The coord ƒ-popover lives in the GraphEditorPane SHELL (`sketch.sketchExprPop`).

### The REFERENCE pattern — polygon `poly_repeat` (#157)

- `PolyRepeatNode = { id; type:'poly_repeat'; count; loopVar; r; z; bindings? }`
  — a **separate free-floating card** (`addPolygonRepeat`): NOT appended to any
  list, so it never shows as an Output; referenced only by a ref entry.
- `PolygonRepeatRef = { kind:'repeat-ref'; sourceId }` — ONE entry in the
  polygon's flat `points[]` (so `polyEntryH` just adds a `repeat-ref` height
  case; flat-idx socket math is preserved).
- Emit: the ref expands to a **`...Array.from({ length: count }, (_, i) => {
  const NPts = count; …bindings; return [r, z]; })`** spread spliced into the
  points array. `NPts` + `loopVar` + bindings are in scope for the `i`-indexed
  exprs.
- Round-trip: the body is **regenerated from `meta.graph`** on load; the
  `Array.from` text is lossy but the graph block is the source of truth. Hydrate
  reconstructs both nodes.

> Mirror **`poly_repeat`** (the single-purpose 2D loop), NOT the composition-level
> `RepeatNode` (which has since grown `children[]` / `modifiers` /
> `partModifiers` for 3D instance stacks). The sketch repeat is a 1-D profile
> tiler — poly_repeat is the right-sized analog.

## 1. Op model — chosen design

**Mirror `poly_repeat` exactly: a separate `sketch_repeat` card + a flat
`repeat-ref` op entry.** Deliberately NOT a nested child-ops array inside the
parent sketch, because the whole sketch card geometry (`sketchColLayout`,
`sketchEntryH`, the flat-`idx` sockets) keys on a **flat integer index** — nesting
a sub-array would break every socket. A flat ref entry costs only one new
`sketchEntryH` case, exactly as `poly_repeat` did for the polygon.

### Types (`composition-graph-types.ts`)

```ts
// A repeat of a CONTIGUOUS run of ops. The prototype sub-sequence lives on the
// repeat node (edited on its own card, like poly_repeat's r/z exprs).
export type SketchRepeatNode = {
  id: NodeId;
  type: 'sketch_repeat';
  count: ArgValue;                 // iterations (literal/param/expr); clamp ≥0
  loopVar: string;                 // default 'i'; in scope for proto op exprs
  /** Per-iteration ADVANCE of the iteration origin (the stride between copies).
   *  Realised as a leading rel move; 0/absent ⇒ pure self-tiling (see §1.2). */
  dr?: ArgValue;
  dz?: ArgValue;
  bindings?: PolyRepeatBinding[];  // reuse poly_repeat's binding type verbatim
  /** The prototype run to repeat — same op vocabulary as a sketch, but NO
   *  nested repeat-refs (v1, see §4). */
  ops: SketchOpEntry[];
};

// One flat entry in the parent sketch's ops list (discriminant stays `op`).
export type SketchRepeatRef = { op: 'repeat-ref'; sourceId: NodeId };

// Parent sketch ops widen to include the ref:
export type SketchNode = {
  id: NodeId; type: 'sketch';
  ops: Array<SketchOpEntry | SketchRepeatRef>;
  segments?: ArgValue;
  scaleX?: ArgValue;   // unchanged — applied post-expansion in compileSketch
  scaleY?: ArgValue;
};
```

`GraphNode` union gains `SketchRepeatNode`. `SketchRepeatRef` keeps `op` as its
discriminant so the existing `if (op.op === 'line' || …)` switches in emit +
markup get a clean new branch and never mistake it for a point op.

### 1.1 How `compileSketch` consumes it — it DOESN'T (expand upstream)

`compileSketch` / `sketch.ts` stay **untouched**. The repeat is expanded into a
flat numeric op stream BEFORE it reaches `compileSketch`, at the two existing
expansion sites (emit + client preview). Because expansion produces one
continuous flat op list, `toVerts`'s running cursor walks across iteration
boundaries for free → rel-mode prototype ops **tile seamlessly** (the end of
iteration *i* is the start of *i+1*). This is the key reuse: no new compile math,
and `scaleX/scaleY` keep working unchanged (they multiply the final points).

### 1.2 The per-iteration advance (tri-modal — document next to the helper)

The stride `(dr,dz)` is the offset of each iteration's ORIGIN:

- **dr=dz=0 (threads / continuous serrations):** the prototype is authored so its
  **own rel ops sum to the pitch** (returns to baseline and steps along by one
  period). Iterations tile with no synthetic vertex.
- **dr/dz set (racks / combs with a land between teeth):** expansion **prepends
  one leading `{op:'line', mode:'rel', r:dr, z:dz}`** to each iteration, creating
  the land/gap vertex between copies (real, usually-wanted geometry).
- **Tapering / non-uniform:** because `i` and `NPts` are in scope (poly_repeat
  parity), proto coords can be exprs like `r: baseR + i*taper` — the advanced
  escape hatch; `dr/dz` is the common-case sugar.

Default new repeats to `count=4, dr=0, dz=<pitch>` with a 2-op V-tooth prototype
so the first drop bakes something visibly periodic.

## 2. Editor UI (lands in SketchEditorPane + SketchNodeCard)

Follow the `poly_repeat` UX beat-for-beat (separate card + wire), adapted to the
sketch card's op-row chrome. **All UI work is in the extracted components now** —
no GraphEditorPane edits beyond, if needed, registering the new node type in the
node-card dispatcher (`NodeCard.svelte`) and the shell's ƒ-popover plumbing.

- **`+ repeat` affordance.** Add a `+ repeat` button to the sketch-card footers
  in `SketchNodeCard.svelte` and `SketchEditorPane.svelte`, next to `+ line /
  + spline / + fillet / + chamfer`. Also a `↻` button in the editor's left tool
  rail for discoverability. It calls a new `addSketchRepeat(graph, sketchId,
  afterIdx?)` mutator mirroring `addPolygonRepeat`: creates the floating
  `SketchRepeatNode` ~280px right + a per-sibling vertical fan, seeds a default
  prototype, and splices a `{op:'repeat-ref', sourceId}` entry into the parent
  `ops` at `afterIdx`.
- **The ref row in the parent card.** Renders as a single compact summary row
  (new `sketchEntryH` case, ~40px, like `polyEntryH`'s repeat-ref): `↻ ×{count}`
  + a small `Δz {dz}` stride chip + a left-edge **input socket** (wire the
  source's output here) + move ▲▼ / × buttons. It does NOT expose the prototype
  ops inline (those live on the repeat card) — keeps the flat socket math intact.
- **The `sketch_repeat` card.** Add a render arm (a new `SketchRepeatCard.svelte`
  or a branch in `NodeCard.svelte`): a PARAMS strip (`count` ArgValue + ƒ + wire
  socket, `loopVar`, `dr`/`dz` advance + ƒ, optional bindings — reuse the
  poly_repeat bindings UI), a **prototype ops list** rendered with the EXISTING
  op-row markup driven by `sketchColLayout(repeatNode.ops, 1)` (so sockets reuse
  the layout contract unchanged — just pass the repeat node + its ops), the same
  `+ line / + spline / + fillet / + chamfer` footer minus `+ repeat` (no
  nesting), and an **output socket** wired to the parent ref row.
- **Socket alignment.** Because the ref row is ONE flat entry and the prototype
  ops use the SAME `sketchColLayout`, the `sketch-layout.ts` pixel contract is
  untouched — only a new `sketchEntryH` branch for `op==='repeat-ref'`. Verify
  visually in 1/2/3 columns (the column-layout socket math bit us before —
  memory `entry_idx_eval_idx_gotcha`).

### UI mock (parent sketch card + linked repeat card)

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

## 3. Emit + the two expansion sites (must agree)

### 3.1 Emit (`composition-emit.ts` `case 'sketch'`)

When walking the parent `ops`, a `repeat-ref` expands to an `Array.from` spread
spliced into the `sketch([...])` array — identical shape to the polygon spread,
but each iteration returns an **array of op objects** that is `.flat()`-ened:

```js
sketch([
  { op:'line', r:0.5, z:0 },
  { op:'line', r:0.5, z:2 },
  ...Array.from({ length: (p.teeth) }, (_, i) => {
    const NPts = (p.teeth);
    return [
      { op:'line', mode:'rel', r:(p.dr), z:(p.dz) },     // only if dr||dz
      { op:'line', mode:'rel', r: 0.3, z: 0.05 },        // prototype ops,
      { op:'line', mode:'rel', r:-0.3, z: 0.05 },        // i/NPts in scope
    ];
  }).flat(),
  { op:'line', r:1.5, z:8 },
], 64, sx, sy)
```

- Add `case 'sketch_repeat'` to the `serialiseGraph` type→tag map.
- Factor the per-op object renderer out of `case 'sketch'` into a shared
  `emitSketchOpObject(op)` so the parent loop and the repeat spread share ONE
  serializer.
- Mark the source node **consumed** so it never emits as an Output: extend
  `computeConsumedSet` — for a `sketch` node, scan its `ops` and add each
  `repeat-ref`'s `sourceId` (greys-out the source's delete button, poly_repeat
  analog).

### 3.2 Client live preview (`SketchState.sketchEditor` derived)

The `sketchEditor` derived (now in `sketch-state.svelte.ts`, NOT GraphEditorPane)
must, for a `repeat-ref` entry, look up the `SketchRepeatNode`, evaluate `count`
numerically (param scope + the coord expr evaluator it already uses), loop
`i=0..count-1` binding `loopVar`/`NPts`/bindings, resolve each prototype op's
ArgValues to numbers (prepending the `(dr,dz)` rel move when set), and
concatenate. Factor this into a **pure shared expander** so the preview and emit
cannot drift:

```ts
// src/lib/cad/sketch-repeat.ts — pure, unit-tested. Client preview calls it;
// the emit path produces the equivalent SOURCE. A round-trip test asserts they
// compile to identical points.
export function expandSketchOps(
  ops: Array<SketchOpEntry | SketchRepeatRef>,
  lookup: (id: NodeId) => SketchRepeatNode | undefined,
  evalArg: (a: ArgValue, scope: Record<string, number>) => number,
  scope: Record<string, number>,
): SketchOp[];   // flat numeric ops ready for compileSketch
```

This is the **highest-correctness-risk surface**: the emitted `Array.from` source
and the client `expandSketchOps` must yield byte-identical geometry. Lock it with
a unit test (PR-1) that runs both a hand-unrolled ops list and the
repeat-expanded one through `compileSketch` and asserts equal points.

### 3.3 Round-trip

The `meta.graph` block is the source of truth (same as poly_repeat) — the
`Array.from` body is lossy. Ensure: (a) `serialiseGraph` writes the
`SketchRepeatNode` + the parent's `repeat-ref` entry; (b) `hydrateGraph`
reconstructs both (the ref survives as a plain `ops` entry; the node is a normal
graph node); (c) a hydrate guard drops a `repeat-ref` whose `sourceId` is missing
(defensive, mirrors poly_repeat). No legacy migration needed — new entry kind.

## 4. Edge cases

- **count = 0** — `Array.from({length:0})` ⇒ `[]`; the repeat contributes no ops.
  If that leaves <2 vertices total, `compileSketch` returns the degenerate point
  list (already handled). Clamp negative `count` → 0 at eval.
- **count = 1** — one prototype copy, `i=0`, no stride; equivalent to inlining the
  prototype once. Valid.
- **Nested repeats — FORBID in v1.** A `SketchRepeatNode.ops` may not contain a
  `repeat-ref`; the repeat card's footer omits `+ repeat`, and emit/expander skip
  any stray nested ref with a `// SKIPPED nested sketch repeat` comment.
- **fillet/chamfer at a repeat boundary** — corner mods attach to the
  **preceding** vertex (`toVerts`). Because expansion is a flat splice this works
  with no special-casing: a corner op as the FIRST prototype op rounds the
  **seam** between successive teeth; mid-prototype rounds a within-tooth corner;
  LAST rounds the tooth's final vertex. Document + add a seam-fillet test.
- **rel-mode accumulation across iterations** — the flat-splice + continuous
  cursor make this automatic; this is how threads tile. Unit-test that 4 copies of
  a `(Δr,Δz)`-summing prototype reach the expected final z.
- **The closing point** — `compileSketch` closes the loop. A repeat that walks
  monotonically down z does NOT close itself; the surrounding ops must bring the
  profile back to start (revolve half-section: out → down through teeth → in → up
  the axis). Unchanged author responsibility — call out in the doc + starter
  template.
- **abs prototype ops** — allowed but discouraged mid-sketch; with a non-zero
  stride an abs op ignores the advance. The UI should default prototype point ops
  to `mode:'rel'` and surface a hint.
- **scaleX/scaleY interaction** — scale is a FINAL multiply on the compiled
  points, downstream of expansion, so it scales the whole tiled profile uniformly.
  No special-casing; add one assertion to the round-trip test that a scaled
  repeat == scale(expanded repeat).

## 5. Risk-sequenced PRs

Each ends green on `bun run build` + `bun run test` (vitest — NOT bare
`bun test`) + `bun run test:graph` where relevant.

1. **PR-1 — Model + pure expander (no UI, no emit).** Add `SketchRepeatNode`,
   `SketchRepeatRef`, widen `SketchNode.ops`, extend the `GraphNode` union, add
   the `sketchEntryH` `repeat-ref` case. Add `src/lib/cad/sketch-repeat.ts` with
   `expandSketchOps` + the node mutators (`addSketchRepeat`,
   `setSketchRepeatCount/LoopVar/Advance`, prototype-op mutators that delegate to
   the existing sketch-op mutators keyed by the repeat node id, bindings reuse).
   **No Svelte changes.** New `sketch-repeat.test.ts`: hand-unrolled vs
   repeat-expanded compile to identical `(r,z)`; count 0/1; rel tiling sum; seam
   fillet; scaled-repeat. LOWEST risk; this is the load-bearing correctness seam.
2. **PR-2 — Emit + round-trip.** Factor `emitSketchOpObject`; add the
   `repeat-ref` `Array.from` spread in `case 'sketch'`; add `case 'sketch_repeat'`
   to the serialise type map; extend `computeConsumedSet`; hydrate guard. Test:
   emit → sandbox-eval the body → equals `expandSketchOps` + `compileSketch`
   (closes the loop with PR-1's expander). Save→load round-trip preserves the
   repeat (no loss), mirroring the poly_repeat round-trip test.
3. **PR-3 — Editor UI (now unblocked).** `+ repeat` in both footers + the `↻`
   rail button (`SketchNodeCard.svelte` + `SketchEditorPane.svelte`); the compact
   `repeat-ref` summary row in the parent card; the `sketch_repeat` card (PARAMS
   strip + prototype op list via `sketchColLayout` + output socket); the wire
   pairing (per-pane `WireState`); the ƒ-popover for prototype coords routed
   through the shell `sketch.sketchExprPop` (the Phase-E pattern). Verify sockets
   sit on rows in 1/2/3 columns and the live preview matches the baked geometry,
   in BOTH `/graph-editor` and multi-instance `/primitives`.
4. **PR-4 (optional) — starter template + docs.** A "threaded section" sketch
   preset (out → repeat V-teeth down z → in → close) so the feature has a
   one-click exemplar; note it in `docs/CAD_AUTHORING.md`.

## 6. Files this will touch (for the implementer)

- `src/lib/cad/composition-graph-types.ts` — `SketchRepeatNode`,
  `SketchRepeatRef`, widen `SketchNode.ops`, extend `GraphNode`.
- `src/lib/cad/composition-graph-mutate.ts` — `addSketchRepeat` (model on
  `addPolygonRepeat`), repeat-node setters, prototype-op mutators, hydrate guard.
- `src/lib/cad/sketch-repeat.ts` — **NEW**: pure `expandSketchOps` (keeps
  `sketch.ts` lean).
- `src/lib/cad/sketch.ts` — UNCHANGED (re-exports `SketchOp` for the expander).
- `src/lib/cad/composition-emit.ts` — `case 'sketch'` spread, `emitSketchOpObject`
  factor, `serialiseGraph` map, `computeConsumedSet`.
- `src/lib/cad/sketch-layout.ts` — `sketchEntryH` `repeat-ref` case.
- `src/lib/shared/graph-editor/sketch-state.svelte.ts` — `sketchEditor` derived
  calls `expandSketchOps`; add repeat-node mutation helpers if the class owns them.
- `src/lib/shared/graph-editor/SketchNodeCard.svelte` +
  `SketchEditorPane.svelte` — `+ repeat` footer, ref summary row.
- `src/lib/shared/graph-editor/NodeCard.svelte` — the `sketch_repeat` card render
  arm (or a new `SketchRepeatCard.svelte`).
- Tests: new `src/lib/cad/sketch-repeat.test.ts`; extend
  `tests/e2e/graph-editor.spec.ts`.

## 7. Relationship to other roadmap items

- **B.4 (id 644) `repeat_with_data`** is a DIFFERENT feature — a heterogeneous,
  data-driven repeat at the *composition-graph* level (mixed BHA parts). This
  (B.2) is a homogeneous tiler in the *sketch* surface. They share only the word
  "repeat"; no code overlap beyond the `PolyRepeatBinding` type reuse.
- **B.5 (modularize round 2)** already shipped the SketchEditorPane extraction
  that unblocks PR-3 here. No further dependency.
