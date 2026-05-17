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

### Components library (`/primitives` backing API)

| Route | Method | Purpose |
|---|---|---|
| `/api/components/list` | GET | Single-file component registry (one `*.ts` per component under `src/lib/cad/components/` plus library parts from `<volume>/library/`). Powers `/primitives` Basic + Parts + Assemblies tabs. |
| `/api/components/save` | POST | Write a new / updated component file. Bundle parts (`src/lib/cad/components/<id>.ts`) only when editing existing src; creating a new id always writes to `library/test/<id>/` instead. |
| `/api/components/refine` | POST | Claude-driven source rewrite for one component (the AI Refine tab). |
| `/api/components/delete` | POST | Remove a component file (plus its `.glb` bake). |
| `/api/components/instructions` | POST | Write `<id>.md` instructions sidecar for a component. |
| `/api/components/geom` | POST | `{ id, params, zScale? }` → server-side ManifoldCAD render for a **library part**. Transpiles + sandbox-executes `library/<cat>/<id>/component.ts`, returns serialized `{ full, cutVC }` mesh-JSON. Bundle primitives render client-side and never hit this. See Rule 17. |
| `/api/components/move` | POST | `{ id, category, family?, level? }` — promote a Test-tab part: atomic `rename` of the part directory + writes its `meta.json`. See Rule 18. |
| `/api/components/rename` | POST | `{ oldId, newId }` — rename a library part's directory slug. Atomic dir move + rewrites `meta.id` in the moved `component.ts` + walks every other library part and rewrites `from './<oldId>'` import specifiers. Refuses bundle primitives + collisions. |
| `/api/components/prompts` | GET/PUT | `?id=<id>` per-component AI prompt history, stored at `library/<cat>/<id>/prompts.json`. Backs the AI inspector tab's History sub-tab. |
| `/api/components/picture` | GET | `?id=<id>` streams a library part's `picture.png` (reference figure). |

**None of the `/api/components/*` endpoints are proxied** — they all
operate on the LOCAL library (`<volume>/library/`), so in proxied dev
mode they still talk to the local store rather than prod. This is
deliberate: a save shouldn't silently mutate prod.

### Volume + KB

| Route | Method | Purpose |
|---|---|---|
| `/api/volume` | GET/PUT/DELETE/POST | Generic CRUD against the persistent data volume rooted at `$APP_DATA_DIR`. Auth via `X-Volume-Token`; local dev can proxy to prod via `CADTRAIN_VOLUME_REMOTE_URL`. See Rule 13. |
| `/api/kb/sources` | GET | Lists `<volume>/kb-sources/*` + sidecar `_index.json` metadata. Powers the KB → Sources sub-tab. |
| `/api/kb/source-pdf` | GET | Streams a PDF from `<volume>/kb-sources/<name>.pdf`. Path-restricted; honours `maybeProxy()`. |

### Authoring (legacy — orphaned)

The `/api/author/*` endpoints (`chat`, `list`, `save`) still exist and
their backing `src/lib/authoring/` module is still imported by
`/primitives`, `/plan`, and several `src/lib/cad/` files for the
`AuthoredComponent` schema + compose interpreter. But no UI route
calls these endpoints any more (the `/archive/author` + `/archive/library`
pages they served were removed). Candidates for deletion if the
authoring chat UI is not coming back.

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
