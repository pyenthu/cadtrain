# SVTC section / cutaway — mechanism + cadtrain replication plan

> Read-only research doc. No feature code touched. Grounded in real line
> references in `~/code/SVTC/` and this repo (2026-07-04).
>
> **Headline finding, up front:** SVTC's fast cutaway is **NOT a THREE
> clipping plane**. It is the **same CSG boolean** cadtrain uses — a
> half-space box subtracted from the solid — but applied **per primitive**
> (one small watertight cylinder/tube at a time), computed **once** and
> cached, never over a giant composed monolith. That per-part-vs-monolith
> split is the whole speed story. A genuine render-time clip plane is a
> *separate, further* win that neither codebase has shipped yet — it is
> cadtrain's own `/plan` task **#958 (W-H2, bundle E)** — and this doc
> plans that too, because it is the durable "free at render time" answer.

---

## 1 · How SVTC does the section / cutaway (the mechanism)

**File:** `~/code/SVTC/src/lib/apps/wson/threeD/manifoldCut.js`
**Caller / scene:** `~/code/SVTC/src/lib/apps/wson/Wson3DScene.svelte`

### 1a. Mechanism = CSG boolean half-space subtract (per primitive)

The file's own header says it plainly (lines 1-12):

> "manifoldCut — CSG via manifold-3d, **cadtrain style** … BUILD every
> primitive in manifold-3d directly (`Manifold.cylinder`, `Manifold.sphere`,
> `Manifold.cube`) … Cut with a **big half-space box**, then convert the
> final result to a THREE.BufferGeometry with **per-triangle vertex colors**
> (grey cut face, mainColor elsewhere)."

The cutter is an axis-aligned half-space cube 100 000 units on a side
(`cutterBox(cutAxis)`, lines 36-46). The cut itself is one line inside each
primitive builder:

- `cutCylinder` (lines 282-312): `Manifold.cylinder(len, r, r, 64).translate(...).subtract(cutterBox(cutAxis))`
- `cutTube` (lines 314-351): `outer.subtract(inner)` → `.subtract(cutterBox(cutAxis))`
- `cutSphere` (lines 632-639): `sphere.subtract(cutterBox(cutAxis))`

So there is **no `renderer.localClippingEnabled`, no `material.clippingPlanes`,
no stencil pass, no 2D section render anywhere in SVTC** — verified:
`grep -rni 'localClippingEnabled|clippingPlanes|ClippingPlane' ~/code/SVTC/src`
returns nothing. It is a solid-modeling boolean.

### 1b. Cut-plane orientation

Axis-aligned, selected by the `cutAxis` prop (`'x' | 'y' | 'z'`, default
`'x'`). `cutterBox('x')` removes the **−X half-space**, leaving a cut face
whose normal points **+X toward the camera** — the camera default position is
deliberately offset `+X, −Y` so the half-section faces the viewer
(`Wson3DScene.svelte:771-784`, `up=[0,0,-1]`, Z-down). A `cutAzimuth` slider
adds an extra rotation (`resolveAzimuthDeg`, lines 277-280) so the section
plane can swing around the wellbore axis.

### 1c. Deviated wells — build the half-section in 2D, no 3D cutter

For deviated wells (`hasRealDeviation(wellDir)`), SVTC does **not** even use
the half-space box. It builds the **half cross-section directly in 2D**
(`CrossSection.circle(r).intersect(left-half-plane)`, or a half-annulus for
tubes), `Manifold.extrude`s it, and then **`warpGeometry`** bends it along the
survey with a **parallel-transport (rotation-minimizing) frame**
(lines 137-242). Every pre-warp `X=0` vertex maps onto the wellbore
centerline, so the cut face follows the tangent automatically. This is the
"cut follows the trajectory" behavior — and it is fundamentally a
**solid-geometry** operation, not a plane.

