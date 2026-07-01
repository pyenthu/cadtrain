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
    **Override tracking:** when points come from a WIRED expression, a manual edit to a point is
    flagged as an OVERRIDE (per-point dirty flag / delta) so we know which points diverged from
    the expression output — the expression stays live for un-edited points, manual edits persist
    across re-evaluation, and a "reset to expression" affordance is possible. The flag is ONLY
    for expression-sourced points; MANUAL points (no wired function) apply edits directly, no flag.
    Plan: `docs/plans/spline-generic-source.md`.

86. **Respect individual subpart colors + materials in the render** (user, 2026-07-01) —
    per-part viewer colour Phase B (Phase A done; memory `per_part_viewer_colour`). A composed
    part renders as one colour today; each SUBPART's own `meta.color`/`meta.material` (already
    persisted via `graph.color`/`graph.material` in composition-emit) should tint that subpart's
    geometry in the 3D scene (+ GLB). Route: carry per-part colour/material through `GeomAcc.add`
    so the scene/GLB paints each contributed sub-geometry with its own colour instead of a single
    part colour. VIEW-only; don't change bake topology.

27. **Sidebar reorg — 3 main vertical tabs (INTERNAL / BASIC / WELL)** (done on branch
    `worktree-agent-adc9d069837d40bdb`, presentation-only). The `/primitives` left vertical
    rail collapses from per-top-folder tabs (Basic · Completions · Archived · stdlib ·
    stdstale · user folders) into THREE: **INTERNAL** (nests folders ARCHIVED / STDLIB /
    STALE), **BASIC** (volume `basic/` + any other user top folder), **WELL** (volume
    `completions/<family>/…`, keeps the family sub-tree). Regroups the SAME dirs (Rule 16 —
    location IS category); no files move. `activeView` derived replaces `activeNode`/
    `activeKind`; create/trash/move/list untouched. Plan: `docs/plans/sidebar-reorg.md`.

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
   **Deploying a FINE-TUNED smaller model** (Coder-0.5B via MLC compile + custom-URL
   `CreateMLCEngine` + zero-prompt) = the #28 endgame, detailed in
   `docs/research/local-fncall-synthetic-data.md` → "In-browser deployment (WebLLM + MLC + XGrammar)".

27. **AI feedback / RL database (thumbs + correction, learn-as-you-use)** (user, SVTC parity).
    A 👍/👎 + free-text "what was wrong / what I wanted" control on each AI turn in `AiMenu.svelte`
    records a verdict (approved | disapproved | corrected — the last diffed from the graph the user
    ended with) to an append-only volume store `ai/feedback/turns.jsonl` (`POST /api/ai/feedback`,
    Rule 4/13), folding in the never-built `fix-errors.jsonl`/`logFixError` sink (§H of
    ai-multishot-assist). Unifies the 3 sources the user named — (a) the repo `.md` docs indexed
    (`docs.jsonl`), (b) LLM/deterministic SIMPLIFICATIONS of them into short few-shot prompts
    (`simplified.jsonl`), (c) the approved/disapproved/corrected turns — all retrieved alongside
    `parts.jsonl`. Closes the loop WITHOUT training first: approved → positive few-shot,
    disapproved → avoid-list/demotion, corrected → vocab promotion (`promote-to-vocab.ts`
    precedent) + self-repair; optional DPO/local-SLM fine-tune only once volume warrants (Phase 4).
    Phases: 1 capture+store+browse · 2 md-ingest+simplify · 3 feedback→few-shot/promotion · 4
    (optional) preference/fine-tune. Reconcile task 905 + TODO #1's "optional fix-errors sink" here.
    Plan: `docs/plans/ai-feedback-rl.md`.

28. **Local fn-call model + synthetic prompt→call data** (user research, 2026-07-01) — CONSOLIDATE
    with #27/#2/#1, don't build a parallel stack. Levers: (a) compact TypeScript-notation tool
    schemas (only wins OFF prompt-cache → for the LOCAL model; we already cache the cloud schema);
    (b) Claude-generated SYNTHETIC {user_prompt, minimized_call} pairs (domain×tool matrix) seeding
    the #27 JSONL corpus; (c) spend the dataset two ways — near-term FEW-SHOT injection via RAG
    Phase-3 embeddings (top-3 nearest pairs, no training), later a LoRA fine-tune (Unsloth,
    ~1–3k pairs → ~95%) of a small model (Qwen2.5-1.5B #2 target / Mistral-7B) that emits our call
    syntax natively so the schema prompt can be dropped. Neo4j/Chroma graph+vector server = PARKED
    experiment (heavy; Rule 1 no Python in prod; a JSONL corpus + in-process/web-llm vector index
    fits better). Sequence: land #27 P1 → synthetic seed → RAG-P3 few-shot → benchmark TS-vs-JSON
    for the local model → optional fine-tune. Research: `docs/research/local-fncall-synthetic-data.md`.
    **In-browser DEPLOYMENT of the fine-tuned model** (the deploy half of the fine-tune endgame,
    refines #2): Qwen2.5-**Coder-0.5B** (4-bit ≈ <350 MB, offline via Cache-Storage) → MLC-LLM AOT
    compile (`.wasm` + weight shards) → host static / HF → custom-URL `CreateMLCEngine` in a Web
    Worker → XGrammar CFG constrained to OUR `EDITOR_TOOLS`/`ArgValue` syntax → output →
    `dispatchEditorTool` on the in-memory `Graph`, no server; fine-tune → drop the schema prompt
    (zero-prompt). Honest: XGrammar = syntax not semantics (needs the dataset), MLC compile is a real
    build step, ~350 MB hosting, 0.5B accuracy = the open risk → conditional-GO spike; few-shot
    injection (step 3) is the near-term win BEFORE any fine-tune/WebLLM deploy. See that doc's
    "In-browser deployment (WebLLM + MLC + XGrammar)" section.

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
