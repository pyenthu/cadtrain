# TODO — crisp index. Full detail in `/plan` (Gantt) + `docs/plans/*` + memories.

## Wells (the active push)
- **#77 · Wells = native GRAPH docs** (DECIDED 2026-07-28) — a well is a pure graph doc (`.asm.ts`); well shape = typed `list<record>` params (`casings`/`openholes`/`completions`/`survey` via parts_table/parts_stack + #38). No 2nd WSON format. FIRST ARTIFACT: reproduce `w2_completion_vert` as a param-shaped well graph doc. `wsonToGraph` → one-time import. Memory `wells_graph_native_decision`.
- **#42c · Recreate completion/well parts on the VOLUME** (`well_parts/`, by id — #77's no-parser model). Parametric `bw_*` (od/id/length); port the fixed `g_*` profiles. ⚠ writes shared prod volume — attended only.
- **#42f · Port real geometry into 4 placeholder well elements** (`bw_pup_perf`/`trsssv_sp`/`gauge_mandrel`/`packer_ahr_ahc`) — parametric revolve driven by od/length, NOT a fixed-`g_*` alias. Drop from `PLACEHOLDER_PART_IDS`.
- **#42h · Wells 3D via the primitives pipeline — CORE DONE** (GraphEditorPane bakes `wsonToGraph`). LEFT: (a) 3D `BAKE | TF` engine selector + TF wiring, (b) rail per-element colour/layer toggles → the 3D pane, (c) delete the dead shell (`WellSchematic3D`/`WellScene`/`threeD/manifoldCut`/the unused WellBakePool seam).
- **#42b · ewells parity** — A build-arch (clip-plane cutaway · element libs · auto-fit 2D+3D) · B editing (mutation+undo · CompletionsEditor · SurveyEditor · inspector-on-select) · C render polish · D chrome (toolbar · ruler MD/TVD · camera presets). (`wells-ewells-gaps.md`)
- **#42g · Wells autoscale + directional toggle** — `xDiaScale`/`yScale`/`autoScale`/`directional` persist in WSON `meta.display`; auto-fit on load + manual override; promote `directional` to a top-level control.
- **#42d · Wells CAD-parts browser + WBG Wizard** (AIDE model: section-by-section WBG · parts picker · left nav · Auto Design). (`wells-cad-parts-browser.md`)
- **#7 / #42 · Wells shell** — register `g_*` into the parametric registry; long-string perf; real store; editor/inspector dock + left toolbar rail.
- **#43 · CHAT→WELLS AI** — RAG-grounded chat that creates/edits wells + a training/correction log (chat corrections · well-edit tuples · full-well snapshots) → LOCAL model (`webllm`, `ai_data_residency_local_first`). First safe headless increment: the register store + RAG-for-chat retrieval reusing the existing corpus. Deep-dive SVTC `src/lib/ai/` first.