`direction.ts` supplies the centerline: `WellDirection.getInterNode(md)` is
sampled every `stepMD` to get `{pt, tangent}`; the frame is parallel-
transported with Rodrigues rotations (lines 194-210, 245-256).

### 1d. The cut FACE is a solid CAPPED face (colored by vertex color)

Because a solid was subtracted, the cross-section is **real capped geometry**,
not an open shell. `manifoldToColoredGeo` (lines 54-107) walks every triangle
and tags the ones lying **on the cut plane** (`|coord| < EPS`) with the grey
`cutColor` (cement gets a beige + per-triangle hash noise, lines 81-92);
everything else gets `mainColor`. One `MeshStandardMaterial({vertexColors:true})`
draws body + cut face in a single call. So: **capped, solid, colored** — no
hollow shell, no second pass.

### 1e. Computed ONCE, not per-frame

`Wson3DScene.svelte` builds the cut geoms in `$derived` blocks keyed by a
`geomKey` string (line 172):

```
`${cutActive}|${cutAxis}|${diaScale}|${directional}|${cutAzimuth}|${profileFingerprint}`
```

A `{#key geomKey}` block (line 820) remounts the meshes only when that key
changes, so `<Edges>` rebuilds off the new CSG output. **Steady-state cost is
zero** — orbiting the camera does not recompute anything. The boolean only re-
runs when the user changes cutaway/axis/scale/azimuth/survey. Completion
solids are additionally cached in an in-flight-guarded `$state` map
(`parametricGeoms`, lines 474-511) via `buildCached`.

**Answer to "computed or render-time":** COMPUTED (once, cached). Not a
render-time clip.

---

## 2 · Why SVTC's cutaway is faster than cadtrain's `cutVC`

Both use `manifold.subtract(halfSpaceBox)`. The difference is **what they cut**.

### cadtrain today (`src/lib/cad/render-helpers.ts`)

