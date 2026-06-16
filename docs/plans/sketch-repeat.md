# Sketch REPEAT — repeat a span of sketch ops N times (plan)

> Status: design (read-only study, 2026-06-16). Adds a **REPEAT** affordance to
> the 2D sketch editor so a contiguous run of sketch ops (line / spline /
> fillet / chamfer) tiles N times — threads, serrations, racks, stacked
> grooves — directly analogous to the polygon `poly_repeat` loop (#157), but for
> the `(r,z)` sketch profile.
>
> **Lands AFTER the P1 GraphEditorPane modularization** (the sketch UI is slated
> to move into a `SketchEditorPane` — memory `todo_modularize_grapheditorpane`).
> Build the *engine + emit* PRs first (they don't touch the Svelte file); do the
> UI PR against whichever file owns the sketch card at that time.

## 0. What exists today (the surfaces this feature plugs into)

- **Op model** — `src/lib/cad/composition-graph.ts`:
  - `SketchOpEntry` = discriminated union on `op`: `line` / `spline` (each with
    `r,z` ArgValues + optional `mode:'abs'|'rel'`; spline also `pts`/`h0`/`h1`),
    `fillet` (`radius`), `chamfer` (`dist`). (L192-206)
  - `SketchNode = { id; type:'sketch'; ops: SketchOpEntry[]; segments? }` (L207).
  - Mutators: `addSketch`, `addSketchOp`, `setSketchOpField`, `setSketchOpMode`,
    `setSketchOpKind`, `moveSketchOp`, `removeSketchOp`, `setSketchSegments`,
    spline-point helpers (L830-959).
- **Compile** — `src/lib/cad/sketch.ts`: `compileSketch(ops: SketchOp[], segments)`
  → `(r,z)[]`. `toVerts` walks ops with a **running cursor**: `mode:'rel'` ops
  accumulate `(Δr,Δz)` from the previous vertex; the first point op is forced
  absolute. fillet/chamfer attach a `corner` mod to the **preceding** vertex.
  The op list is treated as a **closed loop** (`% n` wraparound in the
  fillet/chamfer + chain sampling). compileSketch sees **numeric** ops only.
- **Emit** — `src/lib/cad/composition-emit.ts` `case 'sketch'` (L492-519): emits
  a runtime `sketch([ {op:'line', r:…, z:…}, … ], seg)` call. Each field goes
  through `emitValueExpr(ArgValue)`. The injected sandbox `sketch(...)` runs
  `compileSketch`. The sketch node is wired to a consumer via the `__POLY__<id>`
  sentinel (L332-339, same channel polygon uses).
- **Live preview** — `GraphEditorPane.svelte` `sketchEditor` derived (~L3154):
  maps `node.ops` → resolved **numeric** `SketchOp[]` via `sketchParamScope()`
  and calls `compileSketch` **client-side** for the editor outline. (This is a
  SECOND expansion site that must agree with emit — see §3.)
- **Card geometry** — `src/lib/cad/sketch-layout.ts`: `sketchEntryH(op)` (24 for
  corner ops, else 45) + `sketchColLayout(ops, cols)` is the SINGLE source of
  truth for row Y / column X; `GraphEditorPane` `sketchSock*`/`nodeSize`/
  `miniLayout` all delegate to it. Sockets are SVG circles keyed by a **flat
  integer `idx`** into `ops`.

### The REFERENCE pattern — polygon `poly_repeat` (#157)

- `PolyRepeatNode = { id; type:'poly_repeat'; count; loopVar; r; z; bindings? }`
  — a **separate free-floating card** (`addPolygonRepeat`, L1114): NOT appended
  to any list, so it never shows as an Output; referenced only by a ref entry.
- `PolygonRepeatRef = { kind:'repeat-ref'; sourceId }` — ONE entry in the
  polygon's flat `points[]` (so `polyEntryH` just adds a `repeat-ref`=38 height
  case; flat-idx socket math is preserved).
- Emit (`composition-emit.ts` ~L478, `composition-emit-profile.ts` L142-167):
  the ref expands to a **`...Array.from({ length: count }, (_, i) => { const
  NPts = count; …bindings; return [r, z]; })`** spread spliced into the points
  array. `NPts` + `loopVar` + bindings are in scope for the `i`-indexed exprs.
- Round-trip: the body is **regenerated from `meta.graph`** on load; the
  `Array.from` text is lossy but the graph block is the source of truth. Hydrate
  reconstructs both nodes; `serialiseGraph` type→tag map at L629.

## 1. Op model — chosen design

**Mirror `poly_repeat` exactly: a separate `sketch_repeat` card + a flat
`repeat-ref` op entry.** This is deliberately NOT a nested child-ops array
inside the parent sketch, because the whole sketch card geometry
(`sketchColLayout`, `sketchSock*`, `sketchEntryH`) keys on a **flat integer
`idx`** — nesting a sub-array would break every socket. A flat ref entry costs
only one new `sketchEntryH` case, exactly as `poly_repeat` did for the polygon.

### Types (composition-graph.ts)

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
  bindings?: PolyRepeatBinding[];  // reuse poly_repeat's binding type
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
};
```

`GraphNode` union gains `SketchRepeatNode` (L215). `SketchRepeatRef` keeps `op`
as its discriminant so the existing `if (op.op === 'line' || …)` switches in
emit + markup get a clean new branch and never mistake it for a point op.

### 1.1 How `compileSketch` consumes it — it DOESN'T (expand upstream)

compileSketch / sketch.ts stay **untouched**. The repeat is expanded into a
flat numeric op stream BEFORE it reaches `compileSketch`, at the two existing
expansion sites (emit + client preview). Because expansion produces one
continuous flat op list, `toVerts`'s running cursor walks across iteration
boundaries for free → rel-mode prototype ops **tile seamlessly** (the end of
iteration *i* is the start of *i+1*). This is the key reuse: no new compile math.

### 1.2 The per-iteration advance

Each iteration emits the prototype ops with `loopVar`/`NPts`/bindings in scope.
The stride `(dr,dz)` is the offset of each iteration's ORIGIN:

- **dr=dz=0 (recommended for threads / continuous serrations):** the prototype
  is authored so its **own rel ops sum to the pitch** (it returns to baseline
  and steps along by one period). Iterations tile with no synthetic vertex.
- **dr/dz set (racks / combs with a land between teeth):** expansion **prepends
  one leading `{op:'line', mode:'rel', r:dr, z:dz}`** to each iteration after
  the implicit start, creating the land/gap vertex between copies. This is real,
  usually-wanted geometry (the flat between rack teeth).
- **Tapering / non-uniform:** because `i` and `NPts` are in scope (poly_repeat
  parity), proto coords can be exprs like `r: baseR + i*taper` — the advanced
  escape hatch; `dr/dz` is the common-case sugar.

Document this tri-modal behaviour next to the helper; default new repeats to
`count=4, dr=0, dz=<pitch>` with a 2-op prototype (a simple V tooth) so the
first drop bakes something visibly periodic.

## 2. Editor UI

Follow the `poly_repeat` UX beat-for-beat (wire + separate card), adapted to the
sketch card's op-row chrome.

- **`+ repeat` affordance.** Add a `+ repeat` button to BOTH sketch-card footers
  (`.ge-sketch-foot`, the on-graph card ~L6382 and the full-tab card ~L6981),
  next to `+ line / + spline / + fillet / + chamfer`. Also a `↻` button in the
  full-tab left tool rail (`.ge-sketch-vtools`, ~L6750) for discoverability. It
  calls a new `addSketchRepeat(graph, sketchId, afterIdx?)` mutator that mirrors
  `addPolygonRepeat`: creates the floating `SketchRepeatNode` 280px right + a
  per-sibling 40px vertical fan, seeds a default prototype, and splices a
  `{op:'repeat-ref', sourceId}` entry into the parent `ops` at `afterIdx`.
- **The ref row in the parent card.** Renders as a single compact summary row
  (new `sketchEntryH` case, ~40px, like `polyEntryH`'s repeat-ref=38): `↻ ×{count}`
  + a small `Δz {dz}` stride chip + a left-edge **input socket** (wire the
  source's output here) + move ▲▼ / × buttons. It does NOT expose the prototype
  ops inline (those live on the repeat card) — keeps the flat socket math intact.
- **The repeat card.** A `SketchRepeatNode` card renders:
  - a PARAMS strip: `count` (ArgValue input + ƒ + wire socket), `loopVar`,
    `dr` / `dz` advance inputs (+ ƒ), and optional bindings (reuse the
    poly_repeat bindings UI verbatim);
  - a **prototype ops list** rendered with the EXISTING op-row markup
    (`.ge-sketch-vtx` rows) driven by `sketchColLayout(repeatNode.ops, 1)` — so
    its sockets reuse `sketchSock*` unchanged (just pass the repeat node + its
    ops). The same `+ line / + spline / + fillet / + chamfer` footer, minus
    `+ repeat` (no nesting, §4);
  - an **output socket** wired to the parent ref row (paired exactly like
    poly_repeat → polygon).
- **Collapse/expand.** Reuse whatever card-collapse the canvas already has; the
  prototype list is the collapsible body. The parent's ref row is always the
  one-line summary.
- **Socket alignment.** Because the ref row is ONE flat entry and the prototype
  ops are laid out by the SAME `sketchColLayout` on the repeat card, the pixel
  contract in `sketch-layout.ts` is untouched — only a new `sketchEntryH`
  branch for `op==='repeat-ref'`. Verify visually in 1/2/3 columns.

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

### 3.1 Emit (composition-emit.ts `case 'sketch'`)

When walking the parent `ops`, a `repeat-ref` expands to an `Array.from` spread
spliced into the `sketch([...])` array — identical shape to the polygon spread,
but each iteration returns an **array of op objects** that is `.flat()`-ened:

```js
sketch([
  { op:'line', r:0.5, z:0 },
  { op:'line', r:0.5, z:2 },
  ...Array.from({ length: (p.teeth) }, (_, i) => {
    const NPts = (p.teeth);
    // optional leading advance when dr/dz set:
    return [
      { op:'line', mode:'rel', r:(p.dr), z:(p.dz) },     // only if dr||dz
      { op:'line', mode:'rel', r: 0.3, z: 0.05 },        // prototype ops,
      { op:'line', mode:'rel', r:-0.3, z: 0.05 },        // i/NPts in scope
    ];
  }).flat(),
  { op:'line', r:1.5, z:8 },
], 64)
```

Add a `case 'sketch_repeat'` to the `serialiseGraph` type→tag map (L629) and a
helper that renders a `SketchRepeatNode`'s prototype op objects (reuse the
existing per-op object renderer from `case 'sketch'` — factor it into a shared
`emitSketchOpObject(op)` so the parent loop and the repeat spread share one
serializer). Mark the source node **consumed** so it never emits as an Output:
extend `computeConsumedSet` (L565) — for a `sketch` node, scan its `ops` and add
each `repeat-ref`'s `sourceId` (the `poly_repeat` analog; note poly_repeat nodes
are excluded by simply never being root children — do the same, but ALSO add to
the consumed set so `consumedByCall` greys-out the ref's source delete button).

### 3.2 Client live preview (`sketchEditor` derived)

The `sketchEditor` derived (~L3154) currently maps `node.ops` →
numeric `SketchOp[]`. It must now, for a `repeat-ref` entry, look up the
`SketchRepeatNode`, evaluate `count` numerically (via `sketchParamScope()` +
the same expr evaluator already used for coords), loop `i=0..count-1` binding
`loopVar`/`NPts`/bindings, resolve each prototype op's ArgValues to numbers
(prepending the `(dr,dz)` rel move when set), and concatenate. Factor this into a
**pure shared expander**:

```ts
// pure, unit-tested — used by the client preview; the emit path produces the
// equivalent SOURCE. A round-trip test asserts they compile identically.
export function expandSketchOps(
  ops: Array<SketchOpEntry | SketchRepeatRef>,
  lookup: (id: NodeId) => SketchRepeatNode | undefined,
  evalArg: (a: ArgValue, scope: Record<string, number>) => number,
  scope: Record<string, number>,
): SketchOp[];   // flat numeric ops ready for compileSketch
```

This is the **highest-correctness-risk surface**: the emitted `Array.from`
source and the client `expandSketchOps` must yield byte-identical geometry. Lock
it with a unit test (§5, PR-1) that runs both an inline hand-unrolled ops list
and the repeat-expanded one through `compileSketch` and asserts equal points.

### 3.3 Round-trip

The `meta.graph` block is the source of truth (same as poly_repeat) — the
`Array.from` body is lossy. Ensure: (a) `serialiseGraph` writes the
`SketchRepeatNode` + the parent's `repeat-ref` entry; (b) `hydrateGraph`
reconstructs both (the ref already survives as a plain `ops` entry; the node is
a normal graph node). Add a hydrate guard that drops a `repeat-ref` whose
`sourceId` is missing (defensive, mirrors poly_repeat). No legacy migration is
needed — this is a new entry kind; old sketches have none.

## 4. Edge cases

- **count = 0** — `Array.from({length:0})` ⇒ `[]`; the repeat contributes no
  ops. If that leaves <2 vertices total, `compileSketch` returns the degenerate
  point list (already handled, L133). Clamp negative `count` → 0 at eval.
- **count = 1** — one prototype copy, `i=0`, no stride applied; equivalent to
  inlining the prototype once. Valid.
- **Nested repeats — FORBID in v1.** A `SketchRepeatNode.ops` may not contain a
  `repeat-ref`; the repeat card's footer omits `+ repeat`, and emit/expander
  skip any stray nested ref with a `// SKIPPED nested sketch repeat` comment
  (mirrors poly_repeat, which also has no nesting). Revisit only on demand.
