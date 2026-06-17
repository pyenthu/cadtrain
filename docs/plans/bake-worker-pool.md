# Bake worker pool — parallel Manifold across N workers

> SPEC ONLY (2026-06-18). Extends the single client bake worker into a POOL so
> independent parts bake in parallel. Foundation already exists
> (`bake-worker.ts` + `bake-client.ts`, see [[client_side_execution]]); this is a
> dispatcher in front of N workers. Do NOT build yet.

## Why
Manifold can't split ONE operation across threads (no intra-op parallelism without
a pthreads/SharedArrayBuffer WASM build + COOP/COEP isolation — heavier, breaks
embeds). But TASK parallelism is free: **N workers, each its own Manifold WASM
instance, share no state → independent bakes run truly concurrently.** Wins:
- `/primitives` with N open tabs — all bake at once instead of serially.
- A Stack/Repeat of N DIFFERENT children — bake each child in parallel, then compose.
- `/wells` — N tool components baked concurrently.
- Smoothing/refine cost (smoothOut+refineToTolerance adds tris) spread across cores.
- Batch re-bakes (e.g. a corpus byte-compare).

## Current state (single worker)
`bake-client.ts`: ONE `worker` (lazy `getWorker()`), a `waiting`/`pending` map,
**GLOBAL latest-wins** (a new `run()` supersedes ALL pending → BAKE_CANCELLED),
per-client IndexedDB cache keyed on `KERNEL_VERSION + scriptHash + params + options`.
Designed for ONE consumer (one canvas). The global supersede is the blocker for a
pool: two different parts baking at once would cancel each other.

## Design — the dispatcher
1. **Pool**: `N = clamp(navigator.hardwareConcurrency - 1, 1, 8)` workers, each
   `new Worker('./bake-worker.ts')` with its own Manifold (the existing worker is
   already self-contained — pool just makes N of them). Lazy-spawn on demand;
   idle-evict after a timeout to reclaim memory (~1MB WASM + heap each).
2. **Lanes (the key change)**: every `run()` carries a `lane` id (part id / canvas
   id / tab id). **Latest-wins is PER-LANE**, not global — a new job in lane L
   supersedes lane L's queued/in-flight job (BAKE_CANCELLED) but leaves OTHER
   lanes alone. This is what lets different parts bake concurrently. The graph
   editor / each PrimitiveDualCanvas passes its own lane.
3. **Queue + assignment**: a FIFO of ready jobs; assign each to the first free
   worker. If a worker is mid-bake on a now-superseded lane job, we can't cancel
   the synchronous WASM call — let it finish, drop its result, then reuse the
   worker. (Same as today's "cache even a superseded bake" — store it, it's valid.)
4. **Cache**: unchanged — shared IDB, keyed on scriptHash+params+options. Check
   the cache BEFORE dispatching to a worker (instant hit, no worker needed).
5. **Backpressure**: cap concurrent in-flight at N; excess queues. A lane only ever
   has ≤1 active job (latest-wins), so the queue depth ≈ number of distinct lanes.

## API shape (minimal change to callers)
`bakeClient.run({ script, scriptHash, params, options, lane })` — add `lane`
(default a single shared lane = today's behavior). Returns the same
`{full,cutVC,instanced} | BAKE_CANCELLED`. `dispose()` tears down the whole pool.
Callers: `PrimitiveDualCanvas` passes `lane = id` (the part id). `/primitives`
multi-tab → each tab's canvas already has a distinct `id` → free parallelism.

## Phasing
- **P1** — refactor `bake-client` single-worker → pool of 1 (no behavior change),
  introduce `lane` (default global). Pure refactor, verify byte-identical.
- **P2** — grow the pool to N + per-lane latest-wins + the dispatcher/queue.
  Verify on `/primitives` with several tabs (all bake in parallel; the badge
  shows ⚡client; no cross-tab cancellation).
- **P3** — idle-evict + pool-size telemetry; wire a Stack/Repeat to fan its N
  DISTINCT children across the pool (compose after).

## Caveats
- Each worker = its own WASM init (~sub-second, one-time) + memory. Pool of 4–8,
  not 50. Idle-evict to reclaim.
- The KERNEL_VERSION cache-bust + the latest-wins semantics must stay correct
  per-lane (a regression here = stale or missing meshes).
- This is the TASK-parallel path; intra-op threading (pthreads WASM + COOP/COEP)
  is a separate, heavier track — not in scope here.
- Lands naturally in the client-side-execution lane (PR4+), see
  `docs/plans/client-side-execution.md`.
