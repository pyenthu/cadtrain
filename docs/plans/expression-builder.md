# Expression Builder — calculated-expression BLOCK node (B.7 / id 914)

> **Status: v3 design (2026-06-24) — expressions are reusable per-part
> DEFINITIONS, instanced as blocks on the canvas.** Builds on the shipped v2
> block node (model/card/emit/autocomplete — all merged). The **v3 section
> immediately below supersedes** v2/v0 on storage + reuse; v2's ExprNode becomes
> the *instance*. v0/v1 below are kept only for the reusable engine pieces.

## v3. Expression definitions + instances (per-part library) — DETAILED PLAN

> Locked after discussion (user, 2026-06-24). This is the build spec; v0/v1/v2
> below are kept only for the reusable engine + UI pieces they already shipped.

### v3.0 Decisions (all locked)
- **Scope: per-part first.** Definitions live on the part (`graph.exprDefs[]`,
  serialized in `meta.graph`). A global volume library (`expressions/<id>.expr.json`)
  is an explicit later phase (§v3.9), out of scope here.
- **Definition + instances, shared.** Editing a definition updates EVERY instance
  at once (one source of truth, like parts/Calls). Instances differ ONLY by their
  per-param input WIRING.
- **Self-contained — NO graph `p.*`.** The builder shows none of the host graph's
  params/variables. A definition declares all of its own names.
- **Four declared sections** (the crux of this round): **PARAMS · CONSTS ·
  VARIABLES · OUTPUTS**.
- **Menu home: the Σ left-rail popover** becomes the Expressions menu.
- **Editor layout: tabs OR accordions, user-switchable** (persisted pref).

### v3.1 Data model
```ts
// composition-graph-types.ts — on the Graph (per-part, in meta.graph):
exprDefs?: ExprDef[];

export type ExprParam = { name: string; default?: number };          // PARAMS
export type ExprConst = { name: string; value: number };             // CONSTS
export type ExprVar   = { name: string; formula: string };           // VARIABLES (internal)
export type ExprOut   = { name: string; formula: string };           // OUTPUTS

export type ExprDef = {
  id: NodeId;            // stable; instances reference it
  name: string;         // shown in the Σ menu + on the instance card
  params:  ExprParam[]; // declared INPUTS → input sockets (wired per instance)
  consts:  ExprConst[]; // fixed local values, same for every instance (no socket)
  vars:    ExprVar[];   // internal intermediates, topo order (no socket)
  outputs: ExprOut[];   // exposed results → output sockets
};

// The instance — refactor v2's self-contained ExprNode into a thin reference:
export type ExprNode = {
  id: NodeId; type: 'expr';
  defId: NodeId;                            // → ExprDef.id
  bindings?: Record<string, ArgValue>;      // PARAM name → wired source (else default)
};
```
**Name scope inside a def** (one flat namespace): `params ∪ consts ∪ vars ∪
outputs` names must be unique. A formula (in `vars`/`outputs`) may reference any
name DECLARED-EARLIER in the eval order below + the allow-listed
functions/constants. Any other free symbol = a validation error (NOT a new
socket — sockets come only from `params`/`outputs`).

### v3.2 Evaluation + emit order (per INSTANCE)
A pure helper `orderExprDef(def)` returns the flat eval sequence; emit walks it
once. For an instance node `n` with `bindings`, namespaced by `exprBlockVar(n.id)`
(call it `V` — already exists, a pure fn of the node id so the wire handler and
the emitter agree):
```
// 1. PARAMS — wired value, else the param default, else 0
const V_<param> = <bindings[param] emit | default | 0>;
// 2. CONSTS — literal values
const V_<const> = <value>;
// 3. VARIABLES — internal, in topo order over {params, consts, earlier vars}
const V_<var>   = <formula, local names rewritten to V_*>;
// 4. OUTPUTS — in topo order over {params, consts, vars, earlier outputs}
const V_<out>   = <formula, local names rewritten to V_*>;
```
- **Topo order** within vars+outputs via mathjs free-symbol edges (reuse
  `freeSymbols` + `topoOrderExprOutputs` from step 1.5, widened to the full
  declared set); a cycle → fall back to declaration order + a validation error.
- **Local-name rewrite**: `rewriteExprLocalRefs` (step 1.5) maps each declared
  name → `V_<name>`. Functions/constants pass through.
- **Two instances of one def** → two independent `V`-namespaced const groups
  (distinct `V` per node id) — already how step 1.5 works.
- **An OUTPUT socket wired into a consumer arg** sets that arg to
  `{kind:'expr', expr:'V_<out>'}` (step 1.5 already does this for the v2 block).
- **Empty `exprDefs` / no instances ⇒ byte-identical emit** (the prelude is
  skipped entirely).

### v3.3 Validation (reuse the mathjs engine)
Per formula (`vars` + `outputs`), `validateExpr(ast, schema)` where the allowed
input set = {all names declared EARLIER in this def} ∪ ALLOWED_FUNCTIONS ∪
ALLOWED_CONSTANTS. Errors: unknown symbol, disallowed/over-arity function,
forward-reference (name declared later), name collision across the four sections,
cycle. Surfaced per-row in the editor (red row + message) and as a node-level
error chip on instances whose def is invalid.

