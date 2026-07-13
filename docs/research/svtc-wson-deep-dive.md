# SVTC `.wson` well-schematic app — deep dive + cadtrain `/wells` port map

**Status:** reference (2026-07-04). READ-ONLY research on `~/code/SVTC/src/lib/apps/wson/`,
mapped to cadtrain's `/wells` port (`src/routes/wells/**` + `src/lib/wells/**`).

This is the durable reference behind the `/wells` interface build (plan
`docs/plans/wells-interface.md`, tasks **A–E** = **W-A … W-E**; engine plan
`docs/plans/well-schematic.md`). It complements `docs/research/svtc-autoscale-dtx.md`
(DTX) and `docs/research/wbd-powerdraw-visio.md`. Memories: `svtc_repo`,
`well_schematic_3d_first`.

> **Orientation reminder.** SVTC is **2D-first** (the SVG schematic is the
> authoring surface; 3D is a derived view). cadtrain is **3D-first** (the 3D
> well is canonical; 2D is the derived view — plan W-D). The port therefore
> *inverts* the primacy but reuses almost all of SVTC's pure geometry.
> Axis: SVTC 3D uses X/Y=surface, Z=depth-positive-down, `up=[0,0,-1]` — this
> is **already the cadtrain Z-down convention**, so the 3D engine ported 1:1.

---

## 1. Architecture + data flow

### 1a. SVTC — 3-region workspace (`WsonApp.svelte`, 1717 lines)

```
┌ WsonToolbar ┐┌──────────────── WsonApp (per tab) ──────────────────────────┐
│ (icon rail) ││  [2D / 3D view tabs at bottom]                              │
│ Save        ││  ┌─ activeView='2d' ─ Wson2DRenderer (SVG) ──────────────┐  │
│ Export      ││  │   header · strata track · depth ruler · OH/cem/csg    │  │
│ Validate    ││  │   completions · perfs · labella leader labels         │  │
│ Notes       ││  └───────────────────────────────────────────────────────┘  │
│ Template    ││  ┌─ activeView='3d' ─ Wson3DView → Wson3DScene (Threlte) ─┐  │
│ Undo/Redo   ││  └───────────────────────────────────────────────────────┘  │
│ Edit schem. ││   Floating overlays (FloatingPanel, anchored):              │
│ Record      ││     WsonDisplayMenu (gear pill, on-canvas)                  │
│ Completions ││     CompletionsEditor · SurveyEditor · SchematicEditor      │
│ + Perf      ││     LocationEditor · CanvasCompPopup · CanvasPerfPopup      │
│ Survey      ││     TemplateGallery                                         │
│ Locate      │└─────────────────────────────────────────────────────────────┘
└─────────────┘   (the LEFT file explorer + tab strip live in the host app,
                   NOT in WsonApp — WsonApp is one tab's editor)
```

**State flow — the single mutable truth is `let wson = $state(null)`** in
`WsonApp`. Everything downstream is `$derived`:

```
wson  ──(getSrc normalises dlis config.* / wellData[0] / flat)──►  src
  │
  ├─ geo         = $derived.by(computeGeo({wson, srcRaw:getSrc(), displayOpts, dirData, …}))
  ├─ annotations = $derived.by(computeAnnotations({geo, displayOpts, layers}))   // labella
  ├─ headerFields= $derived.by(computeHeaderFields({wson, …}))
  └─ compSvgStrings = $effect → async fetch per-comp catalog SVG
              │
              ▼
  Wson2DRenderer (props: geo, layers, annotations, compSvgStrings, svgNs, callbacks)
  Wson3DScene   (props: wson, wellDir, annotations, layers, cut* , diaScale, …)
```

**Edits re-render via `setSrc(mut)`** — the reactivity keystone. A shallow
`wson = {...wson}` leaves nested `wellData[0]` as the same proxy, so
`$derived.by` reading `wson.wellData[0].completions[n].top` stayed stale.
`setSrc` rebuilds *every container on the path* down to the working object:

```js
function setSrc(mut) {
  if (wson.config?.openHole)      wson = { ...wson, config: { ...wson.config, ...mut(wson.config) } };
  else if (wson.wellData?.length) wson = { ...wson, wellData: [{ ...wson.wellData[0], ...mut(wson.wellData[0]) }, ...wson.wellData.slice(1)] };
  else                            wson = { ...wson, ...mut(wson) };
}
```
Every mutator (`updateComp`, `toggleCompAutoTop`, `addCompRow`, `addPerforation…`,
survey AI) goes through `setSrc`, so the 2D + 3D views update in the SAME frame.

