# Typed ports — a PortType class + registry for node sockets

**Status:** design, 2026-06-26 (user proposal, during the #11 expr-list wiring).
Motivated by the realization that each new socket kind (expr-list-ref, repeat-ref,
coord, profile, geometry) is hand-wired across NodeCard render + wire-state +
geom + emit. The deep-research pass (`expression-list-builder.md`) recommended a
structural socket-type system; this is that, made first-class.

## The problem it solves

Today wiring is **per-kind, hardcoded everywhere**:
- NodeCard has an `{:else if pt?.kind === '…'}` arm per polygon-point kind.
- wire-state has an `endWireOn<Thing>` handler per drop target.
- geom has a row-height/socket-Y branch per kind.
- emit has a splice branch per kind.
Adding ONE new shape (a `list<transform>` for a repeat, a `list<op>` for a sketch)
means touching all four layers. It doesn't scale, and nothing can *reason* about
what wires to what.

## The model — a `PortType`

Every socket (input or output) declares a **type**. A `PortType` is a small
descriptor + a set of HOOKS, kept in a registry:

```ts
type Direction = 'in' | 'out';
type Cardinality = 'one' | 'list';                 // a value, or a flat list of them
type ElemShape = 'scalar' | 'point' | 'op' | 'transform' | 'geometry' | 'object';

interface PortType {
  id: string;                  // 'scalar' · 'list<point>' · 'geometry' · 'list<transform>'
  elem: ElemShape;
  card: Cardinality;
  label: string;

  // ── visual hook (render the socket dot) ──
  color: string;
  glyph?: string;              // e.g. '[]' for a list, 'ƒ' for an expr output

  // ── compatibility hook ──
  // Can an OUTPUT of this type feed an INPUT slot of `target`? Default rule:
  // same elem AND (card matches OR a `one` broadcasts into a `list` slot —
  // the research's longest-repeat-last lacing). Overridable per type.
  canFeed(target: PortType): boolean;

  // ── emit hook ──
  // How a value of this type splices into a consumer slot's emitted source
  // (e.g. list<point> → `...V_out` into polygon.points[]; scalar → the arg).
  emitInto(ctx: EmitSlotCtx): string;
}
```

A registry: `registerPortType(pt)`, `portType(id)`, `allPortTypes()`.

## Hooks = the per-type behavior (the "hook into them" the user asked for)

Instead of four layers of branches, a socket says `portType: 'list<point>'` and
the four layers ASK the type:
- **render** → `pt.color` / `pt.glyph` draw the socket.
- **wire-state** → `srcType.canFeed(slotType)` gates the drag (one generic
  `endWireOnPort(slotRef)` instead of N handlers).
- **geom** → socket Y/row height from the type's row metrics.
- **emit** → `pt.emitInto(ctx)`.
New shape ⇒ register ONE PortType, no edits to the layers.

## Initial port-type set

`scalar` (number) · `list<point>` ([r,z][]) · `geometry` (a Manifold/part) ·
later: `list<op>` (sketch ops) · `list<transform>` (repeat placements) ·
`object`/`record`. The #11 expr outputs (`shape:list, elem:point`) map straight
onto `list<point>`; the existing coord/profile/geometry sockets get types
retro-fitted so the OLD wiring becomes the FIRST consumer of the new system.

## The two payoffs the user flagged

1. **Generative capability.** Once every port is typed, the graph is
   *machine-reasonable*: a generator (or the ✨ AI) can enumerate output ports +
   open input slots, find type-compatible pairs, and AUTO-WIRE / suggest wirings —
   build whole graphs by type-matching instead of bespoke prompt templates. A
   "list<point> output + a polygon with an empty points slot" is a mechanical
   match. This is the substrate for a generative "builder."
2. **Scalability.** Adding op-lists, transform-lists, records, or a brand-new
   consumer is "register a PortType + its hooks," not a sweep across NodeCard /
   wire-state / geom / emit. The 3-repeat unification (#11) and repeat-as-sweep
   (#12) both fall out as just new typed ports + consumers.

## Migration (incremental, not a big-bang rewrite)

1. **Define `PortType` + registry + the 3 core types** (scalar, list<point>,
   geometry). No behavior change yet — pure addition.
2. **Retrofit ONE existing pair** through the registry (e.g. the polygon coord
   input + a scalar output) so the generic `endWireOnPort` + render path is
   proven against working wiring.
3. **Build the #11 expr-list-ref wiring ON the registry** (the create-affordance:
   drag a `list<point>` output onto a polygon — `canFeed` gates it, `emitInto`
   splices it). This is the first NEW consumer that never touches the old layers.
4. **Migrate the remaining ad-hoc kinds** (repeat-ref, profile, geometry) onto
   the registry opportunistically; delete the per-kind branches as each lands.
5. **Generative hook** — an `autoWireSuggestions(graph)` that returns
   type-compatible (output → open-slot) pairs; surface in the ✨ menu later.

## Open questions

- Type IDENTITY: nominal (`'list<point>'` string id) vs structural (`{elem,card}`
  compared field-wise). Start nominal (simple, matches Blender's named sockets);
  the research warned against deep structural/tree typing early.
- Where the registry lives: `src/lib/cad/port-types.ts` (pure, importable by emit
  + the editor). Hooks that need DOM (render) stay thin / data-only; the editor
  reads `color`/`glyph` and draws.
- Coexistence with the current `ArgValue` (`literal|expr|param`) — ports are about
  SOCKET typing/wiring; ArgValue stays the value model. A wired input still
  resolves to an ArgValue ref; the PortType just gates + describes the wire.

## Decision needed

Scope of the first cut: (a) the registry + 3 core types + retrofit one pair
(proves the design, no UX change), then build #11's create-affordance on it; vs
(b) a broader port-typing of all existing sockets up front. Lean (a) —
incremental, each step shippable, low risk.
