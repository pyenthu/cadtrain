### Open — build work

1. **RAG multi-shot AI + tab context** — **PARTIAL.** Engine MERGED
   (`ge-assist.*` in `src/lib/shared/graph-editor/`). LEFT: mount the panel/button
   in GraphEditorPane + add `route` to `EditorContext`/`readEditorState` + populate
   `selectedId` (node-click) + optional `/api/ai/fix-errors` sink.
   Plan: `docs/plans/ai-rag-system.md`.

2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF, local
   few-shot DB (no data leaves org). `ge-assist` already accepts a `postTurn` override
   for this backend. Plan: `docs/research/web-llm-functionary.md`.

3. **Modularize round 2 — shell cleanup** — GEP A–F + R1 bake-cache deja-vu fix
   (`8edfb05`) shipped. GEP still **6191** lines, so ≤1500 isn't reachable by
   cleanup alone. LEFT (in order): **R6a** carve the Polygon/PolyRepeat editor out
   of GEP (~700 lines, Sketch-style) → **R6b** module-map header + `$state` audit +
   honest line count; plus the GEP-independent **R2** knip prune (dead deps +
   `mime.ts`/`temp-file.ts`), **R3** `/design` link-or-archive (ASK), **R4**
   primitives Sidebar/TabStrip (1836), **R7** `builder.ts`/`library.ts` legacy
   retire (1163), **R8** vocab `_tabs`, **R9** ProfileFnEditor split, **R10**
   warp-subdivide retire + WASM-health banner. Plans: `docs/plans/graph-editor-pane.md`
   · `modularize-round2.md` (§6 sequencing table).

4. **Sketch repeat op** — poly_repeat-style loop in the sketch editor (model +
   `expandSketchOps` + UI in SketchEditorPane). Plan: `docs/plans/sketch-repeat.md` ·
   `repeat-and-sketch-repeat.md`.

5. **/design svelte-flow architecture graph** — interactive route/api graph (needs
   `@xyflow/svelte`). A static descriptive `/design` page already exists; this item
   is the interactive xyflow layer (+ optional per-pane sub-routes — see PARKED #2).
   Plan: `docs/plans/design-route-svelteflow.md`.

6. **Conditional expressions tab** — third tab beside PARAMS/PROPS; `e.<name>` calculated
   /conditional expressions (sparse `graph.exprs[]`, topo eval). Overlaps PARKED #1.
   Plan: `docs/plans/expressions-tab.md`.

7. **Well schematic → 3D well diagram (`/wells`)** — **PARTIAL.** W0 + W1 shipped
   (WSON, registry, `assembleWell`, Threlte `WellScene`). **NEXT:** port SVTC 3D scene
   layer; DTX+scale; W1.3 real `g_*` bakes; flatten; curvature subdivision via
   spline→builder contract; W2 2D schematic view; W3 editor/BOM.
   Plan: `docs/plans/well-schematic.md`.

8. **Smooth surfaces — round-toggle enhancement** — base ◯ toggle shipped; only
   refines below ~28 segments. Tighten tolerance + expose a roundness strength dial.
   Plan: `docs/plans/smooth-surfaces-and-brep.md`.


### PARKED

1. Params + props + **calculated** — calculated fields as functions of params, third tab
   in a table with ƒ popover; wire into other parts. Duplicates open #6.
2. Sketch editor — per-axis scale expansion (x/y); settings button in the top toolbar.
3. `/design` sub-routes — one per pane describing component layout + optional nodal
   connections (companion to open #5).
4. RESEARCH — explore for CAD generation improvement:
   [arxiv 2606.05515](https://arxiv.org/html/2606.05515v1).
5. Units — centralized repository (diameter in in/mm, z in m/ft, etc.).
6. SVG build-time profiling — how long does it take to build these SVGs?
7. `r_weld_extrude` phase angle — straighten spiralled triangles (lat/long-style
   perpendicular quads along latitude).
