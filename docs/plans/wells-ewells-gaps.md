# /wells → ewells.app parity — COMPREHENSIVE gap + build plan (enhance me)

**Status:** 2026-07-04, actively enhanced by user. Derived from the current `/wells`
render + SVTC deep-dive (`docs/research/svtc-wson-deep-dive.md`) + ewells.app.
Companion: `docs/plans/wells-interface.md` (W-A..W-G), `well-schematic.md` (engine).
Checkbox + add sub-items freely.

## Already shipped (verified on :3333, 2026-07-04)
Left sidebar (Samples + Workspace tree, filter, Open-Folder) · tab strip · collapsible
SVTC-style header · control bar (Cutaway/Directional/DTX/Ruler/White + Cut-az/Dia×/Depth×) ·
left element rail (counts) · depth ruler + labella leader-labels · 3D schematic · workspace
cache (folder + tabs restore).

---
## A. BUILD ARCHITECTURE + PERF  ← do this FIRST (decides everything downstream)
- [ ] **A1 · Multi-threaded build via cadtrain's bake API (the "significant enhancement")** — the 3D schematic is SLOW vs ewells (ewells = instant 2D SVG; cadtrain builds real Manifold CSG shells + cutaways on the MAIN THREAD → janky, worst on long strings). Route the wells geometry build through the client Web-Worker bake pipeline (`src/lib/cad/bake-worker.ts` + `bake-client.ts`; server = compiler) so CSG runs OFF the main thread + parallelizes.
  - [ ] design pass: what unit is baked (per-string? whole well? batched?) + how results compose in the scene
  - [ ] parallelize per-string / per-component builds
  - [ ] progressive render (show strings as they finish; don't block on the whole well)
  - [ ] ties #7 long-string perf + memory `stack_cutaway_perf_root_cause` (cutaway CSG super-linear → per-part cutaway is the planned fix)
- [ ] **A2 · Well elements as PARAMETRIC LIBRARY components** — OH (open-hole) · casing · cement · tubing · completions · perforations should be **library parts** (parametric registry / `g_*`-style volume parts) that the wells engine **calls** with params, NOT hardcoded geometry in `WellSchematic3D`. Each element = a reusable, bakeable part → composes with A1 (each library part bakes via the pipeline) + gives per-element parametrics for the inspector (B4).
  - [ ] define the element library (`oh`, `casing`, `tubing`, `cement`, `completion`, `perf`) as parametric parts + a registry (extend `src/lib/wells/threeD/parametric/registry.ts`)
  - [ ] engine builds a well by CALLING these with row params (od/id/top/bot/grade/…)
  - [ ] register the existing `g_*` completion jewelry into the same registry (the standing NEXT item)
- [ ] **A3 · AUTO-SCALE** — auto-fit the schematic to the view + sensible default dia/depth exaggeration (a deep narrow well shouldn't render as an invisible sliver). Auto aspect + fit-to-view on load / on data change; the Dia×/Depth× dials override the auto value.

## B. EDITING (viewer → editor — SVTC deep-dive's #1 gap)
- [ ] **B1 · Mutation layer + undo/redo** (SVTC `setSrc`/`createHistory`) — prereq for all editing.
- [ ] **B2 · CompletionsEditor** — strings/completions table: add/remove/edit rows (od/id/top/bot/grade/tool_comp), live re-render.
- [ ] **B3 · SurveyEditor** — md/dev/az stations → re-warp trajectory live.
- [ ] **B4 · Inspector-on-select** — click a component in the 3D scene → its params (the A2 library part's `ParamSpec` dials). cadtrain's differentiator.
- [ ] **B5 · Edit-the-diagram POPOVERS** — click a component/element → an ANCHORED popover (SVTC/FloatingPanel-style) to edit its params/rows directly on the diagram. The direct-manipulation edit path.

## C. RENDERING + LAYOUT
- [ ] **C1 · 3D schematic sizing** — renders narrow/off-center; center + fill the stage (pairs with A3 auto-scale).
- [ ] **C2 · Label layout** — currently ONE left bank.
  - [ ] split left + right banks (by warped anchor-X, like SVTC/ewells)
  - [ ] **annotation ANCHOR option** — toggle each annotation between (a) attached to the DIAGRAM (label by its component on the 3D well — needs live camera projection / 3D billboard) and (b) the LEFT depth ruler (current `WellDepthRuler`). Per-annotation or global.
  - [ ] leader-line styling / anti-overlap tuning
- [ ] **C3 · White SCENE bg** — the White toggle only drives CSS `.wv-stage.white` + a `whiteBg` prop; the Three SCENE background is NOT set from it (canvas stays dark). Wire `WellSchematic3D` to set `scene.background`/clear-color white + keep materials legible.

## D. CONTROLS + CHROME
- [ ] **D1 · Element rail** — correct icons/labels per element type; select/highlight → filter + feed the inspector (B4).
- [ ] **D2 · Toolbar actions (W-E)** — new/open/save `.wson` · add completion/casing/perf · export (PNG/GLB/SVG) · fit-view.
- [ ] **D3 · Depth ruler polish** — MD vs TVD, units, tick density, DTX-remap emphasis.
- [ ] **D4 · Camera presets** — elevation / plan / 3D (needs a camera setter; OrbitControls owns it today).

## E. SECONDARY VIEW
- [ ] **E1 · 2D derived track view (W-D)** — the classic 2D SVG schematic readout on the white surface. Port SVTC `wsonRender.js` → `wson-2d.ts` + `WellSchematic2D.svelte`; shares the depth scale.

## G. MATERIALS (source feature — primitives render)
- [~] **G-MAT1 · Opacity/transparency** (IN PROGRESS) — `makeLitMaterial` gains `transparent`+`opacity`+`depthWrite=false`; per-part `meta.opacity` + Properties-card slider + a scene "x-ray" control; per-subpart alpha via the #86 color-by-source LUT (RGBA). Well defaults: **open-hole ~0.15 (transparent viz shaft), casing/cement/tubing/hanger opaque** — you look INTO the well through the OH boundary, NOT through the casing.
- [ ] **G-MAT2 · Textures** — named material textures in `makeLitMaterial` (a `meta.texture`: `cement` = hatched/aggregate · `steel` = casing/tubing · `rock` = open-hole face · …), procedural canvas-texture or asset maps. **Cement especially** (hatched aggregate is the schematic convention). Applies to primitives generally, not just wells. Do AFTER G-MAT1 (same material code path).

## F. <user: add ewells-specific gaps>
- [ ] F1 · …

## Notes / sequencing
- **A first** (build model + element library + auto-scale) — it's the perf foundation + unblocks B4/D1 (parametric inspector) and A1 (multi-threaded bake). Then B (editing), then C/D polish, then E.
- Parallel agents blocked on the monthly spend limit; execute inline or via a focused agent once raised.
