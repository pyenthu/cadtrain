# Plan: the Sketcher as a focused, wireable 2D lens on a graph node

> 2026-06-13. Supersedes the ad-hoc sketcher layout work. The sketcher is NOT
> a separate flat-list editor — it is a **focused, visual 2D view of one sketch
> NODE that lives in the graph**, and it must keep the graph's **card +
> connector (wiring) system**. Wiring params into sketch coordinates is the
> key requirement.

## Concept

A sketch is already a graph node (`type:'sketch'`): its output wires into a
revolve/extrude `profile`, and each coordinate (`r`/`z`, spline `pts`/handles,
fillet `radius`, chamfer `dist`) is an `ArgValue` that can be `literal | param
| expr`. The **sketcher** is the focused, visual way to edit *that* node:

- It shows ONLY the cards relevant to this sketch — the **PARAMS card** and the
  **sketch node card** — not the whole graph (that's the "less clutter").
- It keeps the **connectors**: you drag a param's output socket onto a sketch
  coordinate to wire `p.<name>` in — exactly the card+wire interaction from the
  main graph, scoped to these two cards.
- It is **visual**: the sketch's points/handles are draggable in a 2D canvas,
  and those on-canvas points are ALSO wire targets.
- The 3D bake stays visible on the right so the part updates live.

So: the graph is the home (sketch node + its external connectors live there);
the sketcher is a lens that focuses on one sketch node + the params feeding it.

## Layout

```
┌─ tools (horizontal strip, top) ─────────────────────────────┐
│ ⬚ select · ╱ line · ∿ spline · ◜ fillet · ⊿ chamfer · ⤢ fit · ✓ Done │
├──────────────┬───────────────────────────────┬──────────────┤
│ PARAMS card  │   2D draw canvas (visual)      │  3D BAKE     │
│ (wireable,   │   • draggable points/handles   │  (live,      │
│  output      │   • each point exposes r/z     │   right)     │
│  sockets) ───┼──▶ wire targets (sockets)      │              │
│              │   • spline pts + end handles   │              │
│ sketch node  │                                │              │
│ card (coord  │                                │              │
│  sockets) ◀──┘   wires render param → coord   │              │
└──────────────┴───────────────────────────────┴──────────────┘
```

- **Tools** move from the left vertical rail to a **horizontal strip on top**
  (user request).
- **Left column** holds the two real cards: the PARAMS card (output sockets)
  and the sketch node card (the ops list WITH its per-coord input sockets —
  the `ge-sock in poly-coord` sockets already built). Wires draw between them
  just like the main graph.
- **Center** is the 2D draw canvas (Phase-2 draggable points/handles).
- **Right** is the existing 3D BAKE pane (already kept visible via the
  canvas-pane overlay + draggable divider).

## Wiring — the key part

Two equivalent ways to wire a param into a coordinate, both reusing the
existing machinery (`startParamWire` on a param output socket →
`endWireOnSketchCoord` / `endWireOnSketchPoint`):

1. **On the cards** (already works): drag the PARAMS card's output socket onto
   a coord's input socket on the sketch node card. We just need both cards
   rendered inside the sketcher with their sockets + the wire layer.
2. **On the 2D canvas (visual, NEW)**: each draggable point shows small `r`/`z`
   wire sockets; drag a param output onto a point's `r` or `z` socket to wire
   it. A wire renders from the param card to that point. This is the "visual"
   wiring the sketcher is for. New handler `endWireOnSketchPoint(ev, sid,
   opIdx, axis)` → `setSketchOpField`/`setSketchSplinePoint` with
   `asParam(...)`.

A wired coordinate shows its `p.<name>` chip (on the card row AND a small badge
on the canvas point) and re-bakes live when the slider moves.

## What we KEEP vs CHANGE

- KEEP: the main graph (full card+connector system) — untouched. The sketch
  node's external wire (→ revolve profile) is managed there.
- KEEP: the 2D draw canvas + Phase-1/2 spline engine + handle dragging.
- KEEP: 3D pane visible on the right.
- CHANGE: drop the flat PARAMS panel + flat OPS list added recently. Replace
  with the real **PARAMS card + sketch node card** (sockets + wires) on the
  left, and move tools to a top horizontal strip.
- ADD: on-canvas per-point r/z wire sockets (visual wiring).

## Phasing

- **S.1 — cards + wiring in the sketcher.** Render the real PARAMS card +
  sketch node card (with their existing sockets) in the sketcher's left column;
  enable the wire layer between them (reuse `startParamWire` /
  `endWireOnSketchCoord`). Drop the flat panel/list. Verify: drag a param onto
  a sketch coord socket inside the sketcher → wired, re-bakes.
- **S.2 — tools to a top horizontal strip.** Move the tool rail to a top bar;
  keep Fit/Done/the corner dial.
- **S.3 — visual on-canvas wiring.** Per-point `r`/`z` sockets on the 2D
  canvas points (+ spline pts/handles); `endWireOnSketchPoint`; render the
  param→point wire; on-canvas `p.<name>` badge. This is the headline "visual +
  wiring" capability.

Each phase is independently shippable and verified in-browser (drag-wire a
param, watch the 3D re-bake).

## TODO — edge-aware point insertion (2026-06-13)

Today adding a point/spline/op **appends to the END** of the ops list
(`addSketchOp` appends, or inserts after a passed `afterIdx`). It should be
smarter: clicking on/near an **edge** should **insert the new point ON that
edge** — i.e. split that segment by inserting the op at the right sequence
position — rather than always tacking it onto the end. Same for splines.

Approach: on a canvas click with the line/spline tool, find the nearest EDGE
(the segment between consecutive vertices, via point-to-segment distance over
`se.pts`/the resolved vertices), map it back to the **start vertex's op index**
(`entryIdxForEvalIdx`-style), and call `addSketchOp(graph, sid, tool,
startVertexOpIdx)` so the new op lands between the two endpoints. If the click
is far from any edge (or near an end), keep the append behaviour. Bonus: insert
the click coordinate as the new point's literal r/z so it lands where clicked.

## Open questions for the user

1. Cards on the **left column** (as drawn) vs a **floating** params card +
   sketch card you can position? (Left column = simplest, recommended.)
2. On-canvas wiring (S.3): per-point **r/z sockets** beside each point, or drag
   a param onto the point and **pick r/z** from a tiny menu? (Sockets = more
   direct, matches the card sockets.)
