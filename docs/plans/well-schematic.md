# Well schematic — SVTC diagram engine + cadtrain components → 3D well

Plan to build a well-schematic editor under cadtrain's `/wells` route by porting
SVTC's WSON diagram engine (its strengths: **trajectory/deviation** + **depth
auto-scale**), adding the **component layer** SVTC lacks (keyed to cadtrain's
`g_*` completion parts + the WBD smart-icon vocabulary), and bridging the 2D
schematic to a **3D well diagram** (Threlte/Manifold).

Source studied: `~/code/SVTC` (READ-ONLY). Companion research:
`docs/research/wbd-powerdraw-visio.md` (Visio WBD stencil's smart-shape /
feature-flag model + the 2D→3D idea).

---

## CORE PRINCIPLE — 3D-FIRST (the inversion)

SVTC and the Visio WBD are **2D-first**: the schematic is the source of truth,
3D is optional/absent. **cadtrain inverts this — the canonical model is the 3D
well**, and the 2D schematic is a *derived view* of it.

- **Source of truth = the 3D well**: a trajectory (vertical → deviated →
  horizontal) + cadtrain's parametric `g_*` parts **placed along it by depth**,
  baked with ManifoldCAD. This is what the user authors and what everything
  renders from.
- **The 2D schematic is a PROJECTION** — a second renderer of the same WSON
  model, not the authoring surface. Edit the well (3D or via the component
  list); the schematic follows. SVTC's good 2D engine becomes one *view*, not
  the app's spine.
- **WSON is the shared model** describing the 3D assembly: well header · survey
  (`profile`) · strings · components-by-depth (`{tool_comp, depthTop,
  depthBottom, od, params}`). Both the 3D scene and the 2D schematic read it.

