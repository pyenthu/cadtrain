# Professional 2D profile sketcher — plan (bundle M)

> Status: design. Surfaced 2026-06-12 — the hand-rolled SVG vertex editor
> is too manual; the user wants a professional 2D CAD sketch environment
> with **curve / fillet / chamfer operators that live IN the graph**, a
> **dedicated full-page editor** (occupies the whole tab while editing),
> and its **own toolbar**. Keep the vector/SVG approach — just make it a
> real sketcher.

## Today vs. goal

**Today.** A profile is a flat `polygon` node — an ordered list of `(r,z)`
points, each literal/param/expr. The editor is a small SVG of draggable
dots in a popup + the right pane. No curves, no fillets/chamfers, no
snapping/dimensions; everything is point-by-point.

**Goal.** A profile is a parametric **sketch**: an ordered list of
*operators* (line, arc, spline, fillet, chamfer, offset) that COMPILE to
the `(r,z)` point list the revolve/extrude already consumes — so the bake
pipeline is untouched. The operators are graph entries (radius can be
`p.filletR`), and editing happens in a full-tab sketcher with a dedicated
toolbar.

## Package choice — Maker.js (recommended)

**[Maker.js](https://maker.js.org)** (Microsoft, MIT, pure-JS, no WASM) is
purpose-built for 2D CAD line drawings / outlines. It gives us, for free,
exactly the operators the user named:

- Parametric models: `line`, `arc`, `circle`, **`BezierCurve` (splines)**.
- **`chain.fillet(radius)`** — round corners; **dogbone/chamfer** via chain
  corner ops; **`expandPaths(distance)`** — offset (wall thickness).
- `model.combine*` — 2D boolean union/subtract/intersect (feeds the K.58
  CSG-2D idea).
- `measure.*` — bounds/length; `model.toSVG()` (render) + **DXF export**
  (real CAD handoff); `model.findChains` + path sampling → our `(r,z)`.

It renders to **SVG** (keeps the graphics approach) and samples to points,
so r_revolve/r_extrude consume the result unchanged.

**Alternatives considered (why not):**
- *Paper.js* — beautiful bezier editing + boolean, but no CAD fillet/
  chamfer-by-radius or DXF; we'd re-implement the CAD ops.
- *JSketcher* — a full parametric sketcher WITH a constraint solver, but
  it's a whole app; embedding + theming it is heavier than building on
  Maker.js. Revisit if we want true geometric constraints (M.4+).
- *@flatten-js/core* — solid 2D geometry (boolean, relations) but it's a
  library, not an editor/renderer; could pair with Maker.js if needed.
- *OpenCascade.js* — full CAD kernel; massive WASM, overkill for 2D.

M.0 validates this choice before we commit.

## Architecture — sketch operators in the composition graph

New node type **`sketch`** (sits where `polygon` does today). Its body is an
ordered `ops` list; each op is a graph entry with param/expr-able fields:

| op | fields | meaning |
|---|---|---|
| `moveTo` / `lineTo` | `r, z` | straight segment (today's points) |
| `arcTo` | `r, z, radius, sweep` | tangent/【radius arc to a point |
| `spline` | `through[] | control[]` | Bézier through/with control pts → tessellated |
| `fillet` | `atVertex, radius` | round the corner at a prior vertex |
| `chamfer` | `atVertex, dist (×angle?)` | bevel the corner |
| `offset` | `dist` | wall thickness (expandPaths) |
| `mirror` | `axis` | mirror the chain |

`resolveProfile` / a new `compileSketch` runs the ops through Maker.js →
a chain → **samples to `(r,z)` at the `segments` dial** → the same point
list r_revolve/r_extrude already eat. **Downstream bake is unchanged.**
`polygon` stays as the degenerate all-`lineTo` case; existing parts
auto-migrate (each `(r,z)` point → a `lineTo` op) on first open.

Because ops are graph entries, a fillet radius wires to `p.filletR` and
re-bakes live like any other param — the user's "incorporated into the
graph" requirement.

## Dedicated full-page editor + toolbar

- **Sketch mode.** Opening/editing a sketch EXPANDS it to occupy the full
  tab content (the 3D-bake pane collapses to a strip or a toggle). An
  "✎ Edit sketch" affordance enters it; "✓ Done" exits back to the graph.
- **Dedicated left toolbar:** select · line · arc · spline · fillet ·
  chamfer · offset · mirror · dimension · snap-to-grid · zoom/fit ·
  exit-sketch. (Constraints/dimensions land in M.4.)
- **Maker.js render** of the outline (smooth arcs/splines, visible
  fillets/chamfers) + an interaction layer (drag points/handles, click two
  segments → fillet/chamfer with a radius dial, snapping, the black/white
  hover tooltip + point-order markers already shipped).
- The current popup/right-pane previews become the "mini" read-only view;
  the full-tab sketcher is the "max" edit view.

## Phases (bundle M)

- **M.0 — spike + package validation (½ day).** Add `makerjs`; prove a
  parametric path (line + arc + fillet + Bézier) → `toSVG()` render → sample
  to `(r,z)` → bakes through `r_revolve`. Bench tessellation cost. Decision
  gate: Maker.js fits, or fall back to Paper.js + hand-rolled CAD ops.
- **M.1 — sketch node model (2 days).** `sketch` graph node + op entries
  (lineTo/arcTo/spline/fillet/chamfer/offset); `compileSketch` via Maker.js;
  composition-emit + hydrate round-trip; auto-migrate existing polygons.
  No new UI yet — author ops in the graph; verify bake parity vs the old
  polygon.
- **M.2 — full-tab sketch editor + toolbar (2-3 days).** Expand-to-full-tab
  sketch mode; the dedicated toolbar; Maker.js outline render + drag/select
  interaction; enter/exit.
- **M.3 — operator UX (2 days).** Click-two-segments → fillet/chamfer with a
  live radius dial; add spline through points; offset for wall thickness;
  each writes a graph op. Live re-bake.
  - ✅ **Per-corner fillet (engine) — DONE 2026-06-13** (`1faaf0f`).
    `compileSketch` now fillets each corner with its OWN radius via
    `makerjs.path.fillet` (was `chain.fillet(min(radii))` = all corners, one
    radius). Each fillet op's existing radius field is now truly per-corner;
    unfilleted corners stay sharp; spline corners deferred to M.4. Tests in
    `src/lib/cad/sketch.test.ts`.
  - ✅ **Click-to-fillet/chamfer + live radius dial — DONE 2026-06-13**
    (`91c3da9`). Click a corner with the fillet/chamfer tool to round/bevel
    THAT corner; a slider+number dial edits its radius/dist live; gold badge
    marks modified corners. Same commit: tools moved to a LEFT vertical rail
    and the status/dial/Done bar is a DRAGGABLE floating top bar.
  - ⏳ Remaining: spline-through-points; offset (wall thickness, expandPaths).
- **M.4 — pro polish (own session each).** Snapping + grid; dimensions /
  light constraints; DXF export; 2D-CSG (folds in K.58); mirror/symmetry.

## Open decisions (for the user)

1. **Editor surface** — full-tab overlay inside `/primitives` (recommended;
   no route change, keeps tab state) vs. a dedicated `/sketch/[id]` route.
2. **Scope of M.1 first cut** — just curves (arc/spline) + fillet/chamfer,
   or include offset + 2D-boolean (K.58) from the start?
3. **Constraints** — skip geometric constraints for now (Maker.js has none)
   and revisit JSketcher only if dimension-driven constraints become a real
   need?
