# TODO — crisp. Full detail in `/plan` (Gantt) + `docs/plans/*`.
> **Execution:** `batches.md` groups these into issue-and-run batches ("run Batch N to completion").

### Active focus
- **#940/#22 Modularize GraphEditorPane** — Phase 4 (inline, browser-verify each cut): pull the 7 candidates (part-actions · bake-orchestration · expr-actions · keymap/save · canvas-interaction · CSS) onto `controller.svelte.ts` + a `GraphCommand` labeled-undo layer; NodeCard per-type split. (`graph-editor-pane.md`, `modularize-round2.md`, `hierarchical-class-design.md`)
- **#7 Wells `/wells`** — register `g_*` completion parts into the parametric registry; long-string perf; real wells store. (`well-schematic.md`)
- **#42 Wells interface (SVTC WsonApp)** — W-B editor/inspector dock · W-E left toolbar rail. (`wells-interface.md`)
- **#42b Wells → ewells.app PARITY** (`wells-ewells-gaps.md` · `wells-build-architecture.md`):
  - [ ] **A · BUILD ARCH (3D-fast)** — WellBakePool (N own-Manifold workers, per-element parallel bake) · clip-plane cutaway · element libraries (`g_*` via compile+worker) · auto-scale/fit 2D+3D (vertical dia/depth exaggeration + deviated bbox) + manual Dia×/Depth×. Per P0–P5.
  - [ ] **B · EDITING (the differentiator)** — mutation+undo · CompletionsEditor (strings table) · SurveyEditor (live re-warp) · inspector-on-select · edit-diagram popovers
  - [ ] **C · RENDER polish** — 3D center/fill · label banks + anchor option · white scene bg · element-rail icons
  - [ ] **D · CHROME** — toolbar actions · ruler MD/TVD · camera presets
- **#42c Completion element library (`bw_*`)** — `bw_packer` + a tubing element, then the rest of the completion jewelry. Feeds the wells element registry (A2).
- **#42d Wells CAD-parts API browser + WBG Wizard** — model on [AIDE WBG Wizard](https://aide.mwdstd.com/) (screenshot: `docs/plans/refs/aide-wbg-wizard.png`):
  - **WBG Wizard panel** — section-by-section well bore geometry design: each section = alternating Hole size row + Casing row; standard API sizes shown as clickable pills in a horizontal grid (6½ → 26 in); selected size highlighted teal; curved arrows between rows show clearance relationship between drill bit and casing OD.
  - **CAD-parts picker** — browse/search `/primitives` from the /wells canvas; drop a part into a section with auto-populated params (from `meta.params`); dynamic GUI matching the graph-editor param card (live scrub/edit); wells-specific additions: depth anchor, string assignment, orientation.
  - **Left nav sections**: WBG Wizard · Tubulars · Rig · Trajectory (Auto Design + Cost Model) · Summary (Well Cost · WBG · Report) — section list with + Add section + section count badge.
  - **Auto Design** — trajectory auto-generation given surface location + target TVD/inclination.
  - **Toolbar**: Reset · Apply · Save locally · New · Import · Export · Feedback.
  - See: `docs/plans/wells-cad-parts-browser.md`.