## Engines (MF · TF · BREP)
- **BREP per-part / nested colours NOT rendered** (`bw_packer` all-brown) — `__tagNest` is MF-only; implement per-subpart colour tagging in the BREP executor. (#997)
- **BREP renderer — interpolate vertex normals** for material shading (E5 crease-normals must reach the BREP material path). (#993)
- **BREP client-side bake** (E2/E3/#39) — NOT STARTED. Server compiles → pooled warm client OCCT worker builds+meshes + `.cut()` cutaway. `brep-client.ts` is a stub. Verify HEADLESS.
- **BREP-native warp** (E4/#988) — `MakePipeShell` spline sweep (PROVEN: `w_deviated_casing` vol==MF; ⚠ the cut is section-BEFORE-sweep). LEFT: land into the bake pipeline · curvature-adaptive spine · warped-solid cutaway. Depends on E2.
- **BREP curved hollow swept-boolean** — cutaway throws (mesh degrades to uncut; **SVG path `/api/brep/svg` unguarded → 500s**). Quick win **#B-bore-extend**: port the MF/TF bore-extend trick (`brep-occt.ts:961`). Annular fix is MF/TF-only (replicad won't sweep a holed face).
- **Curvature-adaptive axial meshing** — shared `κ→Δz` (`planAxialStations`) EXISTS; **TF done**, **MF + BREP need wiring** (MF bake must call its own folder's model; BREP `nSpine`). Not new math. (#988/#944)
- **TF native `r_loft` builder** — `g_barrel`/waist/flare/ogive/scurve blank on TF (native-only); add `op:'loft'` from `scaleAt(t)`; verify vs the MF oracle. (#989)
- **TF geometry cache** — IndexedDB mesh cache keyed on the recipe hash (TF rebuilds every bake; matters for /wells N-element bakes).
- **#46 Graph→TF compiler** — structural-hash two-tier recompile; per-subpart material.
- **#51 TF welded-mesh builder** + NURBS smoothing (`taubin`/`laplacianSmoothed`).
- **Manifold↔TF consistency** — converge warp densification · share graph-lowering (`consumed-set`/`stack_ref`/`poly_repeat`) · port bore-extend to MF hollow sweeps. (`manifold-vs-tf-audit.md`)
- **`compose` toggle** — expose the opt-in `MF_Compose`/`weld` that fuses to one solid (default is separate parts). Mirror in TF.
- **E1 LEFT** — `engines/types.ts` common `Engine` interface (deferred, design with user).

## SVG / render
- **SVG smooth shading** — Lambert-shade from the shared crease-aware corner normals; extend `PrimitiveSvgView`+`svg-emit`, NO fork. ⚠ namespace gradient ids. (#985)
- **SVG_BASIC tab** — well-schematic SVG: offset walls ⊥ the projected centerline tangent (wellnew/SVTC model), not a projected mesh. Reuse `CompJsonSilhouette` + `wson-2d.ts`. (#1010, `svg-warp-projection.md` Option 2). *(Generic SVG warp-shear already fixed by Option 1.)*
- **BREP_SVG tab** — shade from BREP boundary surfaces (OCCT HLR outline + per-face Lambert), not a triangle soup. (#990)
- **#998 WGPU tab** — WebGPU raster of the OCCT true-boundary (scaffold shipped, not wired). Off critical path.
- **SVG tab is the last `/preview` caller** — needs `segmentsFloor` in the client worker; move the SVG bake + headless callers off-thread.
- **#65 Radial/Z-scale as build-time PARAMS** (warp-aware, arc-length not world-z). LEFT: UI (spline-mode toggle + warp-scale sliders); model/emit/bake shipped.
- **TF section shows no INNER colours** — `{op:'cutaway'}` must colour exposed faces `SECTION_INNER`.
- **SVG projection smoothness** — silhouette/crease outline, AA strokes. (`svg-projection-perf.md` Phase 1)

## Editor / graph
- **#16 Modularize `src/lib/shared/`** (50 files) — git mv into `viewer/svg/engines/profiles/types/volume/ui`; move `graph-editor/`→`graph/editor/` FIRST (kills 76/77 layering violations). ⚠ `folder-tree.ts` 113 paths. (`todo_modularize_k65`)
- **#940 Modularize GraphEditorPane — Phase 4** — pull remaining state/actions onto `controller.svelte.ts` + a `GraphCommand` undo layer; NodeCard per-type split. Inline (subagents stall on GEP).
- **#52 Modularize RightPane** — extract per-tab bodies (large component → HMR skips it).
- **Material/texture** (deprioritized) — **#61** material system · **#63** SVG `<pattern>` textures · **#76** material texture map. *(Graph-wide default-colour chip PARKED — un-overridden parts keep the built-in red/grey fallback; re-add only if that annoys.)*
- **#75 Auto-layout FORCE params** — expose connector-tension + card-repulsion dials in the menu.
- **#20 typed expression outputs** · **#11/#31 expression-as-builder + visual editor** · **#36 warp node** (repeat-as-sweep · varying-section r_sweep · spline as generic point-source · subpart colours).
- **`w_multi_string_dev` — drop the 9 linear sections**, keep only the multi-part warp. (#986) ⚠ writes the shared prod volume — attended only.
- Smaller: Section "show cutter" wedge overlay · in-canvas controls screen-fixed · multi-input compact connectors · #18 r_surface_grid · #21 sweep_demo · #17 loop toolbar.

## /design + AI
- **/design** — Tree · C4 · GEP module · Folder tree · Class model · Code graph. [ ] API docs from graphify (`gen-api-docs.mjs` → a /design "Docs" tab).
- **AI (#0, local-first, `ai-master-plan.md`)** — registry → cloud schema + local CFG → multishot → feedback corpus → WebLLM. #29 fn library · #1 RAG/assist · #27 feedback DB · #2 web-llm · #28 synthetic data. [ ] #3 LiteRT.js spike (decide the page; re-run the cold baseline first). Research: BRep→CSG face-embeddings (`brep-csg-spike.md`).
