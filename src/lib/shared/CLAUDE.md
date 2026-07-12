# `src/lib/shared/` — cross-domain UI + infrastructure

Components and helpers shared by the routes (`/graph-editor`,
`/primitives`, `/vocab`, `/fem`, `/forge`) and by `src/lib/cad/*`.
Domain libs may import from here; this directory must not import from
domain libs.

> **⚠ 2026-07-12 — `shared/` was modularized (#16 `6b72b40`) into themed subdirs;
> the files listed below at the root now live in these:** `viewer/` (PrimitiveDual*,
> SceneControls, scene-state, warp, vertex-alpha-partition, instance-colors,
> part-appearance, material-{preset,textures}) · `svg/` (PrimitiveSvgView,
> CompJsonSilhouette, svg-{emit,reduce,camera,silhouette}) · `profiles/` (ProfileFn*,
> ProfilePalette, profile-{fn-compose,presets}) · `ui/` (NavMenu, ParamGrid,
> dragNumber, floating-tip) · `types/` (TypeDefiner{Panel,Popover}) · `volume/`
> (FolderTreeSidebar, CacheBrowser). The **ENGINE** files (`tf-*`, `trueform-*`,
> `brep-adapter`, `crease-normals`) MOVED to `src/lib/engines/` (E1); `anthropic-api`
> → `src/lib/server/`; `WellSideNav` → `src/lib/wells/`. The tree below predates this.

```
src/lib/shared/
├── graph-editor/               # THE CAD editor, decomposed (modularize K.65 / docs/plans/graph-editor-pane.md)
│   ├── GraphEditorPane.svelte  #   the editor shell — node-graph canvas + bake. Mounted by /graph-editor (full-screen) and /primitives (one per tab)
│   ├── RightPane.svelte        #   the 6-tab right column (3D bake / SRC / MD / SVG / GLB / BREP)
│   ├── Popovers.svelte         #   the anchored container/argExpr/profile/profileRef dropdowns (Phase A)
│   ├── PropertiesCard.svelte   #   the PROPERTIES tab body (z-offset/colour/material grid) (Phase D)
│   ├── ParamsCard.svelte       #   the PARAMS tab body — SVG param chips + wire-feeding output sockets (Phase D)
│   ├── sketch-state.svelte.ts  #   per-instance SketchState class — sketch editor state + 21 sketch* handlers + sketchEditor/miniLayout derived (Phase E Step 1)
│   ├── SketchNodeCard.svelte   #   the n.type==='sketch' node-card render arm (Phase E Step 2)
│   ├── SketchEditorPane.svelte #   the full-tab sketch editor overlay (Phase E Step 2); coord ƒ-popover stays in the GEP shell
│   ├── NodeCard.svelte         #   per-node SVG cards — call/method/mv/rot/txfmn/repeat/container/polygon/poly_repeat + resize grip (Phase F)
│   ├── WireLayer.svelte        #   renders wire beziers + a fat invisible hit-path per CONNECTION wire → onWireClick (click-to-delete)
│   ├── wire-state.svelte.ts     #   per-instance WireState class — drag-to-wire (from/mouse + start/endWireOn*) (Phase C)
│   ├── wire-delete.ts (+ .test) #   WireRef + unwireGraph + describeWireRef — click a connection → delete-popover unwires that slot
│   ├── pointer-capture.ts       #   releaseImplicitCapture (shared: wire-drag + sketch-card drags)
│   ├── popover-clamp.ts        #   shared viewport-clamp action for the popovers
│   ├── graph-editor-bake.ts (+ .test.ts) #   pure source/meta parsers + callDrift (Phase B)
│   ├── graph-editor-bake.svelte.ts       #   expected-params cache ($state singleton) + drift loaders (Phase B)
│   ├── geom.ts (+ .test.ts)    #   pure socket/wire/card position math
│   └── args.ts                 #   pure ArgValue/expr formatting + profile-kind lookups
├── PrimitiveDualCanvas.svelte  # mesh + GLB dual canvas (+ PrimitiveDualScene; smoothShade gate)
├── PrimitiveDualScene.svelte / ProfileFn3DCanvas.svelte
├── ComponentSceneGlb.svelte    # Threlte scene (flatShading rules — see cad/CLAUDE.md); used by /fem/[id]/tension
├── ProfileFnEditor.svelte / ProfilePalette.svelte
├── SceneControls.svelte        # camera/light/zScale + warp toggle (reads scene-state)
├── ParamGrid.svelte            # ParamSchema-driven param card grid (shared by /primitives + /vocab)
├── CompJsonSilhouette.svelte   # K.69 — SVTC compjson half-section as inline SVG (/vocab Inferred tab)
├── scene-state.svelte.ts       # shared scene state (zScale, zFocus, …)
├── profile-presets.ts (+ .test.ts) / floating-tip.ts
├── instance-colors.ts          # INSTANCE_PALETTE + DEFAULT_INNER/OUTER colours
├── dragNumber.ts / warp.ts / mime.ts / temp-file.ts
├── anthropic-api.ts            # SDK key check + client factory
└── claude-cli.ts               # `claude --print` args + spawn + envelope parse
```

> **Archived 2026-06-12** (→ `archive/src/lib/shared/`): the dormant
> `PrimitiveView` editor cluster (`PrimitiveView`, `CompositionEditor`,
> `ConstructionTree`, `CodeEditor`, `ProfileEditor`, `FloatingPanel`) plus
> standalone-dead helpers (`format-ts.ts`, `parse-build-source.ts`,
> `MarkdownView.svelte`, `PrimitiveCanvas.svelte`, `PrimitiveGlbCanvas.svelte`,
> `ComponentScene.svelte`, `KbTableViewer.svelte`) — no active importer once
> the graph editor took over. Revive with `git mv` back. See
> `archive/CADTRAIN_CLEANUP.md`.

## RULE: the `scene` module singleton — ONLY the active pane may write it

`scene` (`scene-state.svelte.ts`) is a **module-level `$state` singleton** shared
by EVERY mounted `PrimitiveDualScene`. **`/primitives` mounts ALL open tab panes at
once** (`{#each tabs}` — inactive ones stay mounted to preserve graph state), so N
panes share ONE `scene`. If more than one pane WRITES `scene.xScale/zScale/partCenter/
partZExtent/cam` (e.g. the `scaleAuto` / camera-fit effects), panes on
differently-sized parts write different targets → **synchronous ping-pong →
`effect_update_depth_exceeded` → frozen renderer** (bit hard 2026-07-02; also the
never-root-caused /plan task 920 multi-tab freeze).

**Rule:** every effect that WRITES the shared `scene` must be gated so **only the
ACTIVE tab's VISIBLE canvas** runs it. The mechanism: an `autoScaleOwner` prop
(`PrimitiveDualScene`/`PrimitiveDualCanvas`), set by `RightPane` to
`active && rightTab === '<thisTab>'` (`active` = the /primitives tab is the current
one; `rightTab` = which right-pane sub-tab is showing). Gate ALL singleton writes on
it (scaleAuto, partCenter/partZExtent, camera-fit, zFocus clamp, viewZScale apply) —
not just some, or the un-gated one still ping-pongs. Same lesson as per-instance
reactive state being a CLASS not a module singleton (`WireState`/`SketchState`): if
state is genuinely per-pane, don't put it in a module singleton; if it's shared UI
for the ACTIVE part (like `scene`), only the active pane may write it.

## Pattern: shared components rendered in multiple routes

`/primitives` and `/vocab` SHARE chrome where possible
(`PrimitiveDualCanvas`, `ParamGrid` in `.pg-acc-wrap`, the vertical
trapezoidal rail styling). When you restyle one, restyle the other.
Don't fork shared components into a route — keep one source of truth.

## Pattern: dual-backend dispatch (API vs CLI)

Claude-driven endpoints expose **two interchangeable backends** behind one
request/response shape, selected via env var:

- **API backend** — `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`. Per-token
  billed. Works in dev and Railway production.
- **CLI backend** — spawns `claude --print --output-format json`
  subprocess. Bills the user's Pro/Max OAuth subscription. Local-only
  (Railway has no `claude` binary). ~5–7× slower per call.

**Subscription billing only works through the CLI subprocess.** The Agent
SDK does NOT bill against Pro/Max OAuth despite docs/intuition.

Primitives here: `anthropic-api.ts`, `claude-cli.ts`, `temp-file.ts`.
Active consumer: `/api/primitives/refine`. The archived identify/wells
backends (`archive/src/lib/{identify,wells}/backend.ts`) used the same
pattern.

## Pattern: cold-classification baseline first, retrieval second

Before investing in CLIP / RAG / embedding pipelines, run the **cold
classification** test: catalog text + target image, no retrieval. If
accuracy is already 90%+ on the realistic input distribution, retrieval
scaffolding is not load-bearing. The cadtrain CAD primitives hit 17/18
(94.4%) cold — see `docs/FINDINGS.md`. Always re-run this baseline before
optimising retrieval (relevant again for RAG Phase 2,
`docs/plans/rag-prompt-builder.md`).