**Scale + view dials (to design — see `docs/research/svtc-autoscale-dtx.md`):**
- **xDiaScale** — radial exaggeration (thin strings visible).
- **zScale** — vertical/along-hole magnification (= SVTC's `yScale`), WITH an
  **auto-scale / DTX** that locally magnifies small-component-dense intervals so
  short "jewellery" (nipples/valves/subs) isn't sub-pixel. Applied to the STRAIGHT
  well in MD space BEFORE the spline warp.
- **Flatten** — a 2D projection that **ignores azimuth** (the vertical-section
  view): project the trajectory onto its azimuth plane so a deviated well reads
  as a 2D bend. A build-in toggle (full-3D ↔ flattened).

### Scale methodology — DECIDED + grounded (`docs/research/svtc-autoscale-dtx.md`)

- **Pipeline (= SVTC, the deep-dive answer):** `raw MD → DTX (straight MD space)
  → warp along survey spline → × zScale`. DTX is applied FIRST, straight, BEFORE
  the bend.
- **DTX** = a monotonic piecewise-linear depth-transform that gives every short
  tool (< 50 m, inside a component) a constant weighted footprint (`len·w =
  50/0.3 ≈ 166.67`) so jewellery isn't sub-pixel, compressing gaps to keep total
  height fixed. Port `autoNodes` + `lerpDTX` verbatim (pure JS).
- **3D scale mode = (A) SPREAD SPACING, TRUE-SIZE PARTS** *(user-chosen)*: DTX/zScale
  magnify the *positions/spacing* of parts along the bore (small tools get
  breathing room) while each part keeps real proportions — faithful 3D CAD.
  Stretching the geometry itself (SVTC-style "schematic mode") is NOT done in 3D
  (it would distort real parts); reserve it for the 2D schematic view (W2) where
  parts are icons.

### Curvature-adaptive Z-subdivision (for the spline warp) — to build

When a part is warped along the trajectory it must have enough Z-segments to
follow the bend smoothly; but a uniform high segment count over-tessellates the
long straight runs (excessive triangles). So **subdivide each part's Z axis
ADAPTIVELY by the LOCAL CURVATURE of the spline over that span**: dense segments
where the trajectory bends, sparse where it's straight. A simple formula —
`nseg = clamp(1, ceil(totalBendAngle_over_span / maxChordAngle), cap)` where
`maxChordAngle` is the quality knob (~5°, equivalent to a sagitta/chord-error
bound) — concentrates triangles at the dogleg and keeps vertical/tangent sections
cheap. TWO rules to honour: (1) **curvature is sampled from the SURVEY (the
spline) over the part's MD span**, not from the part; (2) it is a **BUILD-TIME**
decision fed into the part bake (Rule 25 — the weld builders' build-time
Z-segmentation), NEVER a post-bake mesh rewrite (a plain top+bottom-ring cylinder
can't bend — warp just rotates it rigidly; the Z-rings must exist before the
warp; post-bake subdivide OOB-crashes the WASM core). Net: smooth bends + far
fewer triangles than uniform subdivision.

**Why this is achievable now (the key bridge):** SVTC's **3D** scene already
runs cadtrain's exact THREE + Manifold stack, warps geometry along the survey
(`direction.ts` + `warpGeometry`), AND has a **`tool_comp` → parametric-builder
registry** with only `bakerPacker.ts` filled. That empty registry is precisely
where cadtrain's `g_*` parts plug in. So 3D-first means: **build the 3D
assembler + fill that registry FIRST**, then hang the 2D schematic off the same
model — not the other way round.

**Phasing impact (overrides the bottom-up order in §later):** the 3D assembler
(trajectory + per-component part bake + place-by-depth) is the CORE and ships
early; the 2D schematic engine is ported as a *view* of it. The 2D port is still
valuable (auto-scale, DTX, annotations) but it is downstream of the 3D model,
not the foundation. A component's identity lives once (`tool_comp` + params) and
emits BOTH a 3D part and a 2D icon — Rule 25 build-time segmentation + Z-down
apply to the 3D bake.

---

## 0. TL;DR — what to reuse

- **The real engine is NOT `.dev-volume/base/renderers/well-diagram.svelte`** —
  that's a 24-line placeholder icon ("Open WSON tab to link"). The actual
  renderer lives in **`src/lib/apps/wson/`**.
- **Port these ~clean** (pure, no SVTC coupling):
  - `src/lib/apps/wson/wsonRender.js` (180 lines) — `WellDirection` (arc-slerp
    warp), `txPoint`, `buildDirPath`/`buildDirSide`, `perfArrows`,
    `cementRects`, `compTypeOf`, `textColor`, `ohForDepth`.
  - `src/lib/apps/wson/Wson2DRenderer.svelte` (268 lines) — pure SVG renderer,
    consumes a precomputed `geo` + `layers` + props. No store/tab coupling.
  - The trajectory math + auto-scale LUT inside
    `src/routes/api/schematic/+server.js` — `buildSegments()` (min-curvature
    quaternion-slerp survey → arc segments) and `autoNodes()` (the DTX
    depth-transform). Both are **pure JS**; lift them into a `$lib` module and
    run client-side (cadtrain has SSR off anyway).
  - `src/lib/apps/wson/threeD/direction.ts` + `warpGeometry` from
    `threeD/manifoldCut.js` for the 3D bend-along-survey.
- **Re-author, don't port**: `WsonApp.svelte` (2244 lines — tab/file/AI/store
  shell). Lift only the `geo = $derived.by(...)` block (WsonApp:635-765) and the
  Labella annotation block — both are portable logic tangled into an
  SVTC-specific app shell.
- **Replace**: `comp_list.xlsx` + the `filtercomps` catalog → cadtrain's
  `/api/primitives/list` (the `g_*` parts ARE the component library).

---

## 1. SVTC's diagram engine

### 1a. Rendering tech
Declarative **SVG** authored in Svelte 5 markup (not canvas, not WebGL).
`Wson2DRenderer.svelte` emits one `<svg width={geo.totalW} height={geo.totalH}>`
with layered `<rect>/<path>/<polygon>/<text>`, gated by a `layers` flag object
(`showHeader, showStrata, showOpenHole, showCement, showCasing, showCompletions,
showPerforations`). Two SVG `<pattern>`s (cement stipple, ICD dots). Components
are double-clickable `<g>` groups (`onOpenComp`/`onOpenPerf` callbacks). The
renderer is **stateless**: every coordinate is precomputed in the parent's `geo`
object; the renderer just draws. Annotations use **Labella** (npm) for
collision-resolved leader labels banked left/right of the wellbore.

