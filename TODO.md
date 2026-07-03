# TODO — crisp. Full detail in `/plan` (Gantt) + `docs/plans/*`.

### Active focus
- **#940/#22 Modularize GraphEditorPane** — GEP 5186 lines. First cut shipped (`graph-layout-actions.ts`). NEXT: canvas-interaction class · add-node menu · bake controller · param-wire layer. INLINE only, browser-verify each. (`graph-editor-pane.md`, `modularize-round2.md`)
- **#7 Wells `/wells`** — LIVE (SVTC engine port + ewells shell + wired 3D + sidenav + local workspace). NEXT: register `g_*` completion parts into the parametric registry; long-string perf; real wells store. (`well-schematic.md`)
- **#42 Wells interface — model on the SVTC main app** — bring SVTC's WsonApp workspace to `/wells`: (A) view/layer control bar (show/hide oh/ch/cement/tubing/completions/perfs · cutaway · directional · diaScale/zScale/DTX dials · cut azimuth) surfacing existing `WellSchematic3D` props; (B) right editor/inspector dock (completions+survey tables, click-to-inspect a component's params via the parametric registry); (C) depth ruler + leader-line labels; (D) optional 2D track view; (E) real toolbar actions. Plan: `docs/plans/wells-interface.md`.
- **#39 Multi-engine matrix** — Manifold (client+server) · BREP (server; client TODO) · TrueForm (client; r_cyl/s_cyl/sweep/boolean demos + crease-aware shading). NEXT: BREP client-side + color/smooth; TF real parts. (`docs/architecture/geometry-engines.md`)

### Open — build work
- **#40 Wireframe / diagnostic view** — toggle a wireframe (and normals) view in the 3D canvas to tell geometry bugs apart from material / normals / lighting issues. SHIPPED.
- **#43 TF "actual" button** — next to the TF_DEMO dropdown, an **actual** toggle that imports the REAL baked part mesh (the 3D-BAKE Manifold geometry) into the TF kernel via `tf.mesh(faces, points)` — so the TF tab renders/analyzes YOUR part (not a demo), giving TF's independent watertight/manifold verdict + cutaway on the actual geometry.
- **#41 TF examples registry** — move each TF demo out of `trueform-client.ts` into `src/lib/shared/tf_examples/<name>.ts` (one file per part: box/r_cyl/s_cyl/helix/bored_pipe/dp_pin/cone/…), each exporting `{ name, label, build() }`; an auto-glob registry (`import.meta.glob`) lists them → populates the TF dropdown AND serves as an API. Decouples demos from the kernel driver (kills the two-writers conflict) + makes parts drop-in. Includes a reusable `tfRevolveProfile(profile2D, segments)` lathe (TF has no native revolve) so any axisymmetric volume part (g_dp_pin, g_cone, …) can be replicated by feeding its half-section profile. First content: g_dp_pin + g_cone.
- **#20 Typed expression outputs** — A/B/D on main. LEFT: C explicit annotation · E consumers (r_sweep.path, r_surface_grid) + ObjectNode emit + record→array adapter. (`typed-expression-outputs.md`)
- **#11 Expression-as-builder** — unify the 3 repeats: wire list<op>→sketch, list<transform>→place/repeat; lacing; 2D preview. (`expression-list-builder.md`)
- **#31 Visual expression editor** — for + if/then, no code; finish `ExprImperativeBlocks` + add `if`; text-DSL mirror. (`expr-visual-editor.md`)
- **#32 Undo/redo** — per-instance history class; one `commit()` choke point; Cmd+Z / Cmd+Shift+Z + ↶/↷. (`undo-redo.md`)
- **#36 Warp node** — geometry core shipped; build the bend/deform NODE + editor card (blueprint ready; GEP-touching → after #940). (`warp-part-along-spline.md`)
- **#12 Repeat-as-sweep** — wire `op:'sweep'` into the repeat node (frame torsion / spacing / caps).
- **#23 Generalize r_sweep** — varying section per station (subsumes r_loft + taper).
- **#24/#26 Spline as generic point-source** — feed spline into `r_sweep.section` (2D); expr-driven points; override-tracking on wired points. (`spline-generic-source.md`)
- **#13 Typed ports** — LEFT: `graph.typeDefs[]` + def→instance propagation (needs a consumer = #20 E). (`typed-ports.md`)
- **#8 Repeat editor → wireable popover** — 30/70 params/loop. (`repeat-builder-popup.md`)
- **#86 Subpart colors/materials in render** — Phase B: tint each subpart via `GeomAcc.add` (view-only).
- **#30 Custom tabs + local/cloud folders** — local File System Access shipped for /wells; generalize to custom tabs + per-folder origin (cloud=per-user OAuth, local=machine). (`custom-tabs-local-folders.md`)
- **#18 r_surface_grid** — verified on branch `feat/surface-grid-expr`, unmerged; save `surf_expr_demo` to volume.
- **#21 sweep_demo round-out** — fix ready on `worktree-agent-a614bcd…`; section→circle expr. Pending apply.
- **#17 Loop·x/y toolbar item** — add a standalone drop (today only via polygon "+ expr").

### AI (umbrella #0 — local-first; `docs/plans/ai-master-plan.md`)
- **#0 Master plan** — registry → cloud schema/prompt + local CFG → multishot loop → feedback corpus → WebLLM. #1/#2/#27/#28/#29 are its phases.
- **#29 Complete + document the AI function library** — one registry source-of-truth; missing `addSpline` etc.; CI sync test. (`ai-tool-library.md`)
- **#1 RAG / AI assist** — engine + edit panel shipped. LEFT: `route`/`selectedId` in `EditorContext`. (`ai-rag-system.md`)
- **#27 AI feedback / RL DB** — 👍/👎 + correction → `ai/feedback/turns.jsonl`; few-shot + promotion. (`ai-feedback-rl.md`)
- **#2 web-llm local backend** — in-browser Qwen2.5 + XGrammar, default-off. (`web-llm-functionary.md`)
- **#28 Local fn-call model + synthetic data** — synthetic pairs → few-shot → optional LoRA/MLC deploy. (`local-fncall-synthetic-data.md`)

### Research
- **#44 TrueForm → WebGPU (WGSL) rewrite** — RESEARCH: feasibility of reimplementing `@polydera/trueform`'s kernel in WebGPU compute (WGSL) instead of pthread WASM. Motivator: WebGPU needs NO `SharedArrayBuffer`/cross-origin isolation → could **drop the app-wide COOP/COEP**. Assess which ops GPU-parallelize (generators easy; exact-CSG/arrangements hard — float robustness), prior art, hybrid vs full-rewrite, effort. Doc: `docs/research/trueform-webgpu.md`. Repo: github.com/polydera/trueform.

### Parked
- #4 CAD-gen research (arxiv 2606.05515) · #4b Blender fields for nodes · #5 units repo · #7b r_weld_extrude phase angle · #8b expression library · #16 `src/lib` reorg · #17b first-bake-slow profiling · #18b repeat-builder simplify · #19 BUG `casing_schematic` "BREP is deleted".
