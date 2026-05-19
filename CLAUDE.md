# CAD Train — Project Context for Claude Code

Parametric 3D CAD pipeline for downhole tool components, built as a
**SvelteKit** app with **ManifoldCAD** for geometry, **Threlte** for
3D rendering, and **Claude vision** + a **persistent training cache**
for reverse identification (PNG → component + params).

## Where to look for what

This file holds project-wide rules, tech stack, top-level routes, and
the project layout. Domain detail lives in subdirectory CLAUDE.md
files (auto-loaded when working in that subtree):

| File | Covers |
|---|---|
| `src/routes/api/CLAUDE.md` | Full API endpoint catalog + runtime modes + env vars |
| `src/routes/components/CLAUDE.md` | `/components` sidebar, family classification, inspector conventions |
| `src/routes/archive/CLAUDE.md` | Archive routes + RAG identification pipeline + authoring core |
| `src/lib/cad/CLAUDE.md` | Geometry (Z-down), rendering, SVG export, volume component loader |
| `src/lib/wells/CLAUDE.md` | WSON schema + 5-layer validation pattern |
| `src/lib/shared/CLAUDE.md` | Dual-backend dispatch + cad↔wells no-cross-import |
| `tests/CLAUDE.md` | Unit + e2e setup, run modes, per-task recordings |
| **`docs/CAD_AUTHORING.md`** | **Volume primitive authoring guide — read FIRST when generating or editing any `<volume>/primitives/<id>/source.ts`. Covers param types, apply/save contract, Manifold gotchas (scaleTop+warp collapse, Vec3 tuple, immutable ops, refine n²).** |

## Rules for Claude (read me first)

