### Open — build work

1. **RAG multi-shot AI + tab context** — **PARTIAL.** Engine MERGED
   (`ge-assist.*` in `src/lib/shared/graph-editor/`). LEFT: mount the panel/button
   in GraphEditorPane + add `route` to `EditorContext`/`readEditorState` + populate
   `selectedId` (node-click) + optional `/api/ai/fix-errors` sink.
   Plan: `docs/plans/ai-rag-system.md`.

2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF, local
   few-shot DB (no data leaves org). `ge-assist` already accepts a `postTurn` override
   for this backend. Plan: `docs/research/web-llm-functionary.md`.

3. **Modularize round 2 — shell cleanup** — Phases A–F shipped (NodeCard, sketch
   consolidation, sketch-load bugfix). LEFT: GEP shell ≤1500 lines, module-map header,
   residual `$state` audit, dead-code prune (`builder.ts`/`library.ts` chain).
   Plans: `docs/plans/graph-editor-pane.md` · `modularize-round2.md`.

4. **Sketch repeat op** — poly_repeat-style loop in the sketch editor (model +
   `expandSketchOps` + UI in SketchEditorPane). Plan: `docs/plans/sketch-repeat.md` ·
   `repeat-and-sketch-repeat.md`.

6. **Conditional expressions tab** — third tab beside PARAMS/PROPS; `e.<name>` calculated
   /conditional expressions (sparse `graph.exprs[]`, topo eval). Overlaps PARKED #1.
   Plan: `docs/plans/expressions-tab.md`.

7. **Well schematic → 3D well diagram (`/wells`)** — **PARTIAL.** W0 + W1 shipped
   (WSON, registry, `assembleWell`, Threlte `WellScene`). **NEXT:** port SVTC 3D scene
   layer; DTX+scale; W1.3 real `g_*` bakes; flatten; curvature subdivision via
   spline→builder contract; W2 2D schematic view; W3 editor/BOM.
   Plan: `docs/plans/well-schematic.md`.
   we need to replicate the 3d well sketch fromSVTC... also we can borrow from the same tyhpe of tab design and tool bar design and auto scale etc.

8. in the reoeat card... allow for acceptance of params just like we are accepting parts. let the params section be abive parts section and allow multiple params to be added in a list with a node connecter


### PARKED
2. Sketch editor — per-axis scale expansion (x/y); settings button in the top toolbar.

4. RESEARCH — explore for CAD generation improvement:
   [arxiv 2606.05515](https://arxiv.org/html/2606.05515v1).
5. Units — centralized repository (diameter in in/mm, z in m/ft, etc.).
6. SVG build-time profiling — how long does it take to build these SVGs?
7. `r_weld_extrude` phase angle — straighten spiralled triangles (lat/long-style
   perpendicular quads along latitude).

8. Option to promote and search for expressions to global library or ersonal user based library and search

