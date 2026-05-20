# `src/lib/cad/` — CAD domain code

The CAD half of the two-product split (the other being
`src/lib/wells/`). Must NOT cross-import with `src/lib/wells/*`.
Free to import from `src/lib/shared/*` and `src/lib/training/*`.

## Directory map

```
src/lib/cad/
├── builder.ts              # ManifoldCAD buildComponent / buildPrimitiveManifold
├── library.ts              # ComponentDef catalog (params, tags, defaults)
├── exporter.ts             # three-svg-renderer SVG export
├── manifold-helpers.ts     # shape primitives used inside components
├── manifold-helpers-meta.ts # positional-prop schemas for the helpers
├── mesh-serial.ts          # serialize/rehydrate { full, cutVC } for /api/components/geom
├── mesh-serial.test.ts     # round-trip vitest
├── components-l3.ts        # level-3 composite-generator scaffolding
├── assemblies-l4.ts        # level-4 assembly scaffolding
├── components/             # one *.ts per bundle primitive (26 today)
│   ├── families.ts         # FAMILY_BY_ID + LEVEL_BY_ID central maps
│   └── <id>.ts (+ <id>.md) # primitive + spec sidecar
├── pipe/                   # pipe-specific composites
└── rules/                  # tubing + drill_pipe domain rules
```

## Geometry — Z-down convention

Drilling convention. Encoded into every helper and component.

- **`top` = LOWER z. `bottom` = HIGHER z.** As z increases, you go
  down the hole.
- Translating by `mv(part, [0, 0, +N])` moves it DOWN (toward the
  bottom).
- When composing a box conn (upset flange at top, body below): cone at
  `z = 0..coneLen` with the WIDE end at `z = 0`, body translated to
  `z ≥ coneLen`.
- All components in `components/` and helpers in `manifold-helpers.ts`
  follow this. Any new component MUST follow it too.

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

## Adding a new bundle primitive

1. Create `components/<id>.ts` with `export const meta = {...}` and
   `export function geom(p) {...}`.
2. Add a sibling `components/<id>.md` documenting what real-world part
   it models, vocabulary, validation, derived params. Template:
   `docs/PRIMITIVE_TEMPLATE.md`. Strong example: `components/conn_box.md`.
3. Add the id to `components/families.ts` — `FAMILY_BY_ID` (for Parts
   tab placement) and/or `LEVEL_BY_ID` (for Basic tab placement). If
   omitted, the entry stays visible under safe defaults (`'basic'` /
   `1`) but won't be in the intended group.
4. NO need to touch `library.ts` for the auto-discovered glob; that's
   for the legacy 18-primitive ComponentDef list.

## Volume component loader (Rule 17 detail)

Library parts under `<volume>/library/<cat>/<id>/component.ts` are
NOT seen by `import.meta.glob` at build time. They render via
`/api/components/geom` → `src/lib/server/component-loader.ts` →
`loadVolumeComponent` → `resolvePart`.

**Security** (`component-loader.ts` — volume `.ts` is untrusted):

- `parseImports` allowlists ONLY `'../manifold-helpers'`, `'.'`,
  `'./<sibling-id>'`; strips all import lines.
- Denylist-scans the body for `require(` / `process` / `import(` /
  `eval(` etc.
