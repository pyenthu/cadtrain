# TrueForm (`@polydera/trueform@0.9.8`) — geometry-API notes

Code-adjacent reference for the **tf** engine tab. Enumerated from the shipped
type declarations (`node_modules/@polydera/trueform/dist/*.d.ts`, esp.
`manual.d.ts` which `index.d.ts` re-exports wholesale) + `README.md`. Not the
roadmap — see `docs/plans/` for that.

## What TrueForm actually is

A **mesh-processing / exact-CSG / spatial-query** library ("the STL for
geometry" — algorithms separated from data), NOT a parametric B-rep CAD kernel.
Its own tagline: *"Fast and exact mesh booleans, spatial queries, arrangements,
registration, and remeshing."* Everything operates on **triangle meshes** (or
NDArrays / point clouds / curves), backed by WASM NDArrays.

- `import * as tf from '@polydera/trueform'` — flat namespace, all ops are
  top-level functions (`tf.booleanUnion(...)`), plus `tf.async.*` mirrors that
  run off-thread.
- WASM ~31 MB, needs `tf.init()` once, and **cross-origin isolation**
  (COOP `same-origin` + COEP `require-corp`) for its SharedArrayBuffer pthread
  pool. cadtrain sets these app-wide (hooks.server.ts + a vite dev middleware).
- Coordinates are `float32` or `float64` (per-op `{ dtype }` option).

## ⛔ NOT present: revolve / sweep-profile / loft / extrude / fillet / chamfer

There is **no lathe/revolve, no profile-loft, no linear extrude, no fillet, no
chamfer** in the API. TrueForm does not build parametric solids from 2D
profiles. The only "make me a shape" functions are the fixed mesh primitives
below (+ `tubeMesh`, which is a genuine circular sweep — see ✅).

## Mesh generators (`geometry/sync`) — the parametric primitives tf DOES have

| Function | Signature | Notes |
|---|---|---|
| `boxMesh` | `(w, h, d, wTicks?, hTicks?, dTicks?, {dtype}?) → Mesh` | Centered AABB, optional subdivision |
| `sphereMesh` | `(radius, stacks, segments, {dtype}?) → Mesh` | UV sphere |
| `cylinderMesh` | `(radius, height, segments, {dtype}?) → Mesh` | Closed solid, z-axis, centered |
| `planeMesh` | `(w, h, wTicks?, hTicks?, {dtype}?) → Mesh` | Flat XY rect (open) |
| ✅ `tubeMesh` | `(curves: Curves, radius, radialSegments?) → Mesh` | **Sweep**: circular section along a polyline via parallel-transport frames (RMF). Uncapped → open ends. |
| `triangulate` | `(Mesh \| MeshLike \| Polygon) → Mesh` | Polygon → triangle mesh |

`tubeMesh` is the one real "sweep a section along a path" op — it is what the
prototype uses. Section is always a circle of `radius`; there is no arbitrary
2D section input (that would need a manual welded mesh, as in the Manifold path).

## Boolean / CSG (`cut/sync`)

| Function | Signature | Result |
|---|---|---|
| `booleanUnion` | `(m0, m1, {returnCurves}?) → {mesh, labels, faceLabels, curves?}` | A ∪ B |
| `booleanIntersection` | `(m0, m1, {returnCurves}?) → …` | A ∩ B |
| `booleanDifference` | `(m0, m1, {returnCurves}?) → …` | A − B |
| `meshArrangements` | `(Mesh[], opts?) → {mesh, tagLabels, faceLabels, curves?}` | Split all faces along mutual intersections |
| `polygonArrangements` | `(mesh, opts?) → {mesh, faceLabels, curves?}` | Decompose at self-intersections |
| `isobands` | `(mesh, scalars, cutValues, opts?) → {mesh, labels, faceLabels, curves?}` | Slice into scalar-field bands |
| `embeddedIntersectionCurves` / `embeddedSelfIntersectionCurves` | `(…) → {mesh, faceLabels, curves?}` | Embed intersection edges into a mesh |

Result meshes carry **per-face labels** (region) + **faceLabels** (origin face),
useful for inner/outer face-group coloring like the BREP path.
⚠ Booleans are exact but **not guaranteed watertight/manifold** on degenerate
inputs (coincident/tilted coplanar caps) — the known cadtrain caveat. Always
verify with the topology predicates below.

## Intersect / curves (`intersect/sync`)

