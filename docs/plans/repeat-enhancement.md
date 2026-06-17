# Repeat enhancement — multi-child body + PARAMS/PARTS sections + editable code

> Status: **design / execution-ready** (2026-06-17). Builds on the partly-built
> Repeat windowed editor (`docs/plans/repeat-and-sketch-repeat.md` §2, currently
> uncommitted in `GraphEditorPane.svelte`). This doc adds three capabilities the
> user specified this session. Anchor on type/function/CSS-class names, not line
> numbers — the editor is large and drifts.

## 0. Requirements (verbatim intent, captured 2026-06-17)

1. **Repeat accepts multiple children**, not just one.
2. The **Repeat card has two sections — PARAMS and PARTS** — each
   **dynamically growable** (add a param row / add a part).
3. **Edit mode (windowed editor)** surfaces both sections, AND a **code view of
   the per-iteration body that is editable**.
4. The editable code **initially shows the array of parts** (`place([…])`),
   which the user can then hand-edit.
5. **Confirmed (AskUserQuestion):** the editable code controls the
   **per-iteration body ONLY**. `count` / `op` / `loopVar` remain structured
   controls above the tabs.

### Semantics decided
- **Per-iteration combine of the PARTS = `place([...])`** — `place` →
  `M.compose` (`manifold-helpers.ts`), which combines parts **in their own
  positions** (no mating, no boolean), i.e. a group. Then the Repeat's existing
  `op` (`stack` / `list` / `place`) combines the N iterations.
- **Backward compatibility is mandatory** (drilling-string parts use Repeat):
  a Repeat with exactly one part, no `bodyExpr`, and no modifiers/bindings/
  loopVar MUST emit **byte-identical** to today (`Array.from({length:n}, () =>
  <child>)`).
