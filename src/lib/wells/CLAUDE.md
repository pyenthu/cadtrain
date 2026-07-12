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
- `WellScene.svelte` — Threlte scene (primitive cylinders; the SIMPLE assembler
  view). Camera `up=[0,0,-1]`.
- `wson-2d.ts` — **PURE 2D-schematic geometry builder** (no DOM/Svelte/Three).
  `computeWson2D(wson, opts)` → primitive SPECS (mirrored casing/oh/tubing rects,
  cement annulus rects, perf arrow polys, a deviated centreline/body polyline,
  ruler ticks, banked label anchors). `buildRemap` = the SAME raw-MD→display-depth
  formula `WellSchematic3D` uses (DTX×zScale), so 2D+3D agree on depth. Rendered
  by `routes/wells/WellSchematic2D.svelte` (the FAST DEFAULT view — no Manifold
  CSG; ewells parity, `docs/research/wells-perf-ewells-vs-cadtrain.md`). Ported
  from SVTC `wsonRender.js`. Tested headless: `wson-2d.test.ts`.

## 3D-FAST bake pool (`well-bake-pool.ts` + worker + client) — #42b-A
The parallel, off-UI-thread replacement for the synchronous `buildBundle` pass
in `WellSchematic3D`. Design: `docs/plans/wells-build-architecture.md` §3b/3c/3d.
- `well-bake-pool.ts` — `WellBakePool`: N = `clamp(hardwareConcurrency-1,1,4)`
  workers (each its OWN Manifold WASM instance), **keep-all** scheduling (a key
  change supersedes ONLY the changed element; siblings keep building — the
  opposite of `bake-client.ts`'s latest-wins), per-element dedup, streaming
  results, cancellation, worker-crash respawn. PURE scheduling (no THREE/Manifold/
  DOM) → unit-tested with a MOCK worker (`well-bake-pool.test.ts`). Worker factory
  is injectable. NO fallback (engine fail = `onError`).
- `threeD/wells-bake-worker.ts` — the worker: rebuilds `WellDirection` from the
  cloneable `{profile,td}` survey (min-curvature is cheap) then calls the SAME
  unmodified `manifoldCut` builders (`cutTube`/`cutCylinder`/`cutSphere`) →
  byte-identical geometry; serializes + zero-copy-transfers one vertex-coloured
  mesh. Same `?url` wasm-locate as `bake-worker.ts`. Build-checked only (a real
  Worker can't run headless). `part` (compiled `g_*` completion) is forward-
  declared for P3.
- `well-bake-protocol.ts` — cloneable request/reply shapes (no heavy deps), shared
  by worker + client.
- `well-bake-client.ts` — the MAIN-THREAD seam `WellSchematic3D` calls:
  `getWellBakePool()` (lazy singleton), `shellJobSpec(el, survey)` (id + complete
  geometry cache key incl. survey fingerprint), `shellReplyToGeometry`, and
  `bakeWellShells(pool, specs, onGeo, onError)` (streaming keep-all reconcile).
  THREE lives here. Tested: `well-bake-client.test.ts`.
- **Reuses** `$lib/graph/mesh-serial` (`serializeGeometry`/`deserializeGeometry`,
  now exported) for the single-geometry round-trip. The `WellSchematic3D` render-
  path swap (progressive `$state` map, drop `{#key geomKey}`) is the P2 follow-on
  needing browser verification — the pool/worker/seam are the foundation.

## Ported SVTC 3D engine (`threeD/` + `dtx.ts` + `WellSchematic3D.svelte`)
A high-fidelity PORT of SVTC's real well-diagram engine (`~/code/SVTC/src/lib/
apps/wson/threeD/`) — the min-curvature + quaternion-slerp + parallel-transport
warp + manifold-3d half-section cutaway. Same stack, so file/function names are
preserved for easy future diffs. This is the RICH engine that supersedes the
simple `assemble.ts` trajectory walk for the cutaway schematic.

- `threeD/profile.ts` — `WellProfile` (min-curvature segments from `{md,dev,az}`
  survey; `cleanSurvey` inc-nudge + 2000-unit virtual tail). Uses `mathjs`.
- `threeD/direction.ts` — `WellDirection` (quaternion-slerp sampler;
  `getInterNode(md)` → position/tangent/normal; `dirWarp` 2D). Uses `@math.gl/core`.
  ⚠ `dirWarp3D` retained for parity but **NOT used** for 3D geometry (twists
  planar wells — SVTC abandoned it). Warp geometry via `warpGeometry` instead.
- `threeD/manifoldCut.ts` — THE CROWN JEWEL. `warpGeometry(geo, wellDir)` =
  parallel-transport (Rodrigues) frame warp ("wrap-to-spline"); `cutCylinder /
  cutTube / cutSphere` build primitives DIRECTLY in manifold-3d then half-section
  cut; `manifoldToColoredGeo` (per-vertex grey cut-face colors). **Adapted to
  cadtrain's SHARED Manifold singleton** — `initManifold()` delegates to
  `$lib/graph/manifold-helpers` (`globalThis.__cadtrain_manifold__`), no 2nd WASM
  Module; explicit per-primitive segment counts so the global 256 is untouched.
  (SVTC's dgeo-curtain / debug-cutter builders were intentionally NOT ported.)
- `threeD/index.ts` — `buildWellDirection(profile, td)` (+ vertical fallback) +
  `sampleCentreline(dir, from, to, step)`.
- `threeD/parametric/` — `ParametricComponent` interface (`ParamSpec`,
  `ParametricResult`, `manifoldToBufferGeometry`) + registry (`getBuilder`,
  `buildCached` LRU, `listBuilders`) + `bakerPacker` example builder. This is the
  interface cadtrain's `g_*` parts will implement; complementary to `registry.ts`
  (volume parts) — a completion resolves to a volume part OR a client builder.
- `dtx.ts` — `autoNodes(nodes, maxDepth)` + `lerpDTX(dtx, d)` + `dtxRemapSurvey`,
  the pure-JS DTX depth-scaling ported client-side from SVTC's schematic server
  endpoint (no round-trip). Expands cluttered intervals, compresses empty runs.

### `WellSchematic3D.svelte` — the ported scene (contract)
Scene CONTENT (mount inside the route's `<Canvas>`, like `WellScene`). Prop `wson`
is the only required prop:

| prop | default | meaning |
|---|---|---|
| `wson` | — | the WSON doc (this dir's `Wson` type) |
| `diaScale` | 6 | radial exaggeration (inches→scene units); OPTIONAL view dial, not baked |
| `zScale` | 1 | depth stretch applied AFTER DTX (SVTC's yScale) |
| `dtx` | true | apply DTX depth emphasis |
| `cutaway` | true | half-section CSG cutaway (once Manifold loads) |
| `cutAxis` / `cutAzimuth` | `'x'` / 0 | cut plane orientation |
| `directional` | true | follow the survey; false → straight vertical |
| `layers` | all on | `{ showOpenHole, showCasing, showCement, showCompletions, showPerforations }` |
| `onCameraMove` | — | `(pos)=>void` camera readout callback |

Renders oh→`cutCylinder`, ch→`cutTube`, cement→`cutTube` (beige speckle),
tubing→`cutTube` (gold), perforations→`cutSphere`, completions→parametric
registry (Baker packer) with a plain-cylinder FALLBACK for unknown `tool_comp`;
all warped along the profile. **Scale pipeline** `raw MD → DTX → warp → ×zScale`
is applied via one `remap(md)` so shells + the warped survey share display space.
Lazy: Manifold WASM inits in `onMount`; Three/Threlte evaluate client-side only
(SSR off). Cutaway toggles remount meshes via `{#key geomKey}` so `<Edges>`
rebuilds (cadtrain pattern).

Headless verification: `schematic3d.test.ts` (`bun run test`) — pins the pure
math (min-curvature TVD monotonic, frame orthonormal/right-handed, autoNodes/
lerpDTX monotonic) + that sample-WSON feature meshes bake non-degenerate
finite geometry and the parametric builder returns a manifold non-zero-volume solid.

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