### 1b. Trajectory / direction model (the prize)
Survey input is `profile: [{ md, dev, az }]` (measured depth, deviation/
inclination °, azimuth °) — extracted with fallbacks
`src.profile ?? wellProfile ?? survey ?? trajectory`, and `{md, inc, az}` is
also accepted.

Pipeline:
1. **`buildSegments(survey, td)`** (`/api/schematic` +server.js, pure JS) —
   minimum-curvature: each station pair → spherical points (`sphPoint(dev,az)`),
   a control segment with **quaternion/vector slerp** between unit tangents.
   Output per segment: `{ md1, md2, q1u, q2u, ptPivot, radCurvature, dirMult,
   rotAxis }`. Survey is cleaned/perturbed (tiny dev injected so a "vertical"
   well still has a defined frame).
2. **`WellDirection`** class (`wsonRender.js`, pure) wraps the segments:
   - `dirWarp([x, y]) → [northing, tvd]` — centerline (x=0) or offset point at
     MD=y, via `slerp3` of the segment's unit vectors scaled by
     `radCurvature − dirMult·x`.
   - `getPerpendicular2D(md)` → `{pos, neg}` unit normals for wall offsets.
   - `hasDeviation` gate.
3. **`txPoint(xInches, yMD, wellDir, dtx, yS, dS, cX, autoS) → [svgX, svgY]`** —
   the single transform every shape goes through. Straight well: `x = cX +
   xInches·dS`, `y = HEADER_H + yMD·yS` (with optional DTX remap). Deviated:
   warp the MD via `dirWarp` to `[N, TVD]`, then push walls out along the
   perpendicular by `|xInches·(dS/yS)|`.
4. **`buildDirPath`/`buildDirSide`** sample 30 steps along an interval and emit
   an SVG polygon that follows the curve — used for casing/OH/cement/completions
   when `hasDir`. `dirAxis` draws the dashed wellbore centerline.

`directional` is a display toggle; when off (or no survey) everything falls back
to straight rects via `sxL/sxR/syD`.

### 1c. Depth auto-scale (two independent mechanisms)
- **Fit-to-viewport `yScale`**: `autoYScale = clamp(400 / maxDepth, 0.08, 0.35)`
  — pixels-per-meter so the whole well lands in ~400px. `maxDepth` = deepest of
  all OH/CH/strata/perf/completion bottoms + 50. Ruler ticks use a "nice"
  interval (`[1,2,5,10]·10^n` so ≤12 ticks).
- **DTX magnification** (`autoNodes()` → `{depth[], depthTx[]}`): a piecewise-
  linear **depth-transform LUT** that *stretches completion-dense intervals and
  compresses empty ones* (so a 2-ft nipple at 1025 m isn't a sub-pixel sliver on
  a 1070 m well). `_lerpDTX` interpolates MD→transformed-MD before scaling.
  Toggled by `displayOpts.autoScale`. Computed server-side today (alongside
  `prNorm`/`prAuto` = normal vs autoscaled segment sets) and returned as
  `dirData = { dtx, prNorm, prAuto }` from `POST /api/schematic {action:
  'autonodes'}` — **pure math, trivially client-portable.**

### 1d. Input data shape consumed by the renderer (`geo`)
Built in `WsonApp.svelte:635-765` as `$derived.by`. Fields:
`{ oh, ch, cem, str, perf, completions, maxDepth, yScale, diaScale, centerX,
totalW, totalH, sy, syD, sxR, sxL, wellName, rulerTicks, maxR, strataW, hasDir,
dirPath, dirSide, dirAxis, wellDir, dtx, autoScale }`. `diaScale`
(`xDiaScale`≈6) is px-per-inch radial; `centerX` shifts to fit deviated
northing. Completions get `_top`/`_bot` resolved (absolute depths OR cumulative
`length`).