- **fillet/chamfer at a repeat boundary** — corner mods attach to the
  **preceding** vertex (toVerts). Because expansion is a flat splice, this works
  with no special-casing, and the semantics are useful:
  - a corner op as the FIRST prototype op rounds the **seam** between successive
    teeth (the join from iteration *i*'s last vertex to *i+1*'s first);
  - a corner op mid-prototype rounds a within-tooth corner;
  - a corner op as the LAST prototype op rounds the tooth's final vertex; on the
    last iteration it rounds the vertex before whatever op follows the ref (or
    the closing point). Document; add a test for the seam fillet.
- **rel-mode accumulation across iterations** — the flat-splice + continuous
  cursor make this automatic; this is precisely how threads tile. Unit-test that
  4 copies of a `(Δr,Δz)`-summing prototype reach the expected final z.
- **The closing point** — compileSketch closes the loop. A repeat that walks
  monotonically down z does NOT close itself; the surrounding ops must bring the
  profile back to the start (for a revolve half-section: out → down through the
  teeth → in → up the axis). Unchanged author responsibility — call it out in
  the doc + a starter template.
- **abs prototype ops** — allowed but discouraged mid-sketch; with a non-zero
  stride an abs op ignores the advance (advance only shifts the implicit
  origin/leading rel move). The UI should default prototype point ops to
  `mode:'rel'` and surface a hint.

