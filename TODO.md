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
- **#42h Wells 3D tab → bake through the PRIMITIVES pipeline (3D bake + TF option).** Today `/wells` 3D is the ported SVTC renderer: pure-THREE shells (`solidTubeForRange`/`shellForRange` + JS `warpGeometry`) with Manifold used ONLY for the boolean cutaway (`src/lib/wells/threeD/manifoldCut.ts`). That is the path the wells skill says to REPLACE.
  - **Target:** the well's graph (`wsonToGraph`) bakes exactly like any assembly — `/api/primitives/compile` → client bake worker (`bake-client.ts`/`bake-worker.ts`), which is the ONE place Manifold reliably inits in-browser (main-thread init is blocked by the app-wide COEP `require-corp`; that was the blank-3D root cause).
  - **Engine selector on the 3D tab:** `3D BAKE` (Manifold) | `TF` — same choice `/primitives` offers, driven off the same graph. TF is native-only (no Manifold fallback → blank + reason).
  - **NO FALLBACK** (wells skill): engine fails → surface the error, never a THREE stand-in.
  - Depends on `#42b A` (WellBakePool for per-element parallel bake) for speed; the 2D-SVG default stays the perf lever so opening a tab still does zero CSG.
  - Retires `manifoldCut.ts` + `WellSchematic3D.svelte`'s shell path once at parity.
- **#42f Wells EDITING INTERFACE — model it on SVTC's WsonApp; popovers mutate the GRAPH.**
  - **The key decision:** a property popover must edit the **composition graph**, not just the WSON document. The well IS an assembly graph (`wsonToGraph`), so an edit = a graph mutation → re-bake, and it must land on the SAME undo stack as the graph editor. Target `GraphEditorController` (`src/lib/shared/graph-editor/controller.svelte.ts`, which already owns per-pane undo/redo) rather than inventing a second mutation layer. Open question to settle first: is WSON the source of truth (edit WSON → re-translate → new graph) or is the graph (edit graph → WSON becomes an import format)? Round-tripping both ways is the trap.
  - **Surfaces** (mirror SVTC, one popover per concern, popovers-over-inline per `feedback_popup_over_inline`): casing/tubulars · open-hole sections · cement intervals · **completions** (packers/nipples/mule shoes/SSDs/gauges) · perforations · survey/trajectory · well header. Reference: `~/code/SVTC/src/lib/apps/wson/`; cadtrain already ported `WellPopover` + `WellCompPopup` (dblclick edit) + `WellViewControls`.
  - **Track B is BUILT-but-UNWIRED** — `WellInspectorDock.svelte` has zero mount sites. Wire it before building anything new.
  - Needs a browser to verify (Svelte reactivity + 2D/3D propagation). NOT autonomous-agent work.