### Portable vs SVTC-coupled
| Asset | Portable? | Notes |
|---|---|---|
| `wsonRender.js` | **Clean** | Pure fns + `WellDirection`. Drop in as-is. |
| `Wson2DRenderer.svelte` | **Clean** | Pure props; rename Tailwind/`svgNs`. |
| `buildSegments` / `autoNodes` | **Clean** | Lift out of `+server.js` into `$lib/wson/profile.js`; run client-side. |
| `threeD/direction.ts`, `warpGeometry` | **Clean** | 3D bend; same THREE+Manifold stack. |
| `geo` derivation + Labella block | **Logic portable** | Copy the math; rebuild the host component. Needs `labella` npm. |
| `WsonApp.svelte` shell | **Re-author** | Tabs/store/file/AI/dgeo-strata coupling. |
| `comp_list.xlsx` + `filtercomps` | **Replace** | Use cadtrain `/api/primitives/list`. |

---

## 2. The WSON data model (from the samples)

Plain JSON, depths in **meters**, diameters in **inches**, `tool_comp` =
`CATEGORY.NAME`. Top-level keys: `meta, oh, ch, perforations, completions,
cementing, profile`, optional `strata`.

```jsonc
{
  "meta": {
    "wellName": "SAMPLE-1 Vertical Land Producer",
    "rkbToGl": 8,                // RKB→ground-level offset (m)
    "td": 1070, "pbtd": 1062,    // total / plug-back depth
    "location": { "x": 334430, "y": 4262430, "crs": "UTM 12N",
                  "lon": -112.89, "lat": 38.487 },
    "_wellType": "producer"
  },

  "oh": [ { "bitSize": 12.25, "top": 300, "bot": 1070 } ],   // open-hole sections (in/m/m)

  "ch": [ { "od": 9.625, "id": 8.681, "top": 0, "bot": 1070, // casing/cased-hole strings
            "grade": "L80", "weight": 47,
            "type": "conductor|surface|intermediate|production|tubing" } ],

  "perforations": [ { "top": 1040, "bot": 1060, "label": "Main reservoir",
                      "perfID": 7, "color": "#e53e3e" } ],

  "completions": [ {                                          // the in-string component stack
    "description": "Baker Permanent Packer",
    "tool_comp": "PACKERS.PACKER_BAKER_PERMANENT",           // catalog key
    "od": 8.681, "top": 1028, "bot": 1028.5                  // OR cumulative `length`
  } ],

  "cementing": [ { "od": 9.625, "top": 700, "bot": 1070 } ], // annular cement → paired to OH

  "profile": [ { "md": 0, "dev": 0, "az": 0 },               // survey stations (deviation°, azimuth°)
               { "md": 2000, "dev": 30, "az": 90 },
               { "md": 3000, "dev": 87, "az": 90 } ]
}
```

- **Vertical vs deviated** is purely the presence/shape of `profile`. The
  `deviated/` sample set is generated (`J`/`S` shape × `low/med/high/horizontal`
  band) from the base verticals by swapping in a `profile`. Same component
  stack, bent.
- **Validation** rules live in `src/lib/utils/validate.js` (no zod/JSON-schema —
  informal): casing OD 1–36", depth ordering, casing nesting (deeper = smaller
  OD), perf ordering, completion OD 0.5–12", well-name required. Port as the
  cadtrain WSON linter.
- `.meta.json` sidecars hold archetype/labeling metadata for the sample set
  (not needed by the renderer).

---

## 3. The COMPONENT GAP — and how cadtrain fills it

### What SVTC's 2D renderer can draw
Structural tubulars and **5 heuristic completion archetypes** only.
`compTypeOf(comp)` keyword-matches `tool_comp`+`description` → one of
`hanger | packer | icd | liner | tubing`, each rendered as a **generic SVG
primitive** (packer = two amber triangles to centerline; hanger = trapezoid;
ICD = dotted rect; tubing = two thin bars). It draws OH (dashed purple), casing
(azure rect/curve), cement (stipple annulus), perforations (shaped arrow fans),
strata, ruler, header, TD line — all correctly **scaled, auto-scaled, and
deviation-warped**.

