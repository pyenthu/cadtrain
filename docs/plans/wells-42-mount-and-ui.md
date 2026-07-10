# /wells — mount + UI plan (#42h · #42 · #42b B/C/D)

Diff-level plan to WIRE the built-but-dormant /wells stack: mount the graph-pipeline
bake in the 3D tab (#42h), wire the editor/inspector dock + tool rail (#42), and
land the mutation+undo + editors + render/chrome polish (#42b B/C/D).

Everything below is derived from a headless de-risk pass (`src/lib/wells/wells-bake-coverage.test.ts`,
17 green): every `samples/*.wson` translates+emits a clean `bw_*` assembly, and
dep-resolved well graphs bake to SEPARATE positive-volume `parts[]` (not the fused
open-hole shell). So the mount is **wiring, not geometry invention.**

Two source maps this plan leans on:
- **SVTC** (`~/code/SVTC/src/lib/apps/wson/`) — the interface we port FROM. Key
  shape: a 2-region shell (30px left icon rail + flex-1 center 2D/3D), editors are
  **floating/worksheet panels opened on demand**, WSON is the single source of
  truth, undo = whole-doc JSON-snapshot stack, selection is transient (double-click
  → popover). There is NO fixed right dock and NO named camera presets in SVTC.
- **cadtrain Track-B island** (`src/lib/wells/well-edit-*`, `WellInspectorDock`,
  `CasingStringsEditor`, `SurveyEditor`, `WellToolRail`) — built + partly tested,
  imported by NOTHING outside its own tests. This is what we mount.

---

## 0. The settled architecture decision (mutation + undo)

**WSON is the source of truth. Mutation+undo routes through a per-tab
`WellEditStore` (wrapping the pure `WellEditCore`). Do NOT route WSON edits through
`GraphEditorController`.**

Why, decisively — the two undo engines have **directly opposed identity contracts**:

| | `GraphHistory` (graph editor) | `WellEditCore` (wells) |
|---|---|---|
| snapshot type | whole `Graph` | whole `Wson` |
| restore | **reference SWAP** (`setGraph(newRef)`) | **in-place** (`#restoreInto`, identity preserved) |
| relies on | identity CHANGING (GEP re-derives on ref change) | identity STAYING STABLE |

The wells engine's entire reason to exist is to **never change `doc` identity**, so
the 2D/3D surfaces don't remount and thrash the Manifold bake (memory
`fresh_array_props_effect_loops`; the `structuredClone`-crash lesson). Routing wells
edits through `GraphEditorController` would force a reference swap on undo →
reintroduce the re-bake loop. There is also **no graph→WSON back-translation**
(`wson-to-graph` is one-way) and WSON carries domain semantics (survey stations,
`tool_comp` catalogue keys) the generic graph loses.

The GRAPH tab's `GraphEditorController` undo stays scoped to **direct graph-pane
edits** — a different model on a different surface (the #65 "graph editor as
platform" bet). That is not "a second mutation stack for the same model"; it is the
correct stack for a different model. Graph-as-source is deferred until a lossless
graph↔WSON bridge exists.

This matches SVTC exactly (WSON `$state` is truth; snapshot undo). The one thing to
borrow from SVTC that Track-B lacks: **session-batched undo** (one history entry per
focus session, not per keystroke) — see §5.

---

## #42h — Mount the pipeline bake in the 3D tab

### Runtime data flow (browser only)
`wson` → `wellBakeSpec` (pure, emits the `bw_*` assembly source) → `POST
/api/primitives/compile` (server resolves each `bw_*` dep from the proxied prod
volume → a self-contained script) → `bakeClient.run` (client Web Worker, Manifold)
→ `result.parts[]` (separate, per-element, appearance-bearing). This is exactly
`bakeWell()` in `src/lib/wells/well-graph-bake.ts` — already built + headless-proven.
Compile needs the server (proxied `bw_*` sources), which is why it can't be headless;
in-browser it just works.

### New component — `src/lib/wells/WellBakeScene.svelte` (Threlte scene CONTENT)
Mounts INSIDE the route's `<Canvas>` (like the old `WellSchematic3D`). Contract:

```
props: {
  wson: Wson;                    // stable ref from the store (§5) — do NOT reassign
  engine: 'manifold' | 'tf';     // from view.engine (new field, §selector)
  layers: WellLayerFlags;
  cutaway: boolean;
  onError: (msg: string) => void;      // NO FALLBACK — surface, never stand-in
  onSelectPart?: (id: string | null) => void;   // 3D pick → inspector (#42b)
  cameraPreset?: 'iso'|'front'|'top' | null;     // #42b-D
  onFit?: () => void;
}
```

Behaviour:
1. **Content-keyed bake** (not identity): a `$derived` content key `= JSON key of
   {wson-relevant fields, engine, cutaway}`; an `$effect` gated on the key change
   runs the bake. `manifold` → `bakeWell(wson, {cutaway})`; `tf` → the TF bake seam
   (see TF note). Store `parts`/`cutParts` in `$state`. Never rebuild on a
   camera/hover change.
2. **Render parts** — reuse the per-part material pattern from
   `src/lib/shared/PrimitiveDualScene.svelte` (the `geo.parts` arm, lines ~120-190):
   one `<T.Mesh>` per `WellPart`, geometry `part.geo`, `MeshPhongMaterial` built from
   `part.appearance` (color + opacity), `flatShading` per the cad/CLAUDE.md rule.
   Under `cutaway` render `cutParts` instead of `parts`.
3. **Layer toggles filter the array** — a PURE helper `layerForPartId(id)` maps the
   emit's stable var-name prefixes (confirmed in `wson-to-graph.ts`: `OH_*`→openHole,
   `CEM_*`→cement, `CSG_*`→casing, `COMP_*`→completions) to a `WellLayerFlags` key;
   `{#each parts.filter(p => layers[layerForPartId(p.id)])}`. (Headless-testable —
   see §build order.)
4. **NO FALLBACK** — the bake `$effect` wraps in try/catch; on throw call
   `onError(msg)` and render nothing. `bakeWell` already throws when the bake returns
   no separate parts ("refusing to render the composed body"). The placeholder shows
   the existing `.wv-error` banner.

### Edit `src/routes/wells/WellViewPlaceholder.svelte`
- **Replace** the 3D surface body (currently lines 152-164, `<WellSchematic3D .../>`)
  with `<WellBakeScene {wson} engine={view.engine} layers={view.layers}
  cutaway={view.cutaway} onError={(m)=>bake3dError=m} onSelectPart={...}
  cameraPreset={view.cameraPreset} onFit={...} />`. Keep the `<Canvas>` wrapper, the
  `mounted3D` sticky latch (lines 71-74), and `WellDepthRuler`.
- Add a `let bake3dError = $state<string|null>(null)` and render the `.wv-error`
  block inside the 3D surface when set (mirrors the graph-tab error at lines 182-189).
- Drop the `onDepthMap`/`onBuildTiming`/`remap`/`build3d` plumbing tied to the old
  scene — OR re-emit a **true-depth** `onDepthMap` from `WellBakeScene` (see the
  DTX note). Remove the `WellBuildTiming` import from `manifoldCut` (line 29) — the
  badge either drops or gets a new timing source.

### Add the `3D BAKE | TF` engine selector
- `src/routes/wells/view-settings.ts`: add `engine: 'manifold' | 'tf'` (default
  `'manifold'`) to `WellViewSettings` + `defaultViewSettings()`. Also add
  `cameraPreset: 'iso'|'front'|'top' | null` (default null) for #42b-D.
- `src/routes/wells/WellViewControls.svelte`: add a segmented `3D BAKE | TF` control
  next to the view-mode segment, rendered only when `settings.viewMode === '3d'`
  (mirror the existing `.wvc-seg` markup, lines 59-70). Mutates `settings.engine`.

### Delete the pure-THREE shell path (mandated) — and its dependents
`solidTubeForRange`/`shellForRange` + `manifoldCut.ts` are the shell. Note the
dependency fan-out — **`manifoldCut.ts` is reused by the WellBakePool 3D-FAST stack**,
so deleting it retires that stack too. Files to remove:
- `src/lib/wells/WellSchematic3D.svelte` (sole owner of `solidTubeForRange`/`shellForRange`).
- `src/lib/wells/threeD/manifoldCut.ts` + the `threeD/` engine it anchors
  (`profile.ts`/`direction.ts`/`index.ts`, `parametric/`) — the well warp now lives
  in the graph emit (`surveyToXYZ`+`resampleSpline`+`warpSpline`), NOT in `threeD/*`.
- `src/lib/wells/well-bake-pool.ts` · `threeD/wells-bake-worker.ts` ·
  `well-bake-client.ts` · `well-bake-protocol.ts` (the #42b-A WellBakePool — it
  reuses `manifoldCut` builders; superseded by the graph pipeline).
- Their tests: `schematic3d.test.ts`, `well-bake-pool.test.ts`, `well-bake-client.test.ts`.
- `WellScene.svelte` + `assemble.ts` (the simple assembler view) if unreferenced —
  verify then remove.

> **DECISION TO CONFIRM before deleting:** retiring the WellBakePool stack throws
> away shipped #42b-A work. It IS the right call under NO-FALLBACK (one engine path)
> — the graph pipeline is the chosen renderer — but flag it to the user; it is the
> single largest deletion here.

### Two deliberate simplifications to call out
- **True-size 3D.** The bake renders survey-warped TRUE geometry. `DTX` / `zScale` /
  `diaScale` were `WellSchematic3D`'s display remap; per the wells CLAUDE.md ("3D =
  spread spacing, TRUE-SIZE parts; stretching geometry is 2D-only") these become
  no-ops in the bake path. Hide/disable those dials when `viewMode==='3d'`, and the
  3D depth ruler's `remap` becomes identity (true depth).
- **Layer gaps.** The emit tags `OH_/CEM_/CSG_/COMP_`. Tubing (`bw_prod_tubing`)
  currently folds into `COMP_` (so `showTubing` == `showCompletions`), and
  perforations may not emit as separate parts. If distinct tubing/perf toggles are
  required, `wson-to-graph.ts` needs distinct prefixes — a small emit-side follow-up
  (that file is owned by another agent; do not edit it here).

### TF engine coverage (read-only status — `graph-to-tf.ts` owned by another agent)
Structurally, a well lowers to TF: each row is a Call to a `bw_*` COMPOSITE, and
`graph-to-tf.ts` recurses composites (case `'call'`, lines 692-732) down to
`r_revolve` (`tfRevolveProfile`); the deviated warp lowers via case `'warp'` (lines
817-840). `bw_*` are revolve-based, so `NO_TF_ENGINES` (extrude/loft) does not bite.
Gaps to verify when that agent lands: (a) composite recursion needs an injected
`resolve(src)` that fetches each `bw_*` graph — the SAME dep dependency as compile,
so not headless without the proxied volume; (b) the `'warp'` case needs the warp
node to expose a wired spline with ≥2 static control points — the survey-derived
spline must present as static points to `resolveSplineNode`. Wire the `tf` branch of
`WellBakeScene` to their TF bake fn; do not implement the lowering here.

---

## #42 — Wire the inspector dock + the left tool rail

### The W-E left tool rail — `WellToolRail.svelte` replaces the `WellToolbar` scaffold
- `src/routes/wells/+page.svelte` line 358: replace
  `<WellToolbar bind:active={activeTool} />` with `<WellToolRail ... />` (import from
  `$lib/wells/WellToolRail.svelte`). The current `WellToolbar` only sets a no-op
  `activeTool`; `WellToolRail` emits real intents.
- Wire the callbacks to the ACTIVE tab's store (§5) + `view`:
  - `onViewMode(mode)` → `view.viewMode = mode` (rail mirrors `view.viewMode`).
  - `onAddElement(type)` → a PURE dispatcher `addElementIntent(store, type)`:
    structural (`openhole|casing|cement|tubing`) → `store.addString`/`addElement`;
    completion categories → `store.addCompletion` with the registry `tool_comp` key;
    `'perforation'` → `store.addElement('perforations', …)`. (`well-tool-rail.ts`
    already carries the type↔part descriptors; the intent→store map is the new pure
    glue — headless-testable.)
  - `onTool(name)` → `activeTool` (select/measure).
  - `onCamera(preset)` → `view.cameraPreset` (drives `WellBakeScene`); `onFit()` →
    scene fit.
  - `onAction('save'|'export-png'|'export-glb'|'export-svg'|'new'|'open')` → existing
    file handlers (`WellSideNav`/workspace); export-* are new (#42b-D).
  - `disableAdd={activeId == null}`.

### The W-B inspector dock — `WellInspectorDock.svelte`
- Mount ONE dock at the `<main>` level of `+page.svelte` (a right column beside the
  panes, ~lines 471-495), bound to the ACTIVE tab. (SVTC floats its editors, but
  cadtrain built a persistent collapsible DOCK; keep it docked — the component is
  designed collapsible. FloatingPanel is reserved for the double-click quick editors.)
- Props:
  - `elements={inspectorElementsFromWson(activeStore.doc)}` (pure, from `well-inspector.ts`).
  - `selected={activeSel}` where `let activeSel = $state<WellInspectorElement|null>(null)`,
    reset on tab switch.
  - `onSelect={(el)=> activeSel = el}`.
  - `onEdit={(patch)=> activeStore.updateElement(kindToArrayKey(patch.kind), patch.index, patch)}`
    — `kindToArrayKey`: `openhole→oh, casing→ch, cement→cementing, completion→completions,
    perf→perforations` (new pure mapper — headless-testable).
  - `bind:collapsed`.
- **Selection cross-link:** `WellBakeScene.onSelectPart(id)` → map the emit part id
  (`CSG_2`…) back to a `WellInspectorElement` (`inspectorElementsFromWson` order is
  openhole→cement→casing→completions→perf; build an id→element index once) → set
  `activeSel`. The 2D surface's dblclick already drives `WellCompPopup`; add a
  single-click → `onSelect` on the same `<g>` elements.

---

## #42b B/C/D — editors, popovers, polish, chrome

### #42b-B — mutation+undo layer (the store swap)
Replace the ad-hoc in-session mutation (`+page.svelte` lines 221-262: `workingDocs`
+ direct `wson-mutate`) with per-tab `WellEditStore`:
- `let stores = $state<Record<string, WellEditStore>>({})`. In the seed `$effect`
  (currently lines 234-244) create `new WellEditStore(fileById(t.id).doc, {
  onSurveyChange: () => bumpSurvey(t.id) })` once per tab (the `=== undefined` one-shot
  guard stays — no loops).
- `docForTab(id)` → `stores[id]?.doc` (stable proxy passed to `WellViewPlaceholder`).
- `updateComponent/deleteComponent` → `activeStore.updateCompletion/removeCompletion`.
- Undo/redo: add `<svelte:window>` `Ctrl/Cmd+Z` → `activeStore.undo()`,
  `Ctrl/Cmd+Shift+Z` → `redo()`; feed `activeStore.canUndo/canRedo` to the tool rail's
  undo/redo buttons (add them to `WellToolRail` file group).
- **Port SVTC's session-batched undo** into `WellEditCore` (currently one entry per
  method call): a `beginEdit()`/`endEdit()` pair around a focus session so a burst of
  keystrokes collapses to one undo step (SVTC `beginEditSession`/`endEditSession`).
  Pure — extend `well-edit-core.ts` + its test.
- `onSurveyChange` → re-bake the 3D (survey change ⇒ new warp). Since the 3D bake is
  derived from `wson`, the content-keyed `$effect` re-fires anyway; the flag just lets
  the scene skip the re-bake for non-survey edits that only re-filter.

### #42b-B — the worksheet editors
Both are dumb shells; mount as `FloatingPanel`s (cadtrain `WellPopover`/FloatingPanel)
opened from the tool rail.
- **`CasingStringsEditor.svelte`** (edits `ch[]`; renamed from CompletionsEditor).
  Port FROM SVTC `SchematicEditor.svelte` (the CH tab) + `CompletionsEditor.svelte`
  (column-resize + always-editable cells + draft-per-cell for caret stability). Props
  → `strings={activeStore.doc.ch ?? []}`, `onAddString/onUpdateString/onRemoveString`
  → the store's `*String` methods, `selectedIndex/onSelect` → shared selection.
  Note: a real `completions[]` jewelry worksheet (SVTC's CompletionsEditor proper)
  does not exist yet — follow-up.
- **`SurveyEditor.svelte`** (edits `profile[]`, LIVE RE-WARP). Port FROM SVTC
  `SurveyEditor.svelte` (row-click inline edit + the AI-generate bar is optional).
  Props → `stations={activeStore.doc.profile ?? []}`, `*Station` → store,
  `onReWarp` → the 3D re-bake seam. **Pick ONE re-warp seam** — either the editor's
  `onReWarp` OR the store's `onSurveyChange`, not both (they are the same signal).

### #42b-B — inspector-on-select + edit-diagram popovers
- Keep the double-click quick editors (cadtrain `WellCompPopup.svelte`, SVTC
  `CanvasCompPopup`/`CanvasPerfPopup` pattern), but **route their edits through the
  store** now (`activeStore.updateCompletion`) instead of `wson-mutate`, so they are
  undoable.
- Single-click select → inspector (above). Add a perf popover if perforation editing
  is in scope (SVTC `CanvasPerfPopup`).

### #42b-C — render polish (mostly browser-visual)
3D center/fill, label banks, white bg, element-rail icons. `element-icons.ts` +
`well-tool-rail.ts` icon descriptors are data (their presence/coverage is
headless-checkable — `well-tool-rail.test.ts` already guards registry drift); the
actual visual polish (centering the model, label banking, white backdrop) needs a
live session.

### #42b-D — chrome (browser-visual)
- Toolbar file actions (save / export PNG·GLB·SVG / new / open) — `WellToolRail`
  emits `onAction`; wire to handlers (export-* are new).
- MD/TVD ruler — `WellDepthRuler` exists; in the bake path its remap is true-depth.
  MD for vertical, TVD for deviated (SVTC convention).
- Camera presets (iso/front/top) — cadtrain-additive (SVTC has none): `WellBakeScene`
  reads `cameraPreset` → Threlte camera position + `OrbitControls`; `onFit` frames.

---

## Build order — headless-buildable NOW vs needs a browser

**Headless-buildable next (pure logic + a vitest test — do these first):**
1. `layerForPartId(partId)` → `WellLayerFlags` key (from `OH_/CEM_/CSG_/COMP_`
   prefixes). Unblocks #42h layer toggles. + test.
2. `kindToArrayKey(inspectorKind)` (openhole→oh, casing→ch, cement→cementing,
   completion→completions, perf→perforations). Unblocks the inspector `onEdit` route. + test.
3. `addElementIntent(store, type)` — tool-rail intent → store method + `tool_comp`
   key, using `well-tool-rail.ts` descriptors. Unblocks the rail's Add. + test.
4. Part-id → `WellInspectorElement` back-map (3D pick → inspector). Pure; + test.
5. `WellEditCore` session-batched undo (`beginEdit`/`endEdit`). Extend the existing
   green `well-edit-core.test.ts`.
6. (When `graph-to-tf.ts` lands) a headless TF-lowering coverage test for a well
   graph given a stub `resolve`, mirroring `wells-bake-coverage.test.ts`.

**Needs a live browser session (visual / Svelte reactivity / worker bake):**
- `WellBakeScene.svelte` mount + `parts[]` render + per-part materials + cutaway +
  the async worker bake, and the critical **stable-identity / no-re-bake-loop**
  behaviour (the whole reason the store keeps `doc` identity — verify by editing +
  watching for a rebuild storm).
- The `3D BAKE | TF` selector, tool-rail wiring, inspector dock mount, worksheet
  editors, dblclick popovers.
- Render polish (#42b-C), camera presets + ruler + chrome (#42b-D).
- `.svelte.ts` store wiring in `+page.svelte` (runes can't execute in vitest).

**Verification order:** land 1-5 headless (green tests, mergeable), then one browser
session: mount `WellBakeScene` (verify parts render + no re-bake loop), then rail +
dock + store swap, then editors/popovers, then polish/chrome. Per the wells skill:
read the console FIRST on any blank-3D, and NO FALLBACK — an engine failure surfaces
the error, never a THREE stand-in.
