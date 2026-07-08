# Execution batches

Grouped, issue-and-execute units built from `TODO.md` (which stays the canonical
list). Each batch is sized to ONE build+commit cycle so you can say **"run Batch N
to completion"** and I do the whole thing (edit → build → test → commit) without
per-step check-ins.

**How to issue a batch:** copy the **▶** line. Add "don't check in with me, verify at
the end" for max speed. Batches are independent unless a **needs** note says otherwise.

Legend — **Effort**: S(<1h) · M(half-day) · L(multi-session). **Risk**: how likely to
break other things. **Verify**: H=headless test/build · B=browser check needed.

---

## Batch 1 — TF quick bugs + gaps  ·  Effort M · Risk low · Verify H+B
The cluster of small TF-tab issues. All in `PrimitiveDualCanvas.svelte` / `graph-to-tf.ts` / `PrimitiveDualScene.svelte`.
- **TF double-bake per change** (TODO L20) — repro on a param scrub, count `[bake-client]`/TF-worker calls; find the `$effect` firing twice (args identity? geoVersion? active-pane gate?). *Specificity: needs a repro count first — I'll instrument, then fix.*
- **TF timing measured wrong** (L21) — audit `PrimitiveDualCanvas` tf branch ~L562-607 (`tim.warm`/`tim.build`, `buildMs`); likely double-counts the kernel warm or is skewed by the double-bake.
- **x-ray slider no-ops on TF parts** (L24a) — multiply `scene.xrayOpacity` into `pOp` at `PrimitiveDualScene:988,1018`. *(Precise, S.)*
- **scene sine-warp toggle no-ops on the TF tab** (L24b) — `PrimitiveDualCanvas:367`.
- **TF `parts_map` builder** (L22) — `graph-to-tf.ts` has no `parts_map` case → "no builder". Add a native builder or a documented passthrough (mirror the cutaway passthrough just shipped).
▶ **Run Batch 1: fix the TF double-bake, timing, x-ray-on-TF, sine-warp-on-TF, and the parts_map builder — instrument first where noted, then verify.**
*Split option: "just do the two precise ones (x-ray + sine-warp)" = S, skip the CHECK items.*

## Batch 4 — Section card polish  ·  Effort S · Risk low · Verify B
- **"show cutter" overlay** (L34) — a toggle on the ✂ section card to render the cutting wedge semi-transparent (view-only, not baked) so you see what `az`/`offset` removes.
▶ **Run Batch 4: add the section-card "show cutter" overlay toggle.**

## Batch 5b — SVG smoothness (silhouette outlines)  ·  ✅ DONE (7bb0127)
Phase 1 of `docs/plans/svg-projection-perf.md` — silhouette/crease-outline extraction (`svg-silhouette.ts`), anti-aliased strokes (`stroke-linejoin:round`, non-scaling-stroke, geometricPrecision), collinear-merge (fewer facet chords), curve-aware. Plus #63 (c) `<pattern>` textures (rock/cement/steel). 19 tests green.

## Batch 6 — Material system  ·  Effort M · Risk low-med · Verify B
- **#61 Material CARD** (L37) — (a) opacity/transparency [in progress]; (b) textures via `meta.texture`; (c) a Material Card (sibling to Properties/Params) authoring colour·opacity·texture·preset per PART+SUBPART.
▶ **Run Batch 6: build the Material Card (per-part+subpart colour/opacity/texture/preset).**
*Pairs with Batch 5's #63. Say "do 6 then 5" if you want materials driving SVG too.*

## Batch 8 — Data-driven params P2 (list<record> table editor)  ·  Effort M · Risk low · Verify B
- **#38 P2** (L45) — `ParamsCard` gains "add object/row" to build a `list<record>` inline (a strings table). Payoff: `w_multi_string_dev` 18 cards → 1 list param + 1 producer. Producer (`parts_map`) + schema already shipped.
▶ **Run Batch 8: add the list<record> table editor to ParamsCard (#38 P2).**

## Batch 9 — Small merges / stragglers  ·  Effort S each · Risk low · Verify H
- **#18 r_surface_grid** — merge `feat/surface-grid-expr`.
- **#21 sweep_demo** — apply the fix on its worktree branch.
- **#17 Loop·x/y toolbar drop.**
- **#19 BUG** `casing_schematic` "BREP is deleted" — investigate.
- **`compose` opt-in toggle** (L23) — separate vs fused overlapping parts (author picks list vs weld). Mirror in TF.
▶ **Run Batch 9: pick which — "merge #18", "apply #21", "the #19 BREP-deleted bug", or "the compose toggle".** *(These are unrelated; issue individually.)*

---

## Bigger tracks (not single-batch — scope first, then sub-batch)
- **#42b Wells → ewells parity** (L7-11): A build-arch (WellBakePool + clip-plane cutaway) · B editing (mutation/undo, Completions+Survey editors) · C render polish · D chrome. Each is its own multi-batch track. Plan: `wells-build-architecture.md`.
- **#940 GEP modularization Phase 4** (L4): inline-only, browser-verify each cut — pull the 7 candidates onto `controller.svelte.ts` + a GraphCommand undo layer. **#52 RightPane** modularize rides along.
- **AI umbrella #0** (L54-56): registry → cloud schema → local CFG → multishot → feedback → WebLLM. Local-first constraint. Plan: `ai-master-plan.md`.
- **/design docs** (L50-52): API docs from `graphify-out/graph.json`; decide `src/volume_backup/` fate.

## Where I need more specificity from you (can't execute blind)
- **Batch 3 spline editor** — which component file is the spline editor? (I'll find it first turn, but confirm you mean the warp/`r_sweep` path spline, not the profile sketcher.)
- **Batch 1 double-bake** — is it every part or only multi-tab `/primitives`? (changes where I instrument.)
- **Batch 6 vs 5** — do you want materials to drive the SVG render too, or 3D/TF only for now?
