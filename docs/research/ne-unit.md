<!-- research-group: Node editors -->
# Unit (Samuel Timbó) — node-editor research

> Source: github.com/samuelmtimbo/unit. Live visual dataflow environment.
> Lens: what improves OUR emit-to-source CAD node editor (GraphEditorPane).

## 1. Core architecture

**Unit/graph/pin model.** A *unit* is a Multi-Input-Multi-Output finite state
machine — a black box with named input/output *pins*. A program is a *graph* of
units wired pin-to-pin (explicitly "the 2D evolution of the CLI" — pins as
stdin/stdout piped together). Two kinds: leaf/system units (native code) and
*graph units* (composed of other units) — the same abstraction is both
primitive and composite.

**Nesting / "units of units."** Composition is first-class and bidirectional:
- Multiselect + long-press **composes a subgraph into a new unit** (collapse N
  nodes → one reusable unit whose pin interface is derived from boundary-crossing
  pins).
- The inverse **"explodes"** a graph unit back into its nodes.
- Long-click to **enter** a graph unit and edit its internals in place.
A saved subgraph is indistinguishable from a primitive at the call site.

**Merges — the notable wiring primitive.** Connections aren't plain A→B edges;
Unit calls them *merges* — a junction object that fuses multiple pins into one
shared value node (many-to-many fan-in/out through one named node).

**Functional vs iterative pins.** *Functional* inputs must all be activated
before data moves and are invalidated together (barrier/all-or-nothing — good
for config). *Iterative* inputs are independent (good for streams). Only data in
**constant** inputs is persisted on save (literal defaults serialize, live
stream values don't).

**Runtime.** Live, reactive **dataflow** — pin invalidation propagates and
triggers re-evaluation. An *interpreted live runtime*, not a compiler.

**Serialization.** A "Unit JSON bundle" — `GraphSpec`/`UnitSpec` holding pins,
merges, sub-units (by spec id), and persisted constant inputs.

**Types.** Pins carry a structural/JSON-shaped type; compatibility checked at
connect time (green highlight). Lightweight, structural, not nominal.

## 2. Ideas worth stealing (value-to-effort)

**A. Collapse-to-subgraph + explode (HIGH / LOW–MED).** Multiselect → "compose
into unit"; interface = pins crossing the selection boundary; inverse "explode"
inlines it back. *Biggest leverage item.* Composes cleanly with emit-to-source:
a collapsed subgraph emits an `export function` and the parent emits a `Call`.
Maps to us: selection → derive free inputs (params/exprs in) + the output →
synthesize a `.prim.ts`/inline helper whose signature is those free vars in
`meta.params` order; replace selection with a `Call`. Boundary wires become args
(our `ArgValue = literal|expr|param` already models these). Explode = re-expand
the callee's `meta.graph`.

**B. The "merge" junction node (HIGH / LOW).** A first-class named junction wired
through several producers/consumers — a "shared dimension/datum" node (wire
`wallThickness` once, fan to many parts). Emit as a hoisted `const <name> =
<expr>;`; downstream sockets become `param`/`expr` pointing at it.

**C. Functional (barrier) vs iterative pins → "all-args-required" sockets (MED /
MED).** Mark a node's input set all-or-nothing; refuse to emit a `Call` with
unbound required args, surfaced inline (ties into existing call-drift /
expected-params machinery). A pre-emit lint, not runtime behavior.

**D. Constant-vs-stream persistence rule (MED / done-ish).** Only literals/exprs
persist, derived/preview values don't — validates our "graph is source-of-truth,
geometry is baked/cached, never serialize bake output" stance.

**E. Spec-as-injectable, searchable, instantiable-N-times (MED).** Every saved
part is a callable unit in search; drag-a-file-to-inject. Strengthens treating
volume parts + stdlib uniformly as callable units (our sidebar + `Call`).

## 3. NOT worth adopting

- **The live reactive interpreter / pin-invalidation runtime** — antithetical to
  emit-to-source; would be a second execution engine fighting the pipeline. Keep
  the graph as a *compile target*, not a running machine.
- **Stateful units / FSM memory pins** — CAD geom is pure (params → mesh);
  per-pin state breaks determinism + the bake cache.
- **Stream/event pins** — no streaming domain. Borrow only the barrier-validation
  idea (C).
- **Live continuous propagation as the edit metaphor** — we commit-on-Enter and
  bake on demand; per-keystroke re-bake thrashes the WASM singleton.

## 4. Directly relevant to Repeat / subgraphs / grouping

Unit makes **"a subgraph" and "a unit" the same object**, with *collapse* +
*explode* + *enter-to-edit* over that equivalence. Applied to Repeat:

1. **Repeat body = an editable subgraph**, entered as its own mini-canvas with a
   clear boundary; the loop variable is a *boundary input pin* (`loopVar`). The
   body becomes "a unit parameterized by `i`."
2. **Loop var as a promoted boundary pin** — formalizes capture; makes "what's in
   scope inside the loop" explicit + visual (our new scope-hint is the text
   version of this).
3. **Collapse-to-unit → reusable Repeat bodies** — promote a refined body to a
   named `Call`-able part, then invoke it inside the loop (iterate a reusable
   component, not inlined nodes).
4. **Explode as the escape-hatch safety net** — pair our raw-code body with a
   reversible explode so dropping to code isn't a one-way trap.
5. **Merges inside loops = accumulator clarity** — model the loop's reduce step
   (`acc = acc.add(...)`) as an explicit merge/accumulator node with a chosen op.

**Net:** the lesson is structural — *unify subgraph and unit, expose
boundary-crossing values as pins, make collapse/explode/enter first-class.* That
trio is the highest-value, emit-compatible upgrade for Repeat and node-grouping.