- Execution is `new Function` (host realm — keeps `Manifold` class
  identity; `node:vm`'s separate realm would break it) with only the
  manifold helpers + `defineGeom` + resolved sibling deps in scope.

**Concurrency**: `M` / circular-segment mode / render Z-scale are
process-wide mutable globals — `/api/components/geom` serializes
every WASM build through a promise-chain mutex. Results are
LRU-cached (cap 200) by `<id>|<paramsJson>|<zScale>`; a save
invalidates the component's entries.

**Cross-instance prop refs** — `expandInstancePropRefs`:

- Before transpile, the loader scans every
  `(let|const) X = call(args)` base declaration to build an
  `<INST>.<prop>` → raw arg-text map (helpers use positional
  `manifold-helpers-meta` props; components use object-literal keys
  from the imported component's `meta.params`).
- Loops substitution to a fixpoint (max 8 iterations) — a single
  `.replace` pass only resolves one level; chains like
  `C.top = B.top + B.length` where `B.top = A.top + A.length` need
  3+ passes to fully resolve.
- Lets the user write live cross-instance refs in the editor — e.g.
  `B = mv(B, [0, 0, B.top])` with `B.top = A.top + A.length` —
  without anything being undefined at runtime. Reference text stays
  on disk so editing A's length cascades automatically on next
  preview/save.

**`new Function` exception**: this is the ONE place `new Function` is
allowed (vs the authoring interpreter's "no eval" rule). Authored
components are JSON recipes run by a fixed interpreter; volume
components are authored `.ts` code that must execute — hence the
sandbox + allowlist + denylist instead.

## Components render two ways

| renderMode | Where | When |
|---|---|---|
| `'client'` | Bundle primitive in `src/lib/cad/components/<id>.ts`, seen at build by Vite's `import.meta.glob`. | `/components` build `$effect` runs `buildAuthored()` directly — instant, no round-trip. The 26 baseline primitives. |
| `'server'` | Library part in `<volume>/library/<cat>/<id>/component.ts`. | Build `$effect` POSTs `{ id, params, zScale }` to `/api/components/geom`; server transpiles + sandbox-executes + returns serialized mesh-JSON; client rehydrates via `mesh-serial.ts`. |

The picture → AI → `.ts` → volume workflow uses `'server'`. New
(figure-trained / AI-authored) components are *data on the volume*,
NOT git-tracked `src/` code — they never need a bundle rebuild to
render.

`/api/components/list` decides `renderMode` per entry; the client
build effect dispatches on it.

## Manifold gotchas

### Hand-wound raw mesh — preferred for swept/helical geometry

For helical threads + swept profiles, build the triangle mesh by hand and
wrap it: `new wasm.Manifold(new wasm.Mesh({ numProp:3, vertProperties,
triVerts }))`. Cleaner topology + far fewer WASM ops than union-of-cubes
(`helix_band`) or extrude+warp. **Full methodology — SVTC ordered grid
indexing, the `-du×dv` winding rule, mandatory position-weld, triangle-fan
caps, the `status()`-returns-a-STRING gotcha — is in `docs/CAD_AUTHORING.md`.**
Reference primitives: `<volume>/primitives/raw_helix_1..4`. CS + Mesh are
exposed in the library sandbox (`component-loader.ts`); volume primitives
reach them via `G.__cadtrain_manifold__.wasm` directly.

### `CrossSection.extrude(..., scaleTop)` + `Manifold.warp` — scalar collapse

When the manifold returned by `CrossSection.extrude(height, nDivisions, twistDegrees, scaleTop)` will be fed to `Manifold.warp(callback)`, **`scaleTop` MUST be the Vec2 `[1, 1]`, never the scalar `1`** (or any other scalar identity). The TypeScript signature `scaleTop?: Readonly<Vec2> | number` advertises both as valid, but in manifold-3d 3.4.1:

- Scalar `1` + warp → silently collapses the top-slice profile (top `yLocal` lost), producing a wedge-tapered top regardless of what the warp callback does.
- Vec2 `[1, 1]` + warp → identity, behaves correctly.
- Extrude alone (no warp) → both forms produce identical bboxes; the bug only surfaces when warp follows.

**Symptom**: a primitive built via `extrude → warp` (e.g. `profile_extrude_v3..v5`) renders with one end visibly tapered to a point even though the warp math has no taper term.

**Detection**: compare the post-warp z-extent. If `z_max = height - halfW` instead of `height + halfW`, scaleTop is the culprit.

**Fix**: `extrude(L, n, 0, [1, 1])`, not `extrude(L, n, 0, 1)`.

See `~/.claude/projects/-Users-neerajsethi-code-cadtrain/memory/manifold_extrude_scaletop_warp_bug.md` for the discovery trail. Discovered 2026-05-19 while authoring v5.
