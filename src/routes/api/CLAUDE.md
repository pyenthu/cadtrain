# `src/routes/api/` — API endpoints

All endpoints read env vars via `$env/dynamic/private` (Rule 3) so
deployment-time variables are honoured without rebuilds.

**Archived 2026-06-01** (moved to `archive/src/routes/api/` — see
`archive/CADTRAIN_CLEANUP.md`): `/api/identify`, `/api/refine` (the
identify-chain one), `/api/accept`, `/api/feedback`, `/api/wells/*`,
`/api/kb/*`. Their lib backends (`src/lib/{identify,training,wells}`)
moved with them. `/api/cache/stats` was restored afterward (`ae88bc0`)
because it's the Railway health check.

## Endpoint catalog

### Primitives (`/graph-editor` + `/primitives` backing API)

`/api/primitives/*`: `list`, `save`, `source`, `delete`, `restore`,
`move`, `rename`, `recognize`, `refine` (Claude-assisted source refine —
ACTIVE, distinct from the archived identify-chain `/api/refine`),
`preview`, `bake-preview`, `compile` (dep-inlined Manifold script + `scriptHash` —
client-exec compiler path; GET saved + POST live emit; local like preview),
`prompts`, `instructions`, and
`profiles/{list,save,delete,resolve,source}`.

Sources are flat typed files on the volume (`<id>.prim.ts` / `.asm.ts`,
profiles `.prvl.ts` / `.prex.ts`); all path resolution goes through
`src/lib/server/primitive-paths.ts`. See root Rule 13 + Rule 20.

**Stdlib/stdstale-first (Rule 21):** before the volume, `source` + `list`
consult `src/lib/server/stdlib.ts` — the git-tracked engines in
`src/lib/graph/stdlib/` (active, currently `r_cuboid`) and
`src/lib/graph/stdstale/` (deprecated: `r_revolve`, `r_extrude`,
`r_weld_extrude`). Either origin wins over a same-named volume copy
(`editable:false`); `list` returns separate `stdlib` + `stdstale` groups;
`save`/`delete` reject both (HTTP 403 — edit in src + redeploy).

**Single live store (since 2026-05-20):** the data endpoints ARE proxied
to prod when `CADTRAIN_VOLUME_REMOTE_URL` is set. The proxy is centralized
in `src/hooks.server.ts` via the `VOLUME_PROXY_PATHS` allowlist (list,
save, source, delete, restore, move, rename, prompts, instructions,
profiles/{list,save,delete,source}, plus `rag/{rebuild,stats,scan-refs,prompt}`).
Excluded (stay local): `preview`, `bake-preview`, `compile`, `profiles/resolve`
(stateless compute — fast local WASM).
The hook also bypasses the proxy for stdlib/stdstale ids on `source` so
local engine edits are visible without a redeploy. `X-Volume-Local: 1`
forces local FS (e2e tests).

### Bake cache + health

| Route | Method | Purpose |
|---|---|---|
| `/api/cache/stats` | GET | Cache statistics — **Railway health check**. |
| `/api/cache/bake-stats` | GET | Bake-cache hit/miss stats (`src/lib/server/bake-cache.ts`). |
| `/api/cache/clear` | POST | Clear the bake cache. |

### RAG (generative-authoring corpus)

| Route | Method | Purpose |
|---|---|---|
| `/api/rag/rebuild` | POST | Rebuild the parts corpus at `<volume>/ai/rag/parts.jsonl` (`src/lib/server/rag-corpus.ts`). |
| `/api/rag/stats` | GET | Corpus record count + last-refresh time (sidebar `↻` footnote). |
| `/api/rag/scan-refs` | POST | Scan for broken `src:'<id>'` references (used by rename's "Repair all"). |
| `/api/rag/prompt` | POST | Phase 2 — `{prompt, k?}` → BM25 top-k exemplars + one Claude call (`RAG_MODEL`, default `claude-sonnet-4-6`) → `{id, candidates, graph}` for the ✨ sidebar generate box. Prod-proxied like rebuild/stats. |

### Vocabulary (K.68 / K.69 — `/vocab` backing API)

Full catalog + design notes in `src/routes/api/vocab/CLAUDE.md`.
Five endpoints — `regenerate`, `infer`, `bake-proposed`, `promote`,
`promote-proposed` — compile vocabulary entries via the deterministic
translators in `src/lib/authoring/` and round-trip through
`/api/primitives/{save,preview}`. Sources of truth:
`docs/parts/vocabulary.json` (curated), `vocabulary.seeds.json`,
`proposed-vocab-entries.json`.

### Volume, forge, dev

| Route | Method | Purpose |
|---|---|---|
| `/api/volume` | GET/PUT/DELETE/POST | Generic CRUD against the persistent volume. Auth via `X-Volume-Token`; local dev proxies to prod via `CADTRAIN_VOLUME_REMOTE_URL`. Sub-endpoints: `volume/backup`, `volume/onedrive`. See Rule 13. |
| `/api/forge/generate` | POST | Image → 3D via FAL Hunyuan3D v2. Needs `FAL_API_KEY`. |
| `/api/__dev_restart` | POST | One-click dev-server restart (graph editor toolbar; dev only). |

## Claude backends

`/api/primitives/refine` uses the dual-backend dispatch primitives in
`src/lib/shared/` (`anthropic-api.ts` + `claude-cli.ts`): API backend
(`@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`) or CLI backend (`claude
--print` subprocess — bills Pro/Max OAuth, local-only, ~5–7× slower).
The archived identify/wells endpoints used the same pattern.

## Environment

```env
ANTHROPIC_API_KEY=sk-ant-...     # required for any `api` Claude backend
FAL_API_KEY=...                  # /api/forge/generate
CADTRAIN_VOLUME_REMOTE_URL=...   # local dev → prod volume proxy (Rule 13)
CADTRAIN_VOLUME_TOKEN=...        # cross-origin volume auth
```

Rate limiting: `src/lib/rate_limit.ts` (token-bucket) is still wired in
`src/hooks.server.ts` but `RATE_LIMITED_PREFIXES` is currently `[]` — the
three previously rate-limited endpoints were archived 2026-06-01. Add a
prefix there when a new expensive endpoint lands.
