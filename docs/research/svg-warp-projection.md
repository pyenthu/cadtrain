<!-- research-group: Node editors -->

# SVG projection of warped/deviated parts — perpendicularity + the three options

**Status:** RESEARCH (open) · **Date:** 2026-07-28 · **Asked by:** user (screenshot:
a deviated tube whose walls shear / lose perpendicularity to the local axis as it bends).

## The symptom

On the SVG tab, a **warped/deviated** part renders **sheared**: the tube walls and
cross-sections do not hold a constant perpendicular width to the local trajectory
tangent — they flatten/foreshorten wrong as the tube bends. The straight top reads
fine; the bent section is distorted.

## Root cause (confirmed in code)

`PrimitiveSvgView` projects the **warped 3D MESH** and applies the world-space
exaggeration **`[sX, sX, sZ]` AFTER the bend**:

- `src/lib/shared/svg/svg-emit.ts:353` — `p.set(x*sX, y*sX, z*sZ).project(camera)` (per vertex).
- `src/lib/shared/svg/PrimitiveSvgView.svelte:267` — `const sX = scene.xScale, sZ = scene.zScale;`
- `src/lib/shared/svg/svg-camera.ts:69-74` — the ortho frustum is sized by the same `sX`/`sZ`.

A world-axis **anisotropic** scale on **already-bent** geometry shears the
cross-sections. This is the **same class of bug** plan **#999** fixed for the 3D
MF/TF/BREP render — there the fix was: for a warped part the render group uses the
**identity** view scale (`hasWarp ? 1 : xScale`) and the exaggeration is baked
**PRE-frame** into the warp (`xDiaScale`/`yScale`, scaled in the local section
before it lands on the spline frame). **The SVG projection path never got that fix.**

## How wellnew + SVTC keep walls perpendicular (the reference)

Both share a **min-curvature arc + quaternion-slerp** trajectory core (SVTC is a port
of wellnew). The geometric fact both exploit: an arc's **pivot→point radius is always
⊥ its tangent**.