**Directional data is fetched, not computed inline.** `fetchDirData()` POSTs to
`/api/schematic {action:'autonodes', nodes, maxDepth, survey}` and stores
`dirData = { dtx, prNorm, prAuto }`:
- `dtx` = `{ depth[], depthTx[] }` DTX remap table (clutter-expanding depth warp).
- `prNorm` = arc-slerp survey segments in **normal** MD.
- `prAuto` = the same segments **DTX-remapped**.
`computeGeo` picks `prAuto` when `displayOpts.autoScale` else `prNorm`, wraps them
in a `WellDirection`, and gates directional rendering on
`hasDir = wellDir.hasDeviation && displayOpts.directional`.
`scheduleDirRefresh()` debounces this 250 ms on hot edits (length/top keystrokes).

**Per-tab display cache** (`<script module>` `_cache` Map, cap 20): `displayOpts`
+ `layers` + `viewMode` survive tab remounts. Also mirrored into
`wson.meta.display` (guarded by `hydrated`) so preferences round-trip in the file.

**Undo/redo:** `createHistory(50)` — `pushUndo()` deep-clones `wson` before a
mutation; `undo/redo` swap the whole `wson`.

### 1b. cadtrain — 3-region shell (already shipped)

```
WellToolbar (route)  │ WellSideNav (FolderTree)  │ tab strip + WellViewPlaceholder per tab
 far-left icon rail  │  Samples + Workspace       │  WellViewControls (W-A) over
                     │  (File System Access API)  │  <Canvas><WellSchematic3D/></Canvas>
                     │                            │  + WellDepthRuler overlay (W-C)
```

cadtrain data flow is *thinner* and **read-only today**:
- `+page.svelte` owns tabs (the /primitives multi-tab pattern: `Tab[]`+`activeKey`,
  all panes stay mounted, `visibility:hidden` not `display:none`) + a **single
  shared `view = $state(defaultViewSettings())`** threaded to every pane.
- `wson-summary.ts` parses `.wson` (`?raw` glob of `samples/`), summarises for the
  header/sidebar. No editing, no `setSrc`, no undo, no `/api/schematic` — DTX is
  computed **client-side** (`src/lib/wells/dtx.ts`), no round-trip.
- The 3D scene publishes `remap(md)` up via `onDepthMap`; `WellDepthRuler`
  consumes the *same* fn so depth stays in lockstep.

**The gap in one sentence:** cadtrain has the shell + the (superior, client-side)
3D engine, but **no editing, no annotations/labella, no 2D SVG view, and only a
scaffold toolbar** — it is a *viewer*, SVTC is an *editor*.

---

## 2. Component-by-component reference