`finalizeManifold` (lines ~248-284) cuts the **whole composed/baked stack**
manifold: `cutawayVC(warped, cutBox, …)` → `scaled.subtract(cutBox)` →
`manifoldToCutVC(...)`. The measured-and-documented cost is **not** the
boolean (the code comment at lines 762-786 says the subtract "is cheap and
roughly linear either way") — it is the **`calculateNormals(3,60)`** that
`manifoldToCutVC` runs over the subtracted result (line 620), which is
**super-linear in triangle count: 30k→204 ms, 100k→3776 ms** (lines 250-251,
771-772). One monolithic pass over an N-copy stack is what forced the historic
15k-tri "cutaway off (perf)" skip.

cadtrain **already** mitigates this two ways:
- `cutawayVC` (lines 787-810) uses `scaled.decompose()` to cut **each
  connected body separately** and merge the cross-sections — the subtract is
  distributive over `compose` (`(A∪B)\C ≡ (A\C)∪(B\C)`). Measured ~26× on a
  50-body stack (~3.8 s → ~0.16 s), so the skip threshold could be raised
  15k → 120k (line 260).
- `tryInstanceFinalize` (lines 321-400) detects N identical bodies, cuts the
  **canonical child once**, and replicates the transform — cutaway judged on
  the small child's tri count (line 380).

**But** a single genuinely-huge *connected* body (where `decompose` yields one
piece) still hits the monolithic super-linear path and skips (`numTri() >
120_000`, line 260). That is the ~20 s-cold worst case.

### Why SVTC never hits it

SVTC **never builds a monolith**. Every casing / cement / OH interval is its
own watertight `Manifold.cylinder`/tube of a few hundred–few thousand tris,
cut and normal-computed independently and cheaply (`Wson3DScene.svelte`
`displayChGeoms`/`displayCementGeoms`/… lines 404-465). It is the
**per-part cutaway** cadtrain's own memory `stack_cutaway_perf_root_cause`
prescribes and the `wells-build-architecture.md` A1 plan adopts — just
achieved structurally (elements are never fused) rather than recovered via
`decompose()`.

**So the honest one-liner:** SVTC is faster because it cuts **many small
independent watertight primitives** (linear, cacheable) instead of one giant
composed manifold whose per-cut `calculateNormals` is super-linear. Same
boolean, different granularity. It is *not* faster because of a clip plane.

---

## 3 · Replication plan for cadtrain

Two tiers. Tier 1 = "become SVTC" (per-part boolean, no monolith) — durable,
exact colors, follows any trajectory. Tier 2 = "beat SVTC" (GPU clip plane) —
zero recompute on azimuth/slider, but flat-only and needs a cap pass. Ship
Tier 1 first (it removes the 20 s cliff and matches the crown-jewel port that
`/wells` already has); layer Tier 2 where the interaction demands a free
slider.

### Tier 1 — per-part boolean cutaway (match SVTC), no monolith

**Status:** `/wells` already has this. `src/lib/wells/threeD/manifoldCut.ts`
is a **direct port** of SVTC's file (its header calls SVTC "the CROWN JEWEL")
and cuts each shell independently. So the wells side is done at the
single-thread level; A1 (`wells-build-architecture.md` §3, §P2) just moves
those per-element booleans **off-thread into a `WellBakePool` (cap 4 workers)**
and caches per element key. No new mechanism — parallelize the one SVTC uses.

**For `/primitives` (the slow surface):** the boolean already runs per-body via
`cutawayVC` decompose. The remaining slow case is the single huge *connected*
body. Concrete steps:
1. Keep `cutawayVC`'s decompose-and-cut (`render-helpers.ts:787-810`) as the
   default — it is the SVTC-equivalent for composed stacks and already ~linear.
2. Move `finalizeManifold`'s cut off the main thread. The bake already runs in
   the Web Worker (`bake-worker.ts` / `bake-client.ts`); ensure the
   `calculateNormals` + per-body cut happen there so the main thread never
   blocks (mirrors A1's worker rationale).
3. For a genuinely huge single connected body, prefer Tier 2 (clip plane)
   rather than paying the monolithic `calculateNormals` — i.e. raise/keep the
   skip threshold and fall through to the render-time clip.

Files touched (Tier 1): none new for /wells beyond A1's `well-bake-pool.ts` +
`wells-bake-worker.ts`; for /primitives, only ensure the existing `cutawayVC`
path runs inside the worker.

### Tier 2 — GPU clip plane + stencil cap (cadtrain #958 / W-H2)

This is the render-time-free cutaway. It is already scoped in
`src/routes/plan/details.ts:184` ("GPU clip plane: THREE material
`clippingPlanes` + a stencil-pass to cap the …") and task **#958** in
`src/routes/plan/+page.svelte:72`.

**Mechanism:**
- Renderer: `renderer.localClippingEnabled = true`. cadtrain's renderer is
  created in `PrimitiveDualCanvas.svelte:244-246` (`createRenderer` →
  `new WebGLRenderer({...})`) — add the one flag there. For `/wells` the
  Threlte `<Canvas>` renderer needs the same flag.
- Plane: one `THREE.Plane(normal, constant)`. Assign it to every live-mesh
  material's `.clippingPlanes = [plane]` in `PrimitiveDualScene.svelte`
  (the `liveMat` materials at lines 959-978). No geometry rebuild.
- **The cutaway toggle no longer swaps `cutVC` for `full`.** Instead, always
  render `full` and toggle the plane on the material. This drops the
  `{#key … showCutaway}` remount (line 938) and the whole `cutVC` boolean for
  the clip path.

**Z-slider / azimuth → plane params (the big UX win):** today the Z control is
`scene.zFocus` (camera pan, `PrimitiveDualScene.svelte:482`) and the cut plane
is fixed at Y=0 baked into the geometry. With a clip plane, a section-depth
slider maps **directly to `plane.constant`** and an azimuth dial to
`plane.normal` (`setFromNormalAndCoplanarPoint`), each with **zero rebake** —
exactly the interaction #958 calls out. Store them on `scene-state.svelte.ts`.

**Hollow-vs-capped — the key tradeoff (must solve):**
A bare clip plane produces a **HOLLOW cut** — clipping only discards fragments,
so you look straight into the open shell; there is **no cross-section face**.
SVTC never has this problem because its boolean leaves *real capped geometry*.
To restore the solid cross-section under a clip plane you need a **stencil cap
pass** (the standard technique, and precisely what the #958 note says):
1. Render the mesh **back faces** into the stencil buffer where the clip plane
   cuts (`side: THREE.BackSide`, `colorWrite:false`, stencil increment).
2. Render a **plane-aligned quad** (or a full-screen quad masked by stencil)
   colored as the cross-section, wherever the stencil marks "inside solid".
3. Reset stencil. Three.js exposes this via `Material.stencilWrite`,
   `stencilFunc`, `stencilRef`, `stencilZPass`; the classic reference is the
   three.js `webgl_clipping_stencil` example.

So: **clip plane alone = hollow; clip plane + stencil cap = solid capped face**
matching SVTC's look. Budget the stencil pass in the plan — it is the entire
reason the boolean has stayed around.

**Keeping inner-grey (#888) / outer-red (#cc2222) with a clip plane:**
- The **outer skin** keeps its existing per-vertex colors on `full` (red/outer
  or color-by-source) — clipping does not touch vertex color.
- The **cut face** is drawn by the cap pass, so its color is chosen there. The
  cadtrain cross-section reveal is a single `bodyInner` grey
  (`render-helpers.ts:881`, `SECTION_ID → bodyInner`), so **one grey cap pass**
  reproduces it exactly. Per-part inner colors (color-by-source `innerRgb`)
  would require one stencil group per part-material, or a cap shader that reads
  a per-fragment id — start with the single-grey cap (covers the default
  red/grey look) and defer per-part cap tint.

**Composing with the just-shipped opacity/transparency work:**
- `clippingPlanes` is per-material and works on transparent materials too, so
  the x-ray slider (`PrimitiveDualScene.svelte:112`) and per-subpart alpha
  (`splitMesh`, color-by-source RGBA at `render-helpers.ts:847-896`) keep
  working on the clipped `full`/`splitMesh` mesh.
- **Caveat:** the stencil cap pass + transparent bodies interact through draw
  order and depth/stencil state. Render the cap as **opaque** (the cross-
  section is solid steel/cement) with correct `renderOrder`, before/after the
  transparent shells, and test the open-hole (translucent) + cased (opaque)
  overlap case specifically.
- **Instancing win:** a clip plane applies to all instances of an
  `InstancedMesh` for free — no per-instance CSG — simplifying the
  `tryInstanceFinalize` cutaway branch (`render-helpers.ts:388`).

---

## 4 · Wells angle — this becomes the /wells cutaway (A1) + trajectory

- **Today `/wells` already uses Tier 1** (the SVTC per-primitive boolean port,
  `src/lib/wells/threeD/manifoldCut.ts` + `WellSchematic3D.svelte`, same
  `geomKey`/`{#key}` pattern). A1 (`wells-build-architecture.md` §3f, §P2)
  makes those per-element booleans **concurrent + cached** via `WellBakePool` —
  "no whole-well boolean, ever." That is the janky→smooth win and it is
  literally SVTC's method parallelized.
- **The clip plane (Tier 2) is a *different* /plan item — #958 / W-H2, bundle
  E** ("3D-fast — clip-plane cutaway (drop the boolean)"). It makes cutaway
  toggle + azimuth + section-depth **free at render time** with no CSG rebuild.
- **Trajectory caveat for the clip plane (important):** a `THREE.Plane` is
  **flat**. It correctly sections a **vertical / straight** well and gives a
  good *section-through-azimuth* view, but it **cannot follow a curving
  deviated trajectory** — the cut would slice the build/tangent section at the
  wrong place. SVTC handles deviation precisely *because* it uses solid
  geometry: it builds the half-section in the survey-native frame and
  `warpGeometry`s it along the centerline (and has a manifold "curtain" cutter,
  `buildCurtainCutterManifold`, lines 519-627, for a curved cut surface). So:
  - **Straight/vertical wells + the section view:** use the flat clip plane
    (Tier 2) → free slider.
  - **Deviated wells:** keep the per-part boolean + warp (Tier 1 / A1) — the
    only correct trajectory-following cut. A single flat plane is not a
    substitute there.
- Recommended /wells end state: **clip plane for the vertical/section fast
  path; boolean-per-element (off-thread, cached) for deviated wells** — pick by
  `hasRealDeviation(wellDir)`, exactly the branch SVTC's `cutCylinder`/`cutTube`
  already make.

---

## 5 · Summary table

| Question | Answer |
|---|---|
| SVTC mechanism | CSG boolean `subtract(halfSpaceBox)` **per primitive** (+ 2D-half-extrude+warp for deviated). NOT a clip plane. |
| Orientation | Axis-aligned half-space (`cutAxis`, default −X removed → +X face to camera); `cutAzimuth` rotates it; deviated → survey-native frame. |
| Cut face | Solid **capped**, grey vertex color (beige+noise for cement); one `vertexColors` draw. |
| Computed or render-time | **Computed once**, cached by `geomKey` + `{#key}` remount. Zero steady-state cost. |
| Why faster than cadtrain `cutVC` | Many small independent primitives (linear, cacheable) vs one composed monolith whose per-cut `calculateNormals(3,60)` is super-linear (30k→204 ms, 100k→3776 ms). Same boolean, finer granularity. |
| Replication Tier 1 | Per-part boolean, no monolith (already ported to `/wells`; keep `cutawayVC` decompose + move off-thread for `/primitives`). |
| Replication Tier 2 | GPU clip plane (`localClippingEnabled` + `material.clippingPlanes`) → azimuth/depth slider free, no rebake. cadtrain #958 / W-H2. |
| Hollow vs capped | Clip plane alone = **HOLLOW** (open shell). Add a **stencil cap pass** to draw the solid grey cross-section. SVTC avoids this by using the boolean (cap is real geometry). |
| Inner-grey/outer-red under clip | Outer skin keeps vertex colors on `full`; cut face color comes from the cap pass (single grey cap = default look; per-part inner tint deferred). |
| Deviated wells | Flat clip plane can't follow a curve — keep the per-part boolean + warp for deviation; clip plane only for vertical/section. |

## Key files

- SVTC: `~/code/SVTC/src/lib/apps/wson/threeD/manifoldCut.js` (cut + warp),
  `~/code/SVTC/src/lib/apps/wson/Wson3DScene.svelte` (callers, `geomKey`,
  camera), `~/code/SVTC/src/lib/apps/wson/threeD/direction.ts` (centerline).
- cadtrain now: `src/lib/cad/render-helpers.ts` (`finalizeManifold`,
  `cutawayVC`, `manifoldToCutVC`, `tryInstanceFinalize`),
  `src/lib/shared/PrimitiveDualScene.svelte` (cutVC render, `liveMat`),
  `src/lib/shared/PrimitiveDualCanvas.svelte:244` (`createRenderer`),
  `src/lib/wells/threeD/manifoldCut.ts` + `WellSchematic3D.svelte` (the port).
- cadtrain plans: `docs/plans/wells-build-architecture.md` (A1, §3f),
  `docs/plans/stack-cutaway-perf.md`, `src/routes/plan/details.ts:184` +
  `src/routes/plan/+page.svelte:72` (#958 / W-H2 clip-plane task).