- **#42g Wells autoscale + directional/straight toggle**
  - **Autoscale/fit** — there is NO auto-scale anywhere in `/wells` today (grep: `autoScale|autoFit|fitToView` → 0 hits). `diaScale` / `zScale` are manual dials in the display popover. Want: auto-fit on load + on well change (vertical dia/depth exaggeration from the well's own extents; deviated wells fit their bbox), with the manual Dia×/Depth× dials still overriding. Part of `#42b A`.
  - **Directional / straight toggle** — `settings.directional` already exists (`view-settings.ts:38`) but is buried as a `dm-pill` inside the display-menu popover (`WellViewControls.svelte:137`). Promote it to a top-level segmented control beside `2D | 3D | GRAPH`; it changes what you're looking at, not how it's shaded. Straight = ignore the survey (vertical), Directional = follow it.
- **#42e Wells SAMPLE LADDER — simple → complex, testable at every rung.** Each rung is a `.wson` in `src/lib/wells/samples/` that must (1) translate via `wsonToGraph`, (2) emit source that compiles, (3) bake without strays. Verify HEADLESS first (`wson-to-graph.test.ts` + a bake assertion), then eyeball in `/wells` → GRAPH + 3D. Existing `00-one-casing.wson` is rung 0.
  - [ ] **S1 · `10-three-open-holes.wson`** — 3 telescoping open holes, VERTICAL. No casing, no cement. Pins hole nesting + Mv depth placement alone.
  - [ ] **S2 · `11-three-oh-three-casings.wson`** — the 3 holes of S1 + 3 concentric casing strings, VERTICAL. The reference vertical well. Pins the OH↔casing clearance the `cementDims` annulus math depends on.
  - [ ] **S3 · `12-three-oh-three-casings-cement.wson`** — S2 + cement in each annulus. Exercises `cementDims` (throws when the hole is not wider than the casing — that guard is the point).
  - [ ] **S4 · `13-three-string-deviated.wson`** — S2/S3 + **ONE spline warping every element** (single `warpSpline` before the Output, `originZ: 0`, all Mv ids as `children[]` — the `w1_oh_warp` shape). The deviated reference well. **Unblocked by #64**: half-sectioned `bw_*` elements now warp without the bridging triangle.
  - Notes: elements emitted OUTER→INNER (oh, cement, casing) so transparency reads correctly. NO FALLBACK (wells skill) — a well that can't be expressed as a graph must ERROR, not render a stand-in. Authoring these writes **only** `src/lib/wells/samples/` (repo), NOT the shared prod volume — so it is safe for autonomous work, unlike `#42c`.
- **#42c Completion element library (`bw_*`)** — `bw_packer` + a tubing element, then the rest of the completion jewelry. Feeds the wells element registry (A2). ⚠ Authoring these WRITES THE SHARED PROD VOLUME (`/api/primitives/save`) — never hand to an unattended agent (memory `subagent_shared_volume_2026-06-14`).
- **#42d Wells CAD-parts API browser + WBG Wizard** — model on [AIDE WBG Wizard](https://aide.mwdstd.com/) (screenshot: `docs/plans/refs/aide-wbg-wizard.png`):
  - **WBG Wizard panel** — section-by-section well bore geometry design: each section = alternating Hole size row + Casing row; standard API sizes shown as clickable pills in a horizontal grid (6½ → 26 in); selected size highlighted teal; curved arrows between rows show clearance relationship between drill bit and casing OD.
  - **CAD-parts picker** — browse/search `/primitives` from the /wells canvas; drop a part into a section with auto-populated params (from `meta.params`); dynamic GUI matching the graph-editor param card (live scrub/edit); wells-specific additions: depth anchor, string assignment, orientation.
  - **Left nav sections**: WBG Wizard · Tubulars · Rig · Trajectory (Auto Design + Cost Model) · Summary (Well Cost · WBG · Report) — section list with + Add section + section count badge.
  - **Auto Design** — trajectory auto-generation given surface location + target TVD/inclination.
  - **Toolbar**: Reset · Apply · Save locally · New · Import · Export · Feedback.
  - See: `docs/plans/wells-cad-parts-browser.md`.

### Open — engines
- ~~**#64 BUG — Manifold cut+warp bridging triangle**~~ **DONE 2026-07-10 (e6eeee7).** The 2026-07-09 diagnosis was WRONG: `r_revolve` does NOT ignore the dial (`revolveProfile` applies it). `solid.subtract(wedge)` retriangulates the planar cut faces and discards the wedge's z-rings — maxEdgeΔz 1.48 → 40.0 across the subtract. Fix = `sectionCut` refines the CUT RESULT. Needed a `KERNEL_VERSION` bump (`+cut2`): an engine-internal fix changes neither the part source nor `scriptHash`, so the server bake cache and the client IndexedDB cache both served the pre-fix mesh. Corrected plan: `docs/plans/manifold-cut-warp-densify.md`.
- **Engine-fix cache hazard (follow-up)** — any fix inside `manifold-helpers`/`manifold-mesh` is invisible to BOTH bake caches and silently serves stale geometry until someone remembers to bump `KERNEL_VERSION`. Fold the engine-module hashes into `scriptHash` (or a build-stamped kernel id) so this can't be forgotten. Bit us twice now (`+cap1`, `+cut2`).
- **#65 Radial-scale + Z-scale as real PARAMS (warp-aware).** Today `xScale`/`zScale` are RENDER-time scene dials (`scene-state.svelte.ts:43,49`; `setRenderZScale`, `render-helpers.ts:78`) applied last, to the whole scene. Wanted: **build-time parameters** — a **radial scale** (exaggerate diameter) and a **Z scale** (stretch depth) — so exaggeration is part of the geometry, per-part, and survives bake/export (Rule: `feedback_expose_dont_hide` — the slider IS the product).
  - **The subtlety, and the whole point:** under a warp, Z scale must apply **along the spline's arc length, not world Z**. `warpManifoldAlongSpline` maps a vertex's z → an arc-length station and places its (x,y) on the local frame (`warp-spline.ts:11-12,196`). So a depth stretch on a deviated well must scale the **arc-length coordinate `s`** before the frame lookup; scaling world z instead would stretch a horizontal lateral by zero and shear the trajectory. Radial scale is the clean case: multiply the in-frame (x,y) offsets.
  - Applies to both engines (Manifold `warpManifoldAlongSpline` + the JS twin `warpMeshJS` used by client/TF).
  - Directly serves `/wells` `#42g` autoscale (a well's dia/depth exaggeration becomes a param, not a scene hack).
  - Headless-verifiable: assert bbox + arc-length monotonicity + that a vertical and a horizontal section stretch by the same factor along the path.
- **#39 Multi-engine matrix** — BREP client-side. (`docs/architecture/geometry-engines.md`)
- **#46 Graph→TF compiler** — two-tier recompile on a STRUCTURAL hash (topology + param names, not values) so param edits stay real-time; per-SUBPART material (needs color-by-source). (`tf-compile-perf.md`)
- **#51 TF welded-mesh builder** — #50 + NURBS smoothing (`tf.mesh`, `taubinSmoothed`/`laplacianSmoothed`).
- **FUTURE: opt-in `compose` toggle (separate vs fused parts)** — expose an explicit per-part/per-list toggle (`list` = separate render parts vs `compose`/`weld` = one solid) instead of the implicit `place()` compose. Mirror in TF (union-fold vs separate instrs).
- **Manifold↔TF bake consistency** (audit `docs/findings/manifold-vs-tf-audit.md`) — (a) converge warp densification (Manifold's fixed `WARP_AXIAL_MAX_ZSPAN` → curvature-adaptive `planAxialStations` like TF); (b) share graph-lowering primitives (`consumed-set`/`stack_ref`/`poly_repeat`) between `graph-to-tf.ts` + `composition-emit.ts`; (c) port bore-extend defect-2 prevention to Manifold hollow sweeps. DEAD CODE: dedup `creaseAwareCornerNormals` (`render-helpers:529` ≈ `trueform-adapter:271`, ~70 LOC — RISKY: differ by a `weldTol` param, not a safe delete).

### Open — editor
- **Section card — "show cutter" option** — a view-only toggle on the ✂ section card to render the CUTTING wedge/cube semi-transparent (overlay, not baked) so the author sees what `az`/`offset` removes.
- **Click a connection → delete popover** — clicking a wire (bezier in `WireLayer.svelte`) opens a popover at the click with "delete" that unwires THAT target input slot. Needs: hit-testable wire paths (fat invisible hit-path) + unwire mutate per slot type.
- ~~**BUG — 3D-bake ✂ section clips instead of CSG-cutting**~~ **NOT A BUG (disproven 2026-07-09).** `sectionCut` was always a real capped CSG (`solid.subtract(wedge)` → genus 0, half volume, positive sign, 2 tris on the cut plane). The cap was being DROPPED at render classification — triangles with an unknown `originalID` were discarded instead of bucketed into the body. Fixed in `render-helpers.ts`; guarded by `sectioncut-render.test.ts`.
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
