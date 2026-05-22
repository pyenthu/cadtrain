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

    **Local dev → prod volume**: set `CADTRAIN_VOLUME_REMOTE_URL` + `CADTRAIN_VOLUME_TOKEN` in `.env.local` and every `bun dev` call to `/api/volume` proxies to prod (token gates cross-origin; same-origin browser sessions are trusted; unset locally = open). Operational reference — `.env.local` setup, curl transfer commands (upload/download/list/delete/mkdir), upload ceilings, and the Playwright verification spec — lives in **`docs/VOLUME_TRANSFER.md`**.

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

    **Name resolution (behavioral rule)**: helpers + operators (`cyl`, `tube`, `mv`, `rot`) are the canonical namespace and win on collision — **never name a library part `tube` or `cyl`**. Suffix library parts with `_part` when the natural name would collide.

    **Full `part.json` shape** — the schema, Tier-1 expression grammar (`{lit}`/`{expr}` + `Math.*` whitelist), `mv`/`rot` transforms, composition order, authoring/refine flow, and the legacy .ts loader path — is in **`docs/LIBRARY_PART.md`**. Read it before generating or editing any `library/<cat>/<id>/part.json`.

18. **The library — directory-per-part, location = category.** A part is a self-contained directory under `<volume>/library/<category>/<id>/`. **Its location IS its classification.** No central index, no metadata map that can drift. `src/lib/server/library.ts` is the resolver (`resolvePart`, `listLibraryParts`, `categoryDir`, `partDirIn`). Flow: create → test → review → move → category. `/api/components/save` with `create: true` writes to `library/test/<id>/`; updates write back into the part's current category dir; `/api/components/move` does an atomic `rename` to promote. `/library/` is gitignored.

## Open TODOs (out-of-scope findings)

Research findings (default-param pHash/CLIP collapse, the cold-classification
counter-finding, and the deferred ablation queue) live in **`docs/FINDINGS.md`**
and the session memory. Not day-to-day rules.

## Current work in flight (2026-05-22 — resume point)

> Living section — clear entries as they land. Full detail in the session
> memory handoff (`session_handoff_2026-05-22`).

- **Cutaway unify** — one shared cut+classify module for client `builder.ts` + server `manifold-bake.ts` (drifted: server lacks the `material` path), plus a server/client render policy keyed on IP sensitivity.
- **Per-part dynamic editor** (decision pending) — per-part editing UI from the volume: declarative descriptor + main-source component registry (`<svelte:component>`) vs runtime-compiled volume `.svelte`. See memory `todo_per_part_dynamic_editor`.
- **Non-manifold / CSG-split detection** — plan needed; see memory `todo_nonmanifold_csg_split`.

Shipped this session: CLAUDE.md trim · profile-builder popup · Save As · Volume→OneDrive button (dev-only) · profiles→named polygon params (composites declare `type:'polygon'` params + Parts-tab "Promote to param").

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

# Persistent volume (<volume> = $APP_DATA_DIR; see Rule 13 for sub-paths +
# root resolution). NOTHING here is in git; all served via /api/volume.
# Sub-dirs: figures/ test-recordings/ kb/ kb-sources/ eval/ library/ training_data/
# Local dev mirror: training_data/ (cache.jsonl + prim_<component>/ seed data,
# 18 primitives × ~5 variations) and kb-sources/ (gitignored; canonical copy on volume).

scripts/                               # _volume.ts, seed_cache.ts, extract_figures.ts,
                                       # gen_synthetic.ts, harvest_e2e_videos.ts, migrate_to_clip.ts,
                                       # overnight_extract.ts, kb/ (table re-extractors), prompts/, …

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
