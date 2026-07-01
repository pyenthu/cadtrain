### Open — build work (PENDING)

0. **AI MASTER PLAN (umbrella / north star)** — ONE self-improving, local-first tool-calling
   assistant fusing #1/#2/#27/#28/#29 into a single system: [function-library registry (source
   of truth)] → generates [cloud JSON schema · prompt · local XGrammar CFG] → [multi-shot loop
   on the live Graph] ← retrieval/few-shot from [one corpus: parts+docs+simplified+feedback] →
   [feedback grows the corpus] → [local WebLLM runtime + optional fine-tune], under
   data-residency (memory `ai_data_residency_local_first` — cloud Claude is dev/build-time only).
   Roadmap: **P0** reconcile+registry (mostly SHIPPED) → **P1** complete tools (addSpline first)
   + feedback capture → **P2** corpus unification + few-shot (embeddings, no training) → **P3**
   WebLLM local runtime → **P4** synthetic data + optional LoRA → zero-prompt local. #1/#2/#27/
   #28/#29 below are PHASES of this. Plan: `docs/plans/ai-master-plan.md`.

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

31. **Visual expression editor — for + if/then, no code** (user, 2026-07-01). Finish the multi-line
    expr-OUTPUT editor so non-programmers build a list<point> (etc.) output VISUALLY with just FOR
    loops + IF/THEN — no JS/TS, no variable declarations (the builder owns the vars). `expr-imperative.ts`
    already has for/assign/append; ADD `if` to the model+compile, finish `ExprImperativeBlocks` as the
    primary visual path (for/if-then/set/add-point blocks, nestable, live preview), + a CoffeeScript-ish
    text MIRROR (a small DSL → the same JS IIFE, NOT the real CoffeeScript compiler). Extends #11/#20.
    Plan: `docs/plans/expr-visual-editor.md`.

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

1. **RAG / AI assist.** [MASTER PLAN P0 (shipped) + P1 remainder]. Engine merged; the in-canvas
   edit-this-part panel is mounted (AiMenu edit mode); loop + prompt-cache split + proxy-path all
   SHIPPED. LEFT (P1): `route` in `EditorContext`/`readEditorState`, `selectedId` on node-click.
   The "optional `/api/ai/fix-errors` sink" is SUPERSEDED by #27's `verdict:'error'` feedback rows
   — do not build it. Plan: `docs/plans/ai-master-plan.md` (detail: `ai-rag-system.md`).

2. **web-llm local backend** — [MASTER PLAN P3] the data-residency RUNTIME. In-browser
   Qwen2.5-1.5B + XGrammar (CFG from the registry's `toJsonSchema()`), default-OFF (no data leaves
   org); ge-assist already accepts a `postTurn` override (the seam exists). Plan:
   `docs/plans/ai-master-plan.md` (detail: `docs/research/web-llm-functionary.md`).
   **Deploying a FINE-TUNED smaller model** (Coder-0.5B via MLC compile + custom-URL
   `CreateMLCEngine` + zero-prompt) = the #28 endgame, detailed in
   `docs/research/local-fncall-synthetic-data.md` → "In-browser deployment (WebLLM + MLC + XGrammar)".

27. **AI feedback / RL database (thumbs + correction, learn-as-you-use)** (user, SVTC parity).
    [MASTER PLAN P1 capture + P2 corpus/few-shot + P4 optional fine-tune] — the incremental-
    knowledge flywheel. A 👍/👎 + free-text "what was wrong / what I wanted" control on each AI turn in `AiMenu.svelte`
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

28. **Local fn-call model + synthetic prompt→call data** (user research, 2026-07-01) —
    [MASTER PLAN P2 synthetic seed + few-shot · P4 fine-tune/MLC deploy = the zero-prompt endgame].
    CONSOLIDATE with #27/#2/#1, don't build a parallel stack. Levers: (a) compact TypeScript-notation tool
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

29. **Complete + document the AI function library (capability source-of-truth)** (user, 2026-07-01).
    [MASTER PLAN P0 registry foundation + P1 complete-the-tools] — the source of truth the whole
    system generates from. Trigger: the AI refused "add a circular spline" — no `addSpline` tool exists. AUDIT: the 12
    shipped `EDITOR_TOOLS` are a strict SUBSET of the editor's ~110 public mutators / picker node
    types. MISSING create tools for Spline (`addSpline`/`setSplinePoints`/`setSplineClosed` — the
    concrete gap: the AI literally cannot make a spline/circular spline), Polygon, Sketch, Expr,
    Repeat, Container/Stack; MISSING the whole Sketch/Expr/Repeat edit surface, `describeNode`,
    `unwireArg`, `removeParam`, `setPartColor`/`setPartMaterial`, and the typed expr-list wiring.
    §E of `ai-multishot-assist.md` is itself incomplete (never lists the spline). PLAN: grow
    `editor-tools-schema.ts` into ONE registry (intent phrasings + tool signature + backing
    mutator + nodeType/category) that GENERATES every machine form — `toClaudeTools()` (cloud),
    `toolListText()` (prompt), new `toJsonSchema()`/XGrammar CFG (local model) — so they never
    drift; the registry IS the documentation the #27 md-ingest indexes + seeds #28 synthetic
    prompt→call pairs + #27 few-shot. Add a CI sync test that FAILS when a picker-creatable node
    type or public mutator has no tool + no allow-list entry (so "add a spline" can't silently
    become impossible again). Foundational under memory `ai_data_residency_local_first` (the local
    runtime model is trained/constrained entirely from this registry). Ties #1/#2/#27/#28. Plan:
    `docs/plans/ai-tool-library.md`.

30. **Custom tabs + local/cloud folders** (user, 2026-07-01; PLAN ONLY). Beyond the fixed
    INTERNAL/BASIC/WELL rail: user-added CUSTOM tabs (named, colored) + per-folder ORIGIN —
    **CLOUD = tied to the USER ID** (private per-user volume space, GATED on the OAuth identity
    port `oauth-identity.md`) vs **LOCAL = a machine folder** via the File System Access API
    (`showDirectoryPicker`, IndexedDB handle, client-side bake, no auth — data-residency).
    Cloud vs local vs custom shown in distinct colors + legend. Sequence: LOCAL folders +
    local-backed custom tabs FIRST (no OAuth), then CLOUD per-user tabs/folders once OAuth lands.
    Builds on the shipped 3-tab sidebar + folder-move. Plan: `docs/plans/custom-tabs-local-folders.md`.

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
