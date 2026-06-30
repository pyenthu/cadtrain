### Open — build work (PENDING)

1. **RAG multi-shot AI + tab context** — **PARTIAL.** Engine MERGED
   (`ge-assist.*` in `src/lib/shared/graph-editor/`). LEFT: mount the panel/button
   in GraphEditorPane + add `route` to `EditorContext`/`readEditorState` + populate
   `selectedId` (node-click) + optional `/api/ai/fix-errors` sink. Maybe involve functionary library.
   Plan: `docs/plans/ai-rag-system.md`.

2. **web-llm local backend** — in-browser Qwen2.5-1.5B + XGrammar, default-OFF, local
   few-shot DB (no data leaves org). `ge-assist` already accepts a `postTurn` override
   for this backend. Plan:  `docs/research/web-llm-functionary.md`. Maybe involve functionary library

7. **Well schematic → 3D well diagram (`/wells`)** — **PARTIAL.** W0 + W1 + left tool rail
   (SVTC-style, 10 tools) shipped. **NEXT:** port SVTC 3D scene layer; DTX+scale; W1.3 real
   `g_*` bakes; flatten; curvature subdivision; W2 2D schematic; W3 editor/BOM + wire the
   tool rail to real placement. Plan: `docs/plans/well-schematic.md`.

12. **Repeat-as-sweep — loft a continuous skin between consecutive repeat copies** (geometry).
    Today the part-level repeat `place()`s N DISCRETE copies (heavy + bumpy — g_spiral_repeat is
    ~26k verts of overlapping box-posts). A "sweep" mode would LOFT one welded skin between copy i
    and i+1 (a swept solid along the per-iteration transforms), turning the repeat into a universal
    swept-solid builder — springs, threads, helical ramps, **clean spiral ribbons** (~g_spiral's
    8.6k verts). Welded-mesh path (`manifold-mesh.ts` gridPatch/weld; like r_weld_extrude but along
    a path). **HELPERS MERGED 2026-06-26**: `sweepAlongPath(path,section)` + `loftStations(stations)`
    in manifold-mesh.ts (injected) — bake-verified (spiral sweep 2888 verts, ONE watertight solid,
    ~9× lighter than the box-pile). LEFT: wire `op:'sweep'` MODE into the repeat node (path = the
    repeat's per-iteration mv positions; section = the unit's 2D profile). Open problems
    (frame torsion / variable spacing / inner-turn self-intersect
    / caps). See `g_spiral_repeat.md`. Pairs with #11.

