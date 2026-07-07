# Manifold 3D-baker vs TrueForm (TF) baker — pipeline audit

> Read-only audit (2026-07-07). Maps + compares the two geometry pipelines that
> feed the SAME shared scene (`PrimitiveDualScene.svelte`), records every point of
> divergence with `file:line`, then lists redundant/dead code and a prioritized
> unify list. No source was changed.

## The two pipelines at a glance

| Stage | Manifold (3D-bake tab) | TrueForm (TF tab) |
|---|---|---|
| Compile | `composition-emit*.ts` → Manifold source; server `/api/primitives/compile` inlines deps → script + `scriptHash` | `graph-to-tf.ts:graphToTf` → data-only `TfRecipe` (`TfInstr[]`) |
| Execute | `bake-worker(-core).ts:runCompiledManifold` (Web Worker) OR server `/api/primitives/preview` | `tf-worker(-core).ts:buildTfRecipe` → `tf_examples/execute.ts:executeTfRecipe` (Web Worker) |
| Finalize | `render-helpers.ts:finalizeManifold` → ONE combined `{full, cutVC, instanced}` (vertex-coloured) | `execute.ts` returns `{data, fullData, cutPlanes, parts[], cutParts[]}` |
| Adapt → THREE | `mesh-serial.ts:deserializeComponentResult` (colours already baked into vertex attrs) | `trueform-adapter.ts:tfMeshToGeo` (normals/colours computed main-thread, per mesh) |
| Assemble `geo` | `PrimitiveDualCanvas.svelte:429` `{full, cutVC, instanced}` — **no `parts`** | `PrimitiveDualCanvas.svelte:588` `{full, cutVC?, parts[], cutParts[]}` |
| Scene branch | single-mesh (`full`/`cutVC`/`splitMesh`/`instMesh`) | **per-part loop** (`parts`/`cutParts`) |

The pipelines share only the composition **graph** and a handful of pure helpers
(`warp-spline.ts` frames, `math-lib.ts`). Everything from execute onward is
independent — including two copies of the normal recompute and two different
transparency models. That split is the root of the live transparency bug.

---

## 1. Construction / mesh output — THE transparency-bug root cause

**Manifold** emits ONE combined mesh. `finalizeManifold`
(`render-helpers.ts:337`) returns `{ full, cutVC, manifold, instanced }`; `full`
is a single vertex-coloured `BufferGeometry` (`manifoldToGeo`, `:593`) and per-part
appearance is baked into that ONE mesh's **vertex colour** attribute
(`colorBySourceGeo`, `:889`). The canvas builds `geo = { full, cutVC, instanced }`
(`PrimitiveDualCanvas.svelte:429`) — it **never sets `parts`**.

**TF** emits per-PART meshes. `executeTfRecipe` builds each root output as its own
mesh (`execute.ts:457`) and returns `parts: [{data, appearance}]`
(`execute.ts:504`); the canvas turns each into its own `BufferGeometry`
(`PrimitiveDualCanvas.svelte:592`) → `geo.parts`.

**Scene consequence** — the branch selector in `PrimitiveDualScene.svelte`:
- `geo.parts` present → **per-part arm** (`:977`), each part its own `<T.Mesh>` +
  own material (colour/texture/opacity/PBR) — TF only.
- else → **single-mesh arm**: `instMesh` (`:1034`) / `splitMesh` (`:1042`) /
  `cutVC` (`:1050`) / `full` (`:1060`) — Manifold/BREP only.

So per-part **material and opacity are supported by two completely different
mechanisms**:
- Manifold: opacity is baked into the combined mesh as a 4-component (RGBA) vertex
  colour (`PartColorLUT.opacity` → `colorBySourceGeo` `alphaOn`, `:915-976`). To
  keep the OPAQUE subparts solid the scene must split that one mesh into two draw
  groups by per-triangle alpha (`buildAlphaSplitGeometry` `:329` → `splitMesh`
  `:376`).
- TF: opacity is a **per-part material** property (`appearance.opacity` → `pOp`,
  `:988`) on separate meshes, ordered by `renderOrder` (`:998`). No vertex alpha,
  no split.

