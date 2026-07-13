<!-- research-group: Geometry kernels -->

# BREP → SVG boundary projection (true edges, not triangle soup)

**Status:** SHIPPED (first cut) — `src/lib/engines/brep/svg/brep-to-svg.ts` +
`.../svg/tests/brep-to-svg.test.ts`. The RightPane `BREP_SVG` tab is **NOT** wired
here (graph-editor UI, left to the parent).
**Date:** 2026-07-13 · **Kernel:** OCCT (replicad / `replicad-opencascadejs`).

## Goal

Project the BREP's **true boundary** — exact analytic faces + edges — to 2D SVG
`<path>`/`<polyline>` geometry, **not** a projected triangle soup. A revolved
cylinder must come out as a handful of outline segments (two silhouette lines +
two cap edges), never the ~hundreds of triangles its tessellation contains. This
is the boundary-surface complement to the **mesh-shading** task (`/plan #985`):
that one Lambert-shades the *tessellated mesh*; this one shades **regions bounded
by real edges**.

## The binding actually in use

`src/lib/engines/brep/brep-occt.ts` runs OCCT **in Node** through replicad's
`replicad-opencascadejs` build (`replicad_single.{js,wasm}`, loaded via a dynamic
import with `wasmBinary` handed in — see `ensureOC()`), wired into replicad's
global with `setOC(OC)`. Solids are produced two ways:

- `revolveBrep(profile, opts)` — draws the closed `(r,z)` half-section in the
  `XZ` plane (`draw(...).lineTo(...).close().sketchOnPlane('XZ')`) and `.revolve()`s
  it — the exact surface of revolution. Returns a **tessellated** `BrepMesh`.
- `brepFromSource(source, params, opts, fetchFn)` — the full graph→OCCT executor:
  runs an emitted part body with OCCT-backed engines (`r_revolve`/`r_weld_extrude`/
  `r_loft`/`r_cuboid`/`r_sweep`) + booleans (`.add→.fuse`, `.subtract→.cut`,
  `.intersect`, `mv→.translate`, `rot→.rotate`), then meshes.

Every solid handed around is a **replicad `Shape`** (a `WrappingObj` around a raw
`TopoDS_Shape`). Two escape hatches into raw OCCT exist and matter here:

- `getOC()` (exported by replicad) → the raw `OpenCascadeInstance`.
- `shape.wrapped` → the raw `TopoDS_Shape` the wrapper holds.

**Singleton hygiene (Rule 25 / memory `manifold_trap_poison` twin for OCCT):** the
OCCT WASM heap is a shared singleton. An emscripten/OCCT abort throws a **bare
numeric heap pointer**; `brepFromSource` detects that (`typeof e === 'number' ||
/^\d+$/`) and calls `resetOC()` so the next bake re-inits a fresh instance. Any new
BREP code that can trip an OCCT abort must be catchable and must not leave the
singleton poisoned. This is the single biggest reason we prefer replicad's
**managed** HLR wrappers over hand-rolled raw `HLRBRep_*` object juggling.

## Approach — OCCT hidden-line removal (HLR)

The right tool for "true visible edges of a projected B-rep" is OCCT's **hidden-line
removal**: feed it the shape + a projection direction, and it returns the visible
(and, if asked, hidden) **edges as 2D curves** — silhouette/outline + sharp edges +
smooth-crease (`Rg1`) lines, with occluded parts removed. Per-face analytic
normals then give a Lambert fill of the regions those real edges bound — the exact
antithesis of projecting triangles.

The raw OCCT pipeline is:

```
HLRBRep_Algo algo;                       // (or HLRBRep_PolyAlgo — polygonal, faster/rougher)
algo.Add(shape, nbIso);
algo.Projector(HLRAlgo_Projector(ax2));  // ax2 = eye frame (view dir + up)
algo.Update();  algo.Hide();
HLRBRep_HLRToShape toShape(algo);
TopoDS_Compound visible = toShape.VCompound();       // visible sharp edges
                       + toShape.OutLineVCompound()  // visible silhouette/outline
                       + toShape.Rg1LineVCompound(); // visible smooth-crease lines
TopoDS_Compound hidden  = toShape.HCompound(); ...    // hidden equivalents
```

