# `src/lib/engines/manifold/` — Manifold (ManifoldCAD WASM) kernel

The primary geometry engine — mesh CSG + the welded-mesh toolkit. Holds
`render-helpers`, `manifold-helpers`(+`-meta`), `manifold-mesh`, `warp-spline`,
`mesh-serial`, and the client bake path (`bake-{client,worker,worker-core}`).
Carved out of `src/lib/graph/` 2026-07-12 (E1 `da7399f`). Engine-layer overview +
dependency rule → `../CLAUDE.md`; the cad-domain graph/sketch/stdlib code stays
in `src/lib/graph/` (its `../../cad/CLAUDE.md`). The render + kernel gotchas below
are Manifold-specific and load only when you work in this subtree.

## Rendering

- **ManifoldCAD circular segments: 192** for quality.
- **Vertex colours classify faces**: **red (`#cc2222`)** = outer body,
  **grey (`#888888`)** = bore / cut / internal. `buildComponent(id,
  params)` returns `{ full, cutVC, manifold }` where `cutVC` has the
  CSG cutaway applied.
- Scene camera: `position={[6, 0, 0]}` looking at origin,
  `up={[0, 0, -1]}` — consistent with Z-down.
- Material: **MeshPhongMaterial** (NOT MeshPhysicalMaterial —
  physical washes out on Mac GPUs). `preserveDrawingBuffer: true` so
  the canvas is capture-able for thumbnails.
- **`flatShading: true` on the live-mesh material** (`ComponentScene.svelte`).
  `manifoldToGeo`/`manifoldToCutVC` bake Manifold's `calculateNormals(3, 60)`
  (smoothed per-vertex normals) into the indexed BufferGeometry. Without
  `flatShading`, flat faces (cubes, hex) average their corner normals and
  read as dull/flat. `flatShading` makes the shader derive face normals
  from position derivatives, ignoring the baked smooth normals — matches
  the GLB pane (`ComponentSceneGlb.svelte`, which strips normals + sets
  flatShading). The warp path is unaffected (`subdivideAlongZ` recomputes
  its own normals on non-indexed output). Regressed once in commit 8297314;
  don't drop `flatShading` from the live material.

## Manifold gotchas

### `M.compose` UNIONS overlapping bodies — `place()` is not "just grouping"

Measured (`lazy-place.test.ts`): `compose(bigCyl, cylNestedInside)` returns
**exactly what `big.add(small)` returns** — same tri count, same volume. The inner
body is **destroyed**. On *disjoint* bodies compose merely concatenates (volume
and tris are the sums). So `place()` = grouping only when nothing overlaps.

This is why a well cannot be one Manifold: every element sits inside the open
hole, so composing 16 elements collapsed them to the outer hole alone (510 tris,
genus 0 — the whole completion string gone).

**`autoPlace` (primitive-loader) therefore keeps a list-returning geom fn's
outputs as separate `_parts` and composes LAZILY** — the merged body is built only
if something actually asks for one (a parent doing further CSG on a list-returning
dep, or a consumer wanting one mesh). Reading `_parts` never pays for the union.
On the deviated reference well that is 91 ms instead of 443 ms, and the geometry
survives. `finalizeManifold` meshes `_parts` when a colour LUT is active; a
`WarpNode`'s `children[]` emit already assumed separate parts.

Two implementations must stay in lockstep: the TS `lazyPlace`/`autoPlace` in
`src/lib/server/primitive-loader.ts`, and its **hand-written twin inside the
compiled-script template literal** in the same file (the client bake path). Both
are pinned — `lazy-place.test.ts` (server) and `lazy-place-compiled.test.ts`
(client). Note the twin lives in a template literal: **no backticks in its
comments**. Both must guard `then` and symbol lookups, or `await geomFn(...)` and
console inspection silently force the union.

### Hand-wound raw mesh — preferred for swept/helical geometry

For helical threads + swept profiles, build the triangle mesh by hand and
wrap it: `new wasm.Manifold(new wasm.Mesh({ numProp:3, vertProperties,
triVerts }))`. Cleaner topology + far fewer WASM ops than union-of-cubes
(`helix_band`) or extrude+warp. **Full methodology — SVTC ordered grid
indexing, the `-du×dv` winding rule, mandatory position-weld, triangle-fan
caps, the `status()`-returns-a-STRING gotcha — is in `docs/CAD_AUTHORING.md`.**
Reference primitives: `<volume>/primitives/raw_helix_1..4`. Volume
primitives reach `CS` + `Mesh` via `G.__cadtrain_manifold__.wasm` directly.

### `CrossSection.extrude(h, nDivisions, twistDegrees)` degenerate slices

