<!-- research-group: Archive -->
# Research — should the main graph editor adopt svelte-flow (`@xyflow/svelte`)?

> ARCHIVED (2026-07-13): decision settled both ways. The recommendation —
> **NO-GO for the editor** (keep the bespoke SVG canvas), **GO for /design** —
> is fully acted on: `/design` now ships `@xyflow/svelte` (`ArchGraph.svelte`,
> `nodes/*`), and the editor kept its bespoke canvas. The migration question no
> longer needs a live doc; kept as the rationale for why GraphEditorPane stays
> bespoke. Revisit only if the open auto-layout work (`todo_auto_layout`) ever
> wants a minimap enough to justify the viewport-only slice in "If we ever
> revisit".

Status: EVALUATION. Created 2026-06-16. Scope: the production CAD editor
`src/lib/shared/graph-editor/GraphEditorPane.svelte` (8021 lines) + its
extracted modules (`geom.ts`, `wire-state.svelte.ts`,
`graph-editor-bake*.ts`, `RightPane.svelte`, `Popovers.svelte`,
`ParamsCard.svelte`, `PropertiesCard.svelte`).

## TL;DR — recommendation: **NO-GO** for a wholesale migration.

svelte-flow would replace the *cheapest, most stable* part of this editor
(pan/zoom + generic node/edge plumbing, a few hundred lines) and force a
rewrite of the *expensive, load-bearing, hard-won* part (the socket↔DOM Y-math
in `geom.ts`, the inline mv/rot strips, the foreignObject param chips, the
welded-mesh-specific UX). The cost is high, the benefit is small, and the
domain-specific interactions don't map cleanly onto svelte-flow's
handle/node/edge primitives. **Keep the bespoke canvas.** Adopt svelte-flow
only for the new, greenfield `/design` architecture diagram
(`docs/plans/design-route-svelteflow.md`), where it's a clean win and acts as a
zero-risk pilot of the dependency.

A narrowly-scoped, optional follow-up (see "If we ever revisit") is the only
part worth keeping on the radar.

## What the editor actually is today

Not a generic flowchart. It is a **bespoke SVG canvas** (`<svg>` with one
`translate(pan) scale(zoom)` group, `onwheel` zoom-to-cursor, drag-to-pan) on
which ~12 node types render as `<foreignObject>` HTML cards (35 foreignObjects
in the file), with wires drawn as obstacle-routing cubic béziers, and sockets
whose pixel positions are computed to align with HTML rows *inside* those
cards. Key facts:

- **Node types**: Call, Method, Mv, Rot, Repeat, Polygon, PolyRepeat, Sketch,
  List, Stack, Group — each with bespoke geometry in
  `geom.ts::nodeSize/cardAutoWidth/cardMinWidth` and bespoke sockets.
- **Sockets are not generic handles.** `inputSocketAt` returns *different*
  Y per slot kind (`obj` at y+42, `arg` at y+56, mv/rot `child` at y+16);
  Polygon rows compute `polySockR`/`polySockZ`/`polySockRef` by a *cumulative
  walk* over heterogeneous row heights; Sketch rows delegate to a multi-column
  layout (`sketchColLayout`) with per-column X. The file's own comment calls
  these "the crown jewel of fragility."
- **Inline mv/rot strips**: a transform whose chain bottoms out at a Call is
  *not* a card — it renders as a 92×44 STRIP hanging off the Call's right edge,
  cascading down-then-right (`xformStripAt`, `xformSocketAt`, `xformOutputAt`,
  `xformArrows`). Per-axis sockets sit on the strip's top/bottom edge; sequence
  arrows trace operation order; the whole cluster shares ONE output socket.
- **foreignObject param chips**: the PARAMS card renders SVG-positioned chips
  with embedded numeric `<input>`s, a `ƒ` button, a 📌 pin, a 🗑 trash, and an
  *output socket on the chip* that feeds wires into call args / polygon coords /
  transform axes / sketch fields (`ParamsCard.svelte` + `geom.ts::paramPos/
  paramSocketPos/chipWidthFor`).
- **Wire drag** (`wire-state.svelte.ts`): a per-instance `WireState` class with
  ~12 *typed* drop targets (`endWireOnCallArg`, `endWireOnPolygonCoord`,
  `endWireOnTransformAxis`, `endWireOnSketchCoord`, `endWireOnContainerSlot`,
  `endWireOnRepeatCount`, …). Each commits a *different graph mutation*. Plus
  tap-to-connect for touch (implicit-pointer-capture release).
- **Bézier obstacle routing** (`geom.ts::bezier`): wires arch around blocking
  card bodies via sampled-intrusion passes — not a feature svelte-flow ships.
- **Live bake**: editing the graph re-emits source and re-bakes via Manifold;
  the canvas is one half of a split with `RightPane` (3D/SRC/MD/SVG/GLB/BREP).

## What svelte-flow provides

`SvelteFlow` component + `nodes`/`edges` reactive arrays, `<Handle>`
source/target connection points, built-in viewport pan/zoom/fit-view,
`Background`/`Controls`/`MiniMap`, custom node components via `nodeTypes`,
custom edges via `edgeTypes`, connection drag with validation, selection,
and (in v1.x) Svelte 5 compatibility.

## Pros of migrating

- **Deletes the pan/zoom/viewport math.** `pan`/`zoom`/`clientToGraph`/
  `onCanvasWheel`/drag-to-pan would be free. But this is ~a few hundred lines
  and it is *already written, working, and stable* — low ongoing cost.
- **Free MiniMap + fit-view + Controls.** Genuinely nice; we have an
  auto-layout plan (`docs/plans/auto-layout.md`) and no minimap today.
