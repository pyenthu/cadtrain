# Plan — normals smoothing for the 3D bake

> 2026-06-16. Research/plan only (read-only pass; no source touched). Sibling of
> `docs/research/smooth-shading-normals.md` (the 2026-06-15 "why is replicad's
> smooth" investigation) — that doc establishes that the mechanism already
> exists and was under-applied; THIS doc is the forward plan for the algorithm,
> the crease-angle handling, where to compute, the toggle, and perf.

## 0. State of play (what already exists — verified in code)

The faceted look is **not** missing normals. The bake already computes smooth
per-vertex normals; the open questions are (a) crease-angle correctness on
curved-vs-CSG-seam edges and (b) which surfaces the `flatShading` toggle leaves
faceted.

Pipeline as found:

1. **Weld → indexed Manifold** — `manifold-mesh.ts` `weldAndBuild` builds
   `new Manifold(new Mesh({ numProp:3, … }))`, positions only, indexed. No
   normals here (would be stripped on the round-trip anyway).
2. **Normals via Manifold** — `src/lib/graph/builder.ts`:
   - `manifoldToGeo` (`:752`) and `manifoldToCutVC` (`:801`) both call
     `manifold.calculateNormals(3, 60)` and copy vertProperties idx 3..5 into
     the BufferGeometry `normal` attribute. Falls back to
     `geo.computeVertexNormals()` only if `calculateNormals` throws or
     `numProp < 6`.
   - `calculateNormals` runs on the **indexed adjacency**, so it is
     winding-invariant — sidesteps the historic "inverted/striped triangles"
     bug (`computeVertexNormals()` on a non-indexed buffer flipped alternating
     face normals on CSG output). Keeper commit `8297314`.
3. **Serialize** — `mesh-serial.ts` carries optional `normals`; client only
   `computeVertexNormals()` if absent.
4. **Material toggle** — `MeshPhongMaterial` / `MeshStandardMaterial` with
   `flatShading={!smoothShade}`:
   - `flatShading: true` → shader derives ONE normal per triangle (ignores the
     baked attribute) → faceted. This is the **default** for most parts.
   - `flatShading: false` → uses the baked `calculateNormals(3,60)` smooth
     normals.
   - The `smoothShade` gate lives in `PrimitiveDualCanvas.svelte` (around the
     `{@const smoothShade = …}`) and is forwarded through `PrimitiveDualScene`
     to all three live `MeshPhong`/`MeshStandard` instances. It fires for
     `r_weld_extrude`, twisted `r_extrude`, `r_loft`, the BREP solid, and the
     graph-editor `forceSmoothShade` override (graph contains a curved engine).
   - GLB pane (`ComponentSceneGlb.svelte`) **strips normals + forces
     `flatShading: true`** unconditionally.

So we already have **angle-weighted-ish per-vertex normals with a 60° crease
split**, applied per-primitive. The plan below is about making that the
*correct, deliberate* behaviour rather than an id-matched special-case, and
closing the remaining gaps.

## 1. The algorithm (what "smooth normals" should be)

Reference (from knowledge — verify against the live lessons; no internet here):

- **Scratchapixel "Shading Normals" / "Introduction to Shading — shading
  lights"**: a smooth surface uses **vertex normals** = the (weighted) average
  of the face normals of the triangles sharing that vertex; the rasterizer
  interpolates them across the face (Gouraud/Phong interpolation). A *flat*
  surface uses the face normal directly (our `flatShading: true`).
- **Weighting**: the naive average over-weights regions with many small
  triangles. The two standard improvements:
  - **Angle-weighted** (Thürmer & Wüthrich): weight each face normal by the
    *interior angle* the triangle subtends at the shared vertex. Tessellation-
    independent — the right default for our welded grids where a vertex on a
    cylinder seam touches a different triangle count than one mid-flank.
  - **Area-weighted**: weight by triangle area; cheaper but biased toward large
    triangles. Acceptable fallback.
- **Crease / smoothing groups**: average a face normal into a vertex normal
  ONLY across edges whose dihedral angle is **below a crease threshold**. Edges
  above the threshold get **split vertices** (each side keeps its own face
  normal) → the edge renders hard. This is exactly a "smoothing group" / a
  per-edge `minSharpAngle`.

**`Manifold.calculateNormals(propIdx, minSharpAngle)` already implements this**:
it computes per-vertex normals, splitting vertices where the dihedral angle
exceeds `minSharpAngle` (we pass 60°). Manifold's weighting is
**angle-weighted** internally (verify against the manifold-3d source/docs — the
`CalculateNormals` impl). So the algorithm we want is the algorithm we have; the
question is the **threshold** and **where the split happens**, not whether to
hand-roll it.

**Do NOT hand-roll `THREE.computeVertexNormals()`** — it is unweighted-ish,
non-indexed in our cutVC path, and re-introduces the winding-flip artifact.

## 2. Crease handling — the real design lever

Goal: revolve / loft / weld-extrude flanks shade smoothly; CSG seams, cube/hex
edges, cylinder caps stay crisp.

- **Single global threshold (status quo): 60°.** Cube edges (90°) and
  cyl-cap-to-flank (90°) stay sharp; cylinder/loft flank facets (small dihedral)
  smooth. This is correct for almost everything and is the recommended default.
- **Known weakness**: a *coarse* revolve/loft can have flank facets whose
  dihedral approaches the threshold near tight-radius regions, or a designed
  shallow chamfer (< 60°) that the user WANTS hard could get smoothed away. The
  60° pick is a compromise.
- **Plan — make the threshold a (small) dial, default 60°:**
  - Surface a `creaseAngle` value in `scene` controls (SceneControls gear),
    default 60, range ~[20, 89]. Pass it down to the bake so
    `calculateNormals(3, creaseAngle)` uses it. This is "expose the dial, don't
    hide the constant" (memory `feedback_expose_dont_hide`).
  - Lower it (e.g. 30°) when a part's intended hard chamfers are being smoothed;
    raise it (e.g. 80°) to force more smoothing on very coarse meshes.
  - Caveat: changing the crease angle changes the **vertex split** → it MUST be
    a build-time (bake) parameter, not a render-time flip. Re-bake on change.
    Make it part of the bake cache key.
- **Per-edge / smoothing-group control (parked, Tier 3)**: only if a specific
  part needs an edge hard that the global angle gets wrong. Would require
  carrying explicit edge/smoothing-group tags through the weld → Manifold
  round-trip (`numProp` extension). Not worth it now — note the part if it
  appears.

## 3. Where to compute — build-time vs render-time

| Stage | What | Verdict |
|---|---|---|
| **Build-time, in Manifold** (`calculateNormals` in `builder.ts`) | smooth normals + crease split baked into vertProperties → serialized | **KEEP — this is the home.** Indexed-adjacency, winding-invariant, crease-aware. The vertex split for the crease MUST happen here. |
| **Build-time, in the weld builders** (`manifold-mesh.ts`, `numProp:6`) | emit analytic `cross(∂P/∂u, ∂P/∂v)` normals at construction for surfaces we know parametrically (r_loft `P(u,v)`) | **Parked.** Marginally crisper, lets us choose crease per-edge, but needs the weld to carry `numProp:6` through the round-trip. Revisit only if `calculateNormals` shows a visible crease error. |
| **Render-time, in Three** (`flatShading` flag) | choose to USE or IGNORE the baked normals; no recompute | **KEEP for the on/off toggle only.** It cannot smooth more than the bake split allows — it can only fall back to per-face. |
| **Render-time recompute** (`computeVertexNormals`) | infer normals from positions in Three | **AVOID** — only the absent-normals fallback path. Reintroduces the inversion bug on CSG/cutVC. |

**Rule (matches CLAUDE.md Rule 25 spirit):** segmentation AND normal/crease
computation belong at **build time**. The render layer only toggles between
"use baked smooth normals" and "derive flat per-face." Do not post-process the
baked Manifold's MeshGL to re-smooth (the warp-subdivide OOB-crash lesson,
`3fb1fa8`).