**Confirmed divergences (bugs) from this split:**
1. **The x-ray slider does not affect TF parts.** The single-mesh arms use
   `effOpacity = opacity × scene.xrayOpacity` (`:150`), but the TF per-part arm
   uses `pOp = a.opacity` **directly** (`:988`, `:1000`) — `scene.xrayOpacity` is
   never multiplied in. Same for the per-part cut arm (`:1018`). So the global
   x-ray control silently no-ops on any TF-rendered part.
2. **Two transparency models for "the same" part.** The identical part rendered
   via Manifold (RGBA vertex alpha + `splitMesh` 2-group) vs TF (per-part meshes +
   `renderOrder` ranking) blends differently — depth-write/order behaviour is not
   guaranteed to match, so a part can look different depending only on which tab
   baked it.
3. **Cutaway transparency diverges too.** Manifold's cut is ONE RGBA `cutVC`
   (`:1050`); TF's is a per-part `cutParts` list (`:1008`) — and per-part material
   on the Manifold cut section is simply not available (single mesh).

---

## 2. Material / per-part appearance

| Aspect | Manifold | TF |
|---|---|---|
| Colour model | per-vertex, baked at bake-time (`colorBySourceGeo`, RGB or RGBA) | per-part material uniform (`appearance.colorOuter`), no baked VC on `full` |
| Per-part colour | via server `PartColorLUT` (color-by-source relation, `render-helpers.ts:22`) | via `TfRecipe.partAppearance` (`graph-to-tf.ts:124`, resolved `:901`) |
| Per-part opacity | baked into vertex alpha (`PartColorLUT.opacity`, `:30`) | live material `opacity` per mesh (`:1000`) |
| metalness/roughness | **ignored on the live mesh** — `RenderMaterialSpec.metallic/roughness` are "GLB-only" (`render-helpers.ts:71`); the whole-part `matPBR` only tints the non-VC fallback arm | **per-part** `materialPreset(a.material)` applied to every part mesh (`:989`, `:1000`) |
| Texture map | whole-part only (`texture` prop → one `.map`, `:98`) | **per-part** `getMaterialTexture(a.texture)` (`:1000`) |
| Cut interior grey | heuristic `isBore || onCutX/Y || nzNorm` (`manifoldToCutVC:731-743`) | pure plane-membership: all 3 verts on a cut plane (`sectionFaceColors`, `trueform-adapter.ts:86`) |

**Divergence:** TF supports genuinely per-subpart material/texture/metalness;
Manifold folds everything into one mesh so metalness is per-whole-part at best and
texture is per-whole-part only. The cut-section classifier also differs — Manifold
uses a multi-signal heuristic (bore/normal/radius), TF uses strict plane
membership — so the grey/red split on a cross-section will not match between the
two backends on the same part.

---

## 3. Stacking / placement