In manifold-3d 3.4.1, `extrude(h, nDivisions, 0)` with `nDivisions > 0` AND `twistDegrees === 0` produces a non-manifold mesh — the intermediate slices are IDENTICAL to top + bottom (no morph), so the triangulator emits coincident triangle pairs and rejects with `"Not manifold"`.

**Fix pattern** (used by both `r_extrude` in `src/lib/graph/stdlib/stale/` and `r_weld_extrude` in `src/lib/graph/stdlib/`):

```ts
const tw = Number(twist ?? 0);
if (Math.abs(tw) < 0.001) return cs.extrude(h);              // bare — no nDivisions
const nDiv = Math.max(1, Math.min(96, Math.round(divs)));
return cs.extrude(h, nDiv, tw);                              // morph — twist > 0
```

The conditional sidesteps the bug AND keeps backward compatibility — existing 2-arg callers get the bare branch.

Combined with `Manifold.warp`: `cs.extrude(h).refineToLength(h/divs).warp(twistFn)` is FOUR TIMES SLOWER than the native morphing path (4 ms vs 1 ms at 64×24 in the 2026-05-28 bench). The `refineToLength` pass subdivides every edge globally; don't pair it with warp. Memory: `bench_extrude_findings`.

### Non-planar twisted quads + `flatShading: true` — sawtooth shading

A twisted prism rendered with `flatShading: true` shows ALTERNATING bright/dark sawtooth stripes along its side faces. NOT a winding bug. The cause:

* Each side face quad is non-planar (twist rotates the bottom edge vs the top).
* Triangulating the quad with one diagonal produces 2 triangles whose face normals measurably diverge.
* `flatShading: true` makes the fragment shader derive normals per-triangle (ignoring the buffer's vertex-normal attribute), so adjacent triangles reflect differently → sawtooth.

**Fix (`5582c58`)** — the smooth-shade gate in `src/lib/shared/PrimitiveDualCanvas.svelte`:

```ts
const twistArg = Number((args as any[])?.[2] ?? 0);
const smoothShade =
  id === 'r_weld_extrude' ||
  (id === 'r_extrude' && Math.abs(twistArg) > 0.001);
```

Passed to `PrimitiveDualScene` where the three live `MeshPhongMaterial` instances use `flatShading={!smoothShade}`. Twisted prisms use the baked `calculateNormals(3, 60)` normals (60° crease threshold preserves vertical hex seams as sharp; <60° edges within a side smooth). Cubes/hex/everything else keeps `flatShading: true` unchanged. **Don't drop `flatShading` globally** — the cube/hex rendering was a hard-won lesson (commit 8297314 regression).

The complementary lever: cranking the part-level `segments` dial densifies the perimeter via `resample(...)` so each non-planar quad becomes smaller → less per-triangle normal divergence → less sawtooth even at flatShading=true. Memory: `flatshading_twisted_quad_smoothshade_gate`.

### `CrossSection.extrude(..., scaleTop)` + `Manifold.warp` — scalar collapse

When the manifold returned by `CrossSection.extrude(height, nDivisions, twistDegrees, scaleTop)` will be fed to `Manifold.warp(callback)`, **`scaleTop` MUST be the Vec2 `[1, 1]`, never the scalar `1`** (or any other scalar identity). The TypeScript signature `scaleTop?: Readonly<Vec2> | number` advertises both as valid, but in manifold-3d 3.4.1:

- Scalar `1` + warp → silently collapses the top-slice profile (top `yLocal` lost), producing a wedge-tapered top regardless of what the warp callback does.
- Vec2 `[1, 1]` + warp → identity, behaves correctly.
- Extrude alone (no warp) → both forms produce identical bboxes; the bug only surfaces when warp follows.

**Symptom**: a primitive built via `extrude → warp` (e.g. `profile_extrude_v3..v5`) renders with one end visibly tapered to a point even though the warp math has no taper term.

**Detection**: compare the post-warp z-extent. If `z_max = height - halfW` instead of `height + halfW`, scaleTop is the culprit.

**Fix**: `extrude(L, n, 0, [1, 1])`, not `extrude(L, n, 0, 1)`.

See `~/.claude/projects/-Users-neerajsethi-code-cadtrain/memory/manifold_extrude_scaletop_warp_bug.md` for the discovery trail. Discovered 2026-05-19 while authoring v5.

### r_sweep DEGENERATE / SLIVER caps — two distinct defects (2026-07-02)

A curved hollow sweep (`s_tube` = `sweep(outerR).subtract(sweep(innerR))`) rendered with a **tangled fan of degenerate/sliver triangles at the end caps**. Long debug — the root causes are NOT what they first look like (it is NOT an originalID race, NOT WASM-singleton corruption, and manifold-3d 3.5.1 does NOT fix it — all empirically disproven). Two SEPARATE deterministic defects:

**Defect 1 — self-intersecting section (author bug).** An expr circle formula divided by a hardcoded constant while looping `num_pts` (`tau*i/12` with `num_pts=24`) → the section wrapped ~twice → a self-overlapping loop → malformed swept solid (genus 1, wrong volume) → degenerate caps. Fix: `tau*i/12` → `tau*i/num_pts`. **A single sweep of a clean section is 0 slivers.** TODO: warn on self-intersecting sweeps (genus/volume or 2D segment-cross check) — memory `todo_sweep_self_intersection_check`.

**Defect 2 — tilted coincident caps in a curved hollow SUBTRACT.** Subtracting two coaxial *curved* sweeps gives two **tilted, coincident cap planes** whose independent triangulations don't align → **Manifold's v3 MESH boolean corrupts them** (~137 degenerate + sliver tris, non-watertight). This is a mesh-boolean limitation, not a bug in our code. Key facts:
- **Straight path = clean** (axis-perpendicular caps subtract fine); **revolve hollow (`g_tube`) = clean** (rect section never self-intersects, axis-perp caps). Only *curved sweep − curved sweep* slivers.
- **TrueForm** (mesh boolean) does NOT fix it (default: ~28 degenerate, not watertight). **BREP/OCCT** (exact kernel, `genericSweep`) DOES → 0 degenerate/0 sliver (shipped in `brep-occt.ts`), ~40-100× slower + display-mesh T-junctions.
- **Durable engine-agnostic fix = ANNULAR SECTION**: do the CSG in 2D on the section (a CrossSection with a hole) + sweep ONCE → one welded mesh, no 3D boolean → no coincident caps. Plan `docs/plans/annular-csg2d-section-sweep.md`.

**Diagnose by DECODING cap triangles** (never eyeball): `/api/primitives/preview` → `full = {positions[], normals[]}` (non-indexed). Count near-zero-area tris; group side/cap verts by rounded POSITION. Test on the STRAIGHT/curved cases separately (curved masks/reveals defect 2; a single sweep isolates defect 1). Full trail: memory `r_sweep_normals_and_twist`.

**The defect-2 strays are a TOPOLOGY error, not removable slivers (2026-07-02 exploration).** Decoding the CSG subtract (`sweep(0.4).subtract(sweep(0.25))`, curved path): genus **6** (should be 1), 12 zero-area + 44 sliver tris clustered at the tilted END cap (154 cap tris vs 64 clean), volume CORRECT (2.913 — "looks" fine). It's **always a closed 2-manifold** (0 non-manifold edges, 0 boundary edges, 0 T-junctions) — so nothing to "repair." The mesh boolean stitched the overlapping tilted caps into ~5 phantom handles. **Post-hoc removal PROVEN not to work:** drop-degenerate+weld → still genus 6; drop-slivers → "Not manifold" (tears the surface); `simplify()`/`setTolerance()` preserve topology by design → genus 6 at every tolerance; `getMeshGL().merge()` — `getMeshGL` doesn't exist in manifold-3d 3.4.1. **Only `sweepAnnular` (2D CSG on the section, swept once, no 3D boolean) is clean (genus 1, 0 strays, same volume).** So NO cleanup hook in finalizeManifold is warranted. The 3D-bake **⚠-stray badge + Remove button** (`PrimitiveDualCanvas` `countStrayTris`/`removeStrays`, `576e16a`) is a VISIBILITY/cosmetic aid — the button drops near-zero-area tris but can't fix genus; it's a placeholder for a future real fix. BREP cutaway on a swept-boolean solid throws un-tessellably too — DECIDED: accept degradation (uncut solid); revolve-BREP cuts fine.

**BORE-EXTEND — the TF/compiler fix for hollow SWEEPS (2026-07-04, `01b75d7`).** A hollow swept tube compiles to `booleanDifference(sweep(outerR), sweep(innerR))`. When BOTH sweeps use the SAME path their end caps are COINCIDENT + tilted → the mesh boolean (TF *and* Manifold) stitches phantom handles → defect-2 (χ wrong, degenerate fan) even though closed+manifold. **FIX = extend the SUBTRAHEND (bore) sweep's path past BOTH ends** so its caps punch THROUGH the outer caps (no coincident caps → clean χ=0). `tf_examples/s_tube_demo.ts` has always done this (`extendPathEnds`+`BORE_EXT`, `f9c81d7`); `tf_examples/execute.ts` now does it for any boolean-subtrahend sweep. PROVEN: same-path χ=-16 → extended χ=0. Counter-demo `tf_examples/s_tube_no_ext.ts`. PREVENTION (never create coincident caps), NOT post-hoc removal (can't fix genus). Same trick `bored_pipe` uses.