- **PARAMS section = the existing `bindings`** (named values, in scope as
  `i`/`N` + user names throughout the loop body AND modifiers). No new model
  field — we surface `bindings` as the card's "PARAMS" section. **Each row's
  VALUE is an `ArgValue` and MUST be wireable** (ƒ-popup → literal / expr /
  `param` link to a graph PARAMS slider). User intent: link a value INTO the
  repeat (e.g. `h = p.asmHeight`) and use it per-iteration (`mv [0,0, i*h]` to
  offset each copy).
  - **Now:** value = literal / expr / wired graph-param.
  - **Later (keep value pluggable):** value = a *calculated field* / measured
    geometry (e.g. another part's bbox height) — lands with the
    expressions/calculated-fields system (TODO #10 / PARKED #3). No rework: the
    PARAM row already takes any `ArgValue`.
- **PARTS section = `children: NodeId[]`** (new) — replaces single `child`.

---

## 1. Model layer (`src/lib/cad/`)

### 1.1 `composition-graph-types.ts` — `RepeatNode`
Change the shape, keep legacy `child` resolvable:
```ts
export type RepeatNode = {
  id: NodeId; type: 'repeat';
  children: NodeId[];          // NEW — the repeated unit (place([...]) when >1)
  child?: NodeId;              // LEGACY — hydrate folds into children[]; never written by new code
  count: ArgValue; op?: RepeatOp;
  loopVar?: string;
  bindings?: PolyRepeatBinding[];   // = the "PARAMS" section
  modifiers?: NodeTransform[];
  bodyExpr?: string;           // NEW — raw per-iteration body override (verbatim emit); absent ⇒ derive from children
};
```
Update the doc-comment block to describe `children` + `bodyExpr`.

### 1.2 `composition-graph-hydrate.ts` — fold legacy `child`
In the per-node hydrate pass, for `type==='repeat'`: if `children` is absent,
set `children = node.child ? [node.child] : []` and delete `child`. (Mirror the
`mv/rot → txfmn` legacy-fold already there.) This makes every existing saved
part load as a one-element `children` array with zero migration churn.

### 1.3 `composition-graph-mutate.ts`
- `addRepeat(graph, child, …)` / `addRepeatPlaceholder`: build
  `children: child ? [child] : []` instead of `child`.
- `setRepeatChild(graph, id, childId)`: **keep** as "set/replace the FIRST
  part" for the wire path that targets the primary socket — but the wire should
  now **append** (see 3.3). Implement as:
  - `addRepeatChild(graph, id, childId)` → `{ ...n, children: [...n.children, childId] }`
  - `removeRepeatChildAt(graph, id, idx)` → splice
  - `moveRepeatChild(graph, id, idx, dir)` → reorder (parts order = `place` order)
  - keep `setRepeatChild` delegating to a replace-or-append for back-compat.
- `setRepeatBodyExpr(graph, id, src: string)` → `{ ...n, bodyExpr: src }`
- `clearRepeatBodyExpr(graph, id)` → strip the field (back to wired body).
- All via the existing `updateRepeat()` immutable+`finalize` wrapper.

### 1.4 `composition-emit.ts`
Four touch points (search `case 'repeat'` / `repeat`):

a. **Validation** (`~L138`): currently `if (!has(node.child))`. Change to: for
   each `c` of `node.children`, push `missing-node` if `!has(c)`. Empty
   `children` AND no `bodyExpr` ⇒ a `child`-slot error ("wire a part").

b. **`consumersOf`** (`~L278`) and **`computeConsumedSet`** (`~L641`): replace
   `if (n.child) …add(n.child)` with a loop over `n.children`. Every part is
   consumed by the Repeat (so parts don't double-emit as Outputs and their
   delete buttons grey).

c. **`emitNodeExpr` `case 'repeat'`** (`~L471`): build the per-iteration **unit**:
   ```ts
   const parts = node.children.map((c,i)=>ref(c,`children[${i}]`));
   const unit = node.bodyExpr?.trim()
     ? node.bodyExpr                                  // raw override, verbatim
     : parts.length === 1 ? parts[0] : `place([${parts.join(', ')}])`;
   ```
   Then the EXISTING modifier-fold wraps `unit` (rename local `child` → `unit`).
   Backward-compat fast path stays: `bodyExpr` empty && one part && no
   mods/binds/loopVar ⇒ `Array.from({length:count}, () => ${unit})`.
   **`bodyExpr` note:** it is raw JS executed in the part sandbox — same trust
   model as any Call arg expression. `i`, `N`, the bindings, and the part var
   names are all in scope inside the `Array.from` callback, so a hand-edited
   body can reference them. Document this in the code box hint.

### 1.5 `composition-layout.ts` — predecessors
`predecessorsOf` / the `case` that returns `[n.child]` (`~L114`): return
`n.children.filter(c => graph.nodes[c])`. Also the auto-layout obstacle pass
(`~L70`). Without this, parts beyond the first don't get edges and auto-layout
ignores them.

### 1.6 reachability / delete-cascade (`composition-graph-mutate.ts ~L1328`)
`if (node.child) visit(node.child)` → `node.children?.forEach(visit)`. Ensures
deleting a Repeat (or computing reachable set) walks all parts.

### 1.7 serialise / round-trip
`meta.graph` is the source of truth and is regenerated on save; the type→tag
map already carries `repeat`. Confirm `serialiseGraph` writes `children` +
`bodyExpr` (plain fields, no special handling needed) and that a save→reload
round-trips a 2-part Repeat. Add a unit test in `composition-graph.test.ts`.

---

## 2. Repeat **card** (on-canvas) — two sections

In `GraphEditorPane.svelte`, the `case 'repeat'` node-card markup (`~L4321`):

- **PARTS section** — replace the single `child` socket row with a list: one
  row per `children[i]` showing the resolved part label + a remove (×) + an
  up/down reorder; a trailing **"+ part"** socket row that is the drag target
  for new wires (`endWireOnRepeatChild` appends). Each existing part row also
  carries its own input socket so a wire can rebind it.
- **PARAMS section** — render `bindings` as `name = expr` rows with the ƒ
  expr-popup (reuse the windowed-editor binding markup) + "+ param". (Optional
  on the compact card; can live only in the editor if the card gets tall —
  decide during build. Minimum: a count badge "ƒ ×k" that opens the editor.)
- Keep the `✎` button (opens the windowed editor) + count input + op already
  there. Tint `✎` when `children.length>1 || bodyExpr || mods/binds present`.

## 3. Windowed editor (the overlay) — edit mode

Extends the uncommitted overlay (`{#if editingRepeatId && repeatNode}`):

### 3.1 PARAMS section (already present as ƒ(i) bindings) — keep, relabel
"PARAMS". Add/remove/edit rows already wired (`addRepeatBinding` etc.).

### 3.2 PARTS section (new)
A list of the Repeat's `children` with: resolved label, reorder ▲▼, remove ×,
and a "+ part" affordance. Adding a part here = same as wiring on canvas
(append a placeholder or pick an existing node). Order = `place([...])` order.

### 3.3 Loop-body tab — `wired ⇄ code` toggle
- **wired** (default): show the read-only generated per-iteration body
  (`place([...])` of the parts, with the modifier fold) — live-derived.
- **code**: a `<textarea>` (mono) seeded **from the array of parts**
  (`place([part0, part1, …])`) on first switch; edits call
  `setRepeatBodyExpr`. A "↺ revert to wired" clears `bodyExpr`. While
  `bodyExpr` is set, the parts list still shows (parts define the var names the
  code references) but the wired body is overridden.
- Seed source = the same emit helper that produces the unit expr, so "initial
  code == what bakes" holds.

### 3.4 wire-state (`wire-state.svelte.ts`)
`endWireOnRepeatChild` → call `addRepeatChild` (append) instead of
`setRepeatChild` (replace). Drag onto an existing part row's socket → rebind
that index (new `setRepeatChildAt`).

---

## 4. Build order (each step = green `bun run build`, browser-verify, commit)

1. **Model** — types + hydrate + mutate (`children`/`bodyExpr` + new mutators),
   keep emit reading `children[0]` via a shim so build stays green. Unit test
   round-trip. *(no UX change yet)*
2. **Emit + layout + consumed/validation** — full `children` + `bodyExpr` emit;
   verify a hand-built 2-part Repeat bakes `place([...])` and a 1-part Repeat is
   byte-identical (diff the emitted body).
3. **Card PARTS list + multi-socket wiring** — wire append/rebind/reorder;
   browser-verify two parts repeat.
4. **Windowed editor PARTS section + PARAMS relabel.**
5. **Loop-body wired⇄code toggle + bodyExpr seed/edit/revert.**
6. **Card PARAMS section** (if kept on the compact card).
7. Reconcile TODO #7 + `/plan`; update `docs/plans/repeat-and-sketch-repeat.md`
   cross-ref; commit.

## 5. Risks / guards
- **Back-compat**: every existing Repeat part must bake unchanged. Step 2 gates
  on a byte-diff of a known part (e.g. a drilling-string `g_dp_stand`-style
  graph) before/after.
- **bodyExpr is executed code**: same sandbox trust as Call-arg exprs; no new
  surface, but the hint text must make the `i`/`N`/binding/part-name scope
  explicit so edits don't silently `ReferenceError` at bake.
- **Empty parts + no bodyExpr**: surfaces as the existing "child → node not
  found" validation error, now "wire a part / add code".
- **GEP edits stay inline** (subagents stall on this file); model edits can be a
  worktree subagent (isolated, non-GEP) per the modularize lessons.
