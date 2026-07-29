# TODO — crisp index. Full detail in `/plan` (Gantt) + `docs/plans/*` + memories.

## App Harness — build-via-AI (the strategic push)
Design: `docs/architecture/app-harness.md` · research `docs/research/cursor-sdk-vs-ai-layer.md` · module `src/lib/appkit/CLAUDE.md`.
- **The bet:** cadtrain = engine + harness; a sub-app is a self-contained `.app` the AI builds. **Two-tier (D12):** Claude builds ENGINES (`src/`, complex → verbs); the runtime AI builds APPS (`.app`, thin — draw+wire engines). The **verb registry = the boundary + the full API** (D13). **Per-engine RAG/LLM** — federated experts, authored w/ Claude (D14). **Structured progressive** build pipeline captures every build → **learning system** (D15). Local-first (Ollama/WebLLM) + cloud Claude (D4). Three surfaces over one `.app`: AI chat · visual editor · rendered harness (D16).
- **✅ Shipped:** rung 1 (verbs→AI-SDK schema→dispatch) · rung 2 (harness renders `.app`) · dynamic loader (load/list/save at runtime + `scaffold.app`) · rung 3a (data verbs → REAL parts) · **rung 4a** (AI build primitive: prompt → gui verbs → `.app`, `/api/app/generate` + ChatPanel — **VERIFIED LIVE**: built a hello-world text panel) · **4a hardening** (sanitizeApp drops hallucinated verbs) · **rung 4a.2** (learning loop: `app-corpus.ts` captures every build + grounds future ones — lexical, local) · **ENG-gui** (iterative-editing verbs: removePanel/movePanel/setPanelProp/setAppMeta).
- **▶ Loop queue (autonomous, in order):** **(1) 3b** — wire `bake` to the engine → the bake3d panel renders (+ mutate setParam/addRow → re-bake); **(2) ENG-engine** — widen the verb API to compile/preview/save/engine ops; **(3) rung 5** — local runtime provider (Ollama/WebLLM) behind the pipeline (needs Ollama to fully test); **(4) 4b** — native visual `.app` editor (Svelte Visual Builder patterns). Then **PENG** per-engine RAG/LLM (user authors w/ Claude). Reference layout for hello-world→wells: this repo `wells.app`/`/wells` + SVTC + wellnew.


## Wells (the active push)
- **#77 · Wells = native GRAPH docs** (DECIDED 2026-07-28) — a well is a pure graph doc (`.asm.ts`); well shape = typed `list<record>` params (`casings`/`openholes`/`completions`/`survey` via parts_table/parts_stack + #38). No 2nd WSON format. **FIRST ARTIFACT PROVEN (`5129b7b`):** `w_well_native` — the 3 `parts_table` nodes → `list<record>` params (cements/openholes/casings) + `parts_map`; bakes **byte-identical** (11538v/3846t/z300). Tooling `scratch/issue-77-param-well/`; deliverable local (no volume write). NEXT: save it to the volume (attended) + build the params GUI on those list params. `wsonToGraph` → one-time import. Memory `wells_graph_native_decision`.
- **#42c · Recreate completion/well parts on the VOLUME** (`well_parts/`, by id — #77's no-parser model). Parametric `bw_*` (od/id/length); port the fixed `g_*` profiles. ⚠ writes shared prod volume — attended only.
- **#42f · Port real geometry into 4 placeholder well elements** (`bw_pup_perf`/`trsssv_sp`/`gauge_mandrel`/`packer_ahr_ahc`) — parametric revolve driven by od/length, NOT a fixed-`g_*` alias. Drop from `PLACEHOLDER_PART_IDS`.
- **#42h · Wells 3D via the primitives pipeline — CORE DONE** (GraphEditorPane bakes `wsonToGraph`; dead shell DELETED `50c1aa4`). LEFT: (a) 3D `BAKE | TF` engine selector + TF wiring, (b) rail per-element colour/layer toggles → the 3D pane.
- **#42b · ewells parity** — A build-arch (clip-plane cutaway · element libs · auto-fit 2D+3D) · B editing (mutation+undo · CompletionsEditor · SurveyEditor · inspector-on-select) · C render polish · D chrome (toolbar · ruler MD/TVD · camera presets). (`wells-ewells-gaps.md`)
- **#42g · Wells autoscale + directional toggle** — `xDiaScale`/`yScale`/`autoScale`/`directional` persist in WSON `meta.display`; auto-fit on load + manual override; promote `directional` to a top-level control.
- **#42d · Wells CAD-parts browser + WBG Wizard** (AIDE model: section-by-section WBG · parts picker · left nav · Auto Design). (`wells-cad-parts-browser.md`)
- **#7 / #42 · Wells shell** — register `g_*` into the parametric registry; long-string perf; real store; editor/inspector dock + left toolbar rail.
- **#43 · CHAT→WELLS AI** — RAG-grounded chat that creates/edits wells + a training/correction log (chat corrections · well-edit tuples · full-well snapshots) → LOCAL model (`webllm`, `ai_data_residency_local_first`). First safe headless increment: the register store + RAG-for-chat retrieval reusing the existing corpus. Deep-dive SVTC `src/lib/ai/` first.

