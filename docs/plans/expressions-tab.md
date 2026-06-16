# Plan — EXPRESSIONS tab (named calculated expressions)

Status: PLAN ONLY (not built). Owner: graph-editor / composition-graph.
Cross-refs: `docs/plans/modularize.md` (graph-editor split), `docs/COMPOSITION.md`,
Rule 20 (volume part authoring), memory `fresh_array_props_effect_loops`.

## 1. Goal

Add a THIRD left-overlay tab — **EXPRESSIONS** — beside PARAMS and PROPERTIES.
It holds a list of *named calculated expressions* that derive a value from the
declared params and from each other:

```
bore   = p.od - 2*p.wall
relief = clamp(p.wall*0.4, 0.02, 0.25)
hubH   = p.length > 6 ? p.length*0.15 : 0.9
```

Once defined, an expression is referenceable anywhere an `ArgValue` lives —
Call args, mv/rot offsets, polygon/sketch coords, repeat counts — via a NEW
`e.<name>` namespace (e.g. `e.bore`). Params stay `p.<name>`; computed values
are `e.<name>`. This keeps the two read-only/derived distinction explicit and
sidesteps any name collision between a slider and a formula.

Why a separate concept (not "just type the formula in each arg"): DRY. A
`bore = p.od - 2*p.wall` defined once, referenced in five places, edits in one
place; today the same sub-expression is copy-pasted into five `expr` ArgValues
and drifts.

## 2. Data model

### 2.1 Decision: dedicated `graph.exprs` map (NOT `graph.params` with a kind)

Add a sibling field to `Graph` in `composition-graph-types.ts`:

```ts
/** Named CALCULATED expressions (EXPRESSIONS tab). Each derives a number
 *  from p.<param> and earlier e.<expr>. Ordered list (NOT a Record) so the
 *  user-visible order is stable and the editor can reorder; topo eval order
 *  is computed from the dependency graph, independent of array order. */
export type ExprDef = {
  name: string;        // identifier — referenced as e.<name>; ^[a-zA-Z_]\w*$
  expr: string;        // JS expression string; same dialect as ArgValue 'expr'
  label?: string;      // optional human note
  unit?: string;       // optional, display only
};
// on Graph:
exprs?: ExprDef[];     // SPARSE/optional → zero migration; absent = []
```

Rejected alternative A — reuse `graph.params` with `kind:'computed'`:
`ParamSchema` is `{default,min,max,step,...}` and params are a `Record` consumed
all over (emit signature `fn(p)`, `sketchParamScope`, the PARAMS sliders, the
`stack_ref` reserved key, the bake `positional` array in `composition-bake.ts`
line 64). Slipping a non-numeric `default`-less computed entry into that Record
would touch every one of those consumers and risk the positional-bake mapping.
Keep params = inputs (have a default/min/max, get a slider, become `fn(p)` args)
vs exprs = derived (no default, no slider, never positional).

Rejected alternative B — make each expr a graph *node*: nodes are geometry/
value producers wired on the canvas; an expression is a scalar with no socket
position and no spatial meaning. A flat list in the overlay card (like params)
is the right home, not the canvas.

### 2.2 Why an ordered array, not a Record

Insertion order is the user's editing order and must round-trip; a `Record`'s
key order is fragile across JSON re-serialisation. Evaluation order is derived
separately (topological, §3), so array order never affects correctness.

## 3. Evaluation order + scope injection

### 3.1 The two eval sites that exist today

1. **Client preview / UI** — `evalArg(a, p)` in `src/lib/shared/graph-editor/args.ts`
   runs `expr` via `new Function('p', 'with(p){ return (<expr>); }')`. The scope
   `p` is built by `sketchParamScope(graph)` = `{paramName: default}`.
2. **Server bake** — `composition-emit.ts` `emitValueExpr` writes the `expr`
   string verbatim into the emitted geom body, which runs as `fn(p)` (signature
   chosen at emit line 327: `Object.keys(graph.params).length>0 ? 'p' : ''`).
   `param` kind emits `p.<name>`. So an `expr` at bake time runs in the function
   scope where `p` is the bound params object.

Both must learn about `e.<name>`.

### 3.2 Topological evaluation of exprs

Add a pure helper (new module `src/lib/cad/graph-exprs.ts`, leaf — imports only
types):

