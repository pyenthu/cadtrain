# Plan — /primitives polish session (sinusoidal warp + stage UX)

## Context

What started as a focused sinusoidal Z-warp experiment turned into a
broader /primitives polish pass. The warp is the headline experimental
feature (entire pipeline grep-tagged `TEMP warp experiment` for clean
removal); the rest are permanent UX tightenings to the inspector
panel, the canvas chrome, and the GLB pipeline.

## Status @ 2026-05-15 — DONE

| # | What | Commit |
|---|---|---|
| 1 | E2E spec cleanup — navbar / routes / GLB-path stale-test fixes | `5132bfd` |
| 2 | Param-group accordion + GLB stage tab + parts-picker search + empty stub | `3919bcb` |
| 3 | Cross-section + Edges toggles moved into SceneControls gear | `1e014fe` |
| 4 | Params folded into Parts · drag-scrub number inputs · GLB material | `886a277` |
| 5 | Geom accumulator pattern (`geom = geom.add(...)`) + GLB flat-shading | `68c1703` |
| 6 | GLB cutaway — bake `<id>.cut.glb` variant + Cross-section toggle picks URL | `d83685a` |
| 7 | Restore `hollow_cylinder.ts` after a curl-test clobber | `1bd6e53` |
| 8 | GLB vertex colours (per-face red-outer / grey-bore) + stacked param cards (4-col grid) | `f41cb54` |
| 9 | Bake-size fix — full GLB stays indexed, only cut variant carries colours | `cda8bf2` |
| 10 | GLB honours Z× compression via `loaded.scale.z` | `2a5fdda` |
| 11 | Sinusoidal Z-warp shader (TEMP) — onBeforeCompile injection + rAF uniform loop | `9af86b6` |
| 12 | Subdivide-along-Z so the warp has z-samples to bend through | `a37fff5` |
| 13 | Warp fixes — edge-split subdiv (size bound) + computeVertexNormals + interleaved-buffer support | `65e053b` |
| 14 | Parts-tab accordion is now PER PART (each used helper/component = one bar) | `344b865` |
| 15 | `shoulder.ts` formatting reflow from a UI save | `1234cd1` |
| 16 | GLB material brighter — specular `#666666`, shininess 120 | `7d88e24` |
| 17 | Two stage tabs (3D · Picture) + in-canvas Mesh/GLB toggle + warp on/off master | `f814a79` |

All 17 commits ahead-of and pushed to `origin/main` (`cb2da54..f814a79`).
Build green; e2e 49 passed / 0 failed / 7 skipped (prod-only volume specs).

## Warp implementation — final shape

| File | Role |
|---|---|
| `src/lib/shared/scene-state.svelte.ts` | `warpEnabled`, `warpAmp` (0.3), `warpFreq` (1.5), `warpAxis` (x/y) |
| `src/lib/shared/warp.ts` (NEW) | `attachWarpShader(material)` + `subdivideAlongZ(geo, 0.25)` + rAF loop writing uniforms |
| `src/lib/shared/SceneControls.svelte` | Warp row with master checkbox + axis radios + amp/freq inputs (dim/disabled when off) |
| `src/lib/shared/ComponentScene.svelte` | Threlte `oncreate={(mat) => attachWarpShader(mat)}` on both cutaway + full materials; subdivides geometry when `warpEnabled` |
| `src/lib/shared/ComponentSceneGlb.svelte` | Calls `attachWarpShader` inside `dressGltfScene`; stashes `warpOriginalGeo` / `warpSubdividedGeo` on each mesh's userData and swaps on the `warpEnabled` effect |

Shader injection:
```glsl
float warpDisp = uWarpAmp * sin(transformed.z * uWarpFreq);
transformed.x += warpDisp * (1.0 - uWarpAxis);
transformed.y += warpDisp * uWarpAxis;
#include <project_vertex>
```

## Remaining TODOs

### Warp experiment — retire when done

- Cleanup is one commit: delete `src/lib/shared/warp.ts`, remove the 4
  `scene.warp*` fields, drop the SceneControls Warp row, remove the two
  `attachWarpShader(...)` call sites, drop the `subdivideAlongZ` swap
  in both scenes. `grep -rn "TEMP warp experiment" src/` finds every
  touch point.

### Tradeoffs left on the table (if warp graduates from experiment)

- **Normals aren't recomputed for the warped position** — lighting
  reads "as if unwarped". For a polished feature we'd either compute
  per-pixel normals from positional derivatives in the fragment shader
  (`dFdx` / `dFdy`) or add a GPU-side normal warp using the analytic
  derivative of sin. Not blocking the experiment.
- **The number inputs ignore `min`/`max`** — the browser accepts
  keyboard values past the cap. Add a wrapped clamp in the input
  handler if precise control matters.
- **Subdivider runs synchronously on geometry load** — fine for the
  current primitive sizes (~10–50ms), would need to be moved to a
  Worker if components grow significantly more triangle-heavy.

### Older session items still pending (carried forward)

- **Re-save older bundle primitives** to bake their `.cut.glb` variants.
  ComponentSceneGlb falls back to the full GLB when `.cut.glb` 404s,
  so the cutaway just doesn't kick in until a save touches each one.
- **Per-component `.md` populate** — 24 of the 25+ bundle components
  still have no spec file. Template: `docs/PRIMITIVE_TEMPLATE.md`.
- **Additional assembly recipes** — only `tubing_hanger_spool_stack.md`
  exists. Christmas tree / BOP stack / production-packer ICV / multi-
  lateral junction are the natural next anchors per
  `docs/assemblies/README.md`.
- **Migrate baseline 26 primitives to the volume** (Phase 2 of the
  volume-native components plan) — retires `import.meta.glob` + the
  client `buildAuthored` path entirely. Currently the bundle/library
  split is two render paths picked by `renderMode`.

## Verification (still applicable end-to-end)

1. `bun run build` — green.
2. `bun run dev`, open `/primitives`, click the canvas gear:
   - **Warp** checkbox off (default) → mesh straight; flip on → S-curve.
   - Adjust Amp / Freq / Axis (X|Y); flipping back to off preserves them.
3. In the 3D stage, click **Mesh ↔ GLB** pill — same warp, same
   cutaway / edges / Z× state apply to either source.
4. **Picture** tab loads the volume-stored reference image.
5. `bun run test:e2e` — 49 specs pass.
