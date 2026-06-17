<!-- research-group: Node editors -->
# Flyde — node-editor research

> Source: github.com/flydelabs/flyde · flyde.dev. Visual flows embedded INTO a
> real TS codebase (nodes ARE code). Highly relevant to us since we emit-to-
> source. Lens: our CAD node editor.

## 1. Core architecture

**Node / pin / connection, two node kinds.**
- **`VisualNode`** — the flow container: `instances` (placed nodes + config) +
  `connections` (pin-to-pin). It *also* declares its own `inputs`/`outputs`, so a
  visual flow is itself a node — **subgraphs are first-class** (a flow drops into
  another flow as one node). This is what `.flyde` (YAML) serializes.
- **`CodeNode`** — a node defined by code (TS) with inputs/outputs + a `run`
  function. **`MacroNode`** = a CodeNode with **configuration** (config-driven,
  expands at resolve time).

**A node IS code.** `run(args, outputs, adv)` where `outputs` is a map of RxJS
`Subject`s you *push* to (`outputs.result.next(v)`), and `adv` = per-instance
state/cleanup/error context.

**Execution = functional-reactive / message-passing** (not one-shot DAG eval):
- Input modes: **queued** (each arriving value = a separate run → how loops
  happen, no loop node), **sticky** (last value retained), **static**.
- **`reactiveInputs`** re-execute the node on a new value; **`completionOutputs`**
  explicitly declare which output signals "run done."

**Invocation from TS (the headline bridge):**
`const execute = await loadFlow("./x.flyde"); const { result } = execute({…});`
`loadFlow` composes the visual graph into an executable node and returns a plain
function. Runtime libs are MIT; the editor is AGPL.

## 2. Ideas worth stealing (value-to-effort)

- **A. Visual node IS a flow → first-class subgraph reuse (HIGH / MED).** A
  `VisualNode` declares its own pins and instances inside another flow. Map: let
  a saved part (`.prim.ts` + `meta.graph`) drop into another graph as one
  Call-like node whose sockets = its `meta.params` (in) + returned solid (out).
  Formalize "any part's typed param list = input sockets; its return = output
  socket" → recursive, uniform composition. Reuses our `Call` machinery.
- **B. Config-vs-wired pins, made first-class (HIGH / LOW).** MacroNode separates
  **configuration** (panel, baked at resolve) from **wired inputs**. This is
  exactly our `ArgValue = literal|expr|param`: literal/expr ≈ config, param/wire ≈
  connected. Steal: a visible per-socket toggle "static config ↔ promote to wired
  input," rendered differently. Nearly free — names a thing we already half-have.
- **C. `completionOutputs` = explicit "this is the result solid" (MED / LOW).**
  Declaring the result output beats inferring the terminal node. An explicit
  Output designation → `return <that>;` in emit. (We have an Output card —
  formalize it as a typed completion pin.)
- **D. `loadFlow(path) → execute(inputs)` ergonomics (MED / MED).** Steal the UX,
  not the runtime: when referencing another part, show its input pins as a typed
  call signature from `meta.params` + flag arity/type mismatch at wire time
  (catches our "stale arg keys" / `dt_sub` bugs).
- **E. Queued-input iteration as a Repeat mental model (MED / MED).** Flyde has no
  loop node — a queued input fires once per value. We emit a real `for`/`map`
  (better). Steal the UX: Repeat's loop var as a typed socket consumed
  per-iteration; frame as "this input is a list; body runs per element."
- **F. `.flyde` separates graph-data from code (LOW / LOW).** We already do this
  (`meta.graph` + emitted body). Validation we're on the right architecture.

## 3. NOT worth adopting

- **The RxJS Subject / reactive message-passing runtime** (`outputs.next()`,
  reactive re-fire, sticky/queued buffering, per-instance live state). Exists
  because flows run live as long-lived processes. We emit-to-source and bake
  once — no living graph. Take the *vocabulary* (completion output, reactive
  input, sticky), drop the machinery.
- **Implicit completion / loop-via-queued-input as the execution mechanism** —
  great for a stream runtime, wrong for deterministic emission. Our explicit
  emitted `for`/`map` is more debuggable.
- **MacroNode runtime expansion / dynamic resolution** — any equivalent expansion
  should happen at **emit time** into concrete source.
- **Global mutable `globalState`** — would make emit non-deterministic; keep nodes
  pure-functional.

## 4. Code↔Visual bridge & custom-node authoring (most relevant)

Flyde's standout, clean fit for emit-to-source:
- **"Wrap existing TS code in a node."** A dev writes a normal function + declares
  inputs/outputs → a node. For us: derive a node card from an exported function's
  typed params (we have `parseMetaParams`). Our `stdlib`/`stdstale` engines are
  *already* code nodes but hand-registered — a convention that auto-derives
  sockets from the signature closes the loop (no hand-naming).
- **Graph is source of truth, code is a view.** Flyde edits the same artifact both
  ways; we emit one-way. Adopt as POLICY (not true bidirectional sync — we've
  been bitten by lossy round-trips, `profile_editor_composeSource_bug`): emitted
  body is "generated — edit the graph."
- **Subgraph-as-node = the reuse primitive.** Highest-leverage borrow: if every
  saved part publishes `meta.params` as input sockets + its return as one output,
  users compose assemblies by nesting graphs — exactly our `.asm.ts` goal, made
  uniform with the primitive editor.
- **Config-vs-wired pin mode → our ArgValue toggle.** Surfacing "baked literal/
  expr vs live wired input" per socket is the cleanest authoring upgrade and is
  essentially free given `ArgValue` already encodes it.
