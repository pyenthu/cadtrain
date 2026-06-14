# Research — smooth shading & vertex normals on a Manifold mesh

> 2026-06-15. Spawned from the replicad/g_star "why is theirs smooth" thread.
> Question: how do we get OCCT-style smooth shading on our Manifold mesh, and
> why did a past attempt produce "funky / inverted triangles"? Investigated the
> codebase + git history (read-only Explore pass). Conclusion: **we already have
> the robust mechanism; the only missing piece was applying it to more parts.**

## TL;DR

- Smoothness in three.js is **vertex normals + smooth shading**, not a shader
  and not triangle count. (See `cad_authoring_patterns.md` §"what is our
  possibility".)
- We do NOT need hand-rolled analytic `cross(dP/du, dP/dv)` normals. Manifold's
  **`calculateNormals(3, 60)`** already bakes correct, **winding-invariant**
  per-vertex normals with a 60° crease split — `builder.ts:709` (manifoldToGeo)
  + `:769` (manifoldToCutVC).
- The "inverted triangles" was the **old** `THREE.computeVertexNormals()` path
  on a non-indexed buffer. It was diagnosed and replaced. The fix is in git.
- The only lever left is the material's **`flatShading`** flag, controlled by a
  **`smoothShade` gate** (`PrimitiveDualCanvas.svelte:354`). It only fired for a
  couple of engine ids → composed parts (which render under the *part* id) never
  smooth-shaded. **Fixed 2026-06-15:** added `r_loft` to the gate + a
  `forceSmoothShade` override the graph editor sets when the graph uses a curved
  engine (r_loft / r_weld_extrude / r_revolve).

## The pipeline (as found)

1. **Weld → indexed Manifold.** `weldAndBuild` (`manifold-mesh.ts:198`) builds
   `new Manifold(new Mesh({ numProp: 3, vertProperties, triVerts }))` — positions
   only, **indexed**. No normals at this stage (they'd be stripped anyway).
2. **Normals via Manifold.** `manifoldToGeo` / `manifoldToCutVC` call
   `manifold.calculateNormals(3, 60)` and copy the resulting per-vertex normals
   (vertProperties index 3..5) into the BufferGeometry. Indexed for `full`,
   scattered into a non-indexed buffer for `cutVC`.
3. **Serialize.** `mesh-serial.ts` carries `positions` + optional `normals` +
   `colors` + `index`. Normals ride along; only if absent does the client
   `computeVertexNormals()` (the fallback that historically misbehaved).
4. **Material.** `MeshPhongMaterial` with `flatShading` true/false. `true` =
   shader derives one normal per triangle face (ignores baked normals) → faceted.
   `false` = uses the baked smooth normals.

## Why `computeVertexNormals()` produced inverted/striped triangles

Git history (the whole arc):

- `d99aee5` "use calculateNormals" — first attempt, replaced
  `computeVertexNormals` after `toNonIndexed()`. Reverted same day (`574f155`)
  for a cutVC issue.
- `8297314` "bake manifold.calculateNormals to kill the warp-stripe artifact" —
  the keeper. Commit message: *"CSG output occasionally emits adjacent triangles
  with flipped winding. computeVertexNormals on the non-indexed buffer then
  flips alternating face normals, MeshPhongMaterial reads them as flickering
  creases … calculateNormals operates on the indexed adjacency directly, so
  winding inversions are irrelevant; the 60° sharp-angle split keeps cylinder
  caps / hex faces crisp while the flanks smooth out."*
- `5582c58` "smooth-shade live r_weld_extrude only" — added the `smoothShade`
  gate so twisted prisms drop `flatShading` and use the baked normals; their
  non-planar twisted quads otherwise sawtooth under flat shading.

**Root cause of the inversions:** `computeVertexNormals()` *infers* normals from
face geometry. On a non-indexed buffer it can't average across shared vertices,
and CSG/welded output can carry locally-flipped winding → adjacent faces get
opposed normals → black/inverted facets. `calculateNormals` *computes from the
indexed adjacency* and is winding-invariant — it sidesteps the whole class.

**Don't drop `flatShading` globally** — `8297314` regressed cube/hex (flat faces
read dull when smooth-shaded). The 60° split keeps 90° cube edges sharp, but the
preference is faceted for polyhedral parts. So: smooth for *curved* engines,
flat for *polyhedral* ones — which is what the gate encodes.

## The gap this research closed

The gate matched engine ids (`r_weld_extrude`, twisted `r_extrude`). A composed
volume part renders with `id = part id` (e.g. `g_barrel`), so the gate was blind
to the engines inside its graph → barrels/lofts rendered flat. Fix:

- `PrimitiveDualCanvas.svelte`: added `r_loft` to the gate + a `forceSmoothShade`
  prop override.
- `GraphEditorPane.svelte`: `usesCurvedEngine` derived (graph contains
  r_loft / r_weld_extrude / r_revolve Call) → passed as `forceSmoothShade`.

No new normal code, no engine change, no risk of the inversion bug — purely
flipping the material flag so the **already-correct** baked normals get used.

## Where analytic normals WOULD still matter (parked)

`calculateNormals(3,60)` is a good general solution but it's a *post-hoc* smooth
with a fixed crease angle. For a surface we know analytically (r_loft's
`P(u,v)`), emitting exact `cross(∂P/∂u, ∂P/∂v)` normals at construction would be
marginally crisper and let us choose crease behaviour per-edge. It would require
`weldAndBuild` to carry `numProp:6` and preserve them through the Manifold
round-trip. **Not worth it now** — `calculateNormals` already removes the
visible gap. Revisit only if a specific part shows a crease the 60° threshold
gets wrong.

Cross-refs: `cad_authoring_patterns.md`, `docs/plans/kernel-strategy.md`,
`docs/plans/wavy-star.md`, memory `welded_orientation_volume_sign`.