## 4. The toggle — make it a real, visible control

Today `smoothShade` is computed (id-matched gate + `forceSmoothShade`). Plan:

1. **Promote to a user toggle**: a "Smooth shading" checkbox in SceneControls
   (the gear), defaulting to the current auto-gate value. Stored on `scene`.
   - When the user hasn't touched it → auto (curved engines smooth, polyhedral
     flat — the existing heuristic).
   - When toggled → override the heuristic for the open part.
2. **Decouple the two knobs**:
   - `smoothShade` (bool) = render-time `flatShading` flip. Cheap, no re-bake.
   - `creaseAngle` (deg) = build-time split. Re-bake, cache-keyed.
3. **Keep the auto-default**: polyhedral parts (cube/hex/cuboid) stay
   `flatShading: true` even with smooth normals baked — flat faces read dull
   when smooth-shaded (the hard-won `8297314` regression). The auto-gate is the
   right default; the toggle is the escape hatch.
4. **GLB pane stays flat** unless we decide to carry normals into the GLB export
   (currently stripped). If we want the GLB tab to match the smooth live mesh,
   stop deleting the `normal` attribute in `ComponentSceneGlb.svelte` and gate
   its `flatShading` on the same `smoothShade` — separate small change, note it.

## 5. Performance

- `calculateNormals` **scales super-linearly** — `builder.ts:602` comment
  records 30k tris → 204 ms, and the build is deliberately structured to do ONE
  pass over the whole composed manifold (not per-part). Implications:
  - Crease-angle changes force a re-bake → respect the bake cache
    (`src/lib/server/bake-cache.ts`); add `creaseAngle` to the key so a change
    doesn't silently reuse a stale normal set, but an unchanged value is a cache
    hit (no recompute).
  - The render-time `smoothShade` flip is **free** (material flag) — make the
    on/off toggle render-time so the common case never re-bakes.
  - For stacks/instanced assemblies, normals are computed on the canonical child
    once then instanced (`builder.ts` canonical path) — preserve that; do NOT
    move normal computation into the per-instance loop.
