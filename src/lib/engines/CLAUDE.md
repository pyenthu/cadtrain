# `src/lib/engines/` — the geometry-kernel layer

The three geometry kernels that bake the same composition graph, carved out of
`src/lib/graph/` + `src/lib/shared/` 2026-07-12 (E1 `da7399f`). Each is a right-pane
tab in the CAD editor (`shared/graph-editor/RightPane.svelte`).

```
src/lib/engines/
├── manifold/   # ManifoldCAD WASM (mesh CSG) — the PRIMARY engine. Client (Web Worker) + server.
│               #   render-helpers, manifold-helpers(+meta), manifold-mesh, warp-spline,
│               #   mesh-serial, bake-{client,worker,worker-core}. Kernel gotchas → manifold/CLAUDE.md
├── trueform/   # @polydera/trueform WASM (exact-mesh) — client-only today.
│               #   graph-to-tf, trueform-{adapter,client}, tf-{bake-client,worker,worker-core},
│               #   crease-normals, tf_examples/
└── brep/       # OpenCascade / OCCT (exact B-rep) — server-only today.
                #   brep-occt, brep-{adapter,client,audit}
```

## Dependency rule (the reason this layer exists)

- **UI → engines: OK.** Routes and `src/lib/shared/*` may import engine code.
- **engines → UI: NEVER.** No engine file may import from `src/lib/shared/*`
  or from a route. Keeps the kernels headless (they run in Node tests + workers).
- **engines → cad: GRAPH TYPES ONLY.** An engine may import the composition-graph
  *types* it bakes (`src/lib/graph/composition-graph*`), not the cad editor/UI glue.

## What each folder holds

- **manifold** — the default bake path: mesh booleans + the welded-mesh toolkit
  (`gridPatch`/`capFan`/`weldAndBuild`). No true curves (faceted). See
  `manifold/CLAUDE.md` for the render + kernel gotchas (M.compose fuses overlaps,
  raw-mesh winding, extrude degenerate slices, scaleTop+warp collapse, r_sweep caps).
- **trueform** — `@polydera/trueform` exact-mesh kernel; needs cross-origin
  isolation (COOP/COEP) to spin up its pthread pool. See `trueform/CLAUDE.md`.
- **brep** — OCCT exact kernel: true curves, clean annular caps, ~40–100× slower;
  server-only. See `brep/CLAUDE.md`.

## Pointers

- **`docs/architecture/geometry-engines.md`** — the multi-engine matrix (which
  kernel runs client vs server + why), the compile→execute split, and the
  cross-origin-isolation invariant.
- The `/design` route (Tree + C4 tabs) carries the engine nodes + matrix edges.
- Root `CLAUDE.md` — client-side-execution contract + Rule 21 (engine primitives).