### ⚠ Availability — VERIFIED PRESENT (both raw and managed)

Grepped `node_modules/replicad-opencascadejs/src/replicad_single.d.ts`:

- **Raw HLR classes are exposed** (37 `HLRBRep_*` mentions): `HLRBRep_Algo`
  (ctors `_1.._4`), `HLRBRep_InternalAlgo` (carries `Projector_1`, `Update`,
  `Hide_1`), `HLRBRep_HLRToShape` (`VCompound_1`, `OutLineVCompound_1`,
  `Rg1LineVCompound_1`, `HCompound_1`, …), `HLRAlgo_Projector` (ctors `_1.._5`;
  `HLRAlgo_Projector_2(gp_Ax2)` is the convenient one), plus `gp_Ax2`/`gp_Trsf`/
  `gp_Dir`. So the raw pipeline *is* buildable.
- **replicad also ships a MANAGED HLR wrapper** (verified as runtime exports in
  `node_modules/replicad/dist/replicad.js`, not just `.d.ts`):
  - `drawProjection(shape, ProjectionPlane | ProjectionCamera)` → `{ visible: Drawing, hidden: Drawing }` — runs the full HLR internally.
  - `makeProjectedEdges(shape, camera, withHiddenLines?)` → `{ visible: Edge[], hidden: Edge[] }` — lower-level.
  - `ProjectionCamera(position?, direction?, xAxis?)` and `lookFromPlane(plane)` (`"front"`/`"top"`/`"XZ"`/…) build the eye frame.
  - `Drawing.toSVGPaths()` (→ `string[]` of path `d` data), `Drawing.toSVGViewBox(margin)`, `Drawing.toSVG(margin)`, `Drawing.toSVGPathD()` — Drawing → SVG **directly**.

**Because HLR is available AND replicad wraps it in managed, self-cleaning
`Drawing` objects, the shipped exporter uses `drawProjection` as the primary path**
— no raw `HLRBRep_Algo`/`Handle_*` lifetime juggling (which is exactly the kind of
manual-OCCT allocation that risks a heap abort / singleton poison). The raw
pipeline is documented above only as the reference for what `drawProjection` does
under the hood.

### Per-face Lambert fill (regions bounded by real edges)

For a shaded technical illustration (not just a wireframe), each **Face** carries an
analytic normal: `face.normalAt()` → a `Vector`. Lambert shade = `clamp(ambient,
N·L, 1)`. The face's projected **outer wire** (via `face.outerWire()` +
`wire.pointAt(t)`) is a closed region; `innerWires()` are holes. Back-face cull on
`N·viewDir`, fill the projected polygon with the shaded grey, and draw the HLR
edges on top. This yields fills bounded by the true edges — the boundary-surface
answer to `#985`'s mesh-triangle Lambert.

The exporter ships this as an **optional** `fill: 'lambert'` mode (best-effort, each
face wrapped in try/catch so one bad face never kills the export). To keep fills and
edges in one coordinate frame with zero flip risk, `fill:'lambert'` projects **both**
the face polygons and the boundary edges with the exporter's own ortho projector
(the fallback projector, below) rather than mixing replicad's Drawing frame with a
manual one. The default fill is `'silhouette'` (fill the `visible` Drawing's own
paths flat-grey — same paths, perfectly aligned, cheap) or `'none'` (outline only).

## Fallback — direct edge projection (no HLR)

Kept as an explicit `mode:'edges'` and as the automatic recovery if
`drawProjection` throws. Instead of `TopExp_Explorer(TopAbs_EDGE)` + raw
`BRepAdaptor_Curve`/`GCPnts_UniformDeflection`, we use replicad's **managed**
equivalents (same idea, no raw OCCT, no abort risk):

