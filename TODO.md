# TODO — crisp. Full detail in `/plan` (Gantt) + `docs/plans/*`.

### Active focus
- **#940/#22 Modularize GraphEditorPane** — GEP ~5.2k lines. NEXT cuts: canvas-interaction class · add-node menu · bake controller · param-wire layer. Extract mechanically HEADLESS, browser-verify each on `:3333`. (`graph-editor-pane.md`, `modularize-round2.md`)
- **#7 Wells `/wells`** — LIVE (SVTC engine + ewells shell + wired 3D + sidenav + local workspace). NEXT: register `g_*` completion parts into the parametric registry; long-string perf; real wells store. (`well-schematic.md`)
- **#42 Wells interface (SVTC WsonApp)** — W-A view/layer control bar · W-B editor/inspector dock · W-C depth ruler + labels · W-D dual 3D/2D canvas (2D = SVG track, white bg) · W-E left toolbar rail · W-F workspace cache · W-G shell polish (collapsible SVTC header · trim canvas padding). (`wells-interface.md`)
- **#39 Multi-engine matrix** — Manifold (client+server) ✓ · BREP (server; **client TODO**) · TrueForm (native compiler + composites + defect-2 bore-extend fixed). NEXT: TF r_weld_extrude native (#51); BREP client-side. (`docs/architecture/geometry-engines.md`)

### Open — TrueForm
- **#46 Graph→TF compiler** — SHIPPED: native render, composite dep-resolution, bore-extend hollow sweeps. LEFT: make TF tab render the actual part by DEFAULT (retire the "actual" toggle); two-tier recompile driven by a STRUCTURAL hash (topology + param names/count, NOT values) so param edits stay real-time.
- **#51 TF welded-mesh builder** — prototype SHIPPED (`tf-weld.ts` `buildWeldGrid`/`weldGridToTf` + `weld_extrude` demo, χ=2). LEFT: wire as **r_weld_extrude → native TF** (kills mesh-import fallback); then #50 + NURBS smoothing. TF exposes the ideal blocks (`tf.mesh`, orient/topology predicates, `taubinSmoothed`/`laplacianSmoothed`).
- **#50 Arbitrary-section swept-mesh** (subsumed by #51) — `tubeMesh` is circle-only; transport the real 2D section loop along path frames (RMF) + weld → `tf.mesh` so non-circular sweeps match Manifold.
- **#48/#49 Server compile** — JS `/api/tf/compile` ✓ + WASM `/api/tf/compile-wasm` ✓ (thin concealment). LEFT: a ⚡client/☁server toggle UI. `#47` (parked): per-part WASM `build(params)` — only MILD concealment, do only if a real need.
- **g_dp_joint composite stack** — mated stack unions at origin (parts overlap); executor must place children end-to-end by Z-extent. (in progress)

### Open — editor
- **#52 Modularize RightPane** — large component → Vite HMR silently skips it (stale-dev-server masks fixes). Extract per-tab bodies (SVG/GLB/TF-recipe).
- **#20 Typed expression outputs** — A/B/D on main. LEFT: C explicit annotation · E consumers (`r_sweep.path`, `r_surface_grid`) + ObjectNode emit. (`typed-expression-outputs.md`)
- **#11 Expression-as-builder** — unify the 3 repeats (list<op>→sketch, list<transform>→repeat); lacing; 2D preview. (`expression-list-builder.md`)
- **#31 Visual expression editor** — finish `ExprImperativeBlocks` + `if`; text-DSL mirror. **#32 Undo/redo** — per-instance history + one `commit()` choke point.
- **#36 Warp node** — core shipped; build the node + editor card (after #940). **#12 Repeat-as-sweep** · **#23 Generalize r_sweep** (varying section) · **#24/#26 Spline as generic point-source** · **#13 Typed ports** (def→instance propagation) · **#8 Repeat editor popover** · **#86 Subpart colors** (view-only tint) · **#30 Custom tabs + local/cloud folders**.
- **#18 r_surface_grid** — verified on `feat/surface-grid-expr`, unmerged. **#21 sweep_demo** — fix on `worktree-agent-a614bcd…`, pending apply. **#17 Loop·x/y toolbar drop**.

### AI (umbrella #0 — local-first; `docs/plans/ai-master-plan.md`)
- **#0** registry → cloud schema/prompt + local CFG → multishot loop → feedback corpus → WebLLM (#1/#2/#27/#28/#29 are its phases).
- **#29** complete + document the AI fn library (one registry, CI sync test) · **#1** RAG/assist (engine + panel shipped; LEFT `route`/`selectedId` in ctx) · **#27** feedback/RL DB (👍/👎 → `turns.jsonl`) · **#2** web-llm (Qwen2.5 + XGrammar, default-off) · **#28** synthetic fn-call data → few-shot/LoRA.

### Parked
- #4 CAD-gen research (arxiv 2606.05515) · #4b Blender fields for nodes · #5 units repo · #7b r_weld_extrude phase angle · #8b expression library · #16 `src/lib` reorg · #17b first-bake-slow profiling · #18b repeat-builder simplify · #19 BUG `casing_schematic` "BREP is deleted".
