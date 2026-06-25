### Open — build work (PENDING)

1. **RAG multi-shot AI + tab context** — **PARTIAL.** Engine MERGED
   (`ge-assist.*` in `src/lib/shared/graph-editor/`). LEFT: mount the panel/button
   in GraphEditorPane + add `route` to `EditorContext`/`readEditorState` + populate
   `selectedId` (node-click) + optional `/api/ai/fix-errors` sink.
   Plan: `docs/plans/ai-rag-system.md`.

2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF, local
   few-shot DB (no data leaves org). `ge-assist` already accepts a `postTurn` override
   for this backend. Plan: `docs/research/web-llm-functionary.md`.

3. **Modularize round 2 — shell cleanup** — SHIPPED: Phases A–F + R2 knip + **R6a (poly)**
   + **RepeatEditorPane** + **CanvasMenu + AiMenu** → GEP **9455 → 5070**; **R6b** (GEP
   module-map header + `$state` audit, all per-instance); **R9** (pure `profile-fn-compose.ts`
   + round-trip tests, ProfileFnEditor **1156 → 925**). GEP clean carves done; honest
   target **~2,500–3,000** (≤1500 needs a large feature carve; review 2026-06-25). NOTE:
   ghost toggles NOT carvable (ghostSet/ghostIds feed emit/bake); the expr-in-GEP is ~70
   lines of glue (popup+menu already components), not worth a carve. **R8** SHIPPED
   2026-06-25 (vocab/+page **1687 → 1005**, 4 `_tabs/*` components + ~130 lines dead CSS).
   LEFT: **R7** `builder.ts`/`library.ts` retire (needs knip dead-chain confirm) — the
   last modularize item. Plans: `docs/plans/graph-editor-pane.md` · `modularize-round2.md`.

4. **Sketch repeat op** — ✅ SHIPPED 2026-06-25 (PR1–3): SketchRepeatNode + SketchRepeatRef
   model + `expandSketchOps` (sketch-repeat.ts) flattening upstream of compileSketch +
   emit (`Array.from(...).flat()`, two-site agreement test-locked) + `+ repeat` UI in
   SketchNodeCard/SketchEditorPane + sketch_repeat NodeCard; 13 tests; existing sketch
   parts byte-identical. LEFT (optional polish): re-wirable ref↔source SVG sockets on the
   repeat card (built with plain coord inputs for now). Plan: `docs/plans/sketch-repeat.md`.

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

16. **/design — mostly DONE.** Two view tabs: **Tree** (tidy left→right collapsible tree —
    compact mfmesh-style nodes, minimap, draggable, solid data-flow + dashed depends-on +
    dotted hierarchy edges) + **C4 model** (formal C4 diagram, Context→Container→Component
    level switcher, proper notation + muted externals from `c4.ts`). LEFT (minor polish):
    expand-all `fitView` zooms the big tree small (drill in one container instead);
    legend overlaps the graph at fit-zoom. Files: `src/routes/design/**`.


### Shipped (recent)

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

15. A card delete or a param delete or a node delete should ask for confirmation.

16. Organize the server under lib and shared by categories that are logical. Organzie the folders/sub folders as per the categories that are logical.

