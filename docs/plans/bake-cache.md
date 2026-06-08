# Bake cache — `$APP_DATA_DIR/cache/<hash>.{json,glb}`

Status: PLAN, not yet implemented. User reviewing.

## Why

Currently every `/api/primitives/preview` call re-runs:
1. `buildPrimitiveGeom` (compile + resolve deps + new Function)
2. `primFn(...args)` (Manifold WASM compose)
3. `finalizeManifold` (mesh extract + cutaway CSG)
4. `serializeComponentResult`

That's the whole pipeline, every time the user scrubs a dial or
switches a node. At large N (dt_stand × 30) the round-trip is 15+ s.

But the OUTPUT is a pure function of `(source, params, options)`. Same
inputs → same mesh. So we can hash the inputs and serve cached
outputs.

## What gets cached

Per (part, params, options) tuple, we store TWO files on the volume:

```
$APP_DATA_DIR/cache/<hash>.json   ← mesh JSON (full + cutVC)
$APP_DATA_DIR/cache/<hash>.glb    ← exported GLB (optional, see Phase 4)
$APP_DATA_DIR/cache/<hash>.meta   ← {id, params, options, createdAt, lastAccessAt, size}
```

`<hash>` = SHA-256 hex truncated to 16 chars of:
```
canonical_source + '|' + JSON.stringify(canonical_params) + '|' + JSON.stringify(options)
```

### Canonical source

`meta.graph` carries randomly-generated node ids (`n_xxxxxx`). Two
saves of the same logical graph produce different ids → different
source → false-miss. Two options:

- **Hash the EMITTED BODY only** (after the `// AUTO-GENERATED from
  meta.graph` line). The body is a pure projection of the graph; same
  graph → same body modulo a topo-order tiebreak.
- **Normalize node ids to sequential `n_001`, `n_002`** before hashing.

Plan: hash the emitted BODY only. Simpler + no normalization step.

### Canonical params

`params: [4.5, 0.5, 30, 3]` — JSON.stringify is canonical because we
sort by `Object.values(d.params).map(p => p.default)` deterministically.
Numbers serialize identically across calls.

### Options that affect output

- `cutaway: boolean` — different output (with/without cutVC)
- `zScale: number` — different output (scaled differently)
- `mode: 'bundle' | undefined` — different code path

Include all three in the hash input.

## Where it lives

Following Rule 13 — single live store at `$APP_DATA_DIR/cache/`. Local
dev points at the prod volume via `CADTRAIN_VOLUME_REMOTE_URL` so a
local rebake check can hit a cached entry written by prod.

Could overflow the volume — see Phase 3 LRU below.

## Lookup flow

```
POST /api/primitives/preview { source, name, params, cutaway?, ... }
  → compute hash
  → if cache/<hash>.json exists:
      read it
      touch lastAccessAt in <hash>.meta
      return { ...mesh, cached: true, _t: 0 }
  → else:
      run normal bake (~ today's path)
      write cache/<hash>.json + cache/<hash>.meta
      return { ...mesh, cached: false, _t: T }
```

`cached: true` in the response — UI can surface "served from cache" as
a tiny green dot in the bake panel.

## Invalidation

- **Source change** → new hash → new entry (auto-invalidates).
- **Param scrub** → new hash → new entry.
- **Stale entries** GC'd by `lastAccessAt` age — > 7 days deletes
  (Phase 3 LRU).
- **Manual flush** — `🗑 Clear cache` button in the editor's bake
  panel calls `POST /api/cache/clear`. Also `?bust=1` query on
  `/preview` skips the lookup.

## Storage budget

- A 36k-vert mesh JSON is ~2 MB (positions × 3 + normals × 3 + index).
- 100 cached parts ≈ 200 MB. Manageable.
- GLB is smaller (~ 30 % of mesh JSON via the binary buffer).
- LRU eviction at **500 MB** soft cap. Background GC every 100 misses.