### What it can't draw
There is **no per-component icon**. A side-pocket mandrel, a TRSSSV, a gas-lift
mandrel, a mule shoe, and a no-go nipple all collapse to the same `tubing` bars.
The `comp_list.xlsx` catalog (~72 rows: `comp_id, category, sub_category,
description, od, id, length, weight, tool_comp, magnification, …`) drives a
**search/picker** (`filtercomps`) but carries **no geometry** — there's only a
`jsonImage` type hint and a `magnification` factor. The named `tool_comp`s in
the samples confirm the real vocabulary cadtrain must visualize:
`FLOW_CONTROL.{NIPPLE_R_LANDING, SSD_1, TRSSSV_SP, TRSSV_FLAPPER}`,
`PACKERS.{PACKER_BAKER_PERMANENT, PACKER_AHR_AHC}`,
`MISC.{TUBING, TUBING_PUP, MULE_SHOE, GAUGE_MANDREL, SIDE_POCKET_MANDREL,
PUP_PERF}`, `tbgHanger`, `liner_hanger_red`.

### The 3D side already has the hook (key finding)
`Wson3DScene.svelte` (1036 lines) runs the **same THREE + Manifold-3d (WASM)
stack as cadtrain** and already:
- bends straight `ExtrudeGeometry`/`CylinderGeometry` along the survey via
  `warpGeometry(geo, wellDir)` / `dirWarp3D`,
- does CSG cutaway via `manifoldCut.js`,
- and exposes a **parametric component registry keyed by `tool_comp`**:
  `getBuilder`/`buildCached` in `threeD/parametric/index.ts` — but **only
  `bakerPacker.ts` is implemented**. Every other `tool_comp` falls back to a
  plain cylinder.

**That registry slot is exactly cadtrain's `g_*` parts.** cadtrain already owns
parametric, bakeable completion geometry (nipples `g_nipple_f/r`, flow coupling
`g_flow_coupling`, mandrel `g_mandrel`, mule shoe, packers, collars, shafts,
pup joints, SSDs — the curated `g_*` completions migration + the engine
`stdlib`). The WBD research (`wbd-powerdraw-visio.md` §3) adds the **smart-icon
vocabulary + feature flags** (cementOut/In, openHole, litho, shoe; size-class
Production/Intermediate/Liner; centerline glue-points) for variant control.

### Fill strategy
A **`tool_comp → cadtrain primitive` map** (same shape as the existing vocab
rule-translator), with `{ od, id, top, bot }` from the WSON node feeding
`meta.params`:
- **2D**: replace `compTypeOf`'s generic shapes with a per-`tool_comp` **2D
  icon**. Cheapest path = a small SVG-symbol library keyed by `tool_comp`
  (cadtrain already bakes SVG via `PrimitiveSvgView`/three-`SVGRenderer`; the
  `compSvgStrings[i]` `{@html}` injection slot in `Wson2DRenderer` is *already
  there* for exactly this — SVTC precomputes per-component SVG strings and the
  renderer drops them in). Generate them from the `g_*` parts' silhouette.
- **3D**: register each `g_*` part as a `tool_comp` builder → bake to mesh →
  `warpGeometry` along the survey. Drop-in for the existing registry pattern.

---

## 4. Integration plan for cadtrain (phased)

Route: build under the existing **`/wells`** stub
(`src/routes/wells/+page.svelte`) per Rule 2 (no new top-level route; keep the
archived extractor link). New code in `src/lib/wells/` (engine, pure) + the
route (UI), mirroring the FEM encapsulation (Rule 22). WSON is the data model;
store `.wson` files on the volume under a new `wells/` top dir (Rule 13,
`volumePath` + atomic writes).

### Phase 0 — Port the 2D engine (no components yet)
- Copy `wsonRender.js` → `src/lib/wells/wsonRender.js` (pure; as-is).
- Lift `buildSegments` + `autoNodes` from `/api/schematic` into
  `src/lib/wells/profile.js` (pure; **run client-side** — no endpoint needed,
  SSR is off). Drop the `xlsx`/`filtercomps` half.