### Open — engines
- **#64 BUG — Manifold cut+warp bridging triangle** — `bw_casing` alone is fine; `w1_oh_warp` (warp of that already-cut casing) shows a spurious triangle connecting the cut ends on **3D Bake** only (TF clean). Root: bake sets `_axialMaxZSpan` on `warpSpline(`, but `r_revolve` ignores the dial when `zSegments: 0` (`g_shaft`) → lean hollow+`sectionCut` → long cut-face diagonals → warp chords. **Fix:** teach `r_revolve` to honor `getAxialMaxZSpan()` (TF `densifyRevolveTree` equivalent) + keep/`tighten` `sectionCut` refine. Full plan: `docs/plans/manifold-cut-warp-densify.md`.
- **#39 Multi-engine matrix** — BREP client-side. (`docs/architecture/geometry-engines.md`)
- **#46 Graph→TF compiler** — two-tier recompile on a STRUCTURAL hash (topology + param names, not values) so param edits stay real-time; per-SUBPART material (needs color-by-source). (`tf-compile-perf.md`)
- **#51 TF welded-mesh builder** — #50 + NURBS smoothing (`tf.mesh`, `taubinSmoothed`/`laplacianSmoothed`).
- **FUTURE: opt-in `compose` toggle (separate vs fused parts)** — expose an explicit per-part/per-list toggle (`list` = separate render parts vs `compose`/`weld` = one solid) instead of the implicit `place()` compose. Mirror in TF (union-fold vs separate instrs).
- **Manifold↔TF bake consistency** (audit `docs/findings/manifold-vs-tf-audit.md`) — (a) converge warp densification (Manifold's fixed `WARP_AXIAL_MAX_ZSPAN` → curvature-adaptive `planAxialStations` like TF); (b) share graph-lowering primitives (`consumed-set`/`stack_ref`/`poly_repeat`) between `graph-to-tf.ts` + `composition-emit.ts`; (c) port bore-extend defect-2 prevention to Manifold hollow sweeps. DEAD CODE: dedup `creaseAwareCornerNormals` (`render-helpers:529` ≈ `trueform-adapter:271`, ~70 LOC — RISKY: differ by a `weldTol` param, not a safe delete).

### Open — editor
- **Section card — "show cutter" option** — a view-only toggle on the ✂ section card to render the CUTTING wedge/cube semi-transparent (overlay, not baked) so the author sees what `az`/`offset` removes.
- **Click a connection → delete popover** — clicking a wire (bezier in `WireLayer.svelte`) opens a popover at the click with "delete" that unwires THAT target input slot. Needs: hit-testable wire paths (fat invisible hit-path) + unwire mutate per slot type.
- **BUG — 3D-bake ✂ section clips instead of CSG-cutting (part looks HOLLOW)** — `sectionCut` in `manifold-helpers.ts` appears to clip (no cap) instead of a real `solid.subtract(wedge)`; want a capped, solid-looking cut like the view-only `cutVC`. Check the wedge is closed/manifold + how the section feeds the render (`geo.parts` vs a clip plane).
- **In-canvas controls must be SCREEN-FIXED** — the spline-editor's in-canvas control chips (＋pt/−pt/⌗xyz/view selector, via Threlte `<HTML>`) should stay pinned to the viewport as you orbit, not move with the scene. Use a screen-space overlay (`<HTML fullscreen>` / DOM overlay), not an in-scene world-anchored `<HTML>`. Applies to any in-canvas control overlay.
- **BUG — TF section shows no INNER colours** — the TF `{op:'cutaway'}` builder (`graph-to-tf.ts` + `tf_examples/execute.ts`) must colour the wedge-subtract's exposed faces with SECTION_INNER (grey) / body-inner, matching the Manifold `cutVC` / per-part cut arm.
- **Multi-input SOCKET → compact multi-connector nodes** — let ONE socket accept MULTIPLE incoming wires so a card stays COMPACT (Output root list, ✂ section, ≈ warp). Model: N wires → `children[]` on the single socket. VISUAL: mark multi-input sockets distinctly (elongated ellipse / barred rounded rect) + a count, not N stacked sockets.
- **SVG projection — smoothness** — silhouette/crease-outline extraction, anti-aliased strokes (`stroke-linejoin:round`/non-scaling-stroke), fewer facet chords, curve-aware (Phase 1 of `docs/plans/svg-projection-perf.md`). Engine: `PrimitiveSvgView` + `svg-emit` (`src/lib/shared/`).
- **#52 Modularize RightPane** — extract per-tab bodies (SVG/GLB/TF-recipe); large component → HMR silently skips it.
- **#61 Material system + MATERIAL CARD** — (b) textures via `meta.texture` (cement/steel/rock); (c) a Material Card (sibling to Properties/Params) authoring color·opacity·texture·preset per PART+SUBPART. (`wells-ewells-gaps.md` §G-MAT)
- **#63 SVG bake ↔ material** — (c) SVG `<pattern>` textures. Files: `svg-emit.ts` · `PrimitiveSvgView.svelte`. (§G-MAT5)
- **#20 Typed expression outputs** — C explicit annotation · E consumers (`r_sweep.path`, `r_surface_grid`) + ObjectNode emit.
- **#11 Expression-as-builder** — unify the 3 repeats (list<op>→sketch · list<transform>→repeat); lacing; 2D preview.
- **#31 Visual expression editor** — finish `ExprImperativeBlocks` + `if`; text-DSL mirror.
- **#36 Warp node** — after #940: **#12** repeat-as-sweep · **#23** generalize r_sweep (varying section) · **#24/#26** spline as generic point-source · **#13** typed ports propagation · **#8** repeat editor popover · **#86** subpart colors (view-only tint) · **#30** custom tabs + local/cloud folders.
- **#38 Data-driven params** — **P2 · list<record> table editor** — `ParamsCard` gains "add object/row" to build a list<record> inline (strings table); the well rebuilds with N strings, zero card-wiring. Payoff: `w_multi_string_dev` 18 cards → 1 list param + 1 producer.
- **#18 r_surface_grid** (unmerged `feat/surface-grid-expr`) · **#21 sweep_demo** (fix on a worktree branch, pending apply) · **#17 Loop·x/y toolbar drop**.

### /design architecture views
Tabs: Tree · C4 · GEP module · Folder tree (6 layouts) · Class model · Code graph · Design philosophy — plus a dev toolbar (↻ Rebuild diagrams · Run graphify · Build tree).
- [ ] **API docs from graphify** — `scripts/gen-api-docs.mjs` consuming `graphify-out/graph.json` (2,132 nodes) → repo API/reference docs (public exports · endpoint catalog · module responsibilities) in a buried /design "Docs" tab. Regenerate alongside `gen-design-diagrams.mjs`.

### AI (umbrella #0 — local-first; `docs/plans/ai-master-plan.md`)
- **#0** registry → cloud schema/prompt + local CFG → multishot loop → feedback corpus → WebLLM (#1/#2/#27/#28/#29 are its phases).
- **#29** AI fn library (one registry, CI sync test) · **#1** RAG/assist (LEFT `route`/`selectedId` in ctx) · **#27** feedback/RL DB (👍/👎 → `turns.jsonl`) · **#2** web-llm (Qwen2.5 + XGrammar, default-off) · **#28** synthetic fn-call data → few-shot/LoRA.

### Parked / tooling
- **#DX page-agent** — in-browser agent for live Three/Svelte-`$state`/console inspection; back-pocket (current console+Playwright coverage suffices).
- **#PMP pmp-library** — C++ mesh-processing; reference only for subdivision, DON'T adopt as a 3rd WASM kernel.
- #4 CAD-gen research (arxiv 2606.05515) · #4b Blender fields · #5 units repo · #7b r_weld_extrude phase angle · #8b expression library · #16 `src/lib` reorg · #17b first-bake-slow profiling · #19 BUG `casing_schematic` "BREP is deleted".
