# `src/lib/wells/` — well-schematic engine (3D-first)

The model + assembler for the `/wells` **3D-first well schematic**. Plan +
decisions: **`docs/plans/well-schematic.md`** (read first). Memory:
`well_schematic_3d_first`.

## Principle — 3D-FIRST
The canonical model is the **3D well** (parts placed along the survey by depth,
baked with Manifold); the **2D schematic is a derived VIEW**, not the authoring
surface. Inverts SVTC/Visio-WBD's 2D-first stance.

## Files
- `wson.ts` — WSON model (`meta/oh/ch/perforations/completions/cementing/profile`;
  **metres + inches**) + `lintWson`/`parseWson`/`isDeviated`/`completionExtents`.
- `samples/*.wson` + `samples.ts` — 5 real SVTC sample wells (`?raw` glob):
  `00-one-casing`, `01-vertical-land-producer`, `04-horizontal-shale-pnp`,
  `05-esp-producer`, `09-hpht-completion`. (Count is in flux — the N2 sample-ladder
  task, TODO #42e, is adding vertical/deviated/completion rungs; describe the set,
  don't rely on the number.)
- `registry.ts` — TWO registries, all ids are REAL volume parts:
  (1) completions — `tool_comp` (CATEGORY.NAME) → cadtrain `g_*` part + bake
  params (`resolveComponent`; ~45 catalogue keys across packers/nipples/valves/
  shoes/mandrels/drill-pipe). Fills the slot SVTC's 3D scene left empty.
  (2) structural — wellbore section-kind (casing/openhole/cement/tubing) → the
  parametric `bw_*` element library + od/wall/length params (`resolveStructural`;
  `bw_casing`/`bw_open_hole`/`bw_cement`/`bw_prod_tubing`). Unlike the mostly-
  fixed `g_*` catalogue, `bw_*` parts take real od/id/wall/length inputs, so the
  well BODY bakes through the same graph pipeline. `assemble.ts` wires the `bw_*`
  partId onto each wellbore section. `listRegisteredPartIds()` enumerates both.
- `assemble.ts` — `assembleWell(wson)` → parts placed along the trajectory by
  depth (z-DOWN). Vertical = straight; deviated = average-angle survey walk.
- `wson-2d.ts` — **PURE 2D-schematic geometry builder** (no DOM/Svelte/Three).
  `computeWson2D(wson, opts)` → primitive SPECS (mirrored casing/oh/tubing rects,
  cement annulus rects, perf arrow polys, a deviated centreline/body polyline,
  ruler ticks, banked label anchors). `buildRemap` = the raw-MD→display-depth
  formula (DTX×zScale) shared with the 3D view, so 2D+3D agree on depth. Rendered
  by `routes/wells/WellSchematic2D.svelte` (the FAST DEFAULT view — no Manifold
  CSG; ewells parity, `docs/research/wells-perf-ewells-vs-cadtrain.md`). Ported
  from SVTC `wsonRender.js`. Tested headless: `wson-2d.test.ts`.

## 3D render path — `GraphEditorPane` (NOT a bespoke THREE shell)
The `/wells` 3D view renders through the SHARED CAD editor: `WellViewPlaceholder`
(`routes/wells/`) bakes `wsonToGraph(wson)` into a composition graph and mounts
`GraphEditorPane` on it, so the well uses the SAME compile→bake→geometry pipeline
as every other part. The old pure-THREE shell cluster — `WellSchematic3D.svelte`,
`WellScene.svelte`, the ported SVTC `threeD/manifoldCut.ts` cut+warp builders, and
the never-wired Track-B bake pool (`well-bake-pool.ts` + `well-bake-client.ts` +
`well-bake-protocol.ts` + `threeD/wells-bake-worker.ts` + `threeD/parametric/`) —
was **deleted 2026-07-28 (#42h(c))** as confirmed-dead. Memory
`wells_empty_3d_wiring_gap`. What survives from the SVTC port is the pure survey /
depth math below.

## Ported SVTC survey + depth math (`threeD/` + `dtx.ts`)
A high-fidelity PORT of the SURVEY/DEPTH half of SVTC's well-diagram engine
(`~/code/SVTC/src/lib/apps/wson/threeD/`) — min-curvature + quaternion-slerp
sampling + the DTX depth transform. File/function names are preserved for easy
future diffs. Consumed by `wson-2d.ts` (the 2D schematic depth remap) and the
`wson-to-graph` warp path; `WellDirection.dirWarp3D` is the reference for the
coming deviated-trajectory warp (memory `svtc_warp_3d_function`).

- `threeD/profile.ts` — `WellProfile` (min-curvature segments from `{md,dev,az}`
  survey; `cleanSurvey` inc-nudge + 2000-unit virtual tail). Uses `mathjs`.
  (Also tested by `graph/tests/survey-to-xyz.test.ts`.)
- `threeD/direction.ts` — `WellDirection` (quaternion-slerp sampler;
  `getInterNode(md)` → position/tangent/normal; `dirWarp` 2D). Uses `@math.gl/core`.
  ⚠ `dirWarp3D` retained for parity but **NOT used** for 3D geometry (twists
  planar wells — SVTC abandoned it).
- `threeD/index.ts` — `buildWellDirection(profile, td)` (+ vertical fallback) +
  `sampleCentreline(dir, from, to, step)`.
- `dtx.ts` — `autoNodes(nodes, maxDepth)` + `lerpDTX(dtx, d)` + `dtxRemapSurvey`,
  the pure-JS DTX depth-scaling ported client-side from SVTC's schematic server
  endpoint (no round-trip). Expands cluttered intervals, compresses empty runs.
  Widely reused across `wson-2d.ts` + the shared viewer rulers.

Headless verification: `schematic3d.test.ts` (`bun run test`) — pins the pure
math (min-curvature TVD monotonic, frame orthonormal/right-handed, autoNodes/
lerpDTX monotonic).

### Deps
`@math.gl/core` (quaternion slerp) + `mathjs` (vector ops) — both in package.json.

## Conventions / decisions
- **Z-down** (cadtrain-wide): larger z = deeper. Camera up `[0,0,-1]`.
- **Scale pipeline:** `raw MD → DTX (straight) → warp along spline → × zScale`
  (DTX FIRST, before the bend). `xDiaScale` = radial exaggeration; `zScale` =
  SVTC's `yScale`. DTX deep-dive: `docs/research/svtc-autoscale-dtx.md`.
- **3D scale mode = spread spacing, TRUE-SIZE parts** (faithful CAD). Stretching
  geometry (schematic mode) is for the 2D view only.
- **Curvature-adaptive Z-subdivision** for the warp must be **build-time** (Rule
  25), curvature sampled from the SURVEY over each part's MD span — never a
  post-bake mesh rewrite.
- **Flatten** = azimuth-ignoring 2D projection (toggle).

## Source of the engine
SVTC's REAL well-diagram engine: `~/code/SVTC/src/lib/apps/wson/` (the
`.dev-volume/.../well-diagram.svelte` is a decoy). It has trajectory warp +
auto-scale + interface but LACKS components — cadtrain's `g_*` parts fill that.
Research: `docs/research/wbd-powerdraw-visio.md`, `docs/research/svtc-autoscale-dtx.md`.