## Phases

### Phase 1 — Read-through cache (no UI)

- `src/lib/server/bake-cache.ts` — `hash(input)`, `readCache(hash)`,
  `writeCache(hash, body)`, `touchAccess(hash)`.
- `/api/primitives/preview` calls the cache helpers around the bake.
- Returns `cached: boolean` in the response.

  **Effort**: medium. ~150 LOC + tests.
  **User value**: instant rebakes on param scrub for any same-source
  same-params combo. The bake panel's "loading…" state goes away for
  cache hits.

### Phase 2 — Observability

- `/api/cache/stats` returns `{ count, totalSize, oldestEntry,
  hitRate (rolling 100) }`.
- Editor's bake panel shows a small `✓ cached` badge when `cached: true`.
- `/cache` route — a UI to browse entries (id, params, size, age).

  **Effort**: small. ~50 LOC + route.
  **User value**: see what's in the cache. Debug surprising re-bakes.

### Phase 3 — LRU eviction + clear

- Background sweep when cache > 500 MB or > 1000 entries.
- Drop entries with `lastAccessAt` > 7 days first; then LRU until
  under threshold.
- `POST /api/cache/clear` — wipes everything.
- `POST /api/cache/clear?id=<name>` — drops entries for that part id.

  **Effort**: small. ~80 LOC.

### Phase 4 — GLB cache

- `finalizeManifold`'s result can be re-serialized to GLB via
  `@gltf-transform/core` (already a dep).
- Save GLB alongside the mesh JSON on cache write.
- `/api/primitives/glb?name=X&params=...` checks cache first.
- Useful for the "build N joints then download" flow.

  **Effort**: medium. ~100 LOC. Needs the GLB serializer hooked into
  the bake path.
  **User value**: instant GLB download for previously-baked configs.

## Risks + edge cases

- **`cached: true` response carries no `_t` timings** — the bake panel
  hit-counter might confuse a 0 ms timer with a "still loading" state.
  Fix: include a `cachedAt` field instead.
- **Hash collision** — SHA-256 at 16 hex = 64 bits ≈ collision at
  4 billion entries. Acceptable.
- **Volume proxy in dev** — local dev pointing at the prod volume
  would share cache. Maybe desirable; flag `CADTRAIN_CACHE_LOCAL=1`
  to keep dev cache local.
- **Cache poisoning** — a buggy build that writes wrong data poisons
  the cache. Fix: wrap the cached payload in a `{ schema: 'cadtrain-v1',
  ... }` envelope + version-bust on each cache schema change.

## Acceptance contract

After Phase 1 ships, this should be true:

```
First bake of dt_stand × 3:
  buildFn  944 ms  · geom 33 ms  · finalize 163 ms  · serialize 11 ms

Second bake of dt_stand × 3 (same source + params):
  cached: true · total < 50 ms
```

A param scrub from N=3 to N=4 creates a new cache entry (different
hash). Scrubbing BACK to N=3 hits the cache.

## Open questions for the user

1. **Cache scope** — per-part or global? Per-part means each part has
   its own subdirectory; cleaner GC. Global is simpler.
2. **Volume placement** — `$APP_DATA_DIR/cache/` (proposed) or under
   `ai/` (the existing 4-dir layout)? Proposed lives parallel to
   `primitives/`, `components/`, etc.
3. **Auto-bust on translator change?** When the K.68 translator
   regenerates a part, we want the OLD cached entry invalidated.
   Plan: include `generated_from.rule_hash` in the cache hash.
4. **Phase ordering** — Phase 1 first (most value), then 2 + 4 in
   parallel?

## Implementation plan

1. Memory note `bake_cache_plan` for cross-session continuity.
2. Task #99 tracks this work.
3. On user approval: implement Phase 1 in `src/lib/server/bake-cache.ts`
   + wire into preview endpoint.
4. Add an e2e Phase 25: bake-cache hit on second identical call.