## 5. Risk-sequenced PRs (each ends green on `bun run build` + `bun test` /
`bun run test:graph`)

1. **Model + compile expander (PURE, no UI, no emit).** Add `SketchRepeatNode`,
   `SketchRepeatRef`, widen `SketchNode.ops`, extend the `GraphNode` union, add
   `sketchEntryH` `repeat-ref` case. Add `expandSketchOps` (§3.2) + the
   node mutators (`addSketchRepeat`, `setSketchRepeatCount/LoopVar/Advance`,
   prototype-op mutators that delegate to the existing sketch-op mutators keyed
   by the repeat node id, bindings reuse). **No Svelte changes.** Vitest
   (`sketch-repeat.test.ts`, model on `sketch.test.ts`): hand-unrolled ops vs
   repeat-expanded ops compile to identical `(r,z)`; count 0/1; rel tiling sum;
   seam fillet. LOWEST risk; this is the load-bearing correctness seam.
2. **Emit + round-trip.** Factor `emitSketchOpObject`; add the `repeat-ref`
   `Array.from` spread in `case 'sketch'`; add `case 'sketch_repeat'` to the
   serialise type map; extend `computeConsumedSet`/`consumedByCall`; hydrate
   guard. Test: emit → sandbox-eval the body → equals `expandSketchOps` +
   `compileSketch` (closes the loop with PR-1's expander). Save→load round-trip
   preserves the repeat (no loss), mirroring the poly_repeat round-trip test.
3. **Editor UI.** `+ repeat` in both footers + the `↻` rail button; the compact
   `repeat-ref` summary row in the parent card; the `SketchRepeatNode` card
   (PARAMS strip + prototype op list via `sketchColLayout` + output socket); the
   wire pairing; collapse/expand. Verify sockets sit on rows in 1/2/3 columns
   and the live preview matches the baked geometry. **Do this PR against the
   file that owns the sketch card AFTER modularization** (`SketchEditorPane` if
   the split has landed; otherwise `GraphEditorPane.svelte`) — coordinate with
   `docs/plans/modularize.md` / `todo_modularize_grapheditorpane`.
4. **(Optional) starter template + docs.** A "threaded section" sketch preset
   (out → repeat V-teeth down z → in → close) so the feature has a one-click
   exemplar; note it in `docs/CAD_AUTHORING.md`.

## 6. Files this will touch (for the implementer)

- `src/lib/cad/composition-graph.ts` — types (~L185-215), mutators (~L830-959),
  `addSketchRepeat` (model on `addPolygonRepeat` L1114), hydrate guard.
- `src/lib/cad/sketch.ts` — UNCHANGED (re-exports `SketchOp` consumed by the
  expander); optionally house `expandSketchOps` here or in a new
  `sketch-repeat.ts` to keep sketch.ts lean.
- `src/lib/cad/composition-emit.ts` — `case 'sketch'` spread (~L492-519),
  `emitSketchOpObject` factor, `serialiseGraph` map (L629), `computeConsumedSet`
  (L565).
- `src/lib/cad/sketch-layout.ts` — `sketchEntryH` `repeat-ref` case (L42-44).
- The sketch-card owner (`GraphEditorPane.svelte` today: footers ~L6382/L6981,
  rail ~L6750, op-row markup ~L6334/L6933, `sketchEditor` derived ~L3154) — or
  its post-modularization successor `SketchEditorPane`.
- Tests: new `src/lib/cad/sketch-repeat.test.ts`; extend `tests/e2e/graph-editor.spec.ts`.
```