**3D warp (SVTC's "good" one — parallel-transport / RMF):**
`SVTC .../threeD/manifoldCut.js:137-242` `warpGeometry`: sample the centerline, build a
**rotation-minimizing frame** via **Rodrigues** parallel transport (zero drift on
straight runs), place each vertex at `centerline(MD) + x·right + y·up` — the section
lands in a frame that is ⊥ tangent **by construction**. `diaScale` is baked into the
section **radius in the straight local frame BEFORE the warp** (`cutCylinder(...,
bitSize*diaScale/2)` then `warpGeometry`), never world-space after. They **abandoned**
the per-vertex azimuth-recovery warp (`dirWarp3D`, `direction.ts:91-139`, dead) because
`acos` recovers a spurious **90° twist** on vertical sections at the kickoff.

**2D schematic (the clean tube — NEVER a projected mesh):**
`SVTC .../wsonRender.js`: project only the **centerline** to 2D (`dirWarp`), compute
the **perpendicular to the projected 2D tangent per station** (`getPerpendicular2D`,
`:62-76` — slerp normal, `tangent = cross(normal, rotAxis)`, project, rotate 90°), then
draw two offset walls: `txPoint = centerline + perp · offM`, `offM = |xInches ·
(diaScale/yScale)|` (`:97-114`); `buildDirPath` walks stations emitting left/right walls
(`:117-126`). **The diameter exaggeration is a SCALAR magnitude along a per-station
perpendicular** → constant-width, never sheared. wellnew ties the offset to the arc
radius instead (`R∓x` on concentric arcs, `Direction.svelte.ts:97-116` + warpjs
`Canvas.svelte.ts`/`mixinCurveTrack.js`) — same guarantee, from the arc geometry.

**The load-bearing difference:** they never let a world-axis stretch touch the
cross-section — the offset direction is **recomputed per station from the local
tangent**. Projecting a warped 3D mesh + world-scaling it (what we do) is exactly what
neither reference does.

## The three options

### Option 1 — fix the existing mesh→SVG projection (extend #999) — SURGICAL
For a warped part, use **identity** `sX=sZ=1` in `svg-camera` + `projectScene` (the
exaggeration is already baked into the warp geometry, same as the 3D pane). Needs
`PrimitiveSvgView` to know `hasWarp` — it currently receives only `meshJson`, not
`source`, so thread `source` (or a `hasWarp` prop) from `RightPane` and detect the warp
(regex `resampleSpline([[…]])`, mirroring `PrimitiveDualCanvas.warpSplineCp`).
- **Pros:** surgical; keeps TRUE VECTOR output + the existing silhouette/crease/shading
  pipeline; directly fixes the reported shear. Cheap.
- **Cons:** still a **mesh projection** — a technical elevation of the real 3D deviation
  (foreshortening, elliptical caps), NOT a flattened well-diagram schematic. To also get
  the radial exaggeration on the SVG, the SVG's `/preview` bake must pass `warpViewScale`
  so `xDiaScale` is baked pre-frame (verify: today the SVG `/preview` may bake radial=1).

### Option 2 — an `SVG_BASIC` tab: schematic from centerline + offset walls — the wellnew/SVTC model
A **new right-pane tab** that does NOT project a mesh. Draw the part from its
**centerline** (the warp spline) + a **per-station radius**, with walls offset ⊥ the
**projected 2D tangent** (replicate `getPerpendicular2D` + `txPoint` + `buildDirPath`).
Each completion element gets a 2D symbol/silhouette (cadtrain already has
`CompJsonSilhouette.svelte` for the vocab tab — the SVTC compjson half-section as inline
SVG — reuse it per part).
- **Needs a 2D representation PER PART** (centerline + section profile). For **tube-like /
  well elements** (od/id/top/bot) this is trivial — and cadtrain **already does it** in
  `src/lib/wells/wson-2d.ts` (`computeWson2D`: mirrored casing/oh/tubing rects + a deviated
  centreline/body polyline; the fast 2D well-schematic default). For **arbitrary** CAD
  parts a 2D constructor is a real cost — only worth paying for tube/swept/completion parts.
- **Pros:** clean, constant-width, perpendicular; the "well diagram" look; **far cheaper**
  than triangulating + projecting a warped mesh.
- **Cons:** per-part 2D constructor; natural only for tube/swept parts; two representations
  to keep in sync (3D geom fn + 2D schematic constructor).

### Option 3 — drop the SVG; take a HIGH-RES SNAPSHOT of the ortho 3D view (user idea)
Don't project anything by hand. Point the existing 3D scene's `OrthographicCamera` dead-on
(the same technical-elevation view the SVG tab uses), render it at **high DPI**, and capture
the canvas as a raster image (`preserveDrawingBuffer: true` is already set for thumbnails —
`engines/manifold/CLAUDE.md`; so a `canvas.toDataURL`/render-target grab at 2–4× is trivial).
- **KEY ADVANTAGE — it rides the ALREADY-CORRECT 3D render.** #999 already fixed the warp
  perpendicularity in the 3D pane (identity render-group scale + pre-frame `xDiaScale`), so
  a snapshot of the ortho 3D view is **perpendicular/un-sheared by construction** — it
  **sidesteps the projection bug entirely** rather than re-deriving (or re-introducing) it.
- **Pros:** the simplest possible correct 2D image; **zero** projection/shading/outline code
  (could retire ~1000 lines); pixel-perfect match to the 3D tabs; no per-part 2D constructor.
- **Cons:** **RASTER, not vector** — loses the scalable, editable, true-edge `<path>` outline
  that is the entire reason an SVG tab exists; resolution-bound; not a clean flattened
  schematic (still the true 3D deviation, just a correct image of it). Fine as a
  "correct 2D image / export," not as a vector-diagram or schematic replacement.

## Recommendation

The choice splits on **do you need VECTOR output** (scalable, editable, clean true edges —
the reason an SVG tab exists) or just a **correct 2D image**:

- **Need vector, want it now:** **Option 1** for the generic SVG tab — surgical, directly
  fixes the reported shear, preserves vector output (extend the #999 pre-frame rule into the
  SVG path).
- **Need a clean SCHEMATIC (the well-diagram look):** **Option 2 as `SVG_BASIC`** for the
  well / tube-like parts — offset walls ⊥ the projected tangent; reuse `CompJsonSilhouette` +
  the `wson-2d.ts` precedent; pay the per-part-2D cost only for tube/swept/completion parts.
- **Just want a correct 2D IMAGE, cheapest:** **Option 3** (high-res ortho snapshot) — it
  rides the already-fixed 3D render so it's un-sheared for free and deletes the hand-rolled
  projection; accept raster (no scalable vector/edges).

**Pragmatic path:** ship **Option 1** now (it un-shears the current vector SVG for ~a prop +
a scale gate), keep **Option 3** in mind as a near-free "correct image/export" if the vector
outline stops being worth its complexity, and build **`SVG_BASIC` (Option 2)** as the real
well-schematic view where the diagram look matters.

## `SVG_BASIC` tab — design sketch (if Option 2)
- Register an `SVG_BASIC` `RightPaneTab` (like the existing `SVG`, `B·SVG` tabs;
  `embed-config.ts` + a lazy body in `RightPane.svelte`).
- Input: the part's warp spline (centerline) + per-element `{od, id, top, bot}` (well graph)
  OR a part-provided 2D section. Project the centerline to 2D (ortho, Z-down), sample
  stations, compute the ⊥-to-projected-tangent unit vector per station, emit offset-wall
  `<path>` polylines at `centerline ± perp·(radius·diaScale)`. Completion symbols via
  `CompJsonSilhouette` placed + oriented along the centerline.
- Reference files: SVTC `src/lib/apps/wson/wsonRender.js` (`getPerpendicular2D`/`txPoint`/
  `buildDirPath`) + `threeD/direction.ts`/`profile.ts`; wellnew `ts/Direction.svelte.ts` +
  `components/svgs/PlotTrack/mixinCurveTrack.js`; cadtrain `src/lib/wells/wson-2d.ts` +
  `src/lib/shared/svg/CompJsonSilhouette.svelte`.

Cross-ref: `/plan` #985 (SVG smooth shading), #990 (BREP_SVG), #999 (warp perpendicularity,
the 3D-render precedent), memory `warp_radial_scale_before_warp`.
