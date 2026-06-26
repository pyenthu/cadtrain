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

11. **Expression-as-builder — structured + list outputs + loops (unify the 3 repeats)**. **DATA-MODEL
    step IN FLIGHT 2026-06-26** (subagent): `shape: scalar|object|list` + element-shape on expr
    outputs, validation allows a `map()` list formula, list<point> wires into polygon points, proven
    by baking the spiral as ONE expression. Research decisions locked (flat lists, longest-repeat-last
    lacing, socket-shape typing, no data trees) in the plan. Let an
    expression OUTPUT carry a scalar | object | **list**, with a `map(range(N), i => …)` loop
    inside, and wire the structured output into ANY consumer: list of `[r,z]` → polygon points
    (= poly_repeat), list of ops → sketch ops (= sketch_repeat), list of transforms → place/repeat
    (= part-repeat). ONE generic generator subsumes all three repeat node types; the spiral becomes
    ONE expression with a map. Engine (mathjs) already supports arrays/objects/map/range — work is
    model (`shape` on outputs) + loop UI + typed output sockets + emit-into-slot. Substrate for a
    "builder" app (wire points/ops/transforms/parts) + data-driven parts. Research prior art first:
    Grasshopper data-trees + list-lacing, Dynamo, Blender Geometry Nodes, OpenSCAD comprehensions,
    CadQuery eachpoint, Houdini copy-to-points (deep-research pass). Plan: `docs/plans/expression-list-builder.md`.
    Pairs with the repeat-as-sweep / loft-between-copies idea (clean swept solids; see `g_spiral_repeat.md`).

8. **Repeat editor → draggable/resizable POPOVER with wireable params** (parity with the
   2026-06-26 Expression popover). LEFT 30% = params (editable + INPUT sockets, authored
   in the popover); RIGHT 70% = the loop (iterators + parts + transforms + body). Node card
   shows the params above the parts ONLY when defined in the popover. Decided: full wireable
   sockets. Plan: `docs/plans/repeat-builder-popup.md`.

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



### Shipped (recent) — 2026-06-25/26

- **Expression builder redesign** (popover) — 30/70 split; CONSTS dropped (a param
  with a default replaces them; not back-compat by design); no section tabs; OUTPUTS
  are a clickable LIST + edit column (no tabs/sockets/headings); def name lives in
  the title next to `ƒ`; popover is **draggable** (header) + **resizable** (corner
  grip). Doc: `docs/plans/expression-builder.md §v3.10`.
- **Output-card** wire→socket alignment fix (centered `rootOutputSockY`, shared by
  render + wire).
- **Z-slider** (bake viz) — range 2×→1.1× part length (5% overshoot/side, finer pan
  on long parts); `⇕ fit` now recentres the slider.
- **Dead-code sweep** — removed 6 unused exports + 16 unused files (knip-led).
- **3D-bake default scale on load** — auto `xScale`/`zScale` aspect normalization
  ("Balanced": HI=6, LO=1.2, a=0.5); `scaleAuto` flag, manual drag sticks, new part /
  ⇕ fit re-enables. Verified g_collar z×1.55, g_shaft (AR 5) untouched. View-only.

### PARKED

4. RESEARCH — explore for CAD generation improvement:
   [arxiv 2606.05515](https://arxiv.org/html/2606.05515v1).

5. Units — centralized repository (diameter in in/mm, z in m/ft, etc.).

7. `r_weld_extrude` phase angle — straighten spiralled triangles (lat/long-style
   perpendicular quads along latitude).

8. Option to promote and search for expressions to global library or personal user based library and search

16. Organize source and the server under lib and shared by categories that are logical. Organzie the folders/sub folders as per the categories that are logical.

17. THe first bake is very slow the second one is fast. Why? Also second ti,me when i bake it is lets say showing me 39 ms bbut actiually it takes longer. the first bake was 4000 ms. Maybe there is an actal bottleneck or it is not prpperly captured.

18. The repeat expressio n builder needs to be simplified in design.. it should be model

19. BUG. The casing_schjematic... the BREP is delteted error.