| SVTC file | Purpose | Key API / signature | cadtrain equivalent | Gap + port notes |
|---|---|---|---|---|
| `WsonApp.svelte` (1717) | Per-tab editor orchestrator; owns `wson` state, `setSrc`, derivations, all popovers, undo/redo, dirData fetch, per-tab cache | `setSrc(mut)`, `getSrc()`, `geo/annotations/headerFields = $derived.by`, `fetchDirData()` | `+page.svelte` (shell) + `WellViewPlaceholder.svelte` (per-tab view) | cadtrain splits shell vs view; **no `setSrc` / mutation layer** — needs one for W-B. `getSrc` dlis/legacy normalisation NOT needed (cadtrain WSON is the clean `oh/ch/…` shape). |
| `WsonToolbar.svelte` (272) | Left icon rail: Save, Export, Validate, Notes, Template, Undo/Redo, Edit, Record, Completions, +Perf, Survey, Locate. Single `state` prop bag; hover `.tb-tip` tooltips | `let { state } = $props()` — `s.saveWson`, `s.toggleCompletionsEditor`, `s.showValidation`, … | `WellToolbar.svelte` (route) | cadtrain rail is a **placement-tool scaffold** (select/casing/liner/tubing/packer/nipple/plug/perf/survey/measure) — sets `active` only, no actions. W-E: wire real actions (open/save, add row, toggle 2D/3D, export, fit). |
| `Wson2DRenderer.svelte` (268) | Pure SVG schematic from a computed `geo`. Header, strata, ruler, OH/cem/csg rects OR warped `dirPath`, completions by `compTypeOf`, perf arrows, labella leaders | props `{geo, layers, svgNs, headerFields, compSvgStrings, annotations, autoScale, onOpenComp, onOpenPerf}` | **none** (W-D deferred) | Port whole-cloth for the 2D track view. Reuses the `geo` closures (`sy/syD/sxL/sxR/dirPath/dirSide`). Namespace `<defs>` ids per instance (`svgNs`) — cadtrain already learned this (`svg_gradient_id_collision`). |
| `wsonRender.js` (543) | ALL pure 2D helpers + the two big derivations (`computeGeo`, `computeAnnotations`) + `WellDirection` 2D + DTX lerp | see §3 catalog | partial: `dtx.ts` (DTX), `threeD/direction.ts` (3D `WellDirection`) | The 2D `computeGeo`/`computeAnnotations` + `txPoint`/`buildDirPath`/`perfArrows`/`cementRects` are **unported** — the heart of W-D. `WellDirection` here is a *2D* slerp (`dirWarp([x,y])→[N,TVD]`), distinct from the 3D quaternion one. |
| `WsonDisplayMenu.svelte` (315) | On-canvas gear-pill control stack: Dia scale ±, Auto scale, X/Y scale (manual), Directional, Aspect, Plot track, Labels; a collapsible **Layers** chip group with per-layer ✎ edit buttons; 3D-only Cutaway/Azimuth/Cut-preview/Annotations/Flare/Perf-spurs/Auto-scale chips | `open`/`displayOpts`/`layers` bindable; `onEditLayer(key)`; `show3DCutaway` gates the 3D chips | `WellViewControls.svelte` (W-A) | cadtrain reworked this into a **horizontal top bar** (dark chrome), not an on-canvas pill. Has layers + cutaway + directional + DTX + ruler + white-bg + cut-az/dia/depth dials. **Missing:** auto-scale/aspect/plot-track, the ✎-per-layer edit hook, 3D annotation/flare/perf-spur toggles, camera presets. |
| `Wson3DView.svelte` (119) | Thin `<Canvas>` wrapper; owns top-right controls (Dia/Cutaway/axis) + bottom overlays (well-name badge, camera readout) | mounts `Wson3DScene`; `onCameraMove` readout | `WellViewPlaceholder.svelte` | cadtrain equivalent mounts `WellSchematic3D` + `WellViewControls` + `WellDepthRuler`. Add a camera-position/well-name badge overlay (cheap). |
| `Wson3DScene.svelte` (1036) | Threlte scene: OH/cem/csg/tubing shells warped + CSG half-section cut, perf spheres, completion cylinders/**parametric**, dgeo geological curtain, debug cutters, 3D annotations, perf-spurs | props `{wson, diaScale, cutaway, cutAxis, cutAzimuth, directional, layers, annotations, autoScaleMarkers, flareLabels, parentDgeo, …}`; `{#key geomKey}` remount | `WellSchematic3D.svelte` (`src/lib/wells`) | **Ported faithfully** (see §diff below). cadtrain dropped dgeo-curtain, debug cutters, 3D annotations, perf-spurs, marker auto-scale; ADDED client-side DTX `remap` into the scale pipeline + `onDepthMap`. |
| `WsonAnnotations3D.svelte` (133) | Renders user-authored `wson._annotations[]` as billboard `<HTML>` + `<T.Line>` leader anchored to MD on the warped bore | `{wson, wellDir, td, diaScale, visible}` | **none** | W-C 3D path (optional). cadtrain does side-rail HTML/SVG labels instead (see `WellDepthRuler`). |
| `WsonAutoAnnotations3D.svelte` (154) | 3D parity of the 2D labella labels — reuses F.2 `annotations.rightNodes/leftNodes`, projects labella's screen-y back to a TVD delta (`labellaTvdDelta`) so labels don't stack; golden-angle **flare** option | `{wson, wellDir, annotations, layers, flareLabels}`; `flareAngle(i,bank)`, `resolveAnchor(md)` | **none** | Only relevant if cadtrain adopts labella + a 3D label layer. cadtrain's `WellDepthRuler` already solves the de-overlap in 2D-overlay space (simpler). |
| `WsonPerforations3D.svelte` (158) | Perf as radial spurs w/ phase + symbolic density (visual richness beside the centroid spheres) | `{wson, wellDir, diaScale, markerScale}` | **none** | Nice-to-have; not core. |
| `CompletionsEditor.svelte` (219) | Spreadsheet worksheet: drag-resizable columns, always-editable cells, autoTop 🔗/✎ chip, inline catalog popover, ▲▼🗑 actions, thumbnail hover | `{comps, compCols, thumbCache, rowSearch, api}` — `api.onCellInput/onCellFocus/onCellBlur/updateComp/moveComp/…` | **none** (W-B) | THE core editor to port. See §6. cadtrain has no catalog service → drop the inline catalog OR back it with the `tool_comp` registry (`src/lib/wells/registry.ts`). |
| `SurveyEditor.svelte` (119) | MD/Inc/Az station table (row-click→inline edit, Enter/Esc), + "Ask AI to generate" bar (`surveyGen` task, offline heuristic) | `{rows, editIdx, editData, onStartEdit/onSaveRow/onCancelEdit/onDeleteRow/onAddRow, aiPrompt, onAiRun}` | **none** (W-B) | Port the table (drop the AI bar or wire cadtrain's local LLM later — data-residency memory). WSON survey shape matches (`{md,dev,az}`). |
| `SchematicEditor.svelte` (182) | OH/CH/Cement/Strata worksheets (the ✎-per-layer editors from the Layers menu) | tabbed by `schematicTab`; `ohCols/chCols/cemCols/strataCols` | **none** (W-B) | Port for editing tubulars/holes/cement. Same worksheet mechanics as CompletionsEditor. |
| `LocationEditor.svelte` (162) | Surface-coord editor (x/y/crs/lon/lat) for the fmap integration (#29) | `wson.meta.location` | type exists (`WellLocation` in `wson.ts`) | Low priority; only if cadtrain adds a map/plan view. |
| `CanvasCompPopup.svelte` (93) | dbl-click a completion in the 2D SVG → quick-edit (desc/OD/length/top + autoTop) | `{comp, onLengthInput, onTopInput, onToggleAutoTop, onSave, onDelete, onClose}` | **none** | Pairs with W-D (2D view) OR adapt to a 3D-select inspector (W-B "inspector on select"). |
| `CanvasPerfPopup.svelte` (68) | dbl-click a perf arrow → quick-edit (top/bot/holeSize/perfID/color) | `{perf, onSave, onDelete, onClose}` | **none** | Same. |
| `threeD/{profile,direction,index,manifoldCut,profileGen}` | 3D math: min-curvature `WellProfile`, quaternion-slerp `WellDirection`, `buildWellDirection`/`sampleCentreline`, `warpGeometry`+`cut*` CSG, survey generator | see engine CLAUDE.md | `src/lib/wells/threeD/**` | **Ported** (crown jewel `manifoldCut` adapted to cadtrain's shared Manifold singleton). `dgeo-curtain`/debug-cutter builders NOT ported. |
| `wsonCatalog.js` (218) | Catalog search + `tool_comp`→SVG thumbnail/component builders (`queryCatalog`, `catalogItemToComp`, `fetchCompJson`, `jsonToSvgContent`, `buildThumbSvg`) | fetches `/api/schematic filtercomps` | `src/lib/wells/registry.ts` + `threeD/parametric/` | Different model: SVTC fetches JSON tool defs from a server catalog; cadtrain resolves `tool_comp` to a **`g_*` part / parametric builder**. Keep cadtrain's; borrow the thumbnail idea for the editor. |

---

## 3. 2D renderer helper catalog (`wsonRender.js` — verbatim signatures)

Constants: `HEADER_H = 100`, `RULER_W = 44`, `PERF_DIST = 3`.

```js
// Colour: luminance-picked ink for a fill hex
textColor(hex) -> '#111' | '#eee'

// Which open-hole section owns a depth
ohForDepth(d, oh) -> section | null

// ── the coordinate transform (the heart) ─────────────────────────────
// Unified [svgX, svgY] for an (xInches radial, yMD depth) point.
// Straight well: [cX + xInches*dS, HEADER_H + (autoS?dtxLerp(yMD):yMD)*yS]
// Directional : warp centreline via WellDirection.dirWarp, offset ±perp.
txPoint(xInches, yMD, wellDir, dtx, yS, dS, cX, autoS) -> [x, y]
//   yS = yScale (depth px/m), dS = diaScale (radial px/in), cX = centerX,
//   autoS = displayOpts.autoScale (apply DTX lerp), dtx = {depth[],depthTx[]}

// Filled SVG polygon for a warped section (both sidewalls, `steps` samples)
buildDirPath(top, bot, rL, rR, wellDir, dtx, yS, dS, cX, autoS, steps=30) -> "M…L…Z"
// One annular side (inner→outer ring, sign = ±1 for left/right)
buildDirSide(top, bot, rIn, rOut, sign, wellDir, dtx, yS, dS, cX, autoS, steps=30) -> "M…L…Z"

// Shaped perforation arrows — one ‹ + › pair every PERF_DIST metres,
// tip = perfID/2, ext = tip+5 (arrow reach past casing)
perfArrows(perf, wellDir, dtx, yS, dS, cX, autoS) -> "M…Z M…Z …"

// Pair each cement row with its OH section → drawable annulus rects
cementRects(cem, oh) -> [{ top, bot, holeR, casingR }]

// Linear-interp a dgeo horizon depth at plan-x (fmap strata)
sampleHorizonAt(h, x) -> number | null

// Completion render-style heuristic from tool_comp+description
compTypeOf(comp) -> 'hanger'|'packer'|'icd'|'liner'|'tubing'

// ── the two big derivations ──────────────────────────────────────────
computeGeo({ wson, srcRaw, displayOpts, dirData, strataSource, parentStrata, tabName })
//  -> { oh, ch, cem, str, perf, completions, maxDepth, yScale, diaScale,
//       centerX, totalW, totalH, sy, syD, sxR, sxL, wellName, rulerTicks,
//       maxR, strataW, hasDir, dirPath, dirSide, dirAxis, hasProfileData,
//       wellDir, dtx, autoScale }
//  Coordinate closures: sy(d)=HEADER_H+d*yScale ; sxR(r)=cX+r*diaScale ;
//  sxL(r)=cX-r*diaScale ; syD(md)= txPoint(0,md,…).y  (DTX/arc aware)
//  autoYScale = clamp(400/maxDepth, 0.08, 0.35)  — the AUTO depth scale
//  niceInterval → rulerTicks (nice 1/2/5×10ⁿ, ≤12 ticks)

computeAnnotations({ geo, displayOpts, layers })
//  -> { compNodes, bhNodes, rightNodes, leftNodes, rightRailX, leftRailX, yScale }
//  (labella recipe — see §4)

computeHeaderFields({ wson, srcRaw, tabName })
//  -> { wellName, desc, company, state, country, location }
```

**SVG element shapes emitted by `Wson2DRenderer`** (straight-well branch):
- **OH:** `<rect>` (or warped `<path dirPath>`) fill `#f3e8ff` stroke `#9333ea` dashed.
- **Cement:** two `<rect>` (L/R annulus) fill `url(#{svgNs}-cement-fill)` (a 6×6
  dotted pattern in `<defs>`).
- **Casing:** `<rect>` fill `azure` stroke `#111` 1.5.
- **Completions** (by `compTypeOf`): packer = two triangles + bar; hanger =
  trapezoid `#94a3b8`; icd = `<rect>` `url(#{svgNs}-icd-fill)` + blue side rails;
  liner = green `<rect>`; tubing = two 3px side bars `#334155`. If `compSvgStrings[i]`
  present (catalog SVG) it's `{@html}`-injected instead.
- **Perf:** `<path perfArrows>` fill `p.color ?? '#e53e3e'`.
- **TD line:** red `<line>` + `TD {depth}m` label.
- **Labella leaders:** per bank, a dashed `<line ax,ay → rail,ly>` + anchor
  `<circle>` + `<text>` (right bank grey `#374151`, left bank blue `#1e40af`).
- **Header:** a 100px multi-cell info strip (Well Name/Description/Company/State/
  Country/Location); gated by `layers.showHeader` but the 100px is always reserved.

---

## 4. labella force-annotation recipe (`computeAnnotations`)

**Package:** `labella@1.1.4` (`import labella from 'labella'`).

One `labella.Node(ay, 5, data)` per feature (`ay` = warped anchor screen-y;
`data` = `signedRadius, md, y0, ax, ay, perpPos/Neg, text, bank`). **Seeding:**
borehole (OH/CH/cement) → negative signedRadius (left face); completions + perfs
→ positive (right). **Bank** by warped anchor X vs `centerX` (`dx>=0 ? right :
left`) — so a deviated well can land both on one side and leaders still never
cross the bore. **Force** runs once per bank (`{algorithm:'simple',
nodeSpacing:24, lineSpacing:4, minPos:HEADER_H+5,
maxPos:HEADER_H+maxDepth*yScale*1.2}`); resolved y = `node.currentPos`. **Rails**
at furthest anchor ± `RAIL_PAD=14`; a post-pass side-picks `perpPos`/`perpNeg` by
dotting toward the resolved label; renderer draws one dashed leader
`anchor→(rail, currentPos)`. **3D reuse:** `labellaTvdDelta =
(currentPos-y0)/yScale` projects the 2D spread to a TVD delta so
`WsonAutoAnnotations3D` spaces labels without re-solving.

**cadtrain port choice.** cadtrain does **NOT** use labella — `WellDepthRuler`
does a simpler top-down nudge (`LABEL_GAP=15`, one left side-rail). For W-C keep
the side-rail (cheapest) OR adopt labella for two-sided banked leaders only if the
2D SVG view lands (W-D); `computeAnnotations` is pure → ports almost verbatim.

---

## 5. Popover / floating-panel pattern

Reuse cadtrain's `src/lib/shared/FloatingPanel` (SVTC's equivalent: titled
draggable `{visible, onClose, width, x, y}` + `{#snippet children()}`; memories
`floating_panel_z_index`, `feedback_popup_over_inline`). Sub-popovers that must
escape the panel's `overflow-y-auto` render **`position:fixed`** at document level
from a captured anchor rect, with `onmousedown` stop-propagation so a click
doesn't blur the cell (mirrors `tooltip_native_title_for_clipping`).

Edits reach the model two ways, both committing via `setSrc` (2D+3D update the
same frame): (1) **canvas quick-popups** (`CanvasCompPopup`/`CanvasPerfPopup`,
`ondblclick`) take a reactive proxy copy, length/top use local `draft` state so
`.toFixed()` re-render doesn't kick the caret; (2) **worksheet cells**
(`CompletionsEditor`, `oninput → api.onCellInput → updateComp`), cursor-stable via
a per-cell `cellDraft` map. **cadtrain W-B first cut:** the popup style (dbl-click
a 3D completion → inspector), since it's 3D-first with no SVG yet.

---

## 6. Editors

### CompletionsEditor (the worksheet)
- **Row shape** rendered: `#`, thumb (28×28 `tool_comp` SVG, hover→144px preview),
  Description (opens inline catalog popover), OD (in), Len (m, drives bot),
  Top (m, with 🔗/✎ auto/manual chip), Bot (read-only derived), actions (+ ▲ ▼ 🗑).
- **Column widths** in one `compCols` state (`{mov,idx,thumb,desc,od,len,top,bot}`);
  each header cell has a right-edge drag handle → `api.startColResize(compCols,key,e)`.
- **autoTop cascade:** `recomputeAutoTops(comps)` — auto rows pin `top = prev.bot`;
  manual rows keep an absolute MD (profile nipples / SSSVs / ESPs). Toggle per row.
- **Add/remove:** `api.addCompRow` (footer), `api.insertCompRow(i)`, `api.moveComp(i,±1)`,
  `api.deleteComp(i)` — all through `setSrc`.
- **Live re-render:** every cell mutation flows `setSrc → wson → geo/scene`.

### SurveyEditor
- **Row shape:** `{md, dev|inc, az}`. Table with row-click→inline edit
  (`editIdx`+`editData` lifted to parent so Esc/✕ clears externally), Enter saves.
- **Add/remove:** `onAddRow` (default new station), `onDeleteRow(i)`.
- **AI bar** (above the table): `aiPrompt` → `surveyGen` task → `buildSurveyProfile`
  → stations written via `setSrc`. Offline heuristic parser keeps it working
  API-key-free. **cadtrain:** drop for now (data-residency memory) or wire the
  local WebGPU SLM later.
- **Live re-warp:** editing a station changes `wson.profile` → `fetchDirData` (250ms
  debounce) → new `dirData` → both views re-warp.

**cadtrain port for both:** replicate the worksheet mechanics; feed the shared
`view`/`wson`. cadtrain must ADD a mutation layer (`setSrc`-equivalent) + a
`WellDirection`/DTX recompute — but cadtrain's DTX is client-side (`dtx.ts`) so
no `/api/schematic` round-trip: re-run `autoNodes`+`buildWellDirection` in-place.

---

## 7. Display-param model

### SVTC `displayOpts` (`WsonApp`, per-tab, cached + round-tripped to `wson.meta.display`)
```js
{ autoScale:true, directional:true, xScale:0.17, yScale:0.17, xDiaScale:6.0,
  preserveAspectRatio:true, showLeftTrack:true, cutAzimuth:0,
  showLabels:true, flareLabels:false }
```
plus a `layers` object `{showHeader,showStrata,showOpenHole,showCasing,showCement,
showCompletions,showPerforations}`.
- **Depth scale:** `autoScale` ⇒ `yScale = clamp(400/maxDepth,0.08,0.35)`; else the
  manual `yScale` dial. `autoScale` also switches DTX on (`prAuto` + `dtx` lerp).
- **Radial scale:** `xDiaScale` (px per inch), edited by ± pills (2–15, step 0.5).
- Threaded to **2D** via `computeGeo(displayOpts)`; to **3D** via `Wson3DView`/
  `Wson3DScene` props (`diaScale=xDiaScale`, `cutAzimuth`, `directional`).

### cadtrain `WellViewSettings` (`view-settings.ts`, ONE shared object)
```ts
{ layers:{showOpenHole,showCasing,showCement,showTubing,showCompletions,showPerforations},
  cutaway, cutAzimuth, directional, dtx, diaScale, zScale, whiteBg, showRuler }
```
- **Threading:** created in `+page.svelte`, passed to `WellViewControls` (mutates it),
  `WellSchematic3D` (reads props), `WellDepthRuler` (reads `remap`). Svelte-5 deep
  reactivity ⇒ one source of truth, no drift.
- **Scale pipeline** (cadtrain, DECIDED — see engine CLAUDE.md + `svtc-autoscale-dtx.md`):
  `raw MD → DTX (dtx.ts, straight) → warp along survey → × zScale`. Applied via a
  single `remap(md) = lerpDTX(dtxObj, md) * zScale`, published via `onDepthMap` so
  shells + ruler share display space. `diaScale` = radial exaggeration (NOT baked;
  true depths/diameters preserved).

**Mapping / delta:**
| SVTC | cadtrain | note |
|---|---|---|
| `xDiaScale` | `diaScale` | same idea (radial px-per-inch / scene-units-per-inch) |
| `yScale` (+ autoScale) | `zScale` (+ `dtx`) | cadtrain splits: `zScale`=linear depth stretch, `dtx`=clutter emphasis. SVTC's `autoScale` fused both. |
| `autoScale` | (n/a — always DTX+fit) | cadtrain has no `autoScale` toggle yet; DTX is the emphasis dial. |
| `directional` | `directional` | identical |
| `cutAzimuth` | `cutAzimuth` | identical |
| `preserveAspectRatio` / `showLeftTrack` | — | 2D-only (W-D). Missing. |
| `showLabels`/`flareLabels` | — | annotation toggles; missing (W-C). |
| — | `whiteBg`, `showRuler` | cadtrain additions. |
| DTX via `/api/schematic` | DTX via `dtx.ts` (client) | cadtrain removed the server round-trip (data-residency + latency). |

---

## 8. WSON schema

### SVTC canonical shape (`apps/wson/CLAUDE.md`)
```jsonc
{
  "meta": { "wellName","td","rkbToGl","description","_shape","_band",
             "location?": {"x","y","crs?","lon?","lat?"} },
  "oh":   [{ "bitSize","top","bot" }],
  "ch":   [{ "od","id","top","bot","grade","weight","type" }],
  "cementing":  [{ "od","top","bot" }],
  "completions":[{ "description","tool_comp","od","top","bot",
                   "length?","noJoints?","avgJointLength?","autoTop?" }],
  "perforations":[{ "top","bot","label" }],   // also perfID, color, holeSize
  "strata":     [{ "name"|"strata","top","color" }],
  "profile":    [{ "md","dev","az" }]         // survey stations
}
```
Rules SVTC bakes in: **tubing is a completion** (`tool_comp:"MISC.TUBING"`,
`description:"Tubing Joints"`), never `ch[]` with `type:"tubing"`. OD sizing:
hanger/packer OD = sealing casing **ID**; tubing joints/pups/mule OD = tubing OD;
liner-hanger OD = intermediate-casing ID. SVG `<defs>` ids namespaced per tab.
Also handles two legacy input shapes via `getSrc()`: dlis `config.{openHole,casedHole}`
and `wellData[0]`, and completions as either absolute `top/bot` OR cumulative `length`.

### cadtrain WSON (`src/lib/wells/wson.ts` — typed, clean)
| Field | cadtrain type | vs SVTC |
|---|---|---|
| `meta` | `{wellName, rkbToGl?, td?, pbtd?, location?, _wellType?}` | adds `pbtd`,`_wellType`; SVTC has `_shape/_band/description`. `wson-summary.ts` also reads `meta.description`. |
| `oh[]` | `{bitSize, top, bot}` | identical |
| `ch[]` | `{od, id?, top, bot, grade?, weight?, type?}` (`type`∈conductor/surface/intermediate/production/liner/tubing) | identical + typed enum |
| `perforations[]` | `{top, bot, label?, perfID?, color?}` | identical (SVTC also uses `holeSize`) |
| `completions[]` | `{description?, tool_comp, od?, top?, bot?, length?, params?}` | `tool_comp` **required + typed** `CATEGORY.NAME`; adds `params` for the bake; drops `noJoints/avgJointLength/autoTop` (no worksheet yet) |
| `cementing[]` | `{od, top, bot}` | identical |
| `profile[]` | `{md, dev, az}` | identical |
| — (no `strata`) | | SVTC has `strata[]` (formation tops track) — cadtrain omits (no 2D track yet). |

cadtrain adds `isDeviated`, `completionExtents`, `lintWson` (ported SVTC `validate.js`
rules: casing OD 1–36", nesting, monotonic MD, dev 0–180, az 0–360), `parseWson`.
`tool_comp` is the seam: cadtrain resolves it to a `g_*` part / parametric builder
(`registry.ts` + `threeD/parametric/`), where SVTC fetched a server catalog JSON.
**No `getSrc` normalisation needed** — cadtrain samples are already the clean shape.

---

## 9. Prioritized port checklist (mapped to W-A … W-E)

Legend: ✅ done · 🟡 partial · ⬜ missing.

### W-A — View + layer controls (HIGH, cheap) — 🟡 mostly done
- ✅ Layer toggles, cutaway, directional, DTX, ruler, white-bg, cut-az/dia/depth dials
  (`WellViewControls`).
- ⬜ **Auto-scale toggle** (SVTC `autoScale` fit) + **Aspect** + **Plot-track** chips.
- ⬜ **Camera presets** (elevation / plan / 3D) — needs reworking the scene's
  OrbitControls-owned camera (noted as out-of-scope in `WellViewControls`).
- ⬜ **Per-layer ✎ edit** hook (SVTC `onEditLayer`) — bridges W-A into W-B.
- ⬜ 3D annotation / flare / perf-spur toggles (defer with W-C).
> Source: `WsonDisplayMenu.svelte`. Port the missing chips; camera presets are the
> only non-trivial item.

### W-B — Editor / inspector dock (HIGH) — ⬜ missing, biggest gap
1. **Add a mutation layer** — cadtrain has none. Introduce a `setSrc`-equivalent
   (or, simpler in Svelte 5: mutate a `$state` `wson` deeply + let the shell hold it
   per tab) + `pushUndo`/undo/redo (`createHistory`). *Prereq for everything below.*
2. **CompletionsEditor** (worksheet) — port from SVTC; back the Description search
   with `registry.ts` (not a server catalog); reuse `FloatingPanel`.
3. **SchematicEditor** (OH/CH/Cement worksheets) — same mechanics.
4. **SurveyEditor** — port the table (drop the AI bar); on save re-run
   `autoNodes`+`buildWellDirection` (client DTX) → live re-warp.
5. **Inspector-on-select** — click a 3D completion → highlight + show its row +
   the parametric builder's `ParamSpec` dials (`threeD/parametric`). This is the
   3D-first analogue of SVTC's `CanvasCompPopup`.
> Source: `CompletionsEditor.svelte`, `SchematicEditor.svelte`, `SurveyEditor.svelte`,
> `CanvasCompPopup.svelte`, `WsonApp` `setSrc`/undo.

### W-C — Annotations + depth ruler (MED) — 🟡 ruler done
- ✅ Depth axis/ruler with true-MD ticks over DTX-remapped display depth + a
  left side-rail leader-label column (`WellDepthRuler`, shared `remap`).
- ⬜ Two-sided banked leaders / labella (only if the 2D view lands, W-D) — port
  `computeAnnotations` (pure).
- ⬜ 3D billboard labels (`WsonAnnotations3D`/`WsonAutoAnnotations3D`) — optional.
> cadtrain's side-rail is a defensible simplification; labella is only worth it for W-D.

### W-D — 2D derived track view (MED, later) — ⬜ missing
- Port `wsonRender.js` pure helpers (`txPoint`, `buildDirPath`, `buildDirSide`,
  `perfArrows`, `cementRects`, `compTypeOf`, `computeGeo`, `computeAnnotations`) +
  `Wson2DRenderer.svelte`. Namespace `<defs>` per instance (`svgNs`).
- cadtrain is 3D-first ⇒ this is a **secondary readout** panel, not the authoring
  surface. Feed it the same `wson`; compute a `geo` from cadtrain's WSON (rename
  `xDiaScale→diaScale`, `yScale→zScale`, DTX from `dtx.ts` not `dirData`).
- Render on the `whiteBg` surface (already flagged in `WellViewPlaceholder`).
> Source: `wsonRender.js`, `Wson2DRenderer.svelte`, `CanvasCompPopup/PerfPopup`.

### W-E — Toolbar actions (LOW) — ⬜ scaffold only
- `WellToolbar` currently only sets `active` placement tool. Wire real actions:
  open/save `.wson` (File System Access API is already in the shell), add
  completion/casing/perf (opens the W-B editors), toggle 2D/3D (once W-D lands),
  export (PNG/GLB), fit-view.
- The tool ids already line up with `WellCompCategory` so a future *placement* mode
  (drop a `g_*` part on the survey by depth + bake) can dispatch straight off them.
> Source: `WsonToolbar.svelte` (the `state` prop-bag pattern + `.tb-tip` tooltips —
> cadtrain already mirrors the tooltip style).

### Cross-cutting engine deltas (already handled — for reference)
- ✅ 3D engine ported (`threeD/**` + `WellSchematic3D`), adapted to cadtrain's
  **shared Manifold singleton** + **client-side DTX** + `onDepthMap`.
- ⬜ (dropped from SVTC, revive only if needed) dgeo geological curtain,
  debug cut-plane overlays, 3D perf-spurs, marker auto-scale (`markerScale`),
  `preserveAspectRatio`.

---

### Priority order (recommended)
1. **W-B step 1** (mutation layer + undo) — unblocks all editing.
2. **W-B CompletionsEditor + SurveyEditor** — SVTC-parity core, highest value.
3. **W-A** missing chips (auto-scale/aspect) + **W-E** open/save/add — cheap wins.
4. **W-B inspector-on-select** — leverages the parametric registry (cadtrain's edge).
5. **W-D 2D track** — the big pure-helper port; do last, it's a secondary view.

---

## Appendix — key file paths

SVTC (read-only source): `~/code/SVTC/src/lib/apps/wson/`
- `WsonApp.svelte` · `WsonToolbar.svelte` · `Wson2DRenderer.svelte` · `wsonRender.js`
  · `WsonDisplayMenu.svelte` · `Wson3DView.svelte` · `Wson3DScene.svelte`
  · `WsonAnnotations3D.svelte` · `WsonAutoAnnotations3D.svelte` · `WsonPerforations3D.svelte`
  · `CompletionsEditor.svelte` · `SurveyEditor.svelte` · `SchematicEditor.svelte`
  · `LocationEditor.svelte` · `CanvasCompPopup.svelte` · `CanvasPerfPopup.svelte`
  · `wsonCatalog.js` · `threeD/{profile,direction,index,manifoldCut,profileGen}` · `CLAUDE.md`

cadtrain (the port):
- Shell/route: `src/routes/wells/{+page,WellToolbar,WellViewControls,WellDepthRuler,
  WellViewPlaceholder,wson-summary,view-settings,workspace-cache}.{svelte,ts}`
- Engine: `src/lib/wells/{wson,dtx,assemble,registry,samples,WellSchematic3D,WellScene}.{ts,svelte}`
  + `src/lib/wells/threeD/**` + `src/lib/wells/CLAUDE.md`
- Plans: `docs/plans/wells-interface.md` (UI, W-A…W-E) · `docs/plans/well-schematic.md` (engine)
- Research: `docs/research/svtc-autoscale-dtx.md` · `docs/research/wbd-powerdraw-visio.md`
