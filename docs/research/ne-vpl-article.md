<!-- research-group: Node editors -->
# Designing a node-based VPL (dev.to article) — node-editor research

> Source: dev.to/cosmomyzrailgorynych — "Designing your own node-based visual
> programming language" (uses SvelteFlow, same Svelte family as us). Lens: our
> emit-to-source CAD node editor.

## 1. Core architecture proposed

- **Two edge kinds, separated:** *data edges* (carry values) vs *execution
  edges* (define ordering). Nodes are pure/computed (data), commands (exec), or
  both — tells users when a value is constant-after-run vs stale.
- **Type system:** strongly typed sockets, color-coded by type; a wildcard `any`;
  auto-inserted *data-converting edges* for coercion (number→string); **computed
  pin types** — a pin's type is a function of node data, not a fixed declaration.
- **Evaluation:** pull-based for data ("retrieved from nodes that consume data to
  the very source"); exec flows start→end. Author chose an **interpreter** over a
  compiler (light engine, sidesteps cyclic-graph compilation).
- **Socket cardinality:** outputs fan out to many; **every data input has exactly
  one source**; exec: many can call a node but a node points to one "next."
- **Defaults/inline widgets:** unconnected data inputs render a constant-input
  widget (textbox, dropdown, vector/color picker).
- **Validation:** prevent illegal connections at edit time; sanity-check before
  run (empty required inputs); human errors with suggested fixes + IDs hidden
  under `<details>`; aggressive cleanup that drops edges to deleted entities.
- **UX musts:** the searchbox is make-or-break; **drag-from-socket-into-void**
  opens a context-aware node search; auto-relink on middle-node delete (A→B→C ⇒
  A→C); node declarations as typed TS objects rather than markup.

## 2. Ideas worth stealing (value-to-effort)

- **Drag-into-void → context-filtered node search (HIGH / MED).** Releasing a
  wire on empty canvas opens a picker filtered to nodes whose input type matches
  the dragged output. Direct win for our typed sockets; cuts trips to the
  sidebar. The author calls the searchbox the single biggest quality
  differentiator.
- **Auto-relink on middle-node delete (HIGH / LOW).** Deleting a Mv/Rot/Method in
  a chain reconnects its neighbors (A→C). Cheap, high daily value in a
  transform-heavy CAD graph.
- **Constant widget on every unconnected input, typed (HIGH / MED).** This *is*
  our `ArgValue = literal`. Formalize: unconnected socket shows the literal
  editor; wiring switches it to `param`/`expr`. Makes literal↔param↔wire one
  coherent rule instead of three popovers.
- **Color-code sockets AND their constant fields by type (MED / LOW).**
  Number/vector/bool/Manifold-body get distinct colors on pin + inline input.
  Pure render change; big legibility gain.
- **Computed pin types (MED / MED).** A socket's type as a function of node data:
  a Repeat's output type = its child body type; a Method's return type depends on
  the receiver. Lets validation reject bad wires before emit.
- **Auto-coercion edges (MED / MED).** A number feeding a string/expr slot
  inserts an explicit converter (a wrapped expression in emit) rather than
  silently emitting wrong source.
- **Human errors with collapsible detail (MED / LOW).** Our bake 400s are opaque
  (CLAUDE.md: six bugs all surfaced as "Bake 400"). Map Manifold/emit failures to
  plain language + suggested fix, raw trace under `<details>`.
- **Pre-emit sanity pass (MED / LOW).** Before emit/bake, scan for empty required
  literals + dangling single-source inputs; surface inline. Catches errors before
  the WASM round-trip.

## 3. NOT worth adopting

- **Interpreter / runtime VM with try/catch-per-node** — we emit TS and bake via
  Manifold; we have no graph interpreter and shouldn't build one. Their
  error-walker maps only loosely to emit-time validation.
- **Execution-edge vs data-edge duality as a first-class user concept** — CAD
  geometry is pure dataflow; the one place sequencing matters (CSG order) is
  already implicit in `.add/.subtract` ordering. A separate exec socket adds
  ceremony without payoff.
- **Async-block marking / staleness** — geometry emission is synchronous +
  deterministic.
- **Free-form cyclic graphs** — their selling point is a liability for us (we emit
  straight-line TS; cycles can't emit). We should *forbid* cycles.
- **`${type}-${key}` pin-name serialization** — author calls it "neither
  error-proof nor performant"; our `meta.graph` JSON is already structured.

## 4. Loops / iteration / subgraphs (for Repeat)

- **Pure-vs-command maps to Repeat:** treat Repeat as a pure *data* node taking a
  body + count + per-iteration bindings, outputting a composed body. Its output
  type = child body type (a computed-pin-type case). Keep it dataflow, not a
  control-flow cycle.
- **The article gives NO explicit for-each node** — it leans on graph cycles,
  which we should reject. So our explicit, bounded Repeat (clone N, per-iter
  bindings, graphical modifiers) is *already the better design* for emit-to-
  source; the takeaway: **stay explicit and bounded, don't drift toward feedback
  cycles.**
- **Sub-graphs / collapsible groups** are listed as desirable-but-future. For us:
  a multi-child Repeat (just added) is effectively an inline sub-graph scoped to
  the loop variable. Worth formalizing a **collapsible group → emitted helper
  function** path (enabled by emit-to-source, no interpreter).
- **Loop variable as a typed param source** — `loopVar` should appear as a typed
  output socket inside the body scope, wireable into child params like any
  `param` ArgValue.

**Net top three:** (1) drag-into-void typed node search, (2) auto-relink on
delete, (3) unify literal/param/wire as "typed unconnected-input widget" with
type-colored sockets. All pure editor-UX, fit emit-to-source, no interpreter.