```ts
/** Reference extraction: scan an expr string for e.<name> tokens. Regex is
 *  adequate (identifiers only, no string-literal `e.` faking — flag those in
 *  validation). */
export function exprDeps(expr: string): string[]        // names referenced via e.<n>

/** Topological order over exprs by their e.<name> deps. Throws/returns a
 *  cycle list when a dependency loop exists (Kahn's algorithm; the leftover
 *  set after no in-degree-0 nodes remain IS the cycle). Mirrors the spirit of
 *  topoOrder(graph) in composition-graph-mutate.ts but over the expr list. */
export function exprOrder(exprs: ExprDef[]): { order: ExprDef[]; cycle: string[] }

/** Build the {name: number} map of computed values given a resolved param
 *  scope. Evaluates each expr in topo order with p AND the e-so-far in scope.
 *  Bad/cyclic exprs resolve to 0 (same defensive default as evalArg). */
export function evalExprs(exprs: ExprDef[], p: Record<string, number>): Record<string, number>
```

`evalExprs` evaluation of one entry:
```ts
new Function('p', 'e', `with(e){ with(p){ return (${entry.expr}); } }`)(p, eSoFar)
```
Nesting `with(e)` outside `with(p)` lets the expr write bare `bore` too if we
ever want unqualified refs, but the documented form is `e.bore` / `p.od`.

### 3.3 Wiring into the client scope

Extend `sketchParamScope` (or add a sibling `sketchEvalScope`) so the object
passed to `evalArg` carries an `e` key:

```ts
export function sketchEvalScope(graph: Graph): Record<string, any> {
  const p = sketchParamScope(graph);                 // {param: default}
  const e = evalExprs(graph.exprs ?? [], p);          // {expr: number}, topo
  return { ...p, e };                                 // p.* AND e.* both resolve
}
```

`evalArg` already does `with(p){ ... }`; because we add `e` as a *key* on the
scope object, `e.bore` resolves inside the `with`. Existing `p.od` refs are
unaffected (still keys on the same object). Every current `evalArg(a,
sketchParamScope(graph))` call site swaps to the new scope builder. (Grep:
`sketchParamScope(` — small, contained list.)

### 3.4 Wiring into the emit (server bake)

In `emitGraph` (`composition-emit.ts`), AFTER the `fn(p)` signature is chosen
and BEFORE the node `const` lines, emit a computed-expr prelude in topo order:

```js
export function g_foo(p) {
  const e = {};
  e.bore   = (p.od - 2*p.wall);
  e.relief = clamp(p.wall*0.4, 0.02, 0.25);
  e.hubH   = (p.length > 6 ? p.length*0.15 : 0.9);
  const A = r_revolve({ ... e.bore ... });
  ...
}
```

`emitValueExpr` is unchanged — an `expr` ArgValue that says `e.bore` just emits
the verbatim string `e.bore`, which now resolves against the prelude `const e`.
A new `param`-like kind is NOT needed; `e.<name>` lives inside `expr` strings.
The prelude lines come from `exprOrder(graph.exprs)`; on a cycle, emit a single
`throw new Error('expression cycle: a → b → a')` so a broken graph fails loudly
rather than baking `undefined` into WASM (memory: undefined into the Manifold
core OOB-crashes the singleton).

### 3.5 Helper functions in scope (conditionals / clamp)

`min`/`max`/ternary already work: `Math.min`/`Math.max` are global at bake, and
`a > 0 ? x : y` is plain JS. `clamp` is NOT currently a global — add a tiny math
prelude available at BOTH sites:

- Bake: prepend `const clamp=(x,lo,hi)=>Math.min(Math.max(x,lo),hi), min=Math.min, max=Math.max;`
  to the emitted body (or inject via `primitive-sandbox.ts` alongside the welded-mesh
  helpers, memory `welded_mesh_toolkit_shared`).
- Client `evalExprs`/`evalArg`: include the same `clamp/min/max` on the scope
  object so preview matches bake. Keep the set SMALL and document it in the tab
  (a "functions: clamp, min, max, abs, round, PI, sqrt, sin, cos…" hint).

Document the supported dialect once, in `docs/COMPOSITION.md`, so PARAMS exprs
and EXPRESSIONS entries share one spec.

