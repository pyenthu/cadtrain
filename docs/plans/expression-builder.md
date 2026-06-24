# Expression Builder — calculated-expression BLOCK node (B.7 / id 914)

> **Status: v2 design (2026-06-23) — the expression is a CANVAS BLOCK NODE,
> not a text-reference popover.** The §1–§11 below describe the earlier v1
> popover/`e.<name>`-namespace model and are kept for the reusable parts
> (mathjs engine, validation, autocomplete); the **v0 section immediately below
> supersedes** them on the data model and integration.

## v0. The agreed model — Expr block (SUPERSEDES the text-ref design)

The expression is a **first-class node on the graph canvas**, wired like every
other node — NOT a global `e.<name>` namespace referenced by typed names.

- **`ExprNode`** — a new `composition-graph` node type:
  - **input sockets** = variables *declared* on the block (`a`, `b`, …) — empty
    slots on the left edge, **wired in** from other nodes' outputs (a `p.*` param,
    another node's value, another Expr block's output).
  - **named outputs** = several `{ name, formula }` rows; each formula uses only
    the block's **local** input names + earlier output names; each gets an
    **output socket** on the right edge (multi-output — user's choice).
  - the formula NEVER names `p.*`/`e.*`; the graph **wiring** supplies values.
- **Wiring** uses the existing socket/wire system (`WireState` + the SVG sockets,
  same as poly_repeat refs + param feeds). Drag `p.od → input a`; drag
  `output wall → a node's arg socket`.
- **Validation** reuses the merged mathjs engine (`graph-exprs.ts` /
  `expr-schema.ts`): parse each formula, AST-walk against {local input names +
  prior output names} ∪ ALLOWED_FUNCTIONS, arity + safe-node-type gate. The
  per-block editor's **autocomplete** suggests *local inputs + sibling outputs +
  functions* (NOT global p./e.).
- **Emit**: each wired input substitutes its source expression; each output emits
  `const <block>_<out> = <formula-with-locals-substituted>;` in local topo order;
  an output socket wired into an arg drops that identifier in place. Rides the
  existing composition node→node emit + wire text-substitution.

### What this changes vs v1 (below)
- **Supersedes**: the sparse `graph.exprs[]` + global `e.<name>` namespace +
  topo-prelude *as the integration mechanism*. Values flow by WIRES now.
- **Reuses (not wasted)**: the mathjs parse/validate/AST layer (PR-1/PR-2) → the
  block's **formula validator**; the v1 popover components (`expr/*.svelte`) → the
  block's **editor** (declare inputs + name=formula rows + autocomplete + block
  tree); the multi-line autocomplete SRC work in progress.

### v2 PRs
1. ✅ **`ExprNode` model + mutators + tests — DONE (step 1)**. Node type
   `{ type:'expr', outputs:{name,formula}[] }` (inputs NOT stored — derived);
   `deriveExprInputs` (graph-exprs.ts, mathjs AST walk = hybrid port model);
   mutators (addExprNode/addExprOutput/setExprOutputName/Formula/removeExprOutput);
   `emitNodeExpr case 'expr' → null` (non-geometry). `expr-node.test.ts` 8/8.
   **LEFT for step 1.5:** the prelude EMIT (outputs → `const`s with wired-input
   substitution + local topo) once wiring exists.
2. **Node card + sockets** — `ExprNode` render arm in `NodeCard.svelte`: input
   sockets (left, one per DERIVED input) + output sockets (right, one per
   output), wired via `WireState`. Add/remove OUTPUTS inline (inputs follow the
   formulas). Outputs line-aligned to their formula rows (Dynamo pattern).
3. **Block editor popover** — repurpose `expr/ExpressionBuilderPopup` to edit ONE
   block: declare input names, the `name = formula` rows (multi-line + autocomplete
   over locals+sibling-outputs+functions), live per-row block tree + validation.
4. **Wiring polish** — `e.*`-style autocomplete dropped; the ƒ arg path can also
   reference a block output by wire. Drag-to-socket from the palette.

