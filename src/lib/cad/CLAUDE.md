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