1. This repo uses **Bun + SvelteKit + adapter-node**. Never switch to adapter-static or add Python to the runtime.
2. **Two-product structure** (since commit `55b1f43`, 2026-05-10): the active CAD UI is `/components`, the active Wells UI is `/wells` (stub pending port). The previous implementation lives under `/archive/*` as reference. New product code goes in `src/lib/cad/` or `src/lib/wells/` — these MUST NOT cross-import. Both may import from `src/lib/shared/*`.
3. All API endpoints must use `$env/dynamic/private` (not `$env/static/private`) so env vars are read at runtime, not build time.
4. The training cache at `training_data/cache.jsonl` is the app's long-term memory. Writes must be atomic (temp file + rename). Never delete it without backup.
5. Follow plan files in `~/.claude/plans/`. Don't add features outside the current plan's scope.
6. Before destructive operations (`rm`, `git rm`, `git reset --hard`), show the plan and wait for approval.
7. Commit after each numbered plan step completes, not after each small edit.
8. Test changes locally (`bun run build` + `bun test` + e2e if relevant) before committing.
9. When asked to review or audit, use Explore subagents for read-only exploration. Don't modify files during exploration.
10. Railway deploys via `Dockerfile` (not Railpack). `railway.toml` sets `builder = "DOCKERFILE"`.
11. **Prompt for e2e testing after non-trivial UI/route/backend changes.** When the change adds/moves/removes routes, modifies the navbar, alters API contracts, or could break inter-page navigation, ask the user before merging: *"Run e2e tests now? **headless** (fast, ~15s, just verifies routes load and links resolve) or **headed** (slower, opens a real browser at slow_mo 250 so you can watch)?"* Don't auto-run tests for trivial edits.
12. **Each logical plan step gets a recorded e2e run.** See `tests/CLAUDE.md` for the recording + harvest workflow.
13. **Persistent data volume.** Production URL: **`https://cadtrain.up.railway.app`** (NOT `.com` — Railway uses `.up.railway.app`). All cadtrain state that must survive redeploys lives on a single volume rooted at `$APP_DATA_DIR` (Dockerfile defaults `/app_data`; local dev falls back to `./.dev-volume/`). Sub-paths in use:
    - `$APP_DATA_DIR/training_data/cache.jsonl` — RAG cache for /api/identify
    - `$APP_DATA_DIR/training_data/authored_cache.jsonl` — authored-components cache (dormant; backing UI removed)
    - `$APP_DATA_DIR/library/<category>/<id>/` — the component **library**. Each part is a self-contained directory (`component.ts`, `picture.png`, `mesh.glb`, `instructions.md`, `prompts.json`, `meta.json`); the directory's LOCATION (`test` | `basic` | `parts` | `assemblies`) IS its sidebar category. See `src/lib/server/library.ts` (`resolvePart`). **No `/api/components/*` proxy** — the whole family is dev-local so all writes agree on one store. See Rules 17 + 18.
    - `$APP_DATA_DIR/kb-sources/*.pdf` — vendor reference PDFs served by /api/kb/source-pdf
    - `$APP_DATA_DIR/kb/index.json` + `kb/api/*.json` — structured KB tables; fetched via `/api/volume?path=kb/...` by the KB DB sub-tab. Re-extracted by `scripts/kb/*.ts` then re-uploaded.
    - `$APP_DATA_DIR/figures/` — `scripts/extract_figures.ts` PDF-page renders + `gallery.json` (Test tab figure gallery)
    - `$APP_DATA_DIR/test-recordings/` — Playwright WEBMs + `e2e/<task>/` videos + `manifest.json` (`/archive/tests` + `/plan` popups)
    - `$APP_DATA_DIR/eval/` — `wells/` + `components/` recognition eval fixtures
    - **Nothing data/test-related lives in `static/` or git anymore** — `static/` holds only build output (`components/*.glb`, gitignored). The volume CRUD endpoint serves all of the above; the `/volume` route is a browser/file-manager for it.

    **Root resolution** (`src/lib/server/volume.ts`): `CADTRAIN_VOLUME_ROOT` → `RAILWAY_VOLUME_MOUNT_PATH` → `APP_DATA_DIR` → `/app_data` → `./.dev-volume`. New endpoints that need persistent storage MUST call `volumePath(rel)` and call `maybeProxy(request, url)` first.

    **Local dev → prod volume**: set in `.env.local`:
    ```
    CADTRAIN_VOLUME_REMOTE_URL=https://<service>.up.railway.app
    CADTRAIN_VOLUME_TOKEN=<openssl rand -hex 32 — same value on Railway>
    ```
    Every `bun dev` call to `/api/volume` or `/api/kb/source-pdf` then proxies to prod with `X-Volume-Token`. Single source of truth.

    **Auth model**: `CADTRAIN_VOLUME_TOKEN` on prod gates cross-origin requests. Same-origin browser sessions are trusted without explicit token plumbing. When the env var is unset locally, the endpoint is open.

    **Transfer commands** (run from local against prod — Origin header is required to satisfy SvelteKit's CSRF guard on PUT/POST/PATCH/DELETE):
    ```sh
    # Upload
    curl -X PUT \
      -H "Origin: https://<svc>.up.railway.app" \
      -H "X-Volume-Token: $CADTRAIN_VOLUME_TOKEN" \
      --data-binary @local-bha.pdf \
      "https://<svc>.up.railway.app/api/volume?path=kb-sources/bha-reference.pdf"

    # Download
    curl -H "X-Volume-Token: $CADTRAIN_VOLUME_TOKEN" \
      "https://<svc>.up.railway.app/api/volume?path=kb-sources/bha-reference.pdf" \
      -o local-bha.pdf

    # List a directory (JSON tree, depth 1)
    curl -H "X-Volume-Token: $CADTRAIN_VOLUME_TOKEN" \
      "https://<svc>.up.railway.app/api/volume?path=kb-sources"

    # Delete
    curl -X DELETE \
      -H "Origin: https://<svc>.up.railway.app" \
      -H "X-Volume-Token: $CADTRAIN_VOLUME_TOKEN" \
      "https://<svc>.up.railway.app/api/volume?path=kb-sources/old.pdf"

    # mkdir
    curl -X POST \
      -H "Origin: https://<svc>.up.railway.app" \
      -H "X-Volume-Token: $CADTRAIN_VOLUME_TOKEN" \
      "https://<svc>.up.railway.app/api/volume?path=archive&action=mkdir"
    ```

    **Upload ceilings (two limits).** (1) adapter-node `BODY_SIZE_LIMIT` — Dockerfile sets `64M`; a Railway service variable of the same name overrides it. (2) Railway's edge request timeout — uploads exceeding it 502 ("Application failed to respond") regardless of body size. Files ≳10–15 MB on slow uplinks need a manual transfer (Railway shell / volume mount). Small/medium files (≤~10 MB) go through fine.

    **Verification — Playwright volume spec** (`tests/e2e/volume.spec.ts`): see `tests/CLAUDE.md` for the three modes (local / dev-via-proxy / direct-prod).

14. **Compounding context for drawings — components + assembly recipes.** Before generating a new single-file component or composing a multi-part assembly, check the catalog:
    - **Per-component specs**: `src/lib/cad/components/<id>.md` — each single-file component should have a sibling `.md` documenting what real-world part it models, vocabulary, validation, derived params. Template: `docs/PRIMITIVE_TEMPLATE.md`. Strong example: `src/lib/cad/components/conn_box.md`.
    - **Multi-primitive assembly recipes**: `docs/assemblies/<name>.md`. Index + when-to-write rules: `docs/assemblies/README.md`. Template: `docs/assemblies/_TEMPLATE.md`. First worked example: `docs/assemblies/tubing_hanger_spool_stack.md`.
    - **When you build a new assembly or rename a primitive's vocabulary, write/update the corresponding `.md` BEFORE committing** — that's the only durable handoff to future sessions. Conversation memory evaporates; these files don't.

15. **Never write user-pasted secrets to disk; refuse, advise rotation, redirect to secure-entry.** When the user pastes a credential (API key, token, password, private key) — treat it as already exposed. Do NOT write it to `.env`, `.env.local`, scripts, commits, or any other file — even gitignored ones, because conversation history retains the value. Do NOT echo it back in tool calls (Bash, Edit, Write) — that leaks it into transcript logs.

    **Correct response**:
    - Flag the exposure: "that key is now in the transcript — rotate it."
    - Direct the user to the canonical secure-entry channel:
      - Local: they edit `.env` / `.env.local` themselves.
      - Railway: Variables tab in the service dashboard.
      - Anthropic API keys: https://console.anthropic.com/settings/keys.
    - Offer to set up structure (env var name, file location) without ever touching the value.

16. **Sidebar entry classification — two-axis (tab → group → entry).** The `/components` sidebar uses a consistent pattern. New components are placed by editing ONE central map (`src/lib/cad/components/families.ts`); the UI auto-groups, filters, and collapses based on it. Full UI contract in `src/routes/components/CLAUDE.md`.

17. **Three layers — primitives ↔ components ↔ recipes.** Post `components/primitives-split` plan (2026-05-18):
    - **Primitives** (`src/lib/cad/manifold-helpers.ts` — `cyl`, `tube`, `helix_band`, `revolve`, …): backend geometry toolkit. Raw functions returning a `Manifold`. NOT a stable API — signatures can churn. Recipes CANNOT call primitives directly (`STRICT_RECIPE_CALLS = true` in `part-recipe.ts` rejects with a friendly error pointing at the wrapping pattern). Surfaced in the `/primitives` library route for inspection / live editing (in flight).
    - **Components** — two flavours:
      - **Bundle** in `src/lib/cad/components/<id>.ts`. Exports `meta` (params schema) + `geom(p)`. Calls primitives directly. Rendered client-side via `buildComponent`. The 26 baseline + new wrappers like `thread_helix`.
      - **Library** in `<volume>/library/<cat>/<id>/part.json`. JSON recipe — no `.ts`, no sandbox. The ONLY legal `call:` targets are component ids (bundle OR library) + recipe operators (mv, rot).
    - **Recipes** (the `instances[] + composition[]` model inside library JSON parts) are interpreted by `src/lib/server/part-recipe.ts:buildRecipe`. Tier 1 expression language: arithmetic + `p.<param>` + `<INST>.<argName>` + whitelisted `Math.*`. No conditionals, no loops. Implicit translation: an instance with `top` arg AND non-zero resolved value gets `mv(0, 0, top)` prepended before user transforms.
    - **renderMode** on `/api/components/list` is still `'client'` (bundle) vs `'server'` (library JSON via `/api/components/geom`).

    The picture → AI → JSON → volume workflow uses `'server'`. Bundle components stay git-tracked + compiled; library parts live on the volume and never need a bundle rebuild.

    **part.json shape** (`<volume>/library/<cat>/<id>/part.json`):
    ```jsonc
    {
      "meta": {
        "id": "<id>", "name": "...", "description": "...", "tags": [...],
        "family": "drillstring|wellhead_xt|...",
        "params": { "od": { "label":"OD", "min":1, "max":10, "step":0.125, "default":4.5, "unit":"in" } }
      },
      "instances": [
        { "name": "A", "call": "<helper or component id>",
          "args": { "<argName>": { "lit": 4.5 }, "<other>": { "expr": "p.foo * 2" } },
          "transforms": [ { "op": "mv", "args": [{"lit":0},{"lit":0},{"expr":"A.length"}] } ]
        }
      ],
      "composition": [
        { "op": "add",      "of": "A" },
        { "op": "subtract", "of": "B" }
      ]
    }
    ```
    - Args: `{lit:<n>}` or `{expr:"<tier-1>"}`. Tier 1 = arithmetic + `p.<param>` + `<INST>.<argName>` cross-instance refs + `Math.*` whitelist (abs, sign, floor, ceil, round, trunc, sqrt, cbrt, pow, exp, log, log{2,10}, sin, cos, tan, a{sin,cos,tan,tan2}, min, max, PI, E). No conditionals, no loops.
    - Transforms: `mv` and `rot` take three scalar args (x, y, z) — the recipe expresses vec3s as three Tier 1 expressions, not a single nested array.
    - Composition order matters for `subtract` / `intersect`. The interpreter walks left-to-right and folds through one `GeomAcc`.
    - **Name resolution**: helpers + operators (`cyl`, `tube`, `mv`, `rot`) are the canonical namespace and win on collision — never name a library part `tube` or `cyl`. Convention: suffix library parts with `_part` when the natural name would collide.

    **Authoring + AI**: the inspector Builder tab routes JSON parts to a `lang=json` editor; the Parts tab shows a "edit instances in Builder" banner (form-driven JSON Parts editor is a follow-up). The refine endpoint (`/api/components/refine`) accepts either `source` (legacy .ts) or `recipe` (JSON) and emits the matching shape — schema validator + 1-shot retry on bad output.

    **Legacy .ts loader path** (`loadGeomFromSource`, `parseImports`, `enforceSplitGrammar`, `expandInstancePropRefs`) is still kept so the Builder tab can preview in-flight edits to bundle primitives in `src/lib/cad/components/*.ts`. No library part uses it any more — every `library/<cat>/<id>/` now has a `part.json`. Plan: `~/.claude/plans/grammar-split-init-compose.md` (which describes the intermediate split-grammar TS shape; the JSON pivot supersedes Stage G onward).

18. **The library — directory-per-part, location = category.** A part is a self-contained directory under `<volume>/library/<category>/<id>/`. **Its location IS its classification.** No central index, no metadata map that can drift. `src/lib/server/library.ts` is the resolver (`resolvePart`, `listLibraryParts`, `categoryDir`, `partDirIn`). Flow: create → test → review → move → category. `/api/components/save` with `create: true` writes to `library/test/<id>/`; updates write back into the part's current category dir; `/api/components/move` does an atomic `rename` to promote. `/library/` is gitignored.

## Open TODOs (out-of-scope findings)

- **Default-param primitive renders collapse for pHash AND CLIP.**
  Originally discovered 2026-04-13 with pHash; confirmed for CLIP on
  2026-05-09. Four primitives (`seal_bore_polished`,
  `packer_element`, `nc_numbered_connection`, `grooved_cylinder`)
  share a 64-bit pHash. CLIP collapses even more — cosine = 1.000
  between **12 of 18** primitives on the synthetic render set
  because default-param renders strip away every visual cue CLIP was
  trained on (colour, shading, texture, 3D form).

  CLIP infrastructure stays in place: it likely still helps for real
  photo uploads to `/api/identify` (different domain), and the
  embeddings are on every cache record.

  **Counter-finding (2026-05-09):** CLI/Opus cold classification (no
  RAG, no embeddings, no retrieval — just the catalog text + image)
  hit **17/18 (94.4%)** on `var_1.png` per primitive. The single
  miss (`taper_cone` → `thread_eue`) came in at 0.6 confidence — the
  model knew it was uncertain. This contradicts the assumption that
  the retrieval scaffolding is load-bearing; for the rendered
  synthetic domain at least, raw VLM is enough. Before investing in
  CLIP fine-tuning or pipeline changes, run the multi-variant
  ablation (`var_1..var_20` × CLI/Opus, no RAG vs API/Sonnet with
  RAG). See `~/.claude/plans/components-cli-recognition.md` for the
  deferred queue.

## Tech stack

- **Runtime:** Bun (dev) / Node.js 22 (production via adapter-node)
- **Framework:** SvelteKit (Svelte 5 runes mode)
- **3D:** ManifoldCAD (WASM) + Three.js via Threlte
- **SVG:** `three-svg-renderer` for vector export of 3D scenes
- **Image ops:** `sharp` for decode/resize/pHash
- **VLM:** Claude vision API (`@anthropic-ai/sdk`)
- **Deployment:** Docker → Railway (volume-backed cache persistence)

## Commands

```bash
bun install              # install deps
bun run dev              # dev server on :3333
bun run build            # production build (adapter-node)
bun run start            # run the production build (node build)
bun run seed             # rebuild training_data/cache.jsonl from prim_* records
bun test                 # vitest unit tests
bun run test:e2e         # Playwright e2e (headless, ~15s)
bun run test:e2e:headed  # Playwright e2e (headed, slow_mo 250 — watch in browser)
bun run test:e2e:report  # open last HTML report
```

**Always prefer Bun over Node** for running scripts (bun.lock is the lockfile).

## Top-level routes

| Route | Purpose |
|---|---|
| `/` | Landing page — links to Primitives, Wells, Plan, Archive |
| `/components` | **CAD product UI** — sidebar-of-components + canvas + inspector. See `src/routes/components/CLAUDE.md`. |
| `/wells` | Wells product overview — stub pointing at `/archive/wells` until ported |
| `/volume` | File manager for the persistent data volume (`/api/volume` CRUD UI) |
| `/archive` | Index of legacy routes — see `src/routes/archive/CLAUDE.md` |
| `/plan` | Gantt-style roadmap (bundles A–F) with click-through detail popups |

**Removed**: `/cad`, `/author`, `/library`, `/archive/author`,
`/archive/library` — none of these directories exist any more.
References to them in older CLAUDE.md versions and in
`src/routes/plan/details.ts` are stale.

API endpoints are URL-stable across the restructure — see
`src/routes/api/CLAUDE.md` for the full catalog.

## Project layout

```
src/
├── app.html                          # SvelteKit HTML shell
├── hooks.server.ts                   # auth gate + rate limiting
├── routes/
│   ├── +layout.svelte                # nav: Primitives | Wells | Tests | Archive
│   ├── +layout.ts                    # ssr=false, prerender=false
│   ├── +page.svelte                  # landing — 4 inline links
│   ├── primitives/+page.svelte       # active CAD UI
│   ├── wells/+page.svelte            # stub overview
│   ├── volume/+page.svelte           # volume file manager
│   ├── plan/                         # Gantt roadmap + details
│   ├── archive/                      # legacy implementation (see archive CLAUDE.md)
│   └── api/                          # all API endpoints (see api CLAUDE.md)
└── lib/
    ├── shared/                       # cross-domain infra (see shared CLAUDE.md)
    ├── cad/                          # CAD domain (see cad CLAUDE.md)
    ├── wells/                        # Wells domain (see wells CLAUDE.md)
    ├── identify/backend.ts           # CAD identify dispatch — uses shared/
    ├── server/                       # server-only: volume.ts, library.ts, component-loader.ts
    ├── authoring/                    # AuthoredComponent schema + compose interpreter (UI removed; schema still used)
    ├── training/                     # cache.ts, phash.ts, embed.ts, image_diff.ts
    ├── tools/                        # bottom-sub/, ratch-latch/ (used by /archive/tools/*)
    ├── viewer/builder.ts             # generic tabbed training-data viewer (used by /archive/training)
    └── rate_limit.ts                 # token-bucket rate limiter

static/
├── training_data -> ../training_data # symlink so images are URL-accessible
├── tests/                            # gitignored
└── components/                       # Baked .glb meshes — gitignored, regenerable

# Persistent volume ($APP_DATA_DIR — local dev: repo root when kb-sources/
# is present, else ./.dev-volume; Railway: /app_data). NOTHING here is in
# git; everything is served to the app via /api/volume. See Rule 13.
<volume>/
├── figures/                          # extract_figures.ts PDF-page renders + gallery.json
├── test-recordings/                  # Playwright WEBMs + e2e/<task>/ videos + manifest.json
├── kb/                               # KB tables — index.json + api/*.json
├── kb-sources/                       # vendor/operator reference PDFs + _index.json sidecar
├── eval/                             # eval datasets — wells/ + components/ recognition fixtures
├── library/                          # directory-per-part component library
└── training_data/                    # cache.jsonl + authored_cache.jsonl

training_data/                         # local mirror in dev (volume root when kb-sources/ present)
├── cache.jsonl
├── authored_cache.jsonl
├── authored_context.md
├── prim_<component>/                 # seed training data (18 primitives × ~5 variations)
└── reference/                        # thread spec data etc.

kb-sources/                            # local copy of vendor/operator PDFs feeding scripts/kb/. GITIGNORED. Canonical copy is on the volume.

scripts/
├── _volume.ts                        # volumeRoot()/volumePath() for standalone scripts
├── seed_cache.ts                     # populate cache.jsonl from prim_* training data
├── extract_figures.ts                # PDF-page renders → <volume>/figures/
├── gen_synthetic.ts                  # synthetic training-data generator
├── generate_authored_library.ts      # bulk AuthoredComponent emitter
├── harvest_e2e_videos.ts             # copy Playwright WEBMs to <volume>/test-recordings/e2e/<task>/
├── index_hal_catalog.ts              # ingest HAL catalog assets
├── migrate_to_clip.ts                # one-shot CLIP embedding backfill
├── overnight_extract.ts              # batch wells extraction over the eval set
├── inspect_catalog_pdf.py            # one-off Python inspector
├── snap_dev.mjs                      # dev screenshot helper
├── kb/                               # KB table re-extractors
└── prompts/                          # prompt templates loaded by scripts

docs/
├── PRIMITIVE_TEMPLATE.md
├── RULES.md
├── assemblies/                       # multi-primitive assembly recipes
└── plans/                            # active design docs

Dockerfile                             # bun build → node:22-slim runtime (~250MB)
docker-entrypoint.sh                  # handles /data volume symlink for cache.jsonl
railway.json                           # Railway deployment config
.env                                   # ANTHROPIC_API_KEY (gitignored)
```

## Svelte 5 runes gotchas

- Reactive state: `let x = $state(0)` — not `let x = 0`
- Derived: `let y = $derived(expr)` — not `$:`
- Effects: `$effect(() => { ... })` — runs client-side only when deps change
- Props: `let { foo = $bindable() } = $props()` for two-way binding
- **SSR off**: `src/routes/+layout.ts` has `export const ssr = false` and `export const prerender = false` — everything runs client-side because ManifoldCAD is a WASM module that can't run on the server
- **Lazy imports** for Three.js components in routes to avoid SSR issues:
  ```ts
  let SceneComponent = $state<any>(null);
  $effect(() => {
    import('$shared/ComponentScene.svelte').then(m => { SceneComponent = m.default; });
  });
  ```

## Deployment

### Local Docker
```bash
docker build -t cadtrain .
docker run -p 3333:3333 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v $(pwd)/data:/data \
  cadtrain
```

### Railway
1. Push to GitHub (already connected: `pyenthu/cadtrain`)
2. Railway auto-detects `Dockerfile`
3. Set `ANTHROPIC_API_KEY` in service variables
4. Attach volume at `/app_data`
5. Health check: `/api/cache/stats`

## Things to know / avoid

- **Never** revert to `@sveltejs/adapter-static` — we need SSR for API routes
- **Never** add Python to the production container — the `/api/refine` endpoint uses pure-TS image diff (`src/lib/training/image_diff.ts`). The historical `vlm/` Python tools were deleted; don't re-introduce them.
- **Node 22.2.0** is too old for Vite 8 — use `bun --bun run vite dev` locally if you see the warning, or use Node ≥ 22.12
- Running multiple Vite servers on different ports at once will conflict — **the main SvelteKit app on port 3333 supersedes all legacy viewers**
- When adding a new bundle primitive, edit `src/lib/cad/components/families.ts` (Rule 16) — adding to `src/lib/cad/library.ts` is only for the legacy ComponentDef catalog
- Training data under `training_data/cache.jsonl` should be committed when it grows meaningfully — it's the app's learned memory

## Related directories

- `archive/` — archived legacy work (gitignored): `BOTTOM_SUB_legacy/`, `HAL_PACKERS/`, `HAL_WPS/`, `scripts/`, `training_data_extras/`. Kept locally as a safety net, not committed.
