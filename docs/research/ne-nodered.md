<!-- research-group: Node editors -->
# Node-RED — node-editor research

> Source: nodered.org + the linked collection. The most widely-used node-based
> flow editor; battle-tested UX. Lens: our emit-to-source CAD node editor.

## 1. What the linked collection is

`flows.nodered.org/collection/h_m99XeRlM0a` → **"Interesting Flows," a personal
curated bookmark list** (3 items, ~2.8 yrs old). The page is client-rendered so
the bundled items aren't externally readable. A "collection" is just a
user-curated folder of published flows — not a coherent feature set. **So the
value is entirely in Node-RED's editor MODEL**, below.

### Node-RED core model
- **Flow** — a workspace tab; top-level container of connected nodes (≈ our
  graph / one part).
- **Node** — a processing block; **≤1 input port, N outputs**; configured via a
  double-click **edit dialog**.
- **Wire** — carries `msg` objects from output → input at *runtime*.
- **msg / msg.payload** — plain JS object passed along wires; a **dynamic
  message-passing** execution model (flow-based programming).
- **Palette** — left searchable list of node types by category; drag to canvas.
- **Configuration nodes** — shared reusable config referenced by many nodes.
- **Subflows** — selection of nodes collapsed into one reusable palette node with
  **per-instance properties** (env-var params); no recursion.
- **Groups** — purely *visual* boxing/labeling; no execution/reuse semantics.
- **Link nodes** — virtual wires across tabs with no drawn line.
- **Debug node** — sidebar inspector printing `msg` for live introspection.

## 2. Ideas worth stealing (value ÷ effort)

| # | Idea | Why / how it maps | V/E |
|---|------|-------------------|-----|
| 1 | **Searchable categorized palette** (node types + stdlib/volume parts) | Drag-from-list beats remembering names as the catalog grows; `/api/primitives/list` data exists. Mirrors Rule 16 (location = category). | High / Low–Med |
| 2 | **Double-click node → edit dialog** | Standardizes ArgValue editing (literal/expr/param + ƒ chip) in a FloatingPanel; commit-on-Enter. We're already here — formalize it. | High / Low |
| 3 | **Inspection: per-socket resolved-value + type preview** | Node-RED's killer affordance is seeing data on the wire. Our analog: show the resolved ArgValue + type at each socket and a node error-chip on emit/bake fail. | High / Med |
| 4 | **Subflows → reusable "group node"** (see §4) | Upgrades Repeat + enables user-defined composite parts as palette nodes. | High / Med–High |
| 5 | **Export/Import graph as JSON** (clipboard + file) | Instant duplication/sharing/bug-repros without a volume round-trip; we already persist `meta.graph`. Sidesteps the prod-volume e2e blocker. | High / Low |
| 6 | **Link nodes** (virtual wires) | Declutter long wires in tall stacks; "wire by name" — pure render sugar over the same model edge. | Med / Med |
| 7 | **Visual groups** (box + label, non-semantic) | Cheap organization for big graphs; layout-only, no emit impact. | Med / Low |
| 8 | **Node status line** (vert count / z-extent / outer-r under a node) | We already report these from `/preview`; surface under the node. | Med / Low–Med |

**Top 3:** #5 (export/import JSON — trivial, dodges the volume blocker), #1
(palette), #3 (socket value/error inspection).

## 3. NOT worth adopting

- **The message-passing runtime (`msg`/`msg.payload`).** The foundational
  mismatch: Node-RED is a dynamic async interpreter; we emit deterministic TS and
  bake once. Our "data on the wire" is a **statically-resolved ArgValue**, not a
  live message — which is why #3 is a *resolved-value preview*, not a runtime
  debugger.
- **One-input-port constraint.** We *want* multiple typed input sockets
  (positional `meta.params`). Don't inherit their port limit.
- **Config nodes as a separate sidebar concept.** Their reason is shared live
  connections; our shared values are already `param` ArgValues.
- **The `Function` (arbitrary runtime JS) node.** No runtime interpreter by
  design. Raw escape should be an **emitted expr string validated at emit time**
  (exactly our new Repeat `bodyExpr`), not a sandbox execution.
- **Wire-as-execution-order.** For us a wire is a dataflow dependency the emitter
  topo-orders; don't expose timing/sequencing UI.

## 4. Subflows / grouping → improving Repeat

Two distinct concepts; we want **both**, kept separate:

**(a) Groups = visual only** — labeled box, no semantics. Cheap (#7); readability
of large graphs.

**(b) Subflows = reusable composite, parameterized per instance** — the model to
copy for Repeat and user-defined composite parts:
- **Creation by selection** — "Selection → Subflow": collapse picked nodes into
  one. For us: emit the subgraph as a named helper with a hoisted param list,
  represent as one Call-like node (the deferred composite-emit / `place([...])`
  work, memory `g_star_parts_curated_list` #167).
- **Per-instance properties** — each instance overrides its params. **Repeat
  analog:** the loop body is a subflow instantiated N times; `loopVar` is exactly
  a per-instance env var. Emit: `for (i…) { bodyFn(i, …) }`.
- **Explicit boundary ports** — Node-RED's grey in/out nodes define the subflow
  interface. For Repeat: make explicit which sockets are **per-iteration** (vary
  with `loopVar`) vs **shared** (constant) — disambiguates "which arg is the loop
  index," pairs with our 3-state socket colours.
- **No-recursion rule** — forbid a composite/Repeat containing itself; keeps the
  emitter's topo-sort acyclic (cheap guard).
- **Palette promotion** — a saved subflow becomes a reusable palette node; for us
  a user-defined composite becomes a **volume part** reappearing in the sidebar
  (Rule 16).

**Concrete Repeat recommendation:** model the body as an implicit single-instance
subflow with interface `(loopVar, ...sharedParams)`. Add a boundary-port editor
(per-iteration vs shared inputs) + an instance-properties panel for shared
params; emit a named body function called in a `for` loop. Reuses our existing
`loopVar`/modifiers/bindings model and gives Repeat the same "collapse to one
node, parameterize per instance" clarity — staying within deterministic
emit-to-source.
