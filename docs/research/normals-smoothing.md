# Normals smoothing for the 3D bake — design (SHIPPED)

> 2026-06-16 plan; **built since** — `creaseAngle` + `smoothShade` are now real
> dials (grep: `SceneControls.svelte`, `scene-state.svelte.ts`, `bake-cache.ts`
> key, `/api/primitives/preview`, both engines). Sibling of
> `smooth-shading-normals.md` (the 2026-06-15 investigation that established the
> mechanism already existed + shipped the `r_loft`/`forceSmoothShade` gate). This
> doc is the durable *why* behind the crease-angle + build-vs-render split.

## The mechanism (not "missing normals")

The bake computes smooth per-vertex normals; the only open levers were the
**crease angle** and **which surfaces stay faceted**.

- **`Manifold.calculateNormals(3, 60)`** (in `builder.ts` `manifoldToGeo`/
  `manifoldToCutVC`) computes angle-weighted per-vertex normals on the **indexed
  adjacency**, splitting vertices where the dihedral exceeds `minSharpAngle`
  (60°). Indexed ⇒ **winding-invariant** — it sidesteps the historic
  "inverted/striped triangles" bug (`computeVertexNormals()` on a non-indexed
  buffer flips alternating face normals on CSG output; keeper commit `8297314`).
  Falls back to `computeVertexNormals()` only if it throws or `numProp < 6`.
- **Do NOT hand-roll `THREE.computeVertexNormals()`** — unweighted, non-indexed
  in the cutVC path, and it re-introduces the winding-flip artifact.

Smooth-normals algorithm, for the record: vertex normal = interior-**angle-
weighted** average (Thürmer & Wüthrich — tessellation-independent, the right
default for welded grids) of the face normals of adjacent triangles, averaged
**only across edges below the crease threshold**; edges above it split the vertex
so the edge renders hard (a "smoothing group"). `calculateNormals` already
implements exactly this.

## Two decoupled knobs

| Knob | Stage | Cost | Meaning |
|---|---|---|---|
| **`smoothShade`** (bool) | render-time `flatShading` flip | free (material flag) | use the baked smooth normals vs derive one flat normal per face. Default = auto-gate: **curved** engines (`r_weld_extrude`, twisted `r_extrude`, `r_loft`, `r_revolve`, BREP) + graph-editor `forceSmoothShade` smooth; **polyhedral** (cube/hex/cuboid) stay flat (flat faces read dull smooth-shaded — the `8297314` regression). User toggle overrides the gate. |
| **`creaseAngle`** (deg, default 60) | build-time vertex split in `calculateNormals(3, creaseAngle)` | **re-bake** — in the bake-cache key | 60° keeps cube edges (90°) + cyl caps sharp while flanks smooth. Lower (~30°) to keep a designed shallow chamfer hard; raise (~80°) to force smoothing on a coarse mesh. |

**Rule (CLAUDE.md Rule 25 spirit):** segmentation AND crease/normal computation
belong at **build time**. Render only toggles use-baked vs flat; never
post-process the baked Manifold's MeshGL to re-smooth (the warp-subdivide
OOB-crash, `3fb1fa8`). Because `creaseAngle` changes the **vertex split**, it
must be a bake param + cache key — an unchanged value is a cache hit (no
recompute); the `smoothShade` flip is free.

## Performance

`calculateNormals` scales **super-linearly** (`builder.ts:602`: 30k tris ≈ 204 ms)
and runs ONE pass over the whole composed manifold — for stacks/instanced
assemblies it runs on the canonical child once, then instances; do NOT move it
into the per-instance loop. Triangle budget is the other lever (`segments`/`divs`
→ smaller facets → smoother even flat), but normals are the **cheap** win — prefer
them over cranking segments.

## Parked

- **Analytic construction-time normals** (`numProp:6`, exact `cross(∂P/∂u, ∂P/∂v)`
  for surfaces we know parametrically, e.g. `r_loft P(u,v)`): marginally crisper +
  per-edge crease control, but needs the weld to carry normals through the
  Manifold round-trip. Revisit only if `calculateNormals(3,60)` shows a visible
  crease error.
- **GLB pane** strips normals + forces `flatShading:true`; match the live mesh
  only if the GLB tab needs to.

Cross-refs: `smooth-shading-normals.md`, `docs/plans/kernel-strategy.md`,
`src/lib/graph/CLAUDE.md` §Rendering, memories
`flatshading_twisted_quad_smoothshade_gate`, `welded_orientation_volume_sign`,
`feedback_expose_dont_hide`.
