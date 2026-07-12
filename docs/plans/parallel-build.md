# Parallel primitive build via web workers (K.52)

**Status:** Designed, not yet implemented. /plan K.52 (medium, 1.0w).

## Problem

A composite like `t_drilled_block` today builds every component **sequentially**
in one sandbox:

```
block  = r_cube_ext(width, height, length)   ← ~250 ms
vBore  = r_cylinder(bore, length*1.2, 48)    ← ~50  ms
hPin   = r_cylinder(pin,  width*1.4, 32)     ← ~50  ms
return block.subtract(vBore).subtract(hPin)  ← ~80  ms
                                               -----
                                               ≈ 430 ms wall
```

The three component builds are **independent** — none reads another's output.
Run them concurrently and wall time drops to roughly `max(250, 50, 50) + 80 ≈
330 ms`, with bigger wins as the component count grows. dp_stand (3 dp_joint
instances) and any large drill-string assembly amplify this further.

## Constraints

1. **Manifold WASM is single-threaded** — one `manifold-3d` instance per JS
   thread. Multiple async ops on the same instance share the event loop; no
   true parallelism without separate WASM instances.
2. **A separate WASM instance per worker** has a one-time cold-load cost
   (~50–150 ms). Worth pooling.
3. **Mesh data must serialize across the boundary** — we already have
   `src/lib/graph/mesh-serial.ts` (used by the existing /preview path).
4. **Two execution sites:**
   - **Server-side (/api/primitives/preview)** — Node `worker_threads` pool;
     each worker holds a long-lived `manifold-3d` instance + the sandbox helper
     surface. Builds dispatched per top-level independent instance.
   - **Client-side (PrimitiveDualCanvas, planned)** — browser `Worker` pool,
     same shape, but bundles Manifold WASM into the worker chunk via Vite's
     `?worker` import.

## Architecture

```
┌────────────── main thread ──────────────┐
│ buildPrimitiveGeom(source)              │
│   1. parse + recognize independent      │
│      named instances:                   │
│        const A = depA(args)             │
│        const B = depB(args)             │
│        const C = depC(args)             │
│   2. for each, dispatch to pool:        │
│        pool.build(depId, args) → Promise │
│   3. await Promise.all([A, B, C])       │
│      → meshes + transforms              │
│   4. fold via CSG chain:                │
│        A.subtract(mv(B,…)).intersect(C) │
│      (CSG stays on main thread; one     │
│      WASM instance owns the final mesh) │
└──────────────┬──────────────────────────┘
               │ pool.dispatch({depId, args})
               ▼
┌────────────── worker N ──────────────┐
│ (cached Manifold + helper sandbox)   │
│   build(depId, args) → manifold      │
│   serialize → mesh-serial            │
│   postMessage(mesh)                  │
└──────────────────────────────────────┘
```

## Sub-steps

**(a) Recognize independent named instances** in the existing AST recognizer
(`recognize-composite.ts`). Each `const X = call(...)` whose `call` is a `uses`
dep AND whose args reference only params / Math / earlier-instance scalars
qualifies. Output a `RecognizedDispatch[]` alongside the existing `instances`.

**(b) Server worker pool** — Node `worker_threads`, `N = max(2, os.cpus()-1)`,
LIFO queue, long-lived workers. Each worker:
  - On first message: load Manifold WASM + import the sandbox helpers.
  - Listens for `{ depSource, depName, args, instanceName }`.
  - Compiles + runs the build in the same sandbox-style `new Function`.
  - Stamps with `__tag(result, hashId(instanceName))` so color-by-source still
    routes through the relation IDs.
  - Serializes via `mesh-serial.ts` and postMessages back.

**(c) Main-thread fold** — deserialize each worker's mesh into the main
Manifold instance. Walk the composition chain (existing code), substituting
each named instance with its deserialized manifold. CSG runs as today.

**(d) Client worker pool** — same shape, but the worker is a browser `Worker`
created via `new Worker(new URL('./prim-worker.ts', import.meta.url), {type:
'module'})`. Vite chunks the worker; Manifold WASM gets fetched once per worker
per session.

**(e) Heuristic dispatch** — workers cost ~5–15 ms message overhead each;
skip-dispatch and run inline when the dep is known to be cheap (e.g.,
`r_ball`, `r_cube`). Threshold lives in `prim-pool.ts` + can be tuned via a
profile we collect on /plan items 1–10.

## Files (planned)

```
src/lib/server/prim-worker.ts        ← Node worker entrypoint
src/lib/server/prim-pool.ts          ← worker_threads pool + dispatch
src/lib/server/primitive-loader.ts   ← buildPrimitiveGeom uses pool.fan() then folds
src/lib/server/recognize-composite.ts ← + recognizeDispatches()
src/lib/graph/mesh-serial.ts           ← already exists, no changes needed
src/lib/graph/prim-worker.ts           ← (phase 2) browser worker; same protocol
```

## Benchmark plan

Run before/after on a representative set:
  - `t_drilled_block` (3 components) — expect ~25–35 % wall improvement.
  - `dp_stand` (3 dp_joint instances) — expect ~50 % wall improvement (each
    dp_joint internally builds box + pipe + pin, so the win amplifies).
  - `dp_inst_stand` (1 dp_joint + place) — no win; build already constant.
  - `dp_test_hwdp_5_spiral` (1 box + 1 pipe + 3 r_threads + 1 pin) — expect
    ~40 % improvement (the three r_threads helices dominate).

Track:
  - cold start (first build, includes worker WASM init)
  - warm steady-state (pool reused)
  - mesh-serialize overhead per dispatch

## Why not now

(1) Substantial worker plumbing + careful CSG fold ordering for color-by-source
to keep working. (2) The geometry pipeline is currently single-stack which has
been useful for debugging. (3) The wins are real but not blocking any active
work. Resume when assembly build time starts hurting interactive edits.

## Tracking

  /plan K.52  ·  this doc  ·  session_handoff_2026-05-28 mentions K.52
