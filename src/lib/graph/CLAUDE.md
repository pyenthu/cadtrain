# `src/lib/graph/` — CAD domain code

The geometry core. Free to import from `src/lib/shared/*`. The old wells /
training / pipe / rules code it used to sit beside was archived 2026-06-01
(`archive/src/lib/...` — see `archive/CADTRAIN_CLEANUP.md`).

> **⚠ 2026-07-12 — the ENGINE files MOVED to `src/lib/engines/` (E1 `da7399f`).**
> `render-helpers`, `manifold-helpers`(+`-meta`), `manifold-mesh`, `warp-spline`,
> `bake-{client,worker,worker-core}`, `mesh-serial` → `engines/manifold/`;
> `graph-to-tf` → `engines/trueform/`; `brep-occt`/`brep-client` → `engines/brep/`.
> This map lists only what STAYED here (dir renamed `cad/`→`graph/` 2026-07-12).

**Manifold/render kernel gotchas → `../engines/manifold/CLAUDE.md`; engine layer → `../engines/CLAUDE.md`.**

> **⚠ 2026-07-28 (#995) — the 39 loose root `.ts` files were MODULARIZED into
> concern subfolders** (mechanical `git mv` + import-path rewrites, NO logic
> change). Intra-graph imports use the `$lib/graph/<sub>/<file>` alias. Each
> subfolder has its own one-line `CLAUDE.md`. `nodes/` · `stdlib/` · `tests/`
> were untouched.

## Directory map

```
src/lib/graph/
├── composition/             # the node-graph core + emit + bake
│   ├── composition-graph.ts        # node-graph model (Call/Container/Method/Mv/Rot/Repeat/Polygon/PolyRepeat; hydrate + migrations)
│   ├── composition-graph-types.ts  # graph value types + constructors (asLiteral/asExpr/asParam)
│   ├── composition-graph-hydrate.ts# newGraph + hydrateGraph (schema migrations)
│   ├── composition-graph-mutate.ts # graph mutation ops (add/remove/set…)
│   ├── composition-emit.ts         # graph → emitted source body + validateGraph (meta.graph round-trip)
│   ├── composition-emit-profile.ts # polygon/profile emit path
│   ├── composition-bake.ts         # graph bake orchestration
│   ├── composition-layout.ts       # canvas auto-layout
│   ├── composition-tree.ts         # TreeNode model (docs/COMPOSITION.md)
│   ├── engine-hash.ts              # engine-source digest (import.meta.glob → ENGINE_HASH cache-bust)
│   └── param-keys.ts               # paramKeysOf(source) — ordered meta.params keys (adaptive dispatch)
├── expr/                    # expression + formula language
│   ├── graph-exprs.ts              # parse/validate/emit expr blocks
│   ├── expr-schema.ts              # buildAllowedInputs (expr schema)
│   ├── expr-imperative.ts          # imperative accumulator programs
│   ├── expr-loops.ts               # loop parse/serialize
│   ├── math-lib.ts                 # math injected into profile-fn + sandbox
│   └── tf-wat-emit.ts              # TrueForm WAT emit
├── primitive/              # part-source execution + scaffolds
│   ├── primitive-sandbox.ts        # sandbox exec for part sources (injects helpers)
│   ├── primitive-stub.ts           # typed-create scaffolds (Extrude/Profile/Assembly stubs)
│   ├── glb-client.ts               # client-side GLB export
│   └── manifold-trap.ts            # guards a WASM Manifold trap so it can't poison later bakes
├── sketch/                 # M.1 sketch engine
│   ├── sketch.ts                   # compileSketch(ops)→(r,z) via Maker.js; sandbox `sketch(...)`
│   ├── sketch-layout.ts            # sketch column layout
│   └── sketch-repeat.ts            # sketch repeat expansion
├── spline/                # spline geometry
│   ├── spline-eval.ts              # resolve wired spline points
│   ├── spline-resample.ts          # resample / arc-length
│   └── spline-view.ts              # plane axes + snap + bbox helpers
├── port/                  # typed-port wiring
│   ├── port-types.ts               # port type registry + canWire
│   ├── port-suggest.ts             # wiring suggestions
│   └── struct-type.ts              # composite/struct types
├── part/                  # part identity + colour
│   ├── part-id.ts                  # hashId stamping for color-by-source (SECTION_ID, triSourceIds)
│   └── part-lut-types.ts           # part colour-LUT types
├── editor/                # editor tool API
│   ├── editor-tools.ts             # dispatchEditorTool + readEditorState
│   └── editor-tools-schema.ts      # editor tool schema
├── csg/csg-2d.ts          # CrossSection helpers (cs, extrude_csg, ext, resample)
├── survey/survey-to-xyz.ts# deviation-survey (MD/inc/azi) → XYZ polyline for warp-along-spline
├── warp/warp-geom.ts      # warp vertex geometry
├── wire/wire-check.ts     # wire validation
├── profile/profile-templates.ts # profile preset templates
├── nodes/                  # node-kind descriptor registry: registry.ts (kindOf) + node-kind.ts + kinds/*.ts (call/container/cutaway/expr/material/method/mv/polygon/poly-repeat/repeat/rot/sketch/sketch-repeat/spline/stack/txfmn/warp/parts-map). Golden-tested
├── stdlib/                 # ACTIVE engine primitives (r_cuboid, r_loft, r_weld_extrude, r_revolve) — Rule 21
│   └── stale/               # DEPRECATED engines (r_extrude — 0 consumers) — still resolvable (origin 'stdstale')
└── tests/                  # co-located unit tests — the top-level specs grouped here 2026-07-12 (nodes/ + stdlib/ keep their own)
```

Archived (2026-06-01, in `archive/src/lib/cad/`): `exporter.ts` (SVG
export), `assemblies-l4.ts`, `file-kinds.ts`, `pipe/`, `rules/`.
Archived (2026-06-12): `assembly-deps.ts`'s drift-snapshot half
(parse/diff/write/buildSnapshots + djb2/hashComponent) — only the
now-archived PrimitiveView/CompositionEditor used it. The live
`paramKeysOf` moved to `param-keys.ts`.

**Engine primitives** (`stdlib/` + `stdlib/stale/`): git-tracked, read-only in
the GUI, served BEFORE the volume by the resolver, save/delete refused.
Registry: `src/lib/server/stdlib.ts` (`import.meta.glob('?raw')` → source
baked into the build; `stdlib/*.ts` is non-recursive so `stale/` is globbed
separately with origin `'stdstale'`). Deprecate = `git mv` into `stdlib/stale/`.
**`r_revolve` is ACTIVE** (12 consumers — g_collar/g_shaft/g_dp_*/…, the only
revolve engine); only `r_extrude` (0 consumers, superseded by r_weld_extrude)
is in `stale/`. Full contract in root CLAUDE.md Rule 21.

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

## SVG export — archived

`exporter.ts` (three-svg-renderer export) moved to
`archive/src/lib/cad/exporter.ts` 2026-06-01. Its gotchas
(OrthographicCamera cast, vertex-colour mesh split, FillPass +
VisibleChainPass) travel with it.