## 4. UI — the EXPRESSIONS tab

### 4.1 Tab header (GraphEditorPane.svelte)

`leftTab` widens from `'params' | 'properties'` to `+ 'exprs'` (and the
localStorage `ge-left-tab` guard at ~line 1896 accepts it). Add a third button
in the `.ge-left-tabs` foreignObject (~line 5598):

```
[ Params ] [ ƒ Expressions ] [ ⚙ Properties ]
```

Use the `ƒ` glyph (consistent with the kept ƒ chip, memory `feedback_keep_fx_button`).

### 4.2 Card body — `ExpressionsCard.svelte` (new, under graph-editor/)

Mirror the ParamsCard structure but HTML-in-foreignObject (these rows are
text-editing, not wire-socket carriers — no output socket needed, see §6).
Rendered conditionally `{#if leftTab === 'exprs'}` directly below the tab header,
same `PROPS_X0 / PROPS_Y0 + TAB_HEADER_H / PROPS_W` placement as PropertiesCard.

```
┌─ ƒ Expressions ───────────── + ┐
│ e.bore   = p.od - 2*p.wall   🗑 │   ← name (editable) | "=" | expr input | trash
│ e.relief = clamp(p.wall*.4,…) 🗑│       row turns RED on parse/cycle error,
│ e.hubH   = p.length>6 ? … : .9🗑│       with a tooltip carrying the message
│ + Add expression                │
└─────── ƒ: clamp min max abs … ─┘   ← dialect hint footer
```

Row interaction (follow established conventions):
- Name + expr inputs commit **on Enter / blur only**, not per keystroke
  (memory `feedback_apply_on_enter`).
- A live **evaluated value badge** on the right of each row (e.g. `= 5.40`) using
  `sketchEvalScope` so the user sees the number — greyed when it errors.
- `+ Add expression` appends `{name:'e1', expr:'0'}`; auto-name `e1,e2,…` avoiding
  collisions, focus the name field.
- Reorder is cosmetic (drag handle optional, Phase 3) — order does not affect eval.
- Errors surface inline (red border + `[data-tip]`, NO `?`/help cursor —
  memory `feedback_no_help_cursor`); use the body-portaled `floatingTip`
  action since the card body may clip (memory `tooltip_native_title_for_clipping`).

### 4.3 Callbacks (stay in GEP, passed down — Phase-C pattern)

`onAddExpr`, `onRenameExpr(i, name)`, `onSetExpr(i, expr)`, `onRemoveExpr(i)`,
`onMoveExpr(i, dir)` — each calls a new pure mutator returning a fresh graph
(immutable shape, Svelte 5 `$state` shallow reactivity).

### 4.4 Reactivity caution

The evaluated-value badges read a `$derived` scope. Build it with `$derived.by`
keyed on a JSON content-string of `graph.exprs` + param defaults so a fresh
object identity each render does NOT loop auto-fit / re-mount canvas children
(memory `fresh_array_props_effect_loops`, `canvas_height_contract`).

## 5. Mutators (composition-graph-mutate.ts)

All pure, all return a new `Graph`:

```ts
addExpr(graph, name?, expr?)          // append; auto-unique name
setExprName(graph, i, name)           // rename — and OPTIONALLY rewrite e.<old>→e.<new> refs (Phase 2)
setExprBody(graph, i, expr)
removeExpr(graph, i)
moveExpr(graph, i, dir)
```

Renaming an expr that others reference: Phase 1 just renames the entry (refs go
stale → flagged by validation). Phase 2 adds a safe cascade rewrite of `e.<old>`
→ `e.<new>` across all exprs AND all `expr`-kind ArgValues (token-boundary regex,
NOT naive replace — guard against `e.bored` when renaming `bore`).

## 6. Wiring (`param`-kind ArgValues) — Phase 3, optional

Initially exprs are referenced by TYPING `e.bore` into any expr field (the ƒ
popup) — zero new socket plumbing, matches how `p.od` is typed today. A later
phase can add output sockets on each expr row (like param chips) and a new
`ArgValue { kind:'expr-ref'; name }` so exprs are drag-wireable onto arg sockets.
Defer — typing covers the use case and avoids the socket↔DOM Y-math (memory
`touch_implicit_pointer_capture`, `todo_modularize_grapheditorpane`).