- **Standard handle/connection model** for the *simple* edges (Method `obj`/
  `arg`, container child slots) would be cleaner than bespoke sockets.
- **Selection/multi-select/keyboard** come for free.
- **Community-maintained**, typed, documented; offloads viewport edge cases
  (trackpad pinch, etc.).

## Cons / what would be LOST or fought

1. **The socket↔DOM Y-math doesn't go away — it gets harder.** svelte-flow's
   `<Handle>` positions itself relative to *its node's DOM box* (left/right +
   a CSS offset). Our sockets are computed in *graph/SVG coordinates* by a
   cumulative walk over heterogeneous HTML row heights (polygon r/z, sketch
   multi-column, the y+42/y+56 slot offsets). Re-expressing `polySockR`,
   `sketchSockX`, `xformSocketAt`, `paramSocketPos` as DOM-anchored handles is a
   *from-scratch reimplementation* of the exact thing the modularize plan just
   spent effort hardening and unit-testing (`geom.test.ts`,
   `geom.ts` is PURE + tested). We'd throw away tested code for an unproven
   port. (Memory: this Y-math "bit twice" historically.)

2. **Inline mv/rot strips have no svelte-flow analog.** A transform that
   renders as a satellite strip on *another* node's edge, with its own sockets,
   sequence arrows, and a shared cluster output — that is not a node and not an
   edge in svelte-flow's model. We'd either (a) keep rendering strips as custom
   SVG *inside* a custom node (so svelte-flow buys us nothing there) or (b)
   model each transform as a real node and lose the compact strip UX the user
   specifically has. Same for **param chips** (an output socket living on an
   `<input>`-bearing chip inside the PARAMS card, not a node).

3. **Bézier obstacle-routing is bespoke.** svelte-flow ships bezier/smoothstep/
   step edges but *not* the "arch around blocking card bodies" router in
   `geom.ts::bezier`. We'd reimplement it as a custom edge anyway.

4. **12 typed drop targets → svelte-flow's single `onconnect`.** Today each
   drop target commits a *specific* graph mutation (set call arg vs polygon
   coord vs transform axis vs sketch field). svelte-flow gives one
   `onconnect({source, target, sourceHandle, targetHandle})`; we'd encode the
   target semantics into handle IDs and write a big dispatch — i.e. rebuild
   `wire-state.svelte.ts`'s dispatch table, minus the touch tap-connect handling
   we already solved (`pointer-capture.ts`).

5. **Two coordinate systems / two state models to reconcile.** svelte-flow owns
   `nodes`/`edges` as *its* reactive arrays; our source of truth is the
   `composition-graph` (`Call/Mv/Rot/...` + `graph.layout[id]`). We'd maintain a
   bidirectional adapter (composition-graph ↔ flow nodes/edges) and keep it in
   sync on every mutation — new surface area, new bug class, exactly the
   "fresh-array props → effect loops" / identity-tracking hazard this codebase
   has been bitten by repeatedly (memory `fresh_array_props_effect_loops`,
   `canvas_height_contract`).

6. **Per-pane mount cost.** `/primitives` keeps N panes mounted at once
   (`{#each tabs}` + `class:visible`). N× full `SvelteFlow` instances (each with
   its own viewport store, MiniMap, listeners) is heavier than N× `<svg>`.

7. **Migration is not incremental.** The canvas, sockets, wires, strips, chips,
   and drag are one interlocking system. There is no "wrap half of it" path;
   it's an 8000-line rewrite of the riskiest component, during active feature
   work (modularize K.65 is mid-flight, BREP/sketch/warp in progress). High
   blast radius against memory `feedback_substantive_edits_in_subprocess`.

8. **New runtime dependency + attribution** on the product's core surface, for
   a feature set we mostly don't use (we use ~20% of svelte-flow and rebuild the
   other interesting 30% as custom nodes/edges anyway).

## Cost vs benefit

- **Benefit**: delete a few hundred lines of *stable* viewport code; gain a
  minimap + fit-view + selection. Marginal.
- **Cost**: reimplement the socket Y-math, strips, chips, obstacle router, and
  the 12-way wire dispatch as svelte-flow custom nodes/edges/handles + a
  bidirectional composition-graph↔flow adapter; carry a new dep on the core
  surface; do it as a non-incremental rewrite of the most fragile file in the
  repo. High.

The ratio is upside-down. svelte-flow shines when your nodes are mostly
uniform boxes with handles and your edges are generic — it does not shine when
the node *internals* (chips with inputs, strips, multi-column sketch rows) and
the *typed wiring semantics* are the entire product, which is the case here.

## If we ever revisit (narrow, optional)

The single defensible slice would be **viewport-only**: adopt svelte-flow's
pan/zoom/MiniMap/fit-view while keeping *all* node/edge rendering as custom
components — i.e. use it as a viewport shell, not a node framework. Even this
collides with the existing working pan/zoom and the per-pane multi-mount, so it
only makes sense if/when the auto-layout work (`docs/plans/auto-layout.md`)
wants a minimap badly enough to justify the adapter. Gate it behind: (a)
`/design` shipping svelte-flow first and proving the dep, (b) modularize K.65
finishing so the editor isn't a moving target, (c) a spike that ports ONE node
type + its sockets to confirm the Y-math survives DOM-anchored handles. Absent
all three, stay bespoke.

## Bottom line

NO-GO for the editor. GO for `/design` (separate plan). Re-evaluate the
viewport-only slice only after `/design` ships svelte-flow and auto-layout
demands a minimap.
