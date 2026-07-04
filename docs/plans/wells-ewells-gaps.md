# /wells → ewells.app parity — GAP LIST (enhance me)

**Status:** starter list (2026-07-04). Derived from the current `/wells` render + the
SVTC deep-dive (`docs/research/svtc-wson-deep-dive.md`). **User to enhance** with the
specific ewells.app differences (checkbox each; add sub-items). Reference: ewells.app +
`docs/plans/wells-interface.md` (W-A..W-G) + SVTC deep-dive.

## Already shipped (verified on :3333)
- Left sidebar (Samples + Workspace tree, filter, Open Folder), tab strip, collapsible
  header, control bar (Cutaway/Directional/DTX/Ruler/White + Cut-az/Dia×/Depth×), left
  element rail, depth ruler, labella leader-labels, 3D schematic, workspace cache.

## GAPS (starter — enhance)
- [ ] **G1 · Editing (VIEWER → EDITOR)** — /wells can't edit; ewells can.
  - [ ] mutation layer + undo/redo (SVTC `setSrc`/`createHistory`) — prereq for all editing
  - [ ] CompletionsEditor (strings/completions table: add/remove/edit rows, live re-render)
  - [ ] SurveyEditor (md/dev/az stations → re-warp trajectory)
  - [ ] inspector-on-select (click a 3D component → its params / `tool_comp` ParamSpec dials)
- [ ] **G2 · 3D schematic layout** — it renders narrow/off-center vs ewells.
  - [ ] width/centering + fit-to-view
  - [ ] auto-scale / aspect / plot-track behavior
- [ ] **G3 · Label layout** — currently one bank.
  - [ ] split left + right banks (by warped anchor-X, like SVTC/ewells)
  - [ ] leader-line styling / anti-overlap tuning
- [ ] **G4 · White scene** — toggle exists; confirm the 3D SCENE bg actually goes white + materials stay legible.
- [ ] **G5 · Element rail** — icons/behavior vs ewells.
  - [ ] correct icons + labels per element type
  - [ ] select/highlight an element type → filter/inspect
- [ ] **G6 · Popovers** — element/param popovers (anchored, SVTC-style) for editing.
- [ ] **G7 · 2D derived track view (W-D)** — the classic 2D schematic readout (ewells shows one?). Port SVTC `wsonRender.js` → `wson-2d.ts` + `WellSchematic2D.svelte` on the white surface.
- [ ] **G8 · Toolbar actions (W-E)** — new/open/save .wson, add completion/casing/perf, export (PNG/GLB/SVG), fit-view.
- [ ] **G9 · Depth ruler polish** — MD vs TVD, units, tick density, DTX-remap emphasis.
- [ ] **G10 · <add ewells-specific gaps here>**

## Notes
- Editing (G1) is the biggest gap + the SVTC deep-dive's #1 priority (a real differentiator once the parametric registry drives the inspector).
- Blocked on the monthly spend limit for parallel agents; execute inline or via a focused agent once the limit resets.
