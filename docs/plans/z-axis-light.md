# Plan — rectangular light along the Z (drilling) axis

**Requested 2026-06-14.** Add the *option* of a rectangular light that
illuminates **along the Z axis**, so long thin downhole tools are lit evenly
down their whole length instead of from two point sources clustered near the
origin (which leaves the far ends of a tall stack dim).

Parallel track to the Stack/Properties work — independent blast radius (the
viewer scene + SceneControls only).

## Current lighting (baseline)

`src/lib/shared/scene-state.svelte.ts` + `PrimitiveDualScene.svelte`:

- `<T.AmbientLight intensity={0.3} />`
- Three `<T.PointLight>` (`l1`,`l2`,`l3`) at fixed positions near the origin,
  `distance={50}`, intensities 500/500/250. Z-positions are 0 / 0 / −20.
- Material everywhere is **MeshPhongMaterial** (Phong, NOT physical — physical
  washes out on Mac GPUs; see `src/lib/cad/CLAUDE.md`).
- A tall stack (e.g. `g_dp_stand`, 3× joint with a gap) extends far along +Z;
  the point lights don't follow it, so the bottom of the stack falls off.

## The constraint (read before coding)

Three.js **`RectAreaLight`** is the literal "rectangular light", BUT:

1. It affects **only `MeshStandardMaterial` / `MeshPhysicalMaterial`** — it has
   **no effect on `MeshPhongMaterial`**, which is what every mesh in the viewer
   uses. Lighting them with a RectAreaLight would require either swapping the
   material (regression risk — the Phong choice was hard-won) or adding a second
   physical material just for this mode.
2. It requires `RectAreaLightUniformsLib.init()` (a one-time global init from
   `three/examples/jsm/lights/RectAreaLightUniformsLib.js`) before first use.
3. It is **not shadow-casting** and ignores `distance`/decay the way point
   lights do.

So a literal RectAreaLight is the "correct name" but the wrong fit for the
current material. Three viable approaches:

## Options

### A. Point-light STRIP along Z (recommended) — Phong-compatible
Distribute **N point lights evenly along the part's Z extent** (read
`scene.partCenter` + the geometry bbox already computed in
PrimitiveDualScene's geometry effect). A toggle `zStripLight` swaps the 3
fixed point lights for, say, 4–6 lights spanning `[zMin, zMax]` at a fixed
radial offset, each at a fraction of the total intensity. Visually reads as a
"line/rectangle of light running down the tool"; works with Phong unchanged;
auto-tracks the part's length so tall stacks stay evenly lit.
- **Pros**: no material change, no new deps, auto-fits length, smallest risk.
- **Cons**: not a *true* area light — soft gradients between samples (mitigate
  with enough samples / ambient).

### B. True `RectAreaLight` + dedicated physical material for this mode
Add `RectAreaLightUniformsLib.init()`, a `<T.RectAreaLight>` oriented with its
normal facing the part (long edge along Z, `width`≈part length, `height`≈a few
diameters), AND switch the live mesh material to `MeshStandardMaterial` while
the mode is on (revert to Phong when off).
- **Pros**: physically correct soft rectangular illumination.
- **Cons**: material swap = the washes-out-on-Mac risk re-enters; two material
  code paths; helper init; more surface area. Higher risk.

### C. `DirectionalLight` aligned across Z
A single directional light whose direction is perpendicular to Z (lights the
whole length uniformly since directional lights are position-independent).
- **Pros**: trivial, Phong-compatible, dead-even down the length.
- **Cons**: flat / no falloff, not "rectangular", loses the form-revealing
  point-light highlights.

**Recommendation: A** (point-light strip) as the shipped default behind a
toggle, because it satisfies the intent (even illumination along Z for long
tools) with zero material risk and auto-tracks part length. Keep B noted as a
future "physical area light" upgrade if soft-area quality is wanted later.

## Implementation sketch (Option A)

1. `scene-state.svelte.ts`: add
   - `zStripLight: false` (master toggle)
   - `zStripCount: 5`, `zStripIntensity: 300`, `zStripRadius: 30` (the offset of
     the strip from the part axis), all view-only.
   - (bbox zMin/zMax already derivable from `partCenter` + the geometry effect;
     expose `partZExtent: {min,max}` if not already on `scene`.)
2. `PrimitiveDualScene.svelte`: when `scene.zStripLight`, render
   `{#each Array(scene.zStripCount)}` `<T.PointLight>` at
   `z = lerp(zMin, zMax, i/(n-1))`, `y = zStripRadius`, `x = 0`,
   `intensity = zStripIntensity`, `distance` large enough to cover the diameter.
   Hide `l1/l2/l3` while the strip is on (or dim them to fill).
3. `SceneControls.svelte`: a new "Z-axis light" toggle + count/intensity/offset
   sliders in the Camera + Lights panel (the ⚙ gear). Mirror the existing
   slider chrome.
4. Both panes (mesh + GLB) share `scene`, so the GLB pane gets it for free.
5. **Z-down convention**: +Z is down-hole; the strip spans the part's full Z
   extent so the *bottom* of a stack is lit, not just the top.

## Test / verify
- Bake `g_dp_stand` with a gap (z-offset 4–6) → toggle the Z-axis light → the
  bottom joints should be as bright as the top (vs. the current falloff).
- Toggle off → identical to today's 3-point lighting (no regression).
- Check both the mesh pane and the GLB pane.

## Reconcile
Add a `/plan` lane when scoped (Rule 19). Pairs with the existing view-only
`xScale`/`zScale` exaggeration controls (same SceneControls gear, same
"long-thin-tool legibility" theme).
