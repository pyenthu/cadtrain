# Warp / sweep a part along a spline path (2026-05-23)

> Status: PLANNING. Bend a part so its centerline follows a spline that
> originates at the origin: vertex **z → arc-length** along the spline; the
> cross-section is moved to the spline point and oriented to the local frame so
> the **radial profile is preserved**. Profiles may **vary along the path**.
> (Here "profile" = the path spline; cross-section profiles come from the
> parametric profile system, see `profile-system.md`.)

## Bottom line
Do **NOT** `.warp` a pre-built solid. Build the warped surface **directly as a
welded raw mesh** with the existing toolkit (`src/lib/cad/manifold-mesh.ts`:
`gridPatch`/`capFan`/`weldAndBuild`). **`primitives/raw_helix_4/source.ts`
(`:207-238`) is already a spline-sweep** — clone it; the helix is just one rail
+ one frame. `.warp` is disqualified: it can't vary the profile (fixed prism),
hits the `scaleTop` collapse bug, and the refine cost is n².

## Spline representation
- Catmull-Rom through control points, stored as a `polygon`-typed param
  (`[[x,z]]` polyline starting at `[0,0]`). Reuse `ProfileEditor` with
  `presetSet:'revolve'` (Z-down `(horizontal, z)` section — right axes for a
  deviated-wellbore trajectory). Interpolate to a smooth curve at build time.
- Mirror the profile-system descriptor union → a `resolvePath` sibling; built-in
  path kinds (`straight`, `arc`, `sCurve`, `dogleg(buildRate)`) could live under
  `primitives/paths/`. 3D paths + bespoke PathEditor = later.

## Frame: parallel-transport (Bishop), NOT Frenet
Frenet's normal comes from curvature → unstable on straight runs, flips 180° at
inflections (a wellbore is mostly straight = worst case). Parallel transport
carries the frame with minimal twist (stable through zero curvature) → exactly
the "radial relativity maintained" requirement. Per station: `Tᵢ` = normalized
finite-diff; seed `N₀ ⊥ T₀`; `Nᵢ` = rotate `Nᵢ₋₁` by the angle between
consecutive tangents about their cross product; `Bᵢ = Tᵢ × Nᵢ`. Extend
`RailFrame` (`manifold-mesh.ts:25`) to carry `{N, B}`; `capFan` (`:127-152`)
needs the second basis vector.

## Algorithm (mirrors raw_helix_4)
1. Arc-length-parametrize: dense-sample the spline, cumulative-length table,
   inverse lookup `s → (point, frame)`.
2. Map `z → s` (`s = (z/partLen)·S`). Z-down preserved (deeper z = further along).
3. Per station: world vertex `Cᵢ + px·Nᵢ + py·Bᵢ` via `gridPatch`.
4. `capFan` both ends; `weldAndBuild` (merges seam, self-corrects winding via
   volume-sign safety net).
- Cost is **linear** in rail count (not n²). ~32 stations interactive, ~128 bake.
- **Self-intersection** on tight radii is the hard limit → clamp
  `bendRadius ≥ maxProfileRadius·safety`; `weldAndBuild` throws "Not manifold"
  (loud, correct failure).

## Varying profiles
Why the raw-mesh route is mandatory — `bandFn` evaluates the profile fresh per
station. Two tiers (both reuse the profile resolver):
- **Keyframes (v1)**: `[{at, profile}]` (at ∈ [0,1] norm arc-length); per station
  lerp the bracketing polygons vertex-by-vertex (resample to a common vN so the
  `gridPatch` grid stays rectangular).
- **Parametric (P3)**: `profile(u) = registry[kind].build(lerp(paramsStart,
  paramsEnd, u))`.

## Integration
A **new self-contained volume primitive `warp_along_spline`** (leaf `source.ts`),
NOT a `.warp` operator (recipe ops are mv/rot only) and NOT a recipe transform
(scalar/vec3 only). The welded-mesh toolkit is already injected into the sandbox
(`primitive-sandbox.ts`) — no new wiring. `renderMode:'server'`. Composes into
recipes by name for free.

## Phases
- **P0 spike** — clone `raw_helix_4`; replace `rail()` with Catmull-Rom +
  arc-length + parallel-transport; single fixed profile; verify bbox + volume sign.
- **P1** — authorable `path` + `profile` polygon params (ProfileEditor); bend-
  radius safety clamp.
- **P2** — varying profile via keyframes (vertex-count normalization + lerp).
- **P3** — profile-system integration (`{kind,params}` profiles, `profile(u)`),
  path registry / built-in path kinds, optional 3D PathEditor.

## Risks / open questions
- Self-intersection (geometric limit); frame-seed determinism (project world +x);
  profile vertex correspondence (resample); 3D paths out of v1; interactive cost.
- Open: part length = arc-length 1:1 or proportional remap? planar `(x,z)` vs 3D
  for v1? keyframe `at` normalized [0,1] (recommended)? emit outer/inner VC
  buckets for hollow-tubular material split? share one `resolve` with profiles.

## Critical files
`primitives/raw_helix_4/source.ts` (template) · `manifold-mesh.ts` (extend
`RailFrame` + `capFan`) · `primitive-sandbox.ts` (toolkit injected) ·
`ProfileEditor.svelte` (path authoring) · `primitive-recipe.ts` (composition).
