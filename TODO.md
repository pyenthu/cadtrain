### Open — build work (PENDING)

20. **Typed expression outputs — structural inference + dynamic wiring** (THE design spine).
    An expr is a node that outputs a typed value, wired into a compatible consumer; type
    INFERRED from structure by default (users never declare), explicit annotation optional
    (gradual typing, a contract checked vs inference), named types optional.
    **Phase A SHIPPED** (`struct-type.ts` + `'auto'` shape + live badge; `[[x,y,z],…]`
    literals accepted, any arity). **Phase B DONE on branch** `worktree-agent-a2305d766500241a7`
    (typed/colored sockets + plain-language wire-checking — refuses 2D-into-path etc.).
    **Phase D DONE on branch** `worktree-agent-ab56b8f69c2f89c2e` (Type-Definer: list types +
    "add a field" bug + field dropdown). **LEFT:** C explicit annotation · E consumers
    (r_sweep.path / r_surface_grid) + ObjectNode emit + record→array adapter. Both branches
    pending review/merge. Plan: `docs/plans/typed-expression-outputs.md`.

15. **Spline-editor path card** — **IN PROGRESS** (agent). three.js spline-editor popover
    (draggable control points + Catmull-Rom) → N **arc-length-equal** points (pure-JS
    resampler, no THREE at bake) → `list<point3>` → `r_sweep.path` (smooth tube). v1
    (raw point-list) already works via Phase A. Ref:
    https://threejs.org/examples/webgl_geometry_spline_editor.html. Pairs with #20.

11. **Expression-as-builder — unify the 3 repeats.** Data model + list<point>→polygon +
    imperative loop builder DONE. LEFT: wire list<op> → sketch + list<transform> → place/repeat
    (retire the 3 repeat types); lacing (longest-repeat-last); profile 2D-preview; visual `+`
    compose. Build on #20/#13. Plan: `docs/plans/expression-list-builder.md`.

12. **Repeat-as-sweep** — loft one welded skin between consecutive repeat copies (clean swept
    solids vs the heavy box-pile). Helpers `sweepAlongPath`/`loftStations` merged. LEFT: wire
    an `op:'sweep'` mode into the repeat node (frame torsion / variable spacing / caps).
    `g_spiral_repeat.md`. Pairs #11.

23. **Generalize `r_sweep` — varying section per station** (future; subsumes `r_loft` +
    extrude-taper). r_sweep already lofts rings between path stations (`loftStations`) with a
    FIXED section. Let the section VARY per station — a scale curve `s(t)` and/or a true blend
    between DIFFERENT cross-sections — and ONE engine covers: r_loft (barrel/waist/flare via
    `s(t)`), r_weld_extrude's taper, AND a "real" loft (A→B section blend). `r_loft` has zero
    volume consumers, so folding it in later is low-risk. Same one-engine unification spirit as
    #11 / #20. Keep r_loft + r_sweep separate until this lands (they're orthogonal today:
    loft = varying radius on a straight axis, sweep = fixed section on a bent path).

13. **Typed ports.** Registry + composite record types + type definer + `autoWireSuggestions`
    all DONE. LEFT: per-part `graph.typeDefs[]` + def→instance propagation — blocked on a real
    CONSUMER, so build composite-type consumption first (= #20 Phase E). Plan: `docs/plans/typed-ports.md`.

8. **Repeat editor → wireable popover** (parity with the Expression popover): 30% params
   (+input sockets) / 70% loop. Plan: `docs/plans/repeat-builder-popup.md`.

22. **Modularize GraphEditorPane (round 2)** — GEP has grown large again (sweep seed, bake-loop
    guard, the add-node picker, AiMenu mount, node-card arms). Extract the picker + the
    bake-effect cluster + remaining node-card arms into focused modules; readability pass.
    Incremental, browser-mount-verify each cut. Prior: `docs/plans/graph-editor-pane.md` +
    memory `todo_modularize_grapheditorpane`.

1. **RAG / AI assist.** ge-assist engine merged; the in-canvas edit-this-part panel is mounted
   (AiMenu edit mode). LEFT: add `route` to `EditorContext`/`readEditorState`, populate
   `selectedId` on node-click, optional `/api/ai/fix-errors` sink. Plan: `docs/plans/ai-rag-system.md`.

2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF (no data leaves
   org); ge-assist accepts a `postTurn` override. Plan: `docs/research/web-llm-functionary.md`.

7. **Well schematic → 3D well diagram (`/wells`)** — PARTIAL (W0 + W1 + left tool rail). NEXT:
   SVTC 3D scene layer; DTX+scale; real `g_*` bakes; flatten; curvature subdivision; W2 2D
   schematic; W3 editor/BOM + wire the tool rail to placement. Plan: `docs/plans/well-schematic.md`.

17. **Loop·x/y in the left toolbar add-menu** — today the imperative loop·x/y expr is only
    creatable via the polygon's "+ expr"; add a top-level toolbar item to drop one standalone.

18. **`r_surface_grid` surface-grid work** — verified (bakes a 6912-vert fluted vase) on branch
    `feat/surface-grid-expr`, NOT merged; demo `surf_expr_demo` not yet saved to volume.

21. **Round out `sweep_demo`** — fix READY (Polish agent, branch `worktree-agent-a614bcd2549732801`):
    `section` → round circle expr (re-activates the dead `tubeR`/`nSec`). Pending apply (volume
    write). The live `path` is also a 2-point stub — optional elbow restore included.

10. **Volume ⇄ OneDrive sync** — SHIPPED (diff + tree + dry-run + selective non-destructive sync,
    `/volume`). LEFT (minor): tree default-collapsed for huge diffs; `gone` files not selectable.

### PARKED

4. RESEARCH — CAD generation improvement: [arxiv 2606.05515](https://arxiv.org/html/2606.05515v1).

4b. RESEARCH — Blender Geometry-Nodes **FIELDS** for our graph (`docs/research/blender-fields-for-nodes.md`):
    our `r_surface(fn(u,v))` IS a field; `list<point>`/grid is its captured form. Recommend a
    wireable **field-socket PortType** + an explicit **Capture node** (field→grid); avoid implicit
    field inference. Ties to #11 / #13.

5. Units — centralized repository (in/mm, m/ft, …).

7b. `r_weld_extrude` phase angle — straighten spiralled triangles (perpendicular quads along latitude).

8b. Promote/search expressions to a global or per-user library.

16. Reorganize `src/lib` + `src/lib/server` into logical category folders/subfolders.

17b. First-bake-slow / second-fast — investigate the real bottleneck + whether bake timing is
     mis-captured (first ~4000 ms, second reports 39 ms but feels longer).

18b. Repeat expression builder — simplify the design (should be model-driven).

19. BUG — `casing_schematic`: "BREP is deleted" error.