11. **Expression-as-builder — unify the 3 repeats (the payoff, deferred)**. ONE typed list<element>
    expr output wired into ANY consumer subsumes poly_repeat / sketch_repeat / part-repeat. The data
    model, the list<point>→polygon path, typed sockets + drag-to-wire, and the imperative loop builder
    (+ CodeMirror) are all DONE — see memory `session_handoff_2026-06-28_loop-builder`.
    **REMAINING:** wire list<op> → sketch + list<transform> → place/repeat (retire the 3 repeat types);
    lacing (longest-repeat-last); profile-graph 2D-preview path; the visual `+` compose operator;
    CodeMirror on the remaining fields. Decisions locked (flat lists, longest-repeat-last lacing,
    socket-shape typing, no data trees). Build the "wire it" half on typed-ports (#13).
    Plan: `docs/plans/expression-list-builder.md`. Pairs with repeat-as-sweep (#12, `g_spiral_repeat.md`).

8. **Repeat editor → draggable/resizable POPOVER with wireable params** (parity with the
   2026-06-26 Expression popover). LEFT 30% = params (editable + INPUT sockets, authored
   in the popover); RIGHT 70% = the loop (iterators + parts + transforms + body). Node card
   shows the params above the parts ONLY when defined in the popover. Decided: full wireable
   sockets. Plan: `docs/plans/repeat-builder-popup.md`.

13. **Typed ports — a `PortType` class + registry for node sockets** (architecture; user proposal
    2026-06-26). Every socket (input/output) declares a TYPE (`scalar` · `list<point>` · `geometry` ·
    later `list<op>`/`list<transform>`/`object`) with HOOKS: render (color/glyph), compatibility
    (`canFeed(target)` — same elem + card, one→list broadcast), emit (`emitInto`). Replaces the
    per-kind branches scattered across NodeCard render + wire-state + geom + emit — adding a shape
    becomes "register a PortType", not a 4-layer sweep. **Payoffs:** (1) GENERATIVE — typed ports make
    the graph machine-reasonable; a generator/✨AI can enumerate outputs + open slots + auto-wire by
    type-match; (2) SCALABILITY — the 3-repeat unification (#11) + repeat-as-sweep (#12) fall out as new
    typed ports/consumers. Incremental migration: registry + 3 core types → retrofit one pair → build
    #11's expr-list-ref create-affordance ON it → migrate the rest → an `autoWireSuggestions` hook.
    Plan: `docs/plans/typed-ports.md`. **#11's remaining "wire it" half should be built on THIS**, not
    more ad-hoc branches. **PR1 DONE** (port-types.ts registry + scalar/list<point>/geometry, 5 tests).
    **Layer 2:** a VISUAL "shape definer" + a type MANAGER/store — user-defined COMPOSITE
    record types (`Point{r,z}` · `Casing{od,id,length,isLiner:flag}` · polygon = `list<Point>`).
    **L2a DONE** (port-types.ts: `defineRecordType`/`listOf`, nominal compat, +3 tests).
    **L2b DONE** (`/primitives/types` page + a draggable ◇ POPOVER in the graph-editor rail +
    TypeDefinerPanel.svelte — define records from field rows, live signature, manager rail;
    browser-verified). **L2c DONE** (`/api/primitives/types` GET/POST/DELETE → `<volume>/types/<id>.json`,
    atomic, in VOLUME_PROXY_PATHS so dev shares the prod library; panel loads/saves via it; endpoint
    round-trip verified locally — live in dev after the prod redeploy + dev restart). **LEFT:** per-part
    `graph.typeDefs[]` + def→instance propagation so editing a type updates every node using it (the
    "dynamic nodes" payoff); then wire a typed port (a Casing output / list<Casing>) into a node = the
    PR3 create-affordance on the registry. See typed-ports.md §"Layer 2".
    **GENERATIVE HOOK DONE** (port-suggest.ts, 6 tests): `autoWireSuggestions(graph)` enumerates typed
    outputs x open input slots, filters by `canWire`, dedupes already-wired -> the machine-reasonable
    "what could wire to what" list (expr-list->polygon covered; call-arg/geometry/op/transform slots
    deferred + documented in-file). NOT yet surfaced in the UI (a star "suggest wirings" panel is next).
    **STILL LEFT:** per-part `graph.typeDefs[]` + propagation is blocked on a real CONSUMER — nodes don't
    use composite types yet (expr outputs use shape/elem, not a typeDef); build composite-type
    consumption (or surface autoWireSuggestions) before propagation-without-consumers.

10. **Volume ⇄ OneDrive visual diff + selective sync** (`/volume`). **v1 SHIPPED 2026-06-26**
    (fbcb0c2): metadata-only diff endpoint `POST /api/volume/onedrive/diff` (walk prod
    /api/volume + `rclone lsjson -R` → path+size compare, no download) + `/volume` panel
    with colour-coded count pills (new/gone/changed/match), an ✓in-sync state, a list of
    differing files (+/−/~ badges), and "Sync all → OneDrive". Browser-verified (625 match).
    **v2 SHIPPED 2026-06-26** (merge): collapsible folder TREE grouping (roll-up +/−/~ pills,
    per-file/folder checkboxes), **Dry run** toggle (routes both syncs through `{dryRun}`),
    per-file/folder SELECTIVE sync via new `POST /api/volume/onedrive/sync-paths` (rclone COPY,
    non-destructive, `--backup-dir`, dryRun-verified), + parallelized diff walk (bounded pool).
    Browser-verified (tree shows real drift: spirals moved → +new, old path → −gone). LEFT
    (minor): tree default-collapsed for huge diffs; `gone` files aren't selectable (copy can't
    remove — needs the full mirror).

14. **`r_sweep` not in the GUI add-node menu** — the toolbar "solids" submenu
    (`GraphEditorPane.svelte` ~line 3997, `dropSolid`) is a HARDCODED list
    (revolve/extrude/loft); r_sweep isn't in it. Adding it needs seeding BOTH a 3D
    `path` AND a 2D `section` (unlike revolve/extrude, which take one `profile`
    producer) — design needed.

15. **Path-editor card for the r_sweep PATH** (user idea). CLARIFIED: r_sweep
    consumes POINTS (`[[x,y,z],…]`, ≥2), NOT a spline — it frames per-point + lofts
    straight between. So v1 = a 3D point-list output wired into `r_sweep.path`
    (Phase A inference already makes `[[x,y,z],…]` → `list<point3>` work).
    **v2 = a SPLINE-EDITOR card** (user, 2026-06-30): port three.js'
    `webgl_geometry_spline_editor` (draggable control points + Catmull-Rom curve in
    a 3D scene; https://threejs.org/examples/webgl_geometry_spline_editor.html) into
    a graph-editor POPOVER card. The card's OUTPUT = the curve sampled to N
    **EQUALLY-SPACED (arc-length) points** — three.js `Curve.getSpacedPoints(N)`, NOT
    `getPoints` (uniform-t clusters on a Catmull-Rom) — so r_sweep gets EVEN ring
    spacing and the tube is uniform. Output is a `list<point3>` that drops straight
    into `r_sweep.path` (seamless — same type the path slot already accepts). A "path
    producer" node, same popover pattern as the expr/AI windows. Control points
    persist on the node; N (sample density) is a param. Builds on v1's point output.
    Pairs with the typed-output socket work (#20).

16b. **`r_surface` has the same empty-params latent bug** as r_sweep had — harmless
    today (its first arg is a closure `fn(u,v)` that can't be graph-wired, so it's
    never called object-style). Flag only; fix if it ever gets a graph consumer.

17b. **Loop·x/y not in the left toolbar add-menu** — the imperative loop·x/y expr is
    only creatable via the polygon's "+ expr" button; user wants a top-level toolbar
    item to drop one standalone.

18b. **`r_surface_grid` surface-grid work** — verified (bakes 6912-vert fluted vase)
    on branch `feat/surface-grid-expr` (worktree), NOT merged; demo part
    `surf_expr_demo` not yet saved to volume. The regex-trap that blocked it
    (description + engine JSDoc both contained `uses:['r_surface_grid']`) is fixed.

20. **Typed expression outputs — structural inference + dynamic wiring** (THE design
    spine; plan `docs/plans/typed-expression-outputs.md`). An expr is a node that
    outputs a typed value, wired into a compatible consumer; type INFERRED from
    structure by default (users never declare), explicit annotation optional
    (gradual typing — a contract checked vs inference), named types optional.
    **Phase A SHIPPED** (`struct-type.ts` inference + `'auto'` shape + live badge;
    `[[x,y,z],…]` literals accepted, any arity). **LEFT:** B typed sockets +
    plain-language wire-checking · C explicit annotation · D **Type Definer fixes**
    (first-class list types; the "add at least one field" bug = a field counts only
    if it has a non-empty NAME while `placeholder="field"` masks an unnamed row,
    TypeDefinerPanel ~L83; field-type dropdown) · E consumers (r_sweep.path /
    r_surface_grid) + ObjectNode emit + record→array adapter.

21. **Round out `sweep_demo`'s section** — its `section` is a 4-vertex polygon (wired
    in), so the tube is a 4-sided bar (jagged SVG — correct, not a renderer bug).
    Bump the section polygon to ~16–32 verts OR rewire `section` to a circle expr
    (which re-activates the dead `tubeR`/`nSec` dials). User's call.

### PARKED

4. RESEARCH — explore for CAD generation improvement:
   [arxiv 2606.05515](https://arxiv.org/html/2606.05515v1).

4b. RESEARCH — Blender Geometry-Nodes **FIELDS** for our node graph:
   `docs/research/blender-fields-for-nodes.md`. Headline: our `r_surface(fn(u,v))`
   IS a field over a uv domain; our `list<point>`/grid is the materialised (captured)
   form. Recommend a wireable **field-socket PortType** + an explicit **Capture node**
   (field→grid/list) — unifies surface/list/displacement and fixes the
   `r_surface(fn)`-isn't-wireable problem; **avoid** Blender's implicit field inference.
   Ties to #11 / #13 / `docs/plans/parametric-surface-solid.md`.

5. Units — centralized repository (diameter in in/mm, z in m/ft, etc.).

7. `r_weld_extrude` phase angle — straighten spiralled triangles (lat/long-style
   perpendicular quads along latitude).

8. Option to promote and search for expressions to global library or personal user based library and search

16. Organize source and the server under lib and shared by categories that are logical. Organzie the folders/sub folders as per the categories that are logical.

17. THe first bake is very slow the second one is fast. Why? Also second ti,me when i bake it is lets say showing me 39 ms bbut actiually it takes longer. the first bake was 4000 ms. Maybe there is an actal bottleneck or it is not prpperly captured.

18. The repeat expressio n builder needs to be simplified in design.. it should be model

19. BUG. The casing_schjematic... the BREP is delteted error.



