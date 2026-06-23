### Open — build work

Verified against codebase + `MEMORY.md` 2026-06-23. Nothing below is fully done;
items marked **PARTIAL** have shipped sub-phases called out.

1. **RAG multi-shot AI + tab context** — **PARTIAL.** Engine MERGED
   (`ge-assist.*` in `src/lib/shared/graph-editor/`). LEFT: mount the panel/button
   in GraphEditorPane + add `route` to `EditorContext`/`readEditorState` + populate
   `selectedId` (node-click) + optional `/api/ai/fix-errors` sink.
   Plan: `docs/plans/ai-rag-system.md`.

2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF, local
   few-shot DB (no data leaves org). `ge-assist` already accepts a `postTurn` override
   for this backend. Plan: `docs/research/web-llm-functionary.md`.

3. **Modularize round 2** — **PARTIAL (A–F shipped).** GEP 6191 lines (was 7376);
   extracted: Popovers, RightPane, Params/Properties cards, wire-state, SketchState,
   SketchNodeCard, SketchEditorPane, **NodeCard.svelte** (2015 lines — all node arms +
   resize grip; sketch delegates to SketchNodeCard). Phase F landed 2026-06-23.
   **Bugfix (2026-06-23):** NodeCard sketch branch passed `onDeleteNode={deleteNode}`
   instead of `{onDeleteNode}` — sketch-heavy parts (`g_cube`, `g_dp_box`) white-screened;
   fixed + browser-verified. Lesson: `bun run build` green ≠ browser works (same class
   of error as the Phase E revert).
   LEFT — **shell cleanup** (target ≤1500 lines, module-map header, residual `$state`
   audit) + **dead-code prune** (`builder.ts`/`library.ts` chain).
   Plans: `docs/plans/graph-editor-pane.md` · `modularize-round2.md`.

4. **Sketch repeat** — poly_repeat-style loop in the sketch. **Unblocked** (Phase E
   Step 2 shipped 2026-06-23). Plan: `docs/plans/repeat-and-sketch-repeat.md`.

5. **/design svelte-flow architecture graph** — interactive route/api graph (needs
   `@xyflow/svelte`). A static descriptive `/design` page already exists; this item
   is the interactive xyflow layer (+ optional per-pane sub-routes — see PARKED #3).
   Plan: `docs/plans/design-route-svelteflow.md`.

6. **Conditional expressions tab** — third tab beside PARAMS/PROPS; `e.<name>` calculated
   /conditional expressions (sparse `graph.exprs[]`, topo eval). Overlaps PARKED #1.
   Plan: `docs/plans/expressions-tab.md`.

7. **Well schematic → 3D well diagram (`/wells`)** — **PARTIAL (W0 + W1 shipped).**
   **3D-FIRST:** canonical model = 3D well (`g_*` parts along survey by depth, Manifold
   bake); 2D schematic is a derived VIEW. `/wells` is live (not a stub): WSON model +
   lint/parse, 4 SVTC sample wells, `tool_comp`→`g_*` registry, `assembleWell`, Threlte
   `WellScene` (primitive cylinders for now).
   - **DECIDED:** scale pipeline `MD → DTX(straight) → warp along spline → ×zScale`; 3D
     scale = **spread-spacing / true-size** parts (faithful CAD; geometry-stretch is
     2D-only); **flatten** toggle; **curvature-adaptive Z-subdivision** at BUILD time
     (Rule 25); assembler passes spline to builder — well↔builder **sync contract** to
     lock first.
   - **NEXT:** port SVTC 3D scene layer; DTX+scale; W1.3 real `g_*` bakes (swap cylinders);
     flatten; curvature subdivision via spline→builder contract; W2 2D schematic view;
     W3 editor/BOM.
   - Plan: `docs/plans/well-schematic.md` · Research: `wbd-powerdraw-visio.md`,
     `svtc-autoscale-dtx.md` · Memory: `well_schematic_3d_first` · `svtc_repo`.

8. **Smooth surfaces — round-toggle ENHANCEMENT (future).** Base ◯ round toggle **shipped**
   (`d587417`) but only refines below ~28 segments — at 32/96/192 the mesh is already
   within the fixed 0.4%-of-OD tolerance → visible NO-OP. To make it useful at typical
   seg counts: (1) tighten tolerance (~0.05% of OD), (2) expose a "roundness" strength
   dial next to the checkbox. (High-seg parts that still look faceted = SHADING control,
   not this toggle.) Optional: round on the GLB tab; `Manifold.levelSet(sdf,…)` for
   organic/lattice parts. Plan: `docs/plans/smooth-surfaces-and-brep.md`.
   Memory: `round_silhouette_toggle`.


### PARKED

1. Params + props + **calculated** — calculated fields as functions of params, third tab
   in a table with ƒ popover; wire into other parts. Duplicates open #6.
2. Sketch editor — per-axis scale expansion (x/y); settings button in the top toolbar.
3. `/design` sub-routes — one per pane describing component layout + optional nodal
   connections (companion to open #5).
4. RESEARCH — explore for CAD generation improvement:
   [arxiv 2606.05515](https://arxiv.org/html/2606.05515v1).
5. Units — centralized repository (diameter in in/mm, z in m/ft, etc.).
6. TXForm card — sequential mv/rot rows in one table (add/reorder/wire per row) instead
   of per-card ⇄/↻ redundancy.
7. SVG build-time profiling — how long does it take to build these SVGs?
8. `r_weld_extrude` phase angle — straighten spiralled triangles (lat/long-style
   perpendicular quads along latitude).


### DROPPED

1. **Right nav menu restructure** — group the RightPane rail into VIEW/DATA + a pinned
   settings entry. Dropped 2026-06-23: user prefers the flat 6-tab rail as-is. Plan doc
   `docs/plans/right-nav-menu.md` kept for reference. (/plan O.4, id 908, status deferred.)