## Engines (MF · TF · BREP)
- **BREP client-side bake** (E2/E3/#39) — NOT STARTED. Server compiles → pooled warm client OCCT worker builds+meshes + `.cut()` cutaway. `brep-client.ts` is a stub. Verify HEADLESS.
- **BREP-native warp** (E4/#988) — `MakePipeShell` spline sweep (PROVEN: `w_deviated_casing` vol==MF; ⚠ the cut is section-BEFORE-sweep). LEFT: land into the bake pipeline · curvature-adaptive spine · warped-solid cutaway. Depends on E2.
- **BREP curved hollow swept-boolean** — SVG-500 FIXED (`#B-bore-extend`, merged): `/api/brep/svg` now degrades to uncut instead of throwing + `sectionCut` guarded; bore-extend added as MF/TF parity (OCCT's exact boolean already tolerates coincident caps, so no χ win). REMAINING: an actual cutaway REVEAL on a swept-boolean (needs the annular section — MF/TF-only for BREP; replicad won't sweep a holed face).
- **Curvature-adaptive axial meshing** — DONE (`c833d80`): MF + BREP now wire the shared `planAxialStations` (TF already did); bends cluster rings, straight tangents go sparse. ⚠ MF is **opt-in/default-off** — flip `well-graph-bake.ts` + server `/preview` (1 line each) to turn it on for the real WELL bake. (#988/#944)
- **TF native `r_loft` builder** — `g_barrel`/waist/flare/ogive/scurve blank on TF (native-only); add `op:'loft'` from `scaleAt(t)`; verify vs the MF oracle. (#989)
- **Manifold↔TF consistency** — converge warp densification · share graph-lowering (`consumed-set`/`stack_ref`/`poly_repeat`) · port bore-extend to MF hollow sweeps. (`manifold-vs-tf-audit.md`)
- **`compose` toggle** — expose the opt-in `MF_Compose`/`weld` that fuses to one solid (default is separate parts). Mirror in TF.
- **E1 LEFT** — `engines/types.ts` common `Engine` interface (deferred, design with user).

## SVG / render
- **SVG smooth shading** — Lambert-shade from the shared crease-aware corner normals; extend `PrimitiveSvgView`+`svg-emit`, NO fork. ⚠ namespace gradient ids. (#985)
- **SVG_BASIC tab** — well-schematic SVG: offset walls ⊥ the projected centerline tangent (wellnew/SVTC model), not a projected mesh. Reuse `CompJsonSilhouette` + `wson-2d.ts`. (#1010, `svg-warp-projection.md` Option 2). *(Generic SVG warp-shear already fixed by Option 1.)*
- **BREP_SVG tab** — shade from BREP boundary surfaces (OCCT HLR outline + per-face Lambert), not a triangle soup. (#990)
- **WGPU tab — SHIPPED** (plan 1012): boundary render + white bg + steel-fill shading under the teal outline. LEFT = a human eyeball on the GPU draw (headless can't run WebGPU). Off critical path.
- **SVG tab is the last `/preview` caller** — needs `segmentsFloor` in the client worker; move the SVG bake + headless callers off-thread.
- **#65 Radial/Z-scale as build-time PARAMS** (warp-aware, arc-length not world-z). LEFT: UI (spline-mode toggle + warp-scale sliders); model/emit/bake shipped.
- **TF section shows no INNER colours** — `{op:'cutaway'}` must colour exposed faces `SECTION_INNER`.
- **SVG projection smoothness** — silhouette/crease outline, AA strokes. (`svg-projection-perf.md` Phase 1)

## Editor / graph
- **#16 Modularize `src/lib/shared/`** (50 files) — git mv into `viewer/svg/engines/profiles/types/volume/ui`; move `graph-editor/`→`graph/editor/` FIRST (kills 76/77 layering violations). ⚠ `folder-tree.ts` 113 paths. (`todo_modularize_k65`)
- **#940 Modularize GraphEditorPane — Phase 4** — pull remaining state/actions onto `controller.svelte.ts` + a `GraphCommand` undo layer; NodeCard per-type split. Inline (subagents stall on GEP).
- **#52 Modularize RightPane** — extract per-tab bodies (large component → HMR skips it).
- **Material/texture** (deprioritized) — **#61** material system · **#63** SVG `<pattern>` textures · **#76** material texture map. *(Graph-wide default-colour chip PARKED — un-overridden parts keep the built-in red/grey fallback; re-add only if that annoys.)*
- **#20 typed expression outputs** · **#11/#31 expression-as-builder + visual editor** · **#36 warp node** (repeat-as-sweep · varying-section r_sweep · spline as generic point-source · subpart colours).
- **`w_multi_string_dev` — drop the 9 linear sections**, keep only the multi-part warp. (#986) ⚠ writes the shared prod volume — attended only.
- ✅ **Section card = multiple inputs** — DONE (merged `7e6c64b`): 0-1 solid byte-identical; ≥2 solids → each sectioned with the same wedge, kept as SEPARATE bodies (list producer, never fused). `cutaway.ts children[]` + emit + graph mutate API + multi-input socket UI. +7 tests (11/11 cutaway). Eyeball: drag a 2nd wire into the section input.
- Smaller: Section "show cutter" wedge overlay · in-canvas controls screen-fixed · multi-input compact connectors · #18 r_surface_grid · #21 sweep_demo · #17 loop toolbar.

## /design + AI
- **/design** — Tree · C4 · GEP module · Folder tree · Class model · Code graph. [ ] API docs from graphify (`gen-api-docs.mjs` → a /design "Docs" tab).
- **AI (#0, local-first, `ai-master-plan.md`)** — registry → cloud schema + local CFG → multishot → feedback corpus → WebLLM. #29 fn library · #1 RAG/assist · #27 feedback DB · #2 web-llm · #28 synthetic data. [ ] #3 LiteRT.js spike (decide the page; re-run the cold baseline first). Research: BRep→CSG face-embeddings (`brep-csg-spike.md`).