- Copy `Wson2DRenderer.svelte` → `src/lib/wells/Wson2DRenderer.svelte`; strip
  Tailwind classes to cadtrain's CSS conventions.
- New host `src/lib/wells/WellSchematic.svelte`: lift ONLY the `geo`
  `$derived.by` + Labella annotation derivation from `WsonApp` (635-960). Feed
  it a parsed WSON + a `displayOpts` ({autoScale, directional, xDiaScale,
  yScale, showLeftTrack}). Add `labella` to deps.
- Port `validate.js` → `src/lib/wells/validate.js` (WSON linter).
- **Verify**: render all 10 base samples + a few `deviated/` ones; vertical and
  J/S/horizontal warp must match SVTC visually. e2e: load `/wells`, pick a
  sample, assert SVG dims + a deviated path renders (Rule 11/12).

### Phase 1 — WSON editor (data in)
- Load/save `.wson` on the volume (`wells/*.wson`, atomic). Sidebar of samples +
  user wells (reuse `/primitives` sidebar pattern).
- Editor panels (re-author SVTC's, much smaller): header, casing/OH/cement
  strings table, perforations, **completion stack**, survey table. Adopt the WBD
  **Shape-Data schema** for each completion node (`wbd-powerdraw-visio.md` §3
  P1): `{ itemNum, depthTop, depthBottom, sizeClass, position, units,
  productDetails, toolOD, toolID, toolLength, tool_comp, features:{ cementOut,
  cementIn, openHole, litho, shoe } }` — a near drop-in superset of today's WSON
  completion row.
- Two depth modes (WBD §3 P5): true depth-scaled (default) + "schematic /
  not-to-scale". Centerline top/bottom glue-points for end-to-end stacking
  (WBD §3 P6).

### Phase 2 — Component layer (close the gap, 2D)
- Build `src/lib/wells/toolCompMap.js`: `tool_comp → { primitiveId, paramMap }`
  for the sample vocabulary (nipples, packers, mandrels, SSD, mule shoe, hanger,
  liner hanger, tubing/pup). Seed it from cadtrain's `g_*` completion parts +
  the WBD icon list (`wbd-powerdraw-visio.md` §1).
- Generate per-`tool_comp` **2D SVG icons** from each part's silhouette
  (`PrimitiveSvgView`), cache as strings, feed the renderer's existing
  `compSvgStrings[i]` `{@html}` slot. Fallback = today's `compTypeOf` heuristic
  shape (so unmapped comps still draw).
- Feature flags toggle optional sub-geometry (cement in/out, shoe) per WBD §3 P2
  ≈ a part's optional `.add/.subtract` features.
- Component picker reads cadtrain `/api/primitives/list` (filter to
  completions/`g_*`) — replaces `comp_list.xlsx`.
- BOM/tally (WBD §3 P4): emit a parts list (item#, desc, OD, depth) from the
  stack; useful for round-trip + RAG corpus.

### Phase 3 — 2D → 3D well diagram
- Mount a Threlte scene (`src/lib/wells/Well3D.svelte`) lazy-imported (SSR off).
  Port `threeD/direction.ts` (`dirWarp3D`) + `warpGeometry` + `manifoldCut.js`
  cutaway from SVTC (same Manifold/THREE stack).
- Structural tubulars (casing/OH/cement/tubing) = annular `ExtrudeGeometry`
  subdivided + `warpGeometry(…, wellDir)` along the survey (SVTC's approach,
  directly reusable). NOTE cadtrain Rule 25: **segmentation belongs at build
  time** — sample enough rings before warp; never post-bake subdivide.
- **Components** = bake each mapped `g_*` part to a Manifold mesh, place at
  `[_top,_bot]` along the warped centerline. Fill SVTC's `tool_comp` parametric
  registry slot with cadtrain bakes (the registry already prefers
  `m.parametricGeom` over the cylinder fallback).
- Z-down convention bridge: WSON MD increases downward; cadtrain is Z-down too
  (`mv(part,[0,0,+N])` = down-hole) — align the warp frame at the seam.

### Phase 4 — wire-up & polish
- Layer toggles (reuse SVTC's `layers` object), annotation banking, cutaway
  Z-slider (cadtrain already has this UX in the graph editor).
- Optional: link to the wells **extractor** (archived `/archive/wells`) so a
  PDF/image → WSON → schematic → 3D round-trips (the `/plan` bundle D story).

### New dependencies
- **`labella`** (npm) — annotation collision layout. Only hard new dep.
- **No `xlsx`** — drop the `comp_list.xlsx` catalog; use `/api/primitives/list`.
- `manifold-3d`, `three`/`@threlte/*` — **already in cadtrain.**

### Priority order — 3D-FIRST (revised; supersedes the bottom-up order above)

Per the CORE PRINCIPLE, the 3D well is the source of truth, so build it first:

1. **W0 — WSON model + volume store** (= old P1's data half). The shared
   `{header, profile, strings, components[{tool_comp, depthTop, depthBottom, od,
   params}]}` model on the volume. Adopt the WBD Shape-Data schema.
2. **W1 — 3D assembler (THE CORE)** = old P3 promoted to first. Port
   `direction.ts` (`dirWarp3D`) + `warpGeometry`; fill the `tool_comp` →
   parametric-builder registry with cadtrain `g_*` part bakes; place each
   component along the survey by depth (Z-down, Rule 25 build-time
   segmentation). This makes the 3D well real from the WSON.
3. **W2 — 2D schematic as a VIEW** = old P0 + P2. Port the pure 2D engine
   (`wsonRender.js`, `Wson2DRenderer`, `buildSegments`/`autoNodes` auto-scale +
   DTX) and render it *from the same model*; per-`tool_comp` 2D icons derived
   from the `g_*` silhouettes (closes SVTC's documented component gap). Still the
   visible differentiator, but now downstream of the 3D model.
4. **W3 — editor UX + BOM + polish** (= old P1 UI + P4). SVTC-grade interface
   over the 3D-first model; auto tally/BOM; extractor link; not-to-scale toggle.

One component identity (`tool_comp` + params) → BOTH a 3D bake and a 2D icon.
The unique value is still the component layer (SVTC's gap); the *foundation* is
now the 3D assembler, not the 2D port.

---

## 5. Key file map (SVTC, for the port)

| SVTC file | Lines | Role | Action |
|---|---|---|---|
| `src/lib/apps/wson/wsonRender.js` | 180 | `WellDirection`, `txPoint`, dir paths, perf/cement, `compTypeOf` | **Port clean** |
| `src/lib/apps/wson/Wson2DRenderer.svelte` | 268 | Pure SVG renderer (+`compSvgStrings` `{@html}` slot) | **Port clean** |
| `src/routes/api/schematic/+server.js` | 211 | `buildSegments` (survey→arc segs) + `autoNodes` (DTX) | **Lift pure math → `$lib`** |
| `src/lib/apps/wson/WsonApp.svelte` | 2244 | App shell; `geo` derivation 635-765 + Labella 768-960 | **Re-author; lift the derivations** |
| `src/lib/apps/wson/threeD/direction.ts` | 203 | `dirWarp3D` 3D warp | **Port for Phase 3** |
| `src/lib/apps/wson/threeD/manifoldCut.js` | — | `warpGeometry`, CSG cutaway | **Port for Phase 3** |
| `src/lib/apps/wson/threeD/parametric/index.ts` | — | `tool_comp`→builder registry (only `bakerPacker`) | **Fill with cadtrain `g_*`** |
| `src/lib/apps/wson/Wson3DScene.svelte` | 1036 | THREE+Manifold scene, warp + cutaway + registry | **Reference / adapt** |
| `src/lib/utils/validate.js` | — | WSON lint rules | **Port** |
| `.dev-volume/samples/schematics/*.wson` (+`deviated/`) | — | 10 base + generated J/S deviated samples | **Reuse as seed fixtures** |
| `static/comp_list.xlsx` | 72 rows | component search catalog | **Replace** with `/api/primitives/list` |
| `.dev-volume/base/renderers/well-diagram.svelte` | 24 | placeholder icon | **Ignore** (not the engine) |
