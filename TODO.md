### Open — build work

1. **RAG multi-shot AI + tab context** — engine MERGED (`ge-assist.`*). LEFT: mount the
  panel/button in GraphEditorPane + add `route` to EditorContext/readEditorState +
   populate `selectedId` (node-click) + optional `/api/ai/fix-errors` sink.
   Plan: `docs/plans/ai-rag-system.md`.
2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF, local
  few-shot DB (no data leaves org). Plan: `docs/research/web-llm-functionary.md`.
3. **Modularize round 2** — A/B/C/D **and E (Step 1 + Step 2) done** (`SketchState`
  per-instance class; `SketchNodeCard` + `SketchEditorPane` extracted, coord ƒ-popover
  stays in the shell, GEP 7897→7376, browser-verified in /primitives + /graph-editor).
  LEFT: **Phase F** = `NodeCard.svelte` (per-node render arms + `polyExprPop`, HIGH risk);
  - dead-code prune (builder.ts/library.ts chain). Plans: `docs/plans/graph-editor-pane.md`
  - `modularize-round2.md`.
4. **Right nav menu restructure** — group the RightPane rail into VIEW/DATA + pinned
  settings. Plan: `docs/plans/right-nav-menu.md`.
5. **Sketch repeat** — poly_repeat-style loop in the sketch. *(Unblocked by #3 Phase E
  Step 2.)* Plan: `docs/plans/repeat-and-sketch-repeat.md`.
6. **/design svelte-flow architecture graph** — interactive route/api graph (needs the
  `@xyflow/svelte` dep). Plan: `docs/plans/design-route-svelteflow.md`.
7. **Client-side execution + server-builder** — server stays the compiler (graph→script),
  client executes in a Worker (Manifold first, OCCT via replicad); preserve the server
   Manifold+OCCT builder under `/api/server-builder/`. Also retires the deja-vu bake bug.
   Plan: `docs/plans/client-side-execution.md`.
8. **Conditional expressions tab** — third tab beside PARAMS/PROPS; `e.<name>` calculated
  /conditional expressions (sparse `graph.exprs[]`, topo eval). Plan: `docs/plans/expressions-tab.md`.
9. **Well schematic → 3D well diagram (`/wells`)** — **3D-FIRST**: the canonical model is
  the 3D well (cadtrain `g_*` parts placed along the survey by depth, baked with Manifold);
   the 2D schematic is a derived VIEW, not the source of truth. Leverage SVTC's engine
   (`~/code/SVTC/src/lib/apps/wson/` — interface + trajectory warp + depth auto-scale +
   10 sample `.wson`) which LACKS components; supply them from cadtrain's parts via the
   `tool_comp`→`g_*` registry. WSON = the shared model. Replaces the `/wells` stub.
  - **DECIDED:** scale pipeline `MD → DTX(straight) → warp along spline → ×zScale`; 3D
  scale = **spread-spacing / true-size** parts (faithful CAD; geometry-stretch is 2D-only);
  **flatten** (azimuth-ignoring 2D projection) toggle; **curvature-adaptive Z-subdivision**
  at BUILD time (Rule 25); the assembler **passes the spline to the builder** which
  adaptive-meshes along it — a well↔builder **sync contract** to lock first.
  - **NEXT:** port SVTC's 3D scene; DTX+scale layer; W1.3 real `g_*` bakes; flatten;
  curvature subdivision via the spline→builder contract; W2 2D schematic view; W3 editor/BOM.
  - Plan: `**docs/plans/well-schematic.md`** · Research: `wbd-powerdraw-visio.md`,  
  `svtc-autoscale-dtx.md` (on /research) · Memory: [[well_schematic_3d_first]] · [[svtc_repo]].

10. **Smooth surfaces — roundness toggle (OPTIONAL).** What's LEFT: wire the PROVEN
  `smoothOut(60).refineToTolerance` as a "true round silhouette" toggle (build-time, crease-aware,
  costs triangles — reconstructs welded revolves to ±0.001; prototype in `builder.ts` bbd7de9, unwired);
  `Manifold.levelSet(sdf,…)` is available for organic/lattice parts (verified). Plan:
  `docs/plans/smooth-surfaces-and-brep.md`.


### PARKED

1. We need cability of having params, props and calculated. Basicallty the calculated fields are based on the params and are functions of the params. They can be in the thrid tab, in a table. Similar popover for the function. Then those can be wired into other params in other parts.
2. In the 2D sketch editor can we also have the expansion for scale in x and y direction? the setings button can be in the tool bar on the top. 
3. In the design page we should have a sub-route for each of the panes desribing the component layout and if possible, optionally show the nodal connections bettwenn them.
4. RESEARCH. Explore this for possibility of improving cad generation. [https://arxiv.org/html/2606.05515v1](https://arxiv.org/html/2606.05515v1)
5. PLAN We need to introduce the concept of units here. Like diameter in inches or mm generslly, z in m or ft. We ill need a centralized units repository.
6. The TXForm card is to allow multiple instances of sequential mv/rot or others in the same table as an option. so we need a section with rows of parsms that can be wired and where more txforms cn be added. Right now there is a redundancy in each card's operation. There should be a selactor of what we want for each row. and the ability to move one transform up or down.


5. Need to check how much time it takes to build these svg.
7. Is it possible to use a phase ange for the r_weld_extrude to "straighten the spiralled triangles.. ie.. we build the extrure buy offseting the vertices that are used to build the triangbles.." that way the triangles are kind of straight down on the latituude.. Like the lat and long on the globe.. perpendicular not offset skewed.