`intersectionCurves(m0, m1, opts?)`, `selfIntersectionCurves(mesh, opts?)`,
`isocontours(mesh, scalars, values, opts?)` — return `Curves`.

## Topology / validity (`topology/sync`) — the watertightness toolkit

`isClosed` · `isOpen` · `isManifold` · `isNonManifold` · `eulerCharacteristic`
(V−E+F) · `boundaryEdges` · `nonManifoldEdges` · `boundaryPaths`
(→ OffsetBlockedBuffer, `.length` = # open loops) · `kRings` · `neighborhoods` ·
`connectEdgesToPaths` · `labelConnectedComponents` · `connectedComponents(m, type)`
· `consistentlyOriented` · `cdt` (constrained Delaunay) · `domainLabels`.

## Measurement / analysis (`geometry/sync`)

`area` · `signedVolume` · `volume` · `meanEdgeLength`/`min`/`max` ·
`reverseWinding` · `positivelyOriented` · `principalCurvatures` ·
`principalDirections` · `shapeIndex` · `laplacianSmoothed` · `taubinSmoothed` ·
`sharpEdges(m, angleDeg)` · registration: `fitRigidAlignment` /
`fitIcpAlignment` / `fitObbAlignment` / `chamferError`.

## Remesh (`remesh/sync`)

`decimated(m, opts)` · `isotropicRemeshed(m, opts)` · `simplified(m, opts)`.

## Reindex / split (`reindex/sync`)

`reindexed*` variants · `concatenateMeshes` · `splitIntoComponents` ·
`splitIntoDomains`.

## Spatial queries (`spatial/sync`)

`distance` · `distance2` · `closestPoint` · `closestPointPair` ·
`neighborSearch` · `intersects` · `rayCast` (all accept single primitives OR
batches OR whole meshes/forms — same function).

## IO (`io/sync`)

`readStl` / `readStlData` / `readObj` / `readObjData` / `writeStl` / `writeObj`.

## Data model

- **`Mesh`** — `.faces` (NDArrayInt32 [F,3]), `.points` (NDArray [V,3]),
  `.numberOfFaces`, `.numberOfPoints`, `.transformation` (4×4), `.shallowCopy()`,
  lazy topology (`.manifoldEdgeLink`, `.faceMembership`, …). Build with
  `tf.mesh(faces, points)`.
- **`Curves`** — polyline paths over a shared point buffer. Build with
  `tf.curves(paths: OffsetBlockedBuffer, points)`. A single open path =
  `offsetBlockedBuffer(ndarray([0,n]), ndarray([0..n-1]))`; close a loop by
  appending the first index. This is the input to `tubeMesh`.
- **`Primitive`** (point/vector/segment/triangle/ray/line/plane/aabb/polygon) —
  factories `tf.point/vector/segment/.../polygon`; transforms
  `makeTranslation/makeRotation/makeRandomRotation/inverted`.
- **`NDArray`** — WASM numeric arrays with numpy-ish ops (`take`, `booleanIndex`,
  `gt/lt/and`, `sum/min/max/mean/norm`, trig/`math`, `stack/concatenate/…`).

## How cadtrain uses it (this worktree)

`src/lib/shared/trueform-client.ts`:
- `tfDemoBox(w,h,d)` — original from-scratch box.
- `tfSweepDemo(opts)` — **sweep**: helix path → `tubeMesh` (coil/spring).
- `tfSweepCylDemo(opts)` — **sweep**: straight vertical `tubeMesh` (= r_cyl the sweep way).
- `capOpenEnds(tf, mesh)` — close a `tubeMesh`'s open ends with centroid fans →
  a CLOSED, watertight solid (`buildCappedMesh` is the pure, testable core;
  `positivelyOriented` fixes the winding outward). Both sweeps are capped by
  default so they cross-section (cutaway) like the other solids.
- `tfBooleanDemo(opts)` — **CSG**: `cylinderMesh − cylinderMesh` = bored pipe.
- `tfAnalyze(tf, mesh)` — `{closed, manifold, euler, boundaryLoops, volume, …}`
  via tf's own predicates = the watertightness verdict.
- `tfDemo(kind)` — dispatch `'box' | 'sweep' | 'boolean'`.

`PrimitiveDualCanvas` (`backend="tf"`) takes a `tfDemo` prop; `RightPane`'s TF
tab has a radio selector (sweep / boolean / box) and shows the verdict line.