**Manifold**: emit stamps each container child's `_stackRef`; `stack()` in
`manifold-helpers` advances the cursor `cursor = tail(placed) + _stackRef`. Emit
resolves the effective ref with the precedence in `composition-emit.ts` (childRefs
override → child's `stack_ref` default → null).

**TF**: `graph-to-tf.ts:effectiveStackRef` (`:518`) re-implements that SAME
precedence, emitting `union{mated:true, offsets[]}` (`:770`); the executor places
end-to-end in `execute.ts:placeEndToEnd` (`:230`) using each built mesh's
`localZExtent` (`:176`) and `cursor += (zMax-zMin) + (ref ?? -STACK_OVERLAP)`
(`:247`).

**Agreement / divergence:**
- Both intend the same graded-delta semantics (0 = flush, + gap, − overlap) and
  both put the first child's top at z=0.
- Divergence in the **unauthored** case: Manifold's flush stack uses no nudge;
  TF injects a fixed `STACK_OVERLAP = 0.1` weld nudge (`execute.ts:193`, `:246`)
  so adjacent solids interpenetrate for a clean boolean. → positions differ by
  0.1 per joint when no `stack_ref` is authored. Small but real and cumulative
  down a long string.
- `effectiveStackRef` is a hand-mirror of the emit precedence and **can drift**
  (it does not call the emit code — see §6).

---

## 4. CSG / booleans

**Manifold**: `.add/.subtract/.intersect` on the exact Manifold kernel; the cut is
distributive-over-compose so `cutawayVC` (`:846`) decomposes into bodies and cuts
each. Defect-2 (curved hollow sweep coincident tilted caps → wrong genus) is a
known mesh-boolean limit accepted on this path (see `cad/CLAUDE.md`).

**TF**: `booleanUnion/Difference/Intersection(a,b).mesh` (`execute.ts:303-316`)
on the TF mesh kernel. The **bore-extend hollow-sweep trick** is applied here:
`buildInstr` extends any swept SUBTRAHEND's path past both ends before the
difference (`execute.ts:308`, `extendPathEnds` `:55`, `BORE_EXT = 1.0`) so the
bore caps punch through the outer caps → clean χ=0 instead of defect-2.

**Divergence:** the bore-extend prevention lives ONLY on the TF path. The Manifold
path relies on authored parts already doing it (e.g. `s_tube_demo`) or accepts the
degraded solid. So a naive hollow-sweep part is clean in TF but defect-2 in
Manifold — the two backends can produce topologically different solids (different
χ, different cap fans) from the same graph.

---

## 5. Warp

**Shared:** both consume the SAME spline frames from `warp-spline.ts`
(`splineSampler` `:74`, `spline3DFrames` `:138`, right-handed RMF). Good — the
curve math is one source of truth.

**Manifold warp NODE**: `warpManifoldAlongSpline` (`:204`) calls `Manifold.warp`,
which moves **positions only**; normals are then re-derived by
`calculateNormals(crease)`, and coarse axial chords crease-split → faceted. The
pipeline works around this with a `smoothWarp` flag that forces a 180° crease
(`bake-worker-core.ts:160`, `render-helpers.ts:273`). Density comes from the
`_axialMaxZSpan` dial at build time (`WARP_AXIAL_MAX_ZSPAN = 1.5`,
`bake-worker-core.ts:41,185`) re-lathing rings in the weld builders.

**Manifold scene (sine) warp**: `warpVertex` (`warp-geom.ts:28`) via
`finalize opts.warp`; density set from freq (`bake-worker-core.ts:184`).

**TF warp NODE**: `warpMeshJS` (`warp-spline.ts:285`) rotates **positions AND
normals** by the same `[N,B,T]` frame → smooth, no re-derive, no crease hack.
Density: `densifyRevolveTree`/`densifyProfileAxial` (`execute.ts:137`,
`warp-spline.ts:623`) using curvature-adaptive `planAxialStations`
(minStations 8 / max 96); non-revolve children fall to `subdivideAxialAdaptive`
capped at `GENERIC_WARP_MAX_STATIONS = 24` (`execute.ts:100,417`).

**Divergences:**
- **Normals**: TF bends normals directly (smooth); Manifold moves positions then
  re-shades with a crease workaround → the same warp shades differently.
- **Densification frames don't match**: Manifold uses a fixed span heuristic
  (`WARP_AXIAL_MAX_ZSPAN = 1.5`); TF uses curvature-adaptive stations
  (`planAxialStations`). Different ring counts / placement → different silhouettes
  on a curved run.
- **Scene sine-warp is Manifold-only**: `scene.warpEnabled` is fed to the Manifold
  bake (`PrimitiveDualCanvas.svelte:367`) but the TF rebuild does not read it → the
  warp toggle silently no-ops on the TF tab.

---

## 6. Expressions / emit — shared graph, INDEPENDENT lowering

Both start from the SAME composition graph, but lower it **independently**:
`composition-emit.ts` → Manifold source; `graph-to-tf.ts` → `TfRecipe`. They do
NOT share the lowering, so several pieces are hand-mirrored and can drift:

| Concept | Manifold (emit) | TF (graph-to-tf) | Drift risk |
|---|---|---|---|
| consumed-set (output filtering) | `computeConsumedSet` (`composition-emit.ts:651`) | `computeConsumed` (`graph-to-tf.ts:470`) | duplicated |
| poly_repeat / loop expansion | `composition-emit-profile` generated `build(p)` | `expandPolyRepeat` numeric mirror (`graph-to-tf.ts:229`) | duplicated |
| stack_ref precedence | emit (`:219`) | `effectiveStackRef` (`:518`) | duplicated |
| txfmn = rot∘translate | emit | `lowerNode` case `txfmn` (`:787`) | duplicated |
| math namespace | `math-lib.ts` | `math-lib.ts` (`MATH_NAMES`, `:51`) | **shared ✓** |

Only the math namespace is a shared source of truth. The consumed-set, loop
expansion, and stack semantics are reimplemented in `graph-to-tf.ts` with comments
that say "mirrors composition-emit" — exactly the drift surface to watch.
`sketch` spline/fillet/chamfer are approximated as straight/sharp in TF
(`resolveSketch:296-306`), so a sketched part's TF profile ≠ its Manifold profile
by construction.

---

## Redundant / dead code

### Duplicated logic (unify candidates)
1. **`creaseAwareCornerNormals` — two copies.**
   - `render-helpers.ts:508` — adjacency by **exact position rounding**
     (`Math.round(x*1e4)`).
   - `trueform-adapter.ts:271` — adjacency by **tolerance union-find**
     (`toleranceWeldMap`, edge-length-capped) — strictly more robust.
   Both explicitly say "duplicated (not imported)" (`trueform-adapter.ts:28`).
   Same crease-aware math, two weld strategies → seams shade differently between
   backends. Could unify on the tolerance version behind a pure module.
2. **Cutaway section classification — two copies.** `manifoldToCutVC`
   (`render-helpers.ts:713-744`, heuristic) vs `sectionFaceColors`
   (`trueform-adapter.ts:86`, plane-membership). Different grey coverage.
3. **Non-indexed geometry concat.** `mergeBufferGeometries`
   (`render-helpers.ts:799`) is a private re-implementation because "no THREE
   BufferGeometryUtils bundled" — fine, but worth noting as a candidate for a
   shared util.
4. **Consumed-set + stack + loop lowering** (see §6) — three hand-mirrors.
5. **Warp densification** — `_axialMaxZSpan` (Manifold) vs `planAxialStations`
   (TF) solve the identical "enough rings to bend smoothly" problem two ways.

### Dead / stale / no-op branches
1. **Render-time warp shader is legacy and now GLB-only.**
   `warp.ts:subdivideAlongZ`/`attachWarpShader` are imported by
   `PrimitiveDualScene.svelte:42` but used ONLY on the **GLB** experiment path
   (`:440,:474,:478,:489`). The live-mesh warp is baked server-side (comments at
   `:1051,:1062` say so). Rule 25 flags `subdivideAlongZ` as a "render-time
   stopgap" — it is now dead for the primary mesh and survives only in the GLB
   toggle.
2. **`stackAxis` prop is dead.** Declared/typed (`PrimitiveDualScene.svelte:59,79`)
   and threaded through the canvas (`PrimitiveDualCanvas.svelte:938`) but its own
   doc-comment says it "no longer drives layout" (`:75`); nothing inside the scene
   reads it. Pure pass-through cruft.
3. **`extrudeProfileGrid` + `weldGridToTf` are demo-only.** The native TF extrude
   uses `tfExtrudeProfile` (`extrude.ts`); `extrudeProfileGrid`/`weldGridToTf`
   (`tf-weld.ts:142,157`) are referenced only by `tf_examples/weld_extrude_demo.ts`
   — not on any real-part path.
4. **Stale comment in `graph-to-tf.ts`.** The `NO_TF_ENGINES` branch comment
   (`:679`) still lists `r_weld_extrude` as having "no TrueForm equivalent", but
   `r_weld_extrude` is handled natively at `:578` and is excluded from the set
   (`:449`); `isEngineSrc` returns true for it at `:458`, so it never reaches that
   branch. Comment is misleading (the branch itself is live for `r_loft`/
   `r_extrude`).
5. **`colorInner` unused on the TF full arm** — passed for "call-site parity" but
   "Not read in the full arm" (`PrimitiveDualScene.svelte:108`).

---

## Prioritized fix / unify list

1. **Unify per-part transparency (HIGH · med effort).** The live transparency bug
   is that Manifold (baked RGBA vertex alpha + `splitMesh`) and TF (per-part meshes
   + `renderOrder`) use two unrelated models, and the x-ray slider only touches
   one. Minimum fix: multiply `scene.xrayOpacity` into `pOp` in the TF per-part arm
   (`PrimitiveDualScene.svelte:988,1018`) so x-ray works everywhere. Real fix:
   pick ONE transparency model (per-part meshes is the cleaner one) and have the
   Manifold path also emit `geo.parts` for composed parts, retiring
   `buildAlphaSplitGeometry`/`splitMesh`. *Why:* one bug, one code path, and it
   deletes the mixed-alpha split machinery.
2. **Feed the scene sine-warp to the TF path OR hide the toggle on the TF tab
   (HIGH · low effort).** `scene.warpEnabled` currently no-ops in TF
   (`PrimitiveDualCanvas.svelte:367` is Manifold-only). *Why:* a visible control
   that silently does nothing.
3. **Single crease-aware-normals module (MED · low-med effort).** Delete the copy
   in `render-helpers.ts:508`, import the tolerance-weld version from
   `trueform-adapter.ts:271` (or extract both to a pure `normals.ts`). *Why:*
   removes ~70 duplicated lines and makes seam shading identical across backends.
4. **Shared graph-lowering primitives (MED · med effort).** Export
   `computeConsumedSet`, the stack_ref precedence, and the poly_repeat loop
   expansion from the emit modules and have `graph-to-tf.ts` import them instead of
   re-mirroring (`:470,:518,:229`). *Why:* kills the top drift risk in §6.
5. **Converge warp densification (MED · med effort).** Have the Manifold warp path
   use `planAxialStations` (curvature-adaptive) instead of the fixed
   `WARP_AXIAL_MAX_ZSPAN` heuristic, so both backends place rings the same way.
   *Why:* same curved part currently gets different silhouettes.
6. **Delete dead code (LOW · low effort).** Drop the `stackAxis` prop
   (`PrimitiveDualScene.svelte:59,79` + canvas pass-through), fix the stale
   `graph-to-tf.ts:679` comment, and either fold the GLB render-time warp into the
   baked path or delete `warp.ts` once GLB warp is retired. *Why:* small, safe,
   reduces confusion.
7. **Unify cut-section classification (LOW-MED · low effort).** Pick plane-
   membership (TF's `sectionFaceColors`) or the Manifold heuristic and share it so
   cross-sections read identically. *Why:* consistency, minor.

---

## Executive summary (top inconsistencies + dead-code wins)

1. **One mesh vs many meshes is the fault line.** Manifold bakes ONE vertex-
   coloured combined mesh (`geo.full`, never `geo.parts`); TF emits per-part meshes
   (`geo.parts`). They hit different `PrimitiveDualScene` branches (single-mesh vs
   per-part loop), which is the root of the live transparency bug.
2. **The x-ray/opacity slider is broken on TF parts** — the per-part arm uses raw
   `a.opacity` and never multiplies `scene.xrayOpacity` (`PrimitiveDualScene.svelte:988`),
   unlike every single-mesh arm which uses `effOpacity` (`:150`).
3. **Two transparency implementations** (Manifold RGBA vertex-alpha + 2-group
   `splitMesh` vs TF per-part `renderOrder`) mean the same part can blend
   differently depending only on which tab baked it.
4. **The scene sine-warp toggle is Manifold-only** — silently no-ops on the TF tab.
5. **Warp shades and densifies differently:** TF bends normals (smooth); Manifold
   moves positions + a 180°-crease workaround; densification uses a fixed span
   (Manifold) vs curvature-adaptive stations (TF).
6. **Bore-extend defect-2 prevention lives only in TF** (`execute.ts:308`), so a
   hollow-sweep part is clean in TF but defect-2 in Manifold.
7. **Graph lowering is hand-mirrored** (consumed-set, stack_ref, loop expansion) in
   `graph-to-tf.ts` vs `composition-emit.ts` — real drift surface; only `math-lib`
   is shared.
8. **Biggest dead-code wins:** `creaseAwareCornerNormals` duplicated in two files
   (unify → ~70 LOC); the `stackAxis` prop is fully dead; the render-time warp
   shader (`warp.ts`) survives only in the GLB experiment; `extrudeProfileGrid`/
   `weldGridToTf` are demo-only; and the `graph-to-tf.ts:679` `r_weld_extrude`
   comment is stale.
