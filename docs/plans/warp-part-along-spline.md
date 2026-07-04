# Warp a part along a spline — a general bend/deform node

**Status:** geometry core SHIPPED (2026-07-02, merge c12873f — items 2–4 in
warp-spline.ts: 3D RMF paths + right-handed frame + validity warn); NODE + editor
card (items 1 & 5) DEFERRED pending the GraphEditorPane modularization reorg
(/plan #940). See the Progress section below. User: "warp a part along a spline… can we build that
logic… may be simpler and faster." Take ANY already-baked part/solid and **bend it
along a spline** — a general deform, not a sweep engine. Distinct from the annular
sweep (which BUILDS a hollow tube); this DEFORMS an existing solid.

## The logic already largely exists
`src/lib/cad/warp-spline.ts` `warpManifoldAlongSpline(m, controlPoints, opts)` bends a
finished Manifold along a **planar (x,z)** Catmull-Rom spline via `Manifold.warp`
(z → arc-length along the spline, x → in-plane radial, y → world-Y). It's injected into
the part sandbox as `warpSpline` (`primitive-sandbox.ts`), recognized as a "warp-at-end"
wrapper (`recognize-composite.ts`), and is `/plan` task 609. So the CORE deform works —
what's missing is a first-class NODE + the fixes below.

## Verified facts (from the 2026-07-02 extrude+warp spike — memory `session_handoff_2026-07-02`)
- Manifold has NO native path-sweep; `Manifold.warp(fn)` is the deform primitive.
- **Refine is mandatory:** without build-time `refineToLength`/`refine(n)` the bend
  collapses to straight chords (a 90° arc lost ~⅓ its volume). Segment at BUILD time on
  the input solid, NEVER post-bake subdivide the welded MeshGL (Rule 25 — OOB-crashes WASM).
- **Orientation-sign gotcha:** a left-handed placement frame makes `warp` emit a
  NEGATIVE-volume (inverted) solid that silently breaks later CSG. Must ensure the frame
  handedness is right-handed (det[N,B,T] = +1). (`sweepAlongPath`'s weld auto-corrects
  sign; `warp` does NOT.)
- **No self-intersection guard:** a tight bend (bend radius < section radius) warps into a
  self-overlapping solid that reports `status=NoError, genus=0` — invalid only surfaces
  when a later boolean chokes. Add a genus/volume sanity check + warn.
- warp-spline is **planar (x,z) only** today; 3D paths need a full frame (reuse the RMF
  `sweepFrames` from `manifold-mesh.ts`).
- 3.5.x adds `warpBatch` (a perf win) but no new capability.

## Action plan
1. **A "bend along spline" MODIFIER node** — input: the upstream solid + a spline node
   (reuse `SplineScene`/the spline editor for the path); output: the warped solid.
   Emit → `warpSpline(<solid>, <points>, opts)`. Rides the wire-a-spline-in pattern (#26)
   + [[todo_parametric_geometry_slots]] (the spline is a typed input).
2. **Build-time refine dial** on the input (segments / target edge length) so the bend is
   smooth; default sensible, capped (warp-spline already self-limits refine > 1200 tris).
3. **Robustness:** enforce right-handed frame (fix the inversion), add a genus/volume
   sanity check post-warp → warn on self-intersection (shared with [[todo_sweep_self_intersection_check]]).
4. **3D paths:** extend `warpManifoldAlongSpline` beyond planar (x,z) to a full RMF frame
   along a 3D spline (reuse `sweepFrames`).
5. UI: a modifier card in the graph (like mv/rot), with the spline sub-editor.

## Progress (2026-07-02) — geometry core (items 2–4) SHIPPED
The `warp-spline.ts` reuse path was extended so the deform is correct + robust; the
NODE + UI (items 1 & 5) are deliberately deferred (a large new composition-graph +
GraphEditorPane subsystem — not invented in one pass). Immediately usable TODAY via
the existing `warpSpline(<solid>, <points>, opts)` sandbox injection (hand-authored
parts + the future node both call it).
- **Item 2 (refine dial):** `opts.refine` already self-limits (skips > 1200-tri
  meshes); kept + documented. The UI dial lands with the node (item 5).
- **Item 3 (robustness):** the 3D branch builds an explicitly RIGHT-HANDED frame
  (`N = side`, `B = tangent × N`, `det[N,B,T] = +1`) so `warp` never emits an
  inverted (negative-volume) solid — the frame-handedness inversion is fixed by
  construction. New `warpValidity(m, genusBefore)` + `opts.validate` (opt-in, it
  forces the lazy warp to evaluate) warns on negative volume / a genus bump
  (self-intersecting too-tight bend). Unit-tested.
- **Item 4 (3D paths):** `warpManifoldAlongSpline` now accepts `Pt3[]` and, when the
  path has real out-of-plane (y) variation, routes through `spline3DFrames` — the
  RMF (`sweepFrames`, double-reflection) carried along the 3D curve. A planar path
  (`Pt2[]`, or `Pt3[]` with ~constant y) stays on the proven world-Y frame,
  byte-identical to before. Tests: `src/lib/cad/warp-spline.test.ts`.
## Progress (2026-07-04) — items 1 & 5 (the NODE + card) SHIPPED
The `warp` bend MODIFIER node is now first-class:
- **Model** — `WarpNode { child, path, refine?, stretch?, validate? }` in
  `composition-graph-types.ts` (union member); `addWarp`/`addWarpPlaceholder` +
  `setWarpChild`/`setWarpPath`/`setWarpRefine`/`setWarpStretch`/`setWarpValidate`
  mutators; `setTransformChild`/`removeNode`/`topoOrder`/`collectEdges`/
  `defaultCallPosition` extended for it; hydrate normalises the fields.
- **Emit** — `composition-emit.ts` `case 'warp'` →
  `warpSpline(<child>, <path>, { refine, stretch, validate })` (opts object only
  when a lever is set). The `path` is normally an `expr` referencing a wired
  `SplineNode`'s prelude const (`_x_<id>_path`), so the SAME spline machinery
  drives it. `warpSpline` is already the sandbox-injected
  `warpManifoldAlongSpline`, so the bake bends the solid with no new plumbing.
  Consumed-set marks `warp.child` so it doesn't double-return.
- **Card** — a teal NodeCard arm (`≈ warp`): a `solid` child socket + a `path`
  socket on the LEFT, the bent solid out the RIGHT, and a refine/stretch/validate
  opts row. Wired via `wire.endWireOnWarpPath` (path) + the shared
  `endWireOnInput('child')` (solid). Dropped from the picker `position ▸ warp`
  item. `WireLayer` draws both the child + path wires; `geom.ts` sizes the card.
- **Verify** — `src/lib/cad/warp-node.test.ts` (model → emit → hydrate round-trip,
  opts, validation, cascade-delete); the geometry bend itself stays covered by
  `warp-spline.test.ts`. `bun run build` green.
- **LEFT for the parent to eyeball on :3333:** drop a Call (e.g. g_shaft) → drop a
  spline → drop `warp`, wire the part into `solid` + the spline into `path`, and
  confirm the bake bends. `recognize-composite.ts` already detects the emitted
  `warpSpline(inner, path, opts)` wrap.

## Why it's attractive
- Reuses existing warp logic → small build. Bends ANY part (not just tubes): pipes,
  ramps, deviated tools, curved brackets — "deviated / curved profiles" (Rule 25's goal).
- Complements the annular sweep (build hollow tubes) + r_sweep (sweep a section). Together:
  sweep to BUILD along a path, warp to BEND an existing solid.

## Related
- `src/lib/cad/warp-spline.ts`, `docs/plans/annular-csg2d-section-sweep.md`,
  [[r_sweep_normals_and_twist]], the spline editor (`SplineScene`, task 927).
