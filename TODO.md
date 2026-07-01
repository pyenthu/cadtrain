### Open — build work (PENDING)

20. **Typed expression outputs — structural inference + dynamic wiring** (THE design spine).
    An expr is a node that outputs a typed value, wired into a compatible consumer; type
    INFERRED from structure by default, explicit annotation optional. Phase A on main
    (`struct-type.ts` + `'auto'` shape; `[[x,y,z],…]` literals just work). **Phase B (typed/
    colored sockets + plain-language wire-checking) + D (Type-Definer: list types, "add a
    field" bug, field dropdown) done on branches `worktree-agent-a2305d766500241a7` /
    `…ab56b8f69c2f89c2e` — pending review/merge.** LEFT: C explicit annotation · E consumers
    (r_sweep.path / r_surface_grid) + ObjectNode emit + record→array adapter.
    Plan: `docs/plans/typed-expression-outputs.md`.

11. **Expression-as-builder — unify the 3 repeats.** LEFT: wire list<op> → sketch +
    list<transform> → place/repeat (retire the 3 repeat types); lacing (longest-repeat-last);
    profile 2D-preview; visual `+` compose. Build on #20/#13. Plan: `docs/plans/expression-list-builder.md`.

12. **Repeat-as-sweep** — loft one welded skin between consecutive repeat copies. Helpers
    `sweepAlongPath`/`loftStations` merged. LEFT: wire an `op:'sweep'` mode into the repeat node
    (frame torsion / spacing / caps). `g_spiral_repeat.md`. Pairs #11.

23. **Generalize `r_sweep` — varying section per station** (future; subsumes `r_loft` +
    extrude-taper). Let the section VARY per path station — a scale curve `s(t)` and/or a blend
    between different cross-sections — so one engine covers loft (barrel/waist/flare), taper, and
    a real A→B loft. `r_loft` has zero volume consumers → low-risk to fold in later. Keep them
    separate until this lands (orthogonal today: loft = varying radius / straight; sweep = fixed
    section / bent path). Same unification spirit as #11/#20.

25. **Detach transforms (mv/rot/xform) from the Call card → standalone chainable nodes**
    (user, 2026-07-01). Stop ATTACHING transforms to a part's card (the `⇄`/`↻` inline
    strips); CHAIN standalone mv/rot icon nodes instead (`part → mv → rot → out`). One
    render/emit path (drop the inline-strip + `xformSocketAt` + `attachedTransforms` code),
    transforms become first-class wireable nodes (generative + networkable). Load-bearing:
    a hydrate MIGRATION that materializes existing attached transforms into standalone nodes
    (bake-parity tested) BEFORE removing the inline path. Standalone mv/rot icon + xyz popover
    already shipped. Plan: `docs/plans/detach-transforms.md`. Pairs with #11/#13/#20.

24. **Spline as a generic point-source + expression-driven points** (user, 2026-07-01). Make the
    spline THE curve source of truth. (A) Feed a spline into `r_sweep.section` (2D), not just
    `path` (3D) — a `dim:2|3` flag → `list<point2>`/`list<point3>`, wired by type (#926) into any
    point-list slot (path/section/polygon). (B) Source the spline's points from a
    function/expression (`map(range(N), i => …)`) instead of manual dragging — one expr node
    replaces N control points; parametric path/section, fewer ops (reuses the #11 loop builder).
    Build after #926 typed sockets. Pairs with #23. Plan: `docs/plans/spline-generic-source.md`.

26. **Wire a point-set INTO the spline card** (user, 2026-07-01) — the concrete wiring form of
    #24B. Give the spline a POINTS INPUT socket (typed `list<point2|3>`) so a function/expression
    output — or any point producer — feeds its control points: **expr → spline → sweep**. The
    spline still smooths + arc-length-resamples the wired points. Nodes feeding nodes = a
    "connected universe" substrate toward a generative drawing/design tool. Rides typed ports
    (#20/#926 — the input socket type-checks list<point>) + reuses the expr-list wiring (#11).
    Plan: `docs/plans/spline-generic-source.md`.

13. **Typed ports.** Registry + record types + definer + `autoWireSuggestions` on main. LEFT:
    per-part `graph.typeDefs[]` + def→instance propagation — blocked on a real CONSUMER, so
    build composite-type consumption first (= #20 Phase E). Plan: `docs/plans/typed-ports.md`.

8. **Repeat editor → wireable popover** (parity with the Expression popover): 30% params
   (+input sockets) / 70% loop. Plan: `docs/plans/repeat-builder-popup.md`.

22. **Modularize GraphEditorPane (round 2)** — GEP has grown large again (sweep seed, bake-loop
    guard, add-node picker, AiMenu mount, node-card arms, spline arm). Extract the picker + the
    bake-effect cluster + node-card arms into focused modules; readability pass. Incremental,
    browser-mount-verify each cut. `docs/plans/graph-editor-pane.md`.

18. **`r_surface_grid` surface-grid work** — verified (bakes a 6912-vert fluted vase) on branch
    `feat/surface-grid-expr`, NOT merged; demo `surf_expr_demo` not yet saved to volume.

21. **Round out `sweep_demo`** — fix READY (branch `worktree-agent-a614bcd2549732801`): `section`
    → round circle expr (re-activates the dead `tubeR`/`nSec`); the live `path` is a 2-point stub
    (optional elbow restore included). Pending apply (volume write).

17. **Loop·x/y in the left toolbar add-menu** — today only creatable via the polygon's "+ expr";
    add a top-level toolbar item to drop one standalone.

1. **RAG / AI assist.** Engine merged; the in-canvas edit-this-part panel is mounted (AiMenu edit
   mode). LEFT: `route` in `EditorContext`/`readEditorState`, `selectedId` on node-click, optional
   `/api/ai/fix-errors` sink. Plan: `docs/plans/ai-rag-system.md`.

2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF (no data leaves
   org); ge-assist accepts a `postTurn` override. Plan: `docs/research/web-llm-functionary.md`.

7. **Well schematic → 3D well diagram (`/wells`)** — PARTIAL (W0 + W1 + tool rail). NEXT: SVTC 3D
   scene layer; DTX+scale; real `g_*` bakes; flatten; curvature subdivision; W2 2D schematic; W3
   editor/BOM + wire the tool rail to placement. Plan: `docs/plans/well-schematic.md`.

### PARKED

4. RESEARCH — CAD generation improvement: [arxiv 2606.05515](https://arxiv.org/html/2606.05515v1).

4b. RESEARCH — Blender Geometry-Nodes **FIELDS** for our graph (`docs/research/blender-fields-for-nodes.md`):
    our `r_surface(fn(u,v))` IS a field; `list<point>`/grid is its captured form → a wireable
    field-socket PortType + explicit Capture node (field→grid). Ties to #11 / #13.

5. Units — centralized repository (in/mm, m/ft, …).

7b. `r_weld_extrude` phase angle — straighten spiralled triangles (perpendicular quads along latitude).

8b. Promote/search expressions to a global or per-user library.

16. Reorganize `src/lib` + `src/lib/server` into logical category folders/subfolders.

17b. First-bake-slow / second-fast — real bottleneck + whether bake timing is mis-captured
     (first ~4000 ms, second reports 39 ms but feels longer).

18b. Repeat expression builder — simplify the design (model-driven).

19. BUG — `casing_schematic`: "BREP is deleted" error.
