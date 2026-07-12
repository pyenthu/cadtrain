# `src/lib/cad/` — CAD domain code

The geometry core. Free to import from `src/lib/shared/*`. The old wells /
training / pipe / rules code it used to sit beside was archived 2026-06-01
(`archive/src/lib/...` — see `archive/CADTRAIN_CLEANUP.md`).

> **⚠ 2026-07-12 — the ENGINE files MOVED to `src/lib/engines/` (E1 `da7399f`).**
> `render-helpers`, `manifold-helpers`(+`-meta`), `manifold-mesh`, `warp-spline`,
> `bake-{client,worker,worker-core}`, `mesh-serial` → `engines/manifold/`;
> `graph-to-tf` → `engines/trueform/`; `brep-occt`/`brep-client` → `engines/brep/`.
> This map lists only what STAYED in `cad/`.

**Manifold/render kernel gotchas → `../engines/manifold/CLAUDE.md`; engine layer → `../engines/CLAUDE.md`.**

## Directory map

```
src/lib/cad/
├── composition-graph.ts     # node-graph model (Call/Container/Method/Mv/Rot/Repeat/Polygon/PolyRepeat; ArgValue literal|expr|param; hydrate + migrations)
├── composition-emit.ts      # graph → emitted source body (meta.graph round-trip)
├── composition-emit-profile.ts # polygon/profile emit path
├── composition-layout.ts    # canvas auto-layout
├── composition-bake.ts      # graph bake orchestration
├── composition-tree.ts      # TreeNode model (docs/COMPOSITION.md)
├── param-keys.ts            # paramKeysOf(source) — ordered meta.params keys (adaptive dispatch). Drift-snapshot machinery archived 2026-06-12 with PrimitiveView
├── csg-2d.ts                # CrossSection helpers (cs, extrude_csg, ext, resample)
├── sketch.ts                # M.1 sketch engine — compileSketch(ops)→(r,z) via Maker.js (line/spline/fillet/chamfer); injected into the part sandbox as `sketch(...)`. Plan: docs/plans/profile-sketcher.md
├── inline-profile.ts        # inline-profile resolution (resolveProfile + NaN guard)
├── profile-templates.ts     # profile preset templates
├── primitive-sandbox.ts     # sandbox exec for part sources (injects helpers)
├── primitive-stub.ts        # typed-create scaffolds (Extrude/Profile/Assembly stubs)
├── part-id.ts               # hashId stamping for color-by-source
├── math-lib.ts              # math injected into profile-fn + sandbox
├── survey-to-xyz.ts         # deviation-survey (MD/inc/azi) → XYZ polyline for warp-along-spline
├── manifold-trap.ts         # guards a WASM Manifold trap so it can't poison later bakes (memory manifold_trap_poison)
├── stdlib/                  # ACTIVE engine primitives (r_cuboid, r_loft, r_weld_extrude, r_revolve) — Rule 21
│   └── stale/               # DEPRECATED engines (r_extrude — 0 consumers) — still resolvable (origin 'stdstale'); relocated 2026-06-28 from top-level stdstale/
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