> Decision log: single vs multiple outputs → **multiple named outputs** (user,
> 2026-06-23). Conditionals → mathjs ternary `cond ? a : b` (ConditionalNode,
> already allow-listed). Functions → autocomplete, never a static list.
>
> **Research (prior-art survey, 2026-06-24 — Dynamo Code Block · Unreal Math
> Expression · Grasshopper · Blender · n8n · Node-RED):** adopt the **hybrid
> port model** — auto-derive inputs from undefined symbols (Dynamo/Unreal),
> keep outputs declared. Key ports by NAME + reconcile (don't rebuild) so
> editing-while-wired is non-destructive. Outputs line-aligned to formula rows;
> soft-warn past ~6. Inline CodeMirror-style autocomplete + live resolved-value
> preview, expandable to a modal (n8n). Per-output-row errors (parse vs evaluate
> split). Keep formulas scalar/untyped — no units in the grammar (Blender).

---

> **v1 (below) — retained for the reusable engine/UI pieces only.** Reframed B.7
> from a text expressions tab into a wired-in popup with a SRC pane + visual
> block builder backed by `graph.exprs[]`. Library survey: mathjs / jsep / Rete /
> Blockly / Svelte Flow / acorn (§9).

## 1. Goal

A small **popover** for authoring **calculated expressions** that get wired into
a parametric CAD graph — anchored to the ƒ affordance, with an **expand-to-full**
button that grows the SAME content into a full-screen editor (more room for the
visual builder + multiple outputs). **It is a popover-first surface — NOT a
persistent "expressions tab" beside PARAMS/PROPS.** The full view is the popover
expanded, not a separate component. Two synchronized sections:

1. **SRC** — the raw expression source text (editable).
2. **VISUAL builder** — the same expression as a tree of modular blocks.

Hard requirements (from the brief):
- **Tightly controlled inputs and outputs, visually.** Inputs are a fixed schema
  (`p.<param>` part params + other `e.<name>` expressions); outputs are named
  results. A user can only reference declared inputs and only produce declared
  outputs — invalid wiring is impossible-or-immediately-flagged.
- **One OR multiple outputs** from a single builder.
- **Modular, validatable blocks** — every block (operator / function / input /
  literal) is independently checkable (allowlist, arity, type) so the whole
  expression is statically validated before commit.
- A constrained, **safe** expression grammar — arithmetic, conditionals,
  min/max/clamp, trig, common CAD math. **No arbitrary JS, no side effects.**
- Embeds cleanly in Svelte 5 (runes), client-only (SSR off), Bun.

## 2. Architecture decision (the load-bearing choice)

**The parser owns the two-way sync — NOT a node-graph canvas.** Every visual
node editor surveyed (Rete, Svelte Flow, Flume, Baklava, Blockly) is a
blocks→state system; **none** parses an expression string back into a graph. So
text↔visual is always solved at the parser layer.

**Chosen stack:**

| Layer | Choice | Why |
|---|---|---|
| Parser / AST / evaluator | **`mathjs`** (tree-shaken: `parse`, `evaluate` + the node types) | Rich TYPED AST (OperatorNode, FunctionNode, SymbolNode, ConstantNode, ConditionalNode, ParenthesisNode…), `traverse()`/`filter()`/`transform()`, and `node.toString()` for a faithful roundtrip. Grammar **structurally cannot** express function declarations / imports / imperative code → safe by construction. Active (15.2.0, Apr 2026), Apache-2.0. |
| Visual block rendering | **Custom Svelte 5 recursive components** (one per AST node type) | An expression is a TREE, not a DAG — a recursive renderer is ~400 LoC and zero extra deps. Cheaper + more controllable than embedding a full node canvas. |
| Multi-output canvas (later) | **`@xyflow/svelte`** (ALREADY in the repo as of B.6 / `5ebc946`) | Reserve for when multiple expressions need a 2D wired layout. Integration cost is now sunk. |
| Popup container | cadtrain's existing **`FloatingPanel`** | Consistent with the editor; anchored, z-managed (memory `floating_panel_z_index`). |

**Runner-up (size-sensitive path):** `jsep` (~8 KB gzip, parse-only) + a
hand-written serializer (~100 LoC) + a hand-written evaluator. Take this ONLY if
bundle size becomes critical or the evaluator moves to a Web Worker; for v1
mathjs's unified parse+evaluate+emit is simpler and gives live preview for free.

**Rejected:** Blockly (Svelte wrapper dead since 2022, 16.7 MB, one-way
blocks→code only), acorn (parses dangerous full JS — exhaustive blocklist
needed), expr-eval (CVE-2025-12735, stale), Svelvet (Svelte 4).

The spine, regardless of picks:
```
[SRC textarea] ──parse()──▶ [mathjs AST] ──render──▶ [Svelte block tree]
      ▲                          │  ▲                        │
      └──── ast.toString() ──────┘  └──── mutate AST ◀───────┘ (block edit / chip drop)
```

## 3. Data model — sparse `graph.exprs[]` + the `e.<name>` namespace

The popup AUTHORS expressions; this is where they LIVE. Reuses the original B.7
model so `p.*` positional bake is untouched.

```ts
// composition-graph-types.ts — sparse + optional ⇒ round-trips for free,
// no migration; absent/empty ⇒ emitted source byte-identical to today.
export type GraphExpr = {
  name: string;          // the e.<name> output identifier (unique, ident-safe)
  src:  string;          // the expression source (mathjs grammar)
};
// On the Graph container:  exprs?: GraphExpr[];
```

- **`e.<name>` namespace** is separate from `p.<name>` (params). A `p.*` is a
  positional bake input (unchanged); an `e.*` is a CALCULATED value derived from
  `p.*` and other `e.*`. Keeping them in separate namespaces means the positional
  bake signature never shifts.
- **Multiple outputs** = multiple `GraphExpr` rows. One builder popup can author
  one expr (single output) or, in the multi-output mode, several at once.
- **Topological evaluation** — `src/lib/cad/graph-exprs.ts` (pure, tested):
  parse each `src` to an AST, extract its `e.*` references (SymbolNodes in the
  `e.` namespace), build a dependency DAG among exprs, topo-sort, **detect cycles**
  (return a clear error, never throw uncaught), and emit `const e_<name> = <src>;`
  in dependency order ahead of the consuming body. References to `e.<name>` in
  any ArgValue expression resolve to those consts.
- **Emit** (`composition-emit.ts`): when `graph.exprs` is non-empty, prepend the
  topo-ordered `const e_<name> = …;` block; otherwise emit nothing (byte-identical
  to today). `p.*` positional path unchanged.

## 4. The popup — layout & controlled IO

```
┌── ƒ Expression builder ───────────────────────────────────┐
│ ┌ inputs (schema) ─┐  ┌────────── VISUAL ───────────────┐ │
│ │ p.od   p.id      │  │   ┌─ max ─────────────┐         │ │
│ │ p.len  p.wall    │  │   │  ( p.od - p.id )   │         │ │
│ │ ─ e.* ─          │  │   │     ÷ 2            │         │ │
│ │ e.wall           │  │   └───────────────────┘         │ │
│ │ ─ functions ─    │  │   [drag a chip into a slot ▢]    │ │
│ │ min max clamp …  │  └─────────────────────────────────┘ │
│ └──────────────────┘                                       │
│ ┌─────────────── SRC ───────────────────────────────────┐ │
│ │ max((p.od - p.id) / 2, 0)                              │ │
│ └───────────────────────────────────────────────────────┘ │
│ ⚠ none · output: e.[ wall ]  [+ output]      [Cancel][✓]  │
└────────────────────────────────────────────────────────────┘
```

**How IO is strictly controlled (the core requirement):**
- **Inputs** come ONLY from the schema panel — draggable chips for the part's
  `p.*` params + already-declared `e.*` exprs. A `SymbolNode` whose name is not in
  the allowed set is flagged red in BOTH panes and blocks commit (§5). You cannot
  drag in an input that isn't declared; typing an unknown one in SRC is caught.
- **Functions** come ONLY from the palette (allowlisted math fns). A
  `FunctionNode` outside the allowlist is rejected.
- **Outputs** are named `e.<name>` rows. The name must be a unique ident; the
  builder owns which outputs exist. Multi-output adds rows (§6).
- **Drop targets are typed slots** — `InsertSlot` components mark exactly where a
  chip/subexpression may land (an operand position, a function arg). You can't
  drop a chip into an invalid position because no slot renders there.

## 5. Validation architecture (per-block, free)

Single AST walk after each parse, against the schema:

```ts
const allowedInputs    = new Set([...partParamNames, ...declaredExprNames]); // p.* + e.*
const allowedFunctions = new Set(['sin','cos','tan','sqrt','abs','min','max',
  'clamp','pow','log','floor','ceil','round','pi','atan2','hypot']);          // CAD math
const arity = { clamp:3, min:2, max:2, pow:2, atan2:2, hypot:2, /* …1 for unary */ };

function validate(ast, schema): ExprError[] {
  const errs = [];
  ast.traverse(node => {
    if (node.type === 'SymbolNode'   && !allowedInputs.has(node.name))
      errs.push({ node, msg: `Unknown input: ${node.name}` });
    if (node.type === 'FunctionNode') {
      if (!allowedFunctions.has(node.fn.name)) errs.push({ node, msg: `Disallowed fn: ${node.fn.name}` });
      else if (arity[node.fn.name] && node.args.length !== arity[node.fn.name])
        errs.push({ node, msg: `${node.fn.name} expects ${arity[node.fn.name]} args` });
    }
    if (node.type === 'AssignmentNode' || node.type === 'FunctionAssignmentNode')
      errs.push({ node, msg: 'Assignments not allowed' });
  });
  return errs;
}
```

- **Per-block validation is free**: each rendered block holds its AST node ref;
  it highlights red iff it appears in the error list (filter by node).
- **Safety**: only commit/evaluate after the walk passes AND only node types in
  `{Constant, Operator, Function(allowlisted), Symbol(allowlisted), Conditional,
  Parenthesis}` are present. Never `math.evaluate(userSrc)` raw.
- **Live preview** (optional v1): `math.evaluate(src, sampleScope)` with the
  part's current param values → show the numeric result + range sanity.

## 6. Multi-output

- v1: the popup authors ONE `e.<name>` at a time but the panel lists all declared
  exprs (the schema panel's `e.*` group), and `[+ output]` adds a new `GraphExpr`
  row. Each is its own SRC+visual session.
- v2 (when warranted): a **multi-expression canvas** using `@xyflow/svelte` —
  each `e.*` a node, edges = `e.*`-references, so the dependency DAG is the
  literal wired graph. The topo-eval module (§3) already computes that DAG, so the
  canvas is a view over existing data. Defer until single-tree authoring is solid.

## 7. Component breakdown (Svelte 5 runes)

```
ExpressionBuilderPopup.svelte     ← FloatingPanel; props: schema (p.*/e.*), initialSrc, name; emits {name, src}
  ├── ExpressionSrcPane.svelte    ← textarea (CodeMirror later); on input → parse → $state ast
  ├── ExpressionVisualPane.svelte ← renders the AST as blocks
  │     └── ExpressionNode.svelte ← dispatcher by MathNode type:
  │           ├── OperatorBlock.svelte     (left ∘ right)
  │           ├── FunctionBlock.svelte     (name + typed arg slots)
  │           ├── ConditionalBlock.svelte  (if / then / else)
  │           ├── InputChip.svelte         (p.* or e.* — coloured by schema group)
  │           ├── ConstantChip.svelte      (editable literal)
  │           └── InsertSlot.svelte        (typed drop target)
  ├── SchemaPanel.svelte          ← draggable p.* + e.* chips + function palette
  ├── ValidationBanner.svelte     ← errors from the AST walk; click → highlights the block
  └── OutputRow.svelte            ← named output(s); [+ output] for multi
```

State flow:
```ts
let src   = $state(initialSrc);
let ast   = $derived.by(() => { try { return mathjs.parse(src); } catch { return null; } });
let errors= $derived(ast ? validate(ast, schema) : [{ msg: 'Parse error' }]);
// block edit / chip drop → mutate AST (mathjs transform) → src = ast.toString();  ($derived re-runs)
```
`toString()` normalizes whitespace + adds explicit parens (`3+4*2` → `3 + (4 * 2)`)
— acceptable, arguably better for CAD formulas.

## 8. Risk-sequenced PRs

Each green on `bun run build` + `bun run test` (vitest — NOT bare `bun test`).

1. **PR-1 — model + topo-eval (pure, no UI).** `GraphExpr` type + sparse
   `graph.exprs?`; `src/lib/cad/graph-exprs.ts` (parse refs, DAG, topo-sort, cycle
   detect, emit order); wire into `composition-emit.ts` (prepend `const e_*`
   block; no-op when empty). `graph-exprs.test.ts`: topo order; cycle → error; an
   `e.*` referencing `p.*`; **no-exprs ⇒ byte-identical emit**. Add `mathjs` dep
   (tree-shaken). GEP-independent.
2. **PR-2 — validation + parse harness (pure).** `validate(ast, schema)` allowlist
   walk + arity; the safe node-type gate; a pure `astToSrc`/`srcToAst` wrapper.
   Tests: unknown input, disallowed fn, arity, assignment-rejected, injection
   attempt rejected.
3. **PR-3 — the popup, SRC pane + read-only visual.** `ExpressionBuilderPopup` in
   `FloatingPanel`; SRC textarea ↔ `ast`; `ExpressionVisualPane` renders the block
   tree READ-ONLY; `ValidationBanner`; `SchemaPanel` (chips, non-draggable yet);
   `OutputRow` single. Wire the popup into the editor's ƒ affordance for an `e.*`
   field. Browser-verify in `/graph-editor` + multi-instance `/primitives`.
4. **PR-4 — interactive visual (edits + chip drag).** `InsertSlot` drop targets;
   drag a `p.*`/`e.*` chip or function into a slot → AST splice via mathjs
   `transform()` → `toString()` back to SRC; editable `ConstantChip`. Undo/redo via
   an AST-snapshot stack (serialize trivially).
5. **PR-5 — expand-to-full + multi-output.** An expand button on the popover
   header grows it from the anchored FloatingPanel into a full-screen overlay
   (same components, more room) — and back. `[+ output]` adds `GraphExpr` rows
   (multi-output) in the expanded view. **No permanent tab** — the popover IS the
   surface; "full" is just the expanded state. (Reuse the sketch-editor
   overlay/expand pattern from `SketchEditorPane`.)
6. **PR-6 (deferred) — xyflow multi-expression canvas.** Only if multi-output
   authoring needs a wired 2D view (§6 v2).

## 9. Risks / gotchas

- **mathjs bundle**: 9.4 MB unpacked is install-only; tree-shaken `parse`+`evaluate`+
  used fns ≈ 50–80 KB gzip. Import the factory subset, not the monolith
  (`mathjs/number` or custom bundling) — confirm the final chunk size after PR-1.
- **Svelte 5 + SSR off**: app is client-only, so top-level mathjs import is fine.
  No DOM-injection libs (we rejected Blockly/Rete), so no `onMount` dance.
- **Per-instance state**: the popup is mounted per-trigger; keep its `$state`
  local — never a module singleton (multi-pane `/primitives` leaks otherwise).
- **`toString()` normalization** changes formatting on roundtrip — document so
  users aren't surprised their `3+4*2` becomes `3 + (4 * 2)`.
- **Don't drift two evaluators**: the emitted `const e_* = <src>` (server/client
  bake) and any in-popup `math.evaluate` preview must use the SAME grammar/fns.
  Keep the allowlist + fn set in ONE shared module imported by both.
- **`e.*` vs `p.*` collision**: enforce that an expr name can't shadow a param
  name at declare time.

## 10. Open decisions (for the user)

1. **mathjs vs jsep** — recommend mathjs for v1 (live preview + roundtrip for
   free); switch to jsep only if bundle/Worker pressure appears. (Default: mathjs.)
2. **Launch surface** — RESOLVED: a popover anchored to the ƒ affordance,
   expandable to a full-screen overlay (PR-5). No persistent EXPR tab.
3. **Live numeric preview in v1?** — show `evaluate(src, currentParams)` result
   inline. (Default: yes, cheap with mathjs; cut if noisy.)
4. **CodeMirror for the SRC pane** — syntax highlight + error squiggles, or a
   plain textarea for v1? (Default: textarea v1, CodeMirror later — the dep is
   already in package.json but flagged unused by knip.)

## 11. Files this will touch

- `src/lib/cad/composition-graph-types.ts` — `GraphExpr`, `graph.exprs?`.
- `src/lib/cad/graph-exprs.ts` — **NEW** pure topo-eval + ref extraction.
- `src/lib/cad/expr-schema.ts` — **NEW** shared allowlist (inputs rule + fn set +
  arity), imported by validator AND emitter.
- `src/lib/cad/composition-emit.ts` — prepend topo-ordered `const e_*` block.
- `src/lib/shared/graph-editor/ExpressionBuilderPopup.svelte` + the block
  components under `graph-editor/expr/` — **NEW**.
- `src/lib/shared/graph-editor/RightPane.svelte` — the EXPR tab (PR-5).
- `package.json` — add `mathjs`.
- Tests: `graph-exprs.test.ts`, `expr-validate.test.ts`.
