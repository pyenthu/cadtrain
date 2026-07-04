# Curvature-adaptive axial subdivision for the warp

**Status:** DEEP TODO (parked exploration, 2026-07-04). Task #4.
**Rule:** extends project **Rule 25** (warp/segmentation resolution is a BUILD-TIME
axial-Z concern, never a post-bake MeshGL rewrite).

## ✅ CHOSEN APPROACH (decided WITH the user, 2026-07-05)

> **Warp step (PURE JS): curvature-adaptive axial subdivision → bend positions by
> the frame → bend the NORMALS by the same frame → smooth shading preserved, no
> slivers, no faceting.**

The refinement lives in **the warp step**, not the revolve — because the warp is
the only stage that knows the spline's curvature, and it must work for ANY solid
(not just revolves). It is done in **pure JS on the extracted mesh** (SVTC's
model), NOT via `Manifold.warp` + `refine`:

1. **Extract** the solid's `position` + `normal` arrays (plain typed arrays).
2. **Curvature-adaptive axial subdivision** — insert rings ONLY along Z, denser
   where the spline's local curvature is high (see the math below). This replaces
   Manifold's uniform `refine(n)` (the n² bloat + inside-bend slivers).
3. **Bend positions** by the local frame: `p = at(z) + x·N + y·B`.
4. **Bend normals** by the SAME frame rotation (the orthonormal `[N,B,T]` basis).
   This is the "interpolation of normals" — the pre-warp SMOOTH normals stay
   smooth AND the pre-warp SHARP edges stay sharp; they just rotate along the
   bend. NO `calculateNormals(crease)` re-derive (which crease-SPLITS the coarse
   axial chords → the faceting the user saw), NO `computeVertexNormals` smooth-all
   (which would flatten intentional creases).

**Why pure JS is forced:** `Manifold.warp` moves POSITIONS ONLY, then the pipeline
always ends in `calculateNormals(3, 60)` — the 60° crease splits the warp's axial
chords → faceted. You cannot carry normals through the Manifold path. SVTC proves
the JS path is fast (it warps a `THREE.BufferGeometry` vertex array directly).
(SVTC ends with `computeVertexNormals()` — smooth-all, fine for plain tubes; we do
the frame-rotate variant to preserve intentional creases.)

**Downstream implication — the cutaway.** If the warp returns a PLAIN mesh (not a
Manifold), the half-section cutaway can no longer be a Manifold CSG boolean → it
becomes a **clip-plane** (the wells-plan `svtc-section-cutaway.md` direction). So:
**warp → plain mesh with frame-bent normals; cutaway → clip-plane, not boolean.**

**Secondary/legacy:** the `r_revolve axisPath` path (below) builds a deviated tube
with axial rings at BUILD time and is still the right thing for a *directly*
deviated well tube (no separate warp node). The two could later unify by lowering
a warp-node-over-a-revolve into `r_revolve(axisPath)`. But the CHOSEN general fix
for the warp NODE (bend an arbitrary solid) is the pure-JS warp step above.

## The idea (one line)

Subdivide a part **along the spline** in proportion to the spline's **local
curvature** — more axial rings where it bends sharply, fewer on straight runs —
so a warped solid is smooth **and** cheap (no uniform refine, no inside-bend
slivers).

## Why (what's wrong today)

Two independent resolutions meet in the warp (`src/lib/cad/warp-spline.ts`):

- **Spline subdivision = the PATH.** `catmullRomDense(cp)` makes a dense polyline
  + arc-length table; `at(s)` samples position + frame at ANY `s`. Effectively
  continuous — **not** the bottleneck.
- **Mesh axial subdivision = the SOLID's Z-rings.** The warp callback places
  **each vertex** on the spline (`pos = at(z) + x·N + y·B`); the triangle edges
  BETWEEN rings stay straight **chords**. So the visible smoothness is governed
  by the **ring count along Z**, not the spline.

A `r_revolve` cylinder has ~2 rings → the bend is ~1 chord → faceted. The warp
compensates with Manifold's **uniform `refine(n)`** (circumferential too — n²
bloat) which also **collapses inside-bend triangles into near-zero-area slivers**
(the 960 / 7,584 "stray" counts on `w1_oh_warp`).

**SVTC does it right and is fast** (`~/code/SVTC/.../threeD/manifoldCut.js`):
it builds the body as a parametric `THREE.CylinderGeometry(r, r, td, 128, rings)`
— axial `rings` chosen up front — and warps by **pure-JS vertex remap** on the
`position` Float32Array (no Manifold, no CSG, no refine in the warp). The only
Manifold call is the ONE cutaway boolean. Build-time rings + JS warp = smooth,
no slivers, fast.

## What already exists (build on it, don't rebuild)

`r_revolve(profile, segments, zSegments?, axisPath?)`
(`src/lib/cad/stdlib/r_revolve.ts`) ALREADY does build-time axial rings on the 2D
profile before revolving (Rule 25):

- `axisPath` = a deviated well trajectory (`[z,dx,dy]` knots); each ring's centre
  is sheared by the path at its z (planar shear, radius preserved, caps
  axis-perpendicular). This is the SVTC-style "build the deviated tube directly"
  path — **no post-warp refine**.