## 7. Validation

Extend `validateGraph` (composition-emit.ts) with expr checks; surface via the
existing `GraphValidationError[]` + `formatValidationErrors` path (node-chip
errors today; add a card-level error region):

1. **Bad name** — empty / not `^[a-zA-Z_]\w*$` / duplicate / collides with a
   param name (would make `p.x` vs `e.x` confusing) / reserved (`e`, `p`, `Math`).
2. **Syntax error** — wrap each expr in a try/`new Function` at validate time;
   report the JS error message on that row.
3. **Unknown ref** — `e.<name>` referencing a non-existent expr; `p.<name>`
   referencing a non-existent param (reuse the existing `hasParam` check, add
   `hasExpr`). Also flag stale `e.<old>` refs left by a rename.
4. **Cycle** — `exprOrder` returns the cycle; report `expression cycle: a → b → a`.
   Block emit (the §3.4 `throw`) so a cyclic graph never reaches WASM.
5. **Forbidden ref shape** — `e.` inside a string literal, calls to undeclared
   functions (best-effort warn, not block).

A graph with ANY expr error should keep PARAMS/geometry baking where possible
but show the expr error prominently so it isn't silently producing 0s.

## 8. Emit / round-trip / persistence

- `emitGraph` writes the §3.4 `const e = {…}` prelude. The serialised
  `meta.graph` block ALREADY round-trips the whole `Graph` JSON, so adding
  `exprs?` to the type means it persists with zero new serialiser work — confirm
  `hydrateGraph` (composition-graph-hydrate.ts) passes `exprs` through (default
  `[]` when absent → migration-free, matches the `childRefs`/`colorOuter` sparse
  pattern).
- No new `meta.*` scalar needed (unlike `meta.color`); exprs live only inside the
  graph block. They affect the emitted BODY (the prelude), not the meta header.
- Atomic writes already handled by the save endpoint (Rule 4).

## 9. Phased plan

**Phase 1 — data + eval + emit (no UI yet).** `ExprDef` + `graph.exprs?` type;
`graph-exprs.ts` (`exprDeps`/`exprOrder`/`evalExprs`); `sketchEvalScope`; emit
prelude + cycle-throw; `clamp/min/max` math prelude at both sites; hydrate
passthrough. Unit tests: topo order, cycle detection, ternary/clamp eval,
emit golden. Build + `bun test`. (No browser change — verifiable purely by tests
+ a curl bake of a hand-edited graph JSON.)

**Phase 2 — UI tab.** `leftTab` third value + header button; `ExpressionsCard.svelte`
(rows, add/remove, Enter-commit, live value badge, inline errors); GEP callbacks +
mutators; validation surfaced in-card. Browser-verify per Rule 11 (claude --chrome):
add an expr, reference `e.bore` in a Call arg, confirm preview updates.

**Phase 3 — polish / optional wiring.** Rename-cascade rewrite of refs; reorder
drag; (optional) output sockets + `expr-ref` ArgValue for drag-wiring; dialect
hint footer; `docs/COMPOSITION.md` dialect spec.

**Phase 4 — docs + e2e.** `tests/e2e/graph-editor.spec.ts` step (once the
isolated test-volume blocker noted in CLAUDE.md is resolved); reconcile into
`/plan` (Rule 19).

## 10. Risks / notes

- **WASM safety**: a cyclic or NaN expr must NEVER bake into a Manifold call —
  the §3.4 throw + the `||0` defensive default guard this (memory: undefined args
  OOB-crash the singleton; restart `:3333` cleanly, not the in-app button).
- **Dev restart**: changes to `composition-emit.ts` / `composition-graph-*.ts` are
  server modules — restart `bun run dev` after editing (HMR skips them, memory
  `feedback_build_restart_after_significant_change`).
- **Keep eval dialects identical** client vs server, or preview will lie about the
  bake. One shared `clamp/min/max` set, documented once.
- **Naming clarity**: `p.` = input slider, `e.` = derived. Validation blocks an
  expr name that shadows a param so the two namespaces never alias.
- GEP is ~8400 lines; keep the new body in `ExpressionsCard.svelte` and the eval
  in `graph-exprs.ts` — do NOT grow GEP (modularize plan; subagents stall on big
  GEP extractions, prefer a clean new file).
