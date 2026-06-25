### Open — build work (PENDING)

0. 🔴 **/primitives multi-tab freeze** (regression from the expr v3 merge) — restoring a
   `/primitives` session that reopens several persisted tabs at once hard-hangs the
   renderer (sync loop; no console error). `/graph-editor` single-pane is fine; fresh
   `/primitives` is fine; opening one part is fine. Multi-pane / specific migrated part
   (a WELLS part with v1 `graph.exprs`→`exprDefs` is the suspect). Workaround: clear
   `localStorage prim-open-tabs`. NEXT: bisect the 7 parts, fix the mount loop. /plan #920.

1. **RAG multi-shot AI + tab context** — **PARTIAL.** Engine MERGED
   (`ge-assist.*` in `src/lib/shared/graph-editor/`). LEFT: mount the panel/button
   in GraphEditorPane + add `route` to `EditorContext`/`readEditorState` + populate
   `selectedId` (node-click) + optional `/api/ai/fix-errors` sink.
   Plan: `docs/plans/ai-rag-system.md`.

2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF, local
   few-shot DB (no data leaves org). `ge-assist` already accepts a `postTurn` override
   for this backend. Plan: `docs/research/web-llm-functionary.md`.

3. **Modularize round 2 — shell cleanup** — Phases A–F + R2 knip prune + **R6a (poly
   carve)** shipped → GEP **9455 → 5500 lines**. LEFT: GEP shell ≤1500 (carve the
   poly_repeat/profile-resolve overlay + the remaining node-card SVGs), module-map
   header, residual `$state` audit, R7 `builder.ts`/`library.ts` retire, R8 vocab,
   R9 ProfileFnEditor. Plans: `docs/plans/graph-editor-pane.md` · `modularize-round2.md`.

4. **Sketch repeat op** — poly_repeat-style loop in the sketch editor (model +
   `expandSketchOps` + UI in SketchEditorPane). Plan: `docs/plans/sketch-repeat.md` ·
   `repeat-and-sketch-repeat.md`.

7. **Well schematic → 3D well diagram (`/wells`)** — **PARTIAL.** W0 + W1 shipped
   (WSON, registry, `assembleWell`, Threlte `WellScene`). **NEXT:** port SVTC 3D scene
   layer; DTX+scale; W1.3 real `g_*` bakes; flatten; curvature subdivision via
   spline→builder contract; W2 2D schematic view; W3 editor/BOM.
   Plan: `docs/plans/well-schematic.md`.
   we need to replicate the 3d well sketch fromSVTC... also we can borrow from the same tyhpe of tab design and tool bar design and auto scale etc.

8. in the reoeat card... allow for acceptance of params just like we are accepting parts. let the params section be abive parts section and allow multiple params to be added in a list with a node connecter

15. **Expression system — polish pass** (the v3 block system shipped + works; these are the rough edges):
    dangling-def recovery on instances; clean up the migrated `e.newone`-style invalid formulas;
    Σ button two-click / tooltip overlap; per-output socket labels; live numeric preview.
    (Global/personal expr library = PARKED #8.) Plan: `docs/plans/expression-builder.md`.

16. **/design — d3-force graph polish** — switched from the tidy-tree to a **d3-force**
    directed layout (collapsible container hubs + hierarchy & arch-edge links;
    collapsed-by-default; `fitView` re-frame on toggle). LEFT: tune force params
    (charge/link distance/collide) for readable spacing, node/edge styling toward the
    `mfmesh.up.railway.app/architecture` reference, optional drag-to-pin, and fix the
    legend overlapping the graph at fit-zoom. Visual iteration with the user. Files:
    `src/routes/design/**` (`ArchGraph.svelte` layout).


### Shipped (recent)

- ✅ **R6a — Polygon-editor carve** (modularize #3): `PolyPreviewState` class +
  `PolyPreview.svelte` lifted out of GraphEditorPane (state + 24 handlers + overlay
  markup + CSS); coord ƒ-popover stays in the shell. GEP 5873 → 5500; browser-verified
  on g_collar. /plan modularize lane.
- ✅ **Expression wiring — output → ANY card** (param→expr input + expr output→Call arg /
  polygon coord / mv-rot-txfmn axis / repeat count / sketch field — bind + rendered wire).
- ✅ **/design enriched + collapsible** — 29→56 nodes / 29→65 edges (corrected stale
  /fem,/forge; added /research,/api/brep) + rebuilt as a collapsible auto-layout tree
  (collapsed-by-default, `fitView` re-frame on toggle). Polish → open #16.


### PARKED
2. Sketch editor — per-axis scale expansion (x/y); settings button in the top toolbar.

4. RESEARCH — explore for CAD generation improvement:
   [arxiv 2606.05515](https://arxiv.org/html/2606.05515v1).
5. Units — centralized repository (diameter in in/mm, z in m/ft, etc.).
6. SVG build-time profiling — how long does it take to build these SVGs?
7. `r_weld_extrude` phase angle — straighten spiralled triangles (lat/long-style
   perpendicular quads along latitude).

8. Option to promote and search for expressions to global library or personal user based library and search

9. We need a fit/z scale and dia scale capabiltiy fort the src as well.

10. We need to redesign the folder interface. i think it is occupying a loot of space.. lets do one thing.. When we collapse the folder sidebar lets have the collpase to be just narrow enough to show the vertical ytab bars on the left.

11. Also we need to rationalize the slider on the bake visualizaiton.. so that it slides about 3 times the length of he rendered part in z.

12. For the scale popover for z and xdia. Lets make sure that when we click out of the popover it disappears.

13. The output icon/card needs to be made smaller. We need maybe an svg draggable that has a big arrow and a box on the left whch can accept inputs.. the arrow ha sa min size and the sockets on the left

14. Repeat card we dont need the card to be so elaborate.. Maybe we just need a nice loop icon.. remove the detailed text inside. Also the long name can be removed.in the top var