- Triangle budget is the other smoothness lever (more segments → smaller facets
  → smaller dihedral → smoother even at flat shading). Already exposed as the
  `segments`/`divs` dials. Smoothing normals is the **cheap** win; cranking
  segments is the expensive one. Prefer normals first.

## 6. Concrete step list (if/when built)

1. Add `creaseAngle` (default 60) + `smoothShade` (default = auto) to the
   `scene` controls object and SceneControls UI.
2. Thread `creaseAngle` into the bake call so `manifoldToGeo`/`manifoldToCutVC`
   use `calculateNormals(3, creaseAngle)`; add it to the bake-cache key.
3. Thread the user `smoothShade` override through `PrimitiveDualCanvas` →
   `PrimitiveDualScene` (already plumbed as a prop) so it wins over the auto-gate.
4. (Optional) match the GLB pane: keep normals + gate its `flatShading`.
5. Verify per CLAUDE.md: bake a revolve (e.g. `g_shaft`), a loft (`g_barrel`),
   a cube, and a CSG-seam part; confirm flanks smooth, seams/caps/cube-edges
   crisp; report verts + z-extent. Re-bake clean on `:3333` if a `/preview` 400
   flood appears (corrupted WASM singleton — restart, don't use the in-app
   button).

## 7. What to verify (no internet this pass)

- The exact weighting `Manifold.calculateNormals` uses (angle- vs area-weighted)
  — read manifold-3d's `CalculateNormals` source.
- Scratchapixel "Shading Normals" + "Shading — lights" lessons for the canonical
  angle-weighted-average + crease-angle write-up to cite.
- Whether 60° is the best default across the current part catalog (eyeball a
  coarse loft and a designed shallow chamfer).

Cross-refs: `docs/research/smooth-shading-normals.md`,
`docs/plans/kernel-strategy.md`, `src/lib/graph/CLAUDE.md` §Rendering +
"Non-planar twisted quads", memories `flatshading_twisted_quad_smoothshade_gate`,
`welded_orientation_volume_sign`, `feedback_expose_dont_hide`.