### v3.4 The Σ popover = Expressions menu
Repurpose `openExprPop` (the Σ rail button):
```
[Σ] → ┌ Expressions                     [+] ┐
      │ wall   (od,id) → wall         ✎  ⦻ │   ✎ = edit def
      │ taper  (a,i)   → r            ✎  ⦻ │   ⦻ = drop instance
      └──────────────────────────────────────┘
```
- Lists `graph.exprDefs`: `name  (params) → outputs`.
- **`+`** → create a new `ExprDef` (empty) and open the editor on it.
- **✎** → open the editor bound to that def.
- **⦻ drop instance** → `addExprInstance(graph, defId)` places an `ExprNode`
  on the canvas at a free position.
- Deleting a def warns if instances exist (offer: delete instances too / cancel).

### v3.5 The editor (the four-section builder)
Refit the existing `expr/ExpressionBuilderPopup` to edit a **def** (not a node):
- Header: def name field + the **tabs/accordions toggle** (a small ⊞/≡ button,
  pref persisted in `localStorage` `cad-expr-editor-layout`).
- Four sections **PARAMS · CONSTS · VARIABLES · OUTPUTS**, each a small table:
  - PARAMS: `name` + optional `default` (number).
  - CONSTS: `name` + `value` (number).
  - VARIABLES / OUTPUTS: `name` + `formula` (the autocomplete SRC field from step
    3) + per-row validation; OUTPUTS rows carry the output-socket marker.
  - `+ row` on each; reorder = matters only as a readability aid (eval order is
    topo, not positional).
- **Autocomplete corpus** (step-3 component, repurposed) = names declared earlier
  in THIS def + ALLOWED_FUNCTIONS + ALLOWED_CONSTANTS. **No `p.*`/`e.*`** —
  remove the graph-param INPUTS panel entirely.
- Live per-row block tree + validation banner stay.

### v3.6 The instance node card
The v2 card (already shipped) reads THROUGH the def (`graph.exprDefs.find(d =>
d.id === n.defId)`):
- Title = def name. Input sockets (left) = `def.params`; output sockets (right) =
  `def.outputs` — line-aligned to rows.
- Body = a compact read-only summary (params + outputs); editing is via **✎** →
  opens the DEF editor (shared). Per-param inline value override is a stretch
  (instance-level default override) — DEFER; v3 binds params by WIRE only.
- Missing def (dangling `defId`) → an error chip + a "pick/recreate def" affordance.

### v3.7 Migration (one-way, on hydrate; no data loss)
`hydrateGraph` converts older shapes so existing parts keep working:
- **v2 self-contained `ExprNode{outputs,bindings}`** → synthesize an `ExprDef`
  (name `expr_<n>`, `outputs` = the node's outputs, derived inputs → `params`
  with no default, `consts`/`vars` empty); set `node.defId`; keep `bindings`.
- **v1 `graph.exprs[]`** (`e.<name>` list) → one `ExprDef` each (single output =
  the expr). The legacy `e.*` emit path (`emitExprConsts`) stays for back-compat
  until a part is re-saved in the new shape.
- Migration is idempotent + covered by a hydrate test (old JSON in → new shape +
  same emit out).

### v3.8 Risk-sequenced PRs
1. **PR-1 — model + emit + migration (PURE, tested, no UI).** Add the four-section
   `ExprDef` + `exprDefs`; refactor `ExprNode → {defId,bindings}`; mutators
   (`addExprDef`, `addExprInstance`, `set*`/`add*`/`remove*` for each section);
   `orderExprDef` + point `emitExprBlocks` at the def; hydrate migration (v2 + v1).
   Extend `expr-emit.test.ts`: params/consts/vars/outputs emit order; two
   instances → distinct consts; edit-def-propagates; cycle → error+fallback;
   migration round-trip; empty ⇒ byte-identical. **Build + test green; no
   browser.** This is the load-bearing PR.
2. **PR-2 — the four-section editor.** Refit `ExpressionBuilderPopup` to edit a
   def: PARAMS/CONSTS/VARIABLES/OUTPUTS sections + the tabs/accordions toggle;
   drop the graph-param INPUTS panel; autocomplete corpus = local names + funcs.
   Browser-verify on `:3333`.
3. **PR-3 — the Σ Expressions menu.** Turn the Σ launcher into the menu (list +
   `+` + ✎ + ⦻ drop-instance); `addExprInstance`; delete-def guard. Browser-verify.
4. **PR-4 — instance card through the def** + dangling-def handling + the live
   end-to-end wire→bake check (drop instance, wire a param, see it compute).
   Browser-verify + an e2e.
5. **(later) global volume library** — promote `exprDefs` to volume files
   (`expressions/<id>.expr.json`, resolver, save/load); separate plan (§v3.9).

### v3.9 Out of scope (this round)
Global/cross-part library (volume-backed defs); instance-level param-default
overrides; typed/units params (kept scalar). All noted for a later phase.

---

> **Status: v2 design (2026-06-23) — the expression is a CANVAS BLOCK NODE,
> not a text-reference popover.** The §1–§11 below describe the earlier v1
> popover/`e.<name>`-namespace model and are kept for the reusable parts
> (mathjs engine, validation, autocomplete); the **v0 section** below
> describes the v2 self-contained block (now refactored into the v3 instance).

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
