# `src/routes/api/` — API endpoints

URL-stable across the 2026-05-10 product restructure (commit `55b1f43`).
Endpoints were intentionally **not** moved to `/api/archive/*` since
renaming would break archived pages. New product code may add
`/api/cad/*` or `/api/wells-v2/*` later.

All endpoints read env vars via `$env/dynamic/private` (Rule 3) so
deployment-time variables are honoured without rebuilds.

## Endpoint catalog

### Identification + cache (CAD)

| Route | Method | Purpose |
|---|---|---|
| `/api/identify` | POST | RAG-based image → component + params. Consumed by `/archive/reverse`. |
| `/api/refine` | POST | Iterative refinement loop (SSIM + Claude param update). |
| `/api/accept` | POST | Append user-validated result to `training_data/cache.jsonl`. |
| `/api/feedback` | POST | Correct/wrong match feedback on identification. |
| `/api/cache/stats` | GET | Training cache statistics. Used as Railway health check. |

### Wells

| Route | Method | Purpose |
|---|---|---|
| `/api/wells/extract` | POST | PDF/image → WSON extraction. `WELLS_BACKEND=cli\|api` (default `api`). |

### Primitives (`/primitives` backing API)

The `/primitives` route is the one true CAD UI. Its data endpoints live
under `/api/primitives/*` (list, save, source, delete, restore, recognize,
refine, preview, bake-preview, prompts, instructions, profiles/*). Sources
are flat typed files on the volume (`<id>.prim.ts` / `.asm.ts`, profiles
`.prvl.ts` / `.prex.ts`); all path resolution goes through
`src/lib/server/primitive-paths.ts`. See Rule 13 + Rule 20.

**Single live store (since 2026-05-20): `/api/primitives/*` data
endpoints ARE proxied to prod** when `CADTRAIN_VOLUME_REMOTE_URL` is set.
The proxy is centralized in `src/hooks.server.ts` via the
`VOLUME_PROXY_PATHS` exact-path allowlist (primitives: list, save, source,
delete, restore). So in local dev a save/render reads+writes the PROD
volume — local dev and prod share ONE store. Excluded (stay local):
`primitives/{preview,bake-preview}` (stateless compute — fast local WASM
render) and `identify` + `refine` + `wells/extract` (VLM — keep the local
API key). `/api/volume` + `/api/kb/*` self-proxy in-endpoint. The
`X-Volume-Local: 1` header forces local FS (e2e tests). This reverses the
prior "a save shouldn't silently mutate prod" stance — the user chose prod
as the single store.

### Volume + KB

| Route | Method | Purpose |
|---|---|---|
| `/api/volume` | GET/PUT/DELETE/POST | Generic CRUD against the persistent data volume rooted at `$APP_DATA_DIR`. Auth via `X-Volume-Token`; local dev can proxy to prod via `CADTRAIN_VOLUME_REMOTE_URL`. See Rule 13. |
| `/api/kb/sources` | GET | Lists `<volume>/kb-sources/*` + sidecar `_index.json` metadata. Powers the KB → Sources sub-tab. |
| `/api/kb/source-pdf` | GET | Streams a PDF from `<volume>/kb-sources/<name>.pdf`. Path-restricted; honours `maybeProxy()`. |

### Authoring (legacy — orphaned)

The `/api/author/*` endpoints (`chat`, `list`, `save`) still exist and
their backing `src/lib/authoring/` module is still imported by `/plan`
and several `src/lib/cad/` files for the `AuthoredComponent` schema +
compose interpreter. But no UI route calls these endpoints any more (the
`/archive/author` + `/archive/library` pages they served were removed).
Candidates for deletion if the authoring chat UI is not coming back.

## Runtime modes — `/api/wells/extract`

| Mode | Auth | Where it works |
|---|---|---|
| **Local + CLI** (`WELLS_BACKEND=cli`) | `claude` CLI subprocess → Pro/Max OAuth → subscription | Local dev only (Railway has no `claude` binary) |
| **Local + API** (default) | `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY` from `.env` | Local dev |
| **Production + API** (default) | `@anthropic-ai/sdk` + Railway env var | Railway Docker |

**CLI mode prerequisites**: `claude` on `$PATH` and authenticated via
OAuth (`claude auth status` should show `"authMethod": "claude.ai"`
and `"loggedIn": true`). Spawned with `--print --output-format json
--no-session-persistence --permission-mode bypassPermissions --add-dir
<tmp>` and given a temp file path to read.

CLI mode is ~5–7× slower per call than API (CLI startup + agent loop
overhead) but doesn't burn API tokens. Subject to Pro/Max
session-window rate limits.

Backend dispatch lives in `src/lib/wells/backend.ts`; both backends
return the same `WellsExtractResponse` shape so the endpoint code is
unified.

## Runtime modes — `/api/identify`

`IDENTIFY_BACKEND=api|cli` (default `api`) selects the same way:

| Mode | RAG retrieval | Notes |
|---|---|---|
| **API** | Yes — top-K=5 neighbours from `cache.jsonl` are sent as image blocks alongside the target | Production behaviour |
| **CLI** | No — sends only the target image path + 18-primitive catalog text. Cold classification. | RAG-via-file-paths is a deferred follow-up; the agent can't accept image blocks like the API can |

Backend dispatch lives in `src/lib/identify/backend.ts`.
Cold-classification accuracy was 94.4% (17/18) on synthetic `var_1.png`
renders — see root CLAUDE.md "Open TODOs" for the implications.

## Environment

```env
ANTHROPIC_API_KEY=sk-ant-...               # required for any `api` backend
WELLS_BACKEND=api                          # 'api' (default) or 'cli'
WELLS_MODEL=claude-opus-4-7                # API-backend default
WELLS_CLI_MODEL=opus                       # CLI-backend default alias
IDENTIFY_BACKEND=api                       # 'api' (default) or 'cli'
IDENTIFY_MODEL=claude-sonnet-4-20250514    # API-backend default
IDENTIFY_CLI_MODEL=opus                    # CLI-backend default alias
```

Rate limiting (token-bucket) sits in `src/lib/rate_limit.ts` and
applies to `/api/identify`, `/api/refine`, and `/api/author/chat`
(while it still exists) at 20 req / 10 min per IP.
