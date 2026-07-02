# Spline "plot in the main 3D bake" overlay (TODO #24)

**Status: SHIPPED (this branch).** VIEW-ONLY diagnostic overlay — no change to
emit, bake output, the GLB, or the spline model beyond one sparse flag.

## The need

> "On the spline I want the option of plotting it for diagnosis in the main 3D
> bake — because if I have two splines for r_sweep I can't see them relative to
> each other."

Each spline is editable in its own `SplineEditorPopup` 3D scene, but those scenes
are independent — you cannot see an r_sweep **path** spline and its **section**
spline (or any two splines) *relative to each other and to the swept geometry*.
This adds a per-spline toggle that draws the spline's resolved curve + control
points as a coloured overlay INSIDE the main bake canvas.

## Design

- **Per-spline flag** `SplineNode.plot?: boolean` (+ optional `plotColor?:
  '#rrggbb'`). SPARSE — absent/false ⇒ no overlay, zero overhead, byte-identical
  emit. Toggled by:
  - a **📈 plot** button in `SplineEditorPopup.svelte` (next to the ◯ loop / N
    controls), and
  - a small **📈** glyph on the spline `NodeCard.svelte` card (bottom-left).
  Both call `setSplinePlot(graph, id, v)` (`composition-graph-mutate.ts`).
- **Resolve points (reuse, no second resolver):** for each spline with `plot ===
  true`, GraphEditorPane resolves control points via the manual `points` array,
  or — when wired (#26) — `resolveWiredSplinePoints(graph, pointsExpr)`
  (`spline-eval.ts`). The display curve is `resampleSpline(points, N, closed)`
  (`spline-resample.ts`) — the SAME centripetal-Catmull-Rom + arc-length resample
  the bake uses, so the plotted curve matches the swept spine.
- **Flow GEP → canvas → scene:** GEP builds a `splineOverlays` `$derived`
  (`{id, color, curve, points, closed}[]`, auto-assigning distinct palette
  colours so path vs section read apart), passes it to `RightPane` →
  `PrimitiveDualCanvas` (`overlays` prop) → `PrimitiveDualScene` (`overlays`
  prop).
- **Render + ALIGNMENT (critical):** `PrimitiveDualScene` builds one
  `THREE.Group` per overlay — a thin coloured tube (`TubeGeometry` over a
  `CatmullRomCurve3` of the dense curve) + a small sphere at each control point,
  radius sized from the part bbox. The overlay groups are rendered **inside the
  same live-mesh `<T.Group position={meshPos}>` that sits within the view-scale
  `<T.Group scale={[xScale, xScale, zScale]}>`**, so they share the mesh's
  Z-down orientation AND the view scale. Change the ⚙ X-dia / Z-depth scale and
  the overlays move/scale WITH the swept tube; they never drift.
- **GPU cleanup:** an `$effect` disposes each overlay group's geometry/material
  when the set is rebuilt or the scene unmounts; `invalidate()` requests a frame
  on toggle so it shows without an orbit nudge.

## The SECTION caveat

A **section** spline is a small 2D loop of OFFSETS around the origin, so it plots
as a little loop AT the origin — not swept along the path. That is expected and
still useful for diagnosis (you see the section's size/shape relative to the
tube). The **path** spline plots as the world-space spine, aligned with the tube.
A future option could plot the section swept along the path — out of scope here.

## Constraints honoured

- VIEW/diagnostic only: emit, bake, GLB and the spline geometry are untouched.
  `setSplinePlot(true)` does NOT change `emitSplineBlocks` output (unit test).
- Overlay is editor-only — never baked into the part or the GLB.
- Off ⇒ no overlay, no cost.
- Reuses `spline-eval` + `resampleSpline`; no second point-resolver added.

## Verification

Built a `plot_demo` part (path spline + section spline → r_sweep, both plotted)
and opened it in `/graph-editor`:
- 3D bake showed BOTH splines in distinct colours — RED path curve tracing the
  swept-tube spine (aligned), BLUE section loop at the origin — with control-point
  spheres.
- Changing the ⚙ Z-depth view scale kept the overlays aligned with the tube.
- Toggling 📈 off on a spline removed only that overlay.
- `bun run test` (incl. `__spline_plot_flag.test.ts`) + `bun run build` green.

## Files

- `src/lib/cad/composition-graph-types.ts` — `SplineNode.plot?` / `plotColor?`
- `src/lib/cad/composition-graph-mutate.ts` — `setSplinePlot`
- `src/lib/cad/composition-graph-hydrate.ts` — sparse normalisation of `plot` /
  `plotColor`
- `src/lib/shared/PrimitiveDualScene.svelte` — `SplineOverlay` type + overlay
  build/render (inside the scaled mesh group) + dispose
- `src/lib/shared/PrimitiveDualCanvas.svelte` — `overlays` pass-through
- `src/lib/shared/graph-editor/RightPane.svelte` — `splineOverlays` pass-through
- `src/lib/shared/graph-editor/GraphEditorPane.svelte` — `splineOverlays`
  `$derived` + `onSplinePlot`
- `src/lib/shared/graph-editor/SplineEditorPopup.svelte` — 📈 plot toggle
- `src/lib/shared/graph-editor/NodeCard.svelte` — 📈 card toggle
- `src/lib/cad/__spline_plot_flag.test.ts` — flag mutate/hydrate/emit-invariance