- `solid.edges` → `Edge[]` (replicad wrappers; `TopExp_Explorer` under the hood).
- each `edge.pointAt(t)` for `t ∈ [0,1]` → a 3D `Vector` (curve tessellation); sample
  count scales with `edge.length` and `edge.geomType` (a `LINE` needs 2 points, a
  `CIRCLE`/`BSPLINE` many).
- project each 3D point to 2D with the **same ortho camera** convention the mesh
  SVG uses (`src/lib/shared/svg/svg-camera.ts`): a straight technical **elevation**,
  eye on `+Y`, `up = [0,0,-1]` (Z-down), so world-X → horizontal, world-Z → vertical.
  Projection is `u = P·xAxis`, `v = P·yAxis` of the camera frame.
- emit one `<polyline>` per edge; bbox of all points → `viewBox`.

This path has **no HLR** (so no hidden-line removal — every edge, front and back,
is drawn), but it is guaranteed to produce true boundary edges and never traps.

## Reuse / prior art

- `src/lib/shared/svg/svg-camera.ts` — the ortho/persp camera math the mesh SVG view
  uses. The exporter mirrors its **ortho elevation** convention (eye `+Y`, `up=-Z`,
  render at natural V/H aspect) so BREP_SVG and the mesh SVG frame parts the same way.
- `src/lib/shared/svg/svg-emit.ts` — the mesh silhouette/edge emitter (path building,
  `viewBox`, reduce). BREP_SVG is the analytic-boundary sibling: same output shape
  (`<svg><path.../></svg>`), different source (exact edges, not mesh silhouette).
- `archive/src/lib/cad/exporter.ts` — the **archived** three-svg-renderer path
  (`SVGRenderer` + `FillPass` + `VisibleChainPass`). That renders from a **mesh**
  (`SVGMesh` over a `BufferGeometry`) — i.e. it silhouettes triangle soup. BREP_SVG
  supersedes it for B-rep solids: HLR gives the true outline directly, no mesh.
- `docs/plans/svg-projection-perf.md` — the mesh SVG projection performance work
  (silhouette extraction, reduce). Relevant when BREP_SVG later needs to cache /
  throttle projections for big assemblies.
- Cross-ref `/plan #985` (mesh Lambert shading) — the boundary-surface complement.

## What shipped + why

- **Primary: managed HLR via `drawProjection`** — HLR *is* available, and replicad's
  wrapper returns self-cleaning `Drawing`s with `toSVGPaths()`/`toSVGViewBox()`, so
  we get true hidden-line-removed boundary edges as SVG paths with **zero** raw-OCCT
  lifetime management (the abort/poison risk). Optional dashed hidden lines
  (`opts.hiddenLines`) and flat silhouette fill (`opts.fill:'silhouette'`).
- **Optional `fill:'lambert'`** — per-face analytic-normal Lambert region fills,
  projected with the exporter's own ortho projector (aligned, self-consistent),
  edges drawn on top. Best-effort, per-face guarded.
- **Fallback `mode:'edges'`** — managed edge tessellation (`solid.edges` +
  `edge.pointAt`) + ortho projection; also the automatic recovery on any
  `drawProjection` throw. Every path is catchable — no singleton poison.

## Open follow-ups (for the parent / future work)

- Wire the `BREP_SVG` right-pane tab (graph-editor UI) — call `brepSolidToSvg` on the
  BREP tab's already-built solid, or `brepRevolveToSvg`/a source-based entry.
- Crease-line styling: `drawProjection` folds outline + sharp + smooth into `visible`;
  if we want silhouette vs crease drawn differently, drop to `makeProjectedEdges` or
  the raw `HLRToShape.{OutLine,Rg1Line}VCompound` split.
- Lambert-fill frame unification with the HLR edge frame (so `fill:'lambert'` can sit
  under real HLR hidden-line-removed edges, not just the fallback edges).
- Perf: HLR is O(faces²)-ish; cache per (solid, camera) and throttle for big wells
  (see `svg-projection-perf.md`).
