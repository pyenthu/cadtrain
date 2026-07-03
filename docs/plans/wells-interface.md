# /wells interface — modeled on the SVTC main .wson app

**Status:** planning (2026-07-03). Companion to `well-schematic.md` (which covers the
ENGINE port). This doc covers the `/wells` **UI shell + interaction**, modeled on
SVTC's main well-schematic app (`~/code/SVTC/src/lib/apps/wson/WsonApp.svelte` +
`CompletionsEditor.svelte` + `SurveyEditor.svelte` + `Wson3DScene.svelte` toggles),
adapted to cadtrain's 3D-first stance + component library.

## Already shipped (don't re-plan)
- ewells-style **app shell**: dark chrome, left folder **sidenav** (`FolderTreeSidebar` /
  `WellSideNav`), **multi-tab** strip (a pane per open `.wson`), far-left icon rail
  (`WellToolbar`), **local workspace** (File System Access API — open folder/files),
  3 bundled samples.
- **3D schematic** center view (`WellSchematic3D`): oh/ch/cement/tubing → cut* CSG,
  perforations, completions via the parametric registry, warped along the survey,
  DTX depth scaling; mounts in a `<Canvas>`.

## Interface enhancements — modeled on SVTC's WsonApp (the ask)
SVTC's main app is a 3-region workspace: **left explorer · center diagram · right
editor/inspector**, with a **layer/view control bar** and **on-diagram annotations**.
Bring those to `/wells`:

### A. View + layer controls (SVTC's scene toolbar) — HIGH, cheap
A control bar over the 3D view (reuse `SceneControls` pattern), driving `WellSchematic3D` props:
- **Layer toggles**: show/hide open-hole · casing · cement · tubing · completions · perforations (the `layers` prop already exists — just expose checkboxes).
- **Cutaway** (half-section) on/off + **directional** (warp along survey) on/off.
- **Scale dials**: `diaScale` (radial exaggeration) · `zScale` (depth stretch) · **DTX** on/off (emphasize cluttered zones). Sliders like the CAD editor's z-scale.
- **Cut azimuth** (rotate the cutaway plane). Camera presets (elevation / plan / 3D).

### B. Right-hand EDITOR / INSPECTOR panel (SVTC's CompletionsEditor + SurveyEditor) — HIGH
A right dock (collapsible), tabbed:
- **Completions/strings table** — edit oh/ch/cement/tubing/completions rows (od/id/top/bot/grade/tool_comp) as a form/grid; add/remove rows; live re-render. (SVTC `CompletionsEditor`.)
- **Survey editor** — edit the deviation survey `{md,dev,az}` stations (SVTC `SurveyEditor`); the trajectory re-warps live.
- **Inspector on select** — click a component in the 3D scene → highlight + show its row/params (ties to the parametric registry; a `tool_comp` with a builder shows its `ParamSpec` dials).

### C. On-diagram annotations + depth ruler — MED
- **Depth axis / ruler** down the side (true MD + the DTX-remapped display depth).
- **Leader-line labels** for components/perfs (SVTC uses `labella` force-layout in 2D; do a 3D-billboard or a side-rail label column).

### D. 2D derived track view (SVTC's Wson2DRenderer) — MED, later
An optional 2D well-track panel (SVG) beside/under the 3D — the classic schematic
readout. Port `wsonRender.js` pure helpers (`txPoint`/`buildDirPath`/`perfArrows`/
`cementRects`) — cadtrain is 3D-first so this is a secondary view, not the primary.

### E. Toolbar actions (the left rail) — LOW
Fill the `WellToolbar` icon rail with real actions: new/open/save `.wson`, add
completion/casing/perf, toggle 2D/3D, export (PNG/GLB), fit-view.

## Reuse map (SVTC → cadtrain)
- `WsonApp.svelte` — the 3-region layout reference (explorer/diagram/editor) + how it
  wires editor edits → re-render.
- `CompletionsEditor.svelte` / `SurveyEditor.svelte` — the table/form editors (port the
  interaction; cadtrain styles + WSON shape).
- `Wson3DScene.svelte` — the `layers`/`cutaway`/`directional`/`cutAzimuth`/marker-scale
  toggles (already props on `WellSchematic3D`) — A just surfaces them.
- Keep cadtrain conventions: FloatingPanel/popovers-over-inline, dark ewells aesthetic,
  reuse the CAD editor's slider/gear patterns, Z-down.

## Sequence
A (view/layer bar — surfaces existing props) → B (editor/inspector dock) → C
(annotations/ruler) → D (2D track) → E (toolbar actions). A + B are the SVTC-parity core.

## Related
`well-schematic.md` (engine), `svtc_repo` memory, `well_schematic_3d_first` memory,
the parametric registry (`src/lib/wells/threeD/parametric/`) for the inspector.
