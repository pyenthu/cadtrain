# `src/lib/cad/` — CAD domain code

The CAD half of the two-product split (the other being
`src/lib/wells/`). Must NOT cross-import with `src/lib/wells/*`.
Free to import from `src/lib/shared/*` and `src/lib/training/*`.

## Directory map

```
src/lib/cad/
├── builder.ts              # ManifoldCAD buildComponent / buildPrimitiveManifold + render helpers
├── library.ts              # ComponentDef catalog (params, tags, defaults)
├── exporter.ts             # three-svg-renderer SVG export
├── manifold-helpers.ts     # raw shape primitives (base geometry toolkit)
├── manifold-helpers-meta.ts # positional-prop schemas for the helpers
├── mesh-serial.ts          # serialize/rehydrate { full, cutVC } mesh-JSON
├── mesh-serial.test.ts     # round-trip vitest
├── assemblies-l4.ts        # level-4 assembly scaffolding
├── stdlib/                 # git-tracked STDLIB primitives (r_revolve, r_extrude) — canonical, read-only, served stdlib-first. See root CLAUDE.md Rule 21.
├── primitive-stub.ts       # source generators for "+ new primitive" (buildFnProfileStub / buildPartStubFromBase / stubSource)
├── pipe/                   # pipe-specific composites
└── rules/                  # tubing + drill_pipe domain rules
```

`builder.ts`'s `buildComponent` / `buildPrimitiveManifold` now build only
from the legacy `library.ts` `ComponentDef` catalog. Its render helpers
(`finalizeManifold`, `setRenderZScale`, `manifoldToGeo`, `manifoldToCutVC`)
are used live by `/api/primitives/preview`.

**Stdlib primitives** (`stdlib/`): `r_revolve` + `r_extrude` are git-tracked,
function-only parametric (`type:'profile'`), read-only in the GUI, served
BEFORE the volume by the resolver. Registry: `src/lib/server/stdlib.ts`
(`import.meta.glob('?raw')` → source baked into the build). Full contract in
root CLAUDE.md Rule 21 + memory `stdlib_primitives_in_src`.

## Geometry — Z-down convention

Drilling convention. Encoded into every helper and component.

- **`top` = LOWER z. `bottom` = HIGHER z.** As z increases, you go
  down the hole.
- Translating by `mv(part, [0, 0, +N])` moves it DOWN (toward the
  bottom).
- When composing a box conn (upset flange at top, body below): cone at
  `z = 0..coneLen` with the WIDE end at `z = 0`, body translated to
  `z ≥ coneLen`.
- The helpers in `manifold-helpers.ts` follow this. Any new primitive
  MUST follow it too.

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

## SVG export — `src/lib/cad/exporter.ts`

Uses `three-svg-renderer`:

- Uses **OrthographicCamera** (type-cast as `any` since
  three-svg-renderer types only accept PerspectiveCamera, but the
  underlying `Vector3.project()` works with both).
- Geometry split by vertex colour into two meshes (red + grey)
  because FillPass reads material colour, not per-face vertex colours.
- Passes: `FillPass` (polygons) + `VisibleChainPass` (edges).

## Manifold gotchas

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

**Fix pattern** (used by both `r_extrude` and `r_weld_extrude` in `src/lib/cad/stdlib/`):

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