- BUT the ring count + placement are **UNIFORM + length-based**:
  - auto `zSegEff = max(32, min(256, ceil(pathLen)))` (line ~139),
  - even spacing `maxZSpan = span / zn`; each profile edge gets
    `ceil(|Δz| / maxZSpan)` collinear inserts (lines ~164–177).

So the machinery to insert axial rings exists — this TODO makes **where** it
inserts **curvature-driven** instead of uniform.

## The math

Treat the trajectory centre as `c(z) = [dx(z), dy(z), z]` (from `axisPath`, or the
warp spline). Local curvature `κ(z) = |c′ × c″| / |c′|³` (finite-difference the
knots, or evaluate the Catmull-Rom analytically). Radius of curvature `R = 1/κ`.

**Chord (sagitta) tolerance → spacing.** A chord over axial step `Δz` on an arc of
radius `R` has sagitta `≈ (Δz)² · κ / 8`. Hold sagitta ≤ ε:

```
Δz(z) ≤ sqrt( 8 · ε / κ(z) )      // high curvature ⇒ small Δz ⇒ dense rings
```

Clamp: `Δz ∈ [minSpacing, maxSpacing]` (straight runs get a baseline ring every
`maxSpacing`; a cusp can't demand infinite rings). `ε` is a fraction of the part
radius (e.g. `ε = 0.02·r`) so the tolerance auto-scales with part size.

**Two fidelity levels:**
1. **Curvature-driven COUNT (easy).** Keep even spacing but set
   `zn = Σ turningAngle / Δθ_max` (+ a length baseline), so a curvy path gets many
   uniform rings, a straight one few. ~5-line change to the `zSegEff` auto-pick.
2. **Curvature-driven PLACEMENT (ideal — the ask).** Walk z from `zmin`→`zmax`
   accumulating turning angle / applying `Δz(z)`; drop a ring wherever the
   accumulated angle ≥ `Δθ_max` OR spacing ≥ `maxSpacing`. Rings CLUSTER at the
   kink, sparse on the straights. Requires the profile densifier to insert at
   **non-uniform** z (today it's uniform `maxZSpan`).

## Where it plugs in

- **Primary: `r_revolve` axial densifier** (lines ~130–180). Replace the uniform
  `zSegEff` (from length) + even `maxZSpan` inserts with the curvature-adaptive
  placement above, driven by the `dev` path's local curvature. This is the clean,
  SVTC-aligned path: the deviated tube is BUILT with the right rings — the warp is
  then a rigid per-ring shear, no `refine`, no slivers. Covers `w_*` wells + any
  `r_revolve(..., axisPath)` part.
- **Secondary: the warp NODE** (`warpSpline` on an ARBITRARY built solid,
  `warp-spline.ts`). Harder — the child mesh is already baked, so there's no 2D
  profile to densify. Options:
  - (a) **Re-parametrize the child**: when the child is a revolve, the warp passes
    its spline down as the child's `axisPath` + a curvature-derived `zSegments`
    so the child rebuilds at the right density (couples warp → child param).
  - (b) **Curvature-adaptive axial-only mesh subdivision** at warp time — slice
    the mesh ONLY along Z at the curvature-adaptive z-stations (a clean version of
    SVTC's `subdivideAlongZ`, replacing Manifold's uniform `refine`). General but
    a custom mesh op.
  - (c) **SVTC route**: build the warped part as parametric THREE geometry
    directly (heightSegments + JS warp), bypassing Manifold for warped parts —
    fastest, but abandons the Manifold pipeline for those parts.
  Recommendation: do the PRIMARY (r_revolve `axisPath`) first — it already builds
  deviated tubes cleanly; unifying the warp node onto it (option a) is the follow.

## Open questions

- Curvature from a **piecewise-linear** `axisPath` is impulses at knots — smooth
  it (Catmull-Rom, like the spline) before computing κ, or place extra rings in a
  window around each knot.
- Interaction with the **cutaway** (the deviated tube is then half-section CSG):
  more rings ⇒ bigger CSG. Cap `maxSegments` (256 today) still applies.
- Does the curvature-adaptive count need to also raise **circumferential**
  `segments` on tight bends (the inside compresses)? Probably not — the section
  stays a true circle under planar shear; only the axial chords facet.
- Per-part `ε` vs a global tolerance dial (expose as a param? Rule "expose dials").

## References

- Rule 25 (build-time Z-segmentation) — root `CLAUDE.md`.
- `src/lib/cad/warp-spline.ts` — `warpManifoldAlongSpline`, `splineSampler`,
  `spline3DFrames` (the current uniform-`refine` warp).
- `src/lib/cad/stdlib/r_revolve.ts` lines ~92–210 — the `axisPath` deviated tube +
  uniform axial densifier (the primary integration point).
- SVTC `~/code/SVTC/src/lib/apps/wson/threeD/manifoldCut.js` `warpGeometry` +
  `Wson3DScene.svelte` `CylinderGeometry(r, r, len, 48, heightSegs)` — the fast
  build-time-rings + pure-JS-warp reference.
- Memories: `svtc_warp_3d_function`, `stack_cutaway_perf_root_cause`,
  `bench_extrude_findings`.
