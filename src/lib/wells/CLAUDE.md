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
- `samples/*.wson` + `samples.ts` — 4 real SVTC sample wells (`?raw` glob).
- `registry.ts` — `tool_comp` (CATEGORY.NAME) → cadtrain `g_*` part + bake params.
  Fills the slot SVTC's 3D scene left empty.
- `assemble.ts` — `assembleWell(wson)` → parts placed along the trajectory by
  depth (z-DOWN). Vertical = straight; deviated = average-angle survey walk.
- `WellScene.svelte` — Threlte scene (primitive cylinders for now; W1.3 swaps in
  real baked `g_*` meshes). Camera `up=[0,0,-1]`.

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
