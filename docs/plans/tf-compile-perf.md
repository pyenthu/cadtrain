# TF `/api/tf/compile` — composite-resolve perf follow-ups

Context: the TF tab's "compile" cost is the server round-trip that resolves +
inlines a composite part's dependencies (`/api/tf/compile` → BFS of
prod-proxied `/api/primitives/source` fetches). Surfaced by the step-breakdown
badge: `bw_open_hole` showed `compile 302 ms` vs `g_shaft` `compile 0` (direct
engine, client-local recipe). See the endpoint header comment in
`src/routes/api/tf/compile/+server.ts`.

## ✅ DONE — #1 dep-source cache (commit b8cc92a)
Module-level `SRC_CACHE` in the endpoint, keyed by dep id (60 s TTL, negative
entries cached). A 🔄 rebake sends `bust:true` → bypasses the cache read.
**Measured (bw_open_hole): cold 378 ms → warm 1–2 ms → 🔄 312 ms** (~300×).
Param scrubs / composite-graph edits are already fresh (they ride
`body.graph`/`body.params`, not the cache — the cache holds only the dep's
param-invariant source graph).

## TODO — #2 parallelize the BFS frontier
`buildCompositeMap` is still SERIAL per dep (`while (pending) { await fetchDep }`).
Deps within one BFS *level* are independent — fire the whole level with
`Promise.all`, then descend. Turns a COLD multi-dep resolve from
`N × latency` → `depth × latency` (most composites are shallow+wide, e.g.
`w_multi_string` → several `bw_*` → an engine).
- Rewrite the loop as level-parallel: dedup the frontier vs `seen`, `await
  Promise.all(level.map(id => fetchDep(id, fetch, bust)))`, collect children →
  next frontier. `guard` becomes a depth bound (~50), not a total-pop bound.
- Add a small concurrency cap (p-limit ~8) if a giant composite ever fans out
  to dozens, so we don't open 50 sockets to prod at once.
- Interacts with #1: a warm cache short-circuits `fetchDep` before any network,
  so #2 mainly helps the cold / busted first resolve.
- Verify: cold compile of a deep multi-`bw_*` composite (e.g. `w_multi_string`)
  drops toward one-level latency.

## TODO — dep-source-edit cache invalidation (the "instant across parts" gap)
Editing a dep's OWN source (open `g_shaft` in its tab, change its graph, Save)
leaves `bw_open_hole`'s compile serving the cached g_shaft source until the
60 s TTL expires or a manual 🔄. To make it instant:
- On `/api/primitives/save` (and delete/rename/move) for id `X`, invalidate
  `SRC_CACHE.delete(X)`.
- **Local-dev wrinkle:** save is prod-proxied (`VOLUME_PROXY_PATHS`), so the
  local SvelteKit process never runs the save handler → can't invalidate its own
  in-process cache that way. Options: (a) a tiny local `/api/tf/cache/invalidate`
  the client pings after a successful save; (b) fold a `savedIds` nonce into the
  client's compile `bust` decision; (c) accept the 60 s TTL in dev (prod is
  single-process so a direct save-handler `SRC_CACHE.delete` works there).
- Lowest-effort correct: client calls a local invalidate endpoint (or just sends
  `bust:true` on the next compile) after it saves a part that others may Call.

Both are contained to `src/routes/api/tf/compile/+server.ts` (+ a few client
lines in `RightPane.svelte` for the invalidate ping).
