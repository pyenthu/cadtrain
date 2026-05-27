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
| `src/routes/archive/CLAUDE.md` | Archive routes + RAG identification pipeline + authoring core |
| `src/lib/cad/CLAUDE.md` | Geometry (Z-down), rendering, SVG export, builder render helpers |
| `src/lib/wells/CLAUDE.md` | WSON schema + 5-layer validation pattern |
| `src/lib/shared/CLAUDE.md` | Dual-backend dispatch + cad↔wells no-cross-import |
| `tests/CLAUDE.md` | Unit + e2e setup, run modes, per-task recordings |
| **`docs/CAD_AUTHORING.md`** | **Volume primitive authoring guide — read FIRST when generating or editing any `<volume>/primitives/<id>/source.ts`. Covers param types, apply/save contract, Manifold gotchas (scaleTop+warp collapse, Vec3 tuple, immutable ops, refine n²).** |

## Rules for Claude (read me first)

1. This repo uses **Bun + SvelteKit + adapter-node**. Never switch to adapter-static or add Python to the runtime.
2. **Two-product structure** (since commit `55b1f43`, 2026-05-10): the active CAD UI is **`/primitives`** (the old `/components` route + its whole backing stack — `/api/components/*`, `src/lib/cad/components/`, `server/library.ts`, `component-loader.ts`, the recipe chain — was deleted 2026-05-27; `/primitives` is now the one CAD UI). The active Wells UI is `/wells` (stub pending port). The previous implementation lives under `/archive/*` as reference. New product code goes in `src/lib/cad/` or `src/lib/wells/` — these MUST NOT cross-import. Both may import from `src/lib/shared/*`.
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
13. **Persistent data volume.** Production URL: **`https://cadtrain.up.railway.app`** (NOT `.com` — Railway uses `.up.railway.app`). All cadtrain state that must survive redeploys lives on a single volume rooted at `$APP_DATA_DIR` (Dockerfile defaults `/app_data`; local dev falls back to `./.dev-volume/`). **4-dir layout (2026-05-24): `archive/` · `components/` · `ai/` · `primitives/`.** Sub-paths in use:
    - `$APP_DATA_DIR/components/<category>/<id>/` — **DORMANT** former component **library** (directory-per-part). The reading code (`server/library.ts`, `component-loader.ts`, `/api/components/*`) was deleted with the components product 2026-05-27; the on-volume data may still exist but nothing serves it. Do not build new features on it — use `primitives/` below.
    - `$APP_DATA_DIR/primitives/<category>/<id>.prim.ts` — primitive sources as **flat typed files** (file-based layout, 2026-05-26; the **mid-extension is the type**: `.prim.ts` primitive · `.asm.ts` assembly). Profiles live at `primitives/profiles/<id>.prvl.ts` (revolve) / `.prex.ts` (extrude) — meta + `build()` in **one module** (replaced the old `profile.json` + `source.ts` pair). Categories: `basic/`, `completions/<family>/`, `archive/` (the `industrial/` category was removed 2026-05-27). **All path resolution goes through `src/lib/server/primitive-paths.ts`** (the single resolver — `findPrim`/`findProfile`/`listEntitiesIn`); it resolves the new flat files FIRST and still READS the legacy `<id>/source.ts` + `profiles/<id>/{profile.json,source.ts}` folders (dual-read) for any unmigrated volume. See `docs/plans/file-based-architecture.md`. **NOTE (2026-05-27): `r_revolve` + `r_extrude` are NO LONGER on the volume — they moved to src stdlib (Rule 21); their volume copies + `r_rotate` were archived. The volume now holds user/domain parts, not those engine primitives.**
    - `$APP_DATA_DIR/ai/training_data/cache.jsonl` — RAG cache for /api/identify (the in-image `training_data/` working path is symlinked here by `docker-entrypoint.sh`).
    - `$APP_DATA_DIR/ai/training_data/authored_cache.jsonl` — authored-components cache (dormant; backing UI removed)
    - `$APP_DATA_DIR/ai/kb-sources/*.pdf` — vendor reference PDFs served by /api/kb/source-pdf
    - `$APP_DATA_DIR/ai/kb/index.json` + `ai/kb/api/*.json` — structured KB tables; fetched via `/api/volume?path=ai/kb/...` by the KB DB sub-tab. Re-extracted by `scripts/kb/*.ts` then re-uploaded.
    - `$APP_DATA_DIR/ai/eval/` — `wells/` + `components/` recognition eval fixtures
    - `$APP_DATA_DIR/archive/` — soft-deleted parts + `figures/` (PDF-page renders + `gallery.json`) + `test-recordings/` (Playwright WEBMs + `manifest.json`) + legacy
    - **Nothing data/test-related lives in `static/` or git anymore** — `static/` holds only build output (`components/*.glb`, gitignored). The volume CRUD endpoint serves all of the above; the `/volume` route is a browser/file-manager for it.

    **Root resolution** (`src/lib/server/volume.ts`): `CADTRAIN_VOLUME_ROOT` → `RAILWAY_VOLUME_MOUNT_PATH` → `APP_DATA_DIR` → `/app_data` → `./.dev-volume`. New endpoints that need persistent storage MUST call `volumePath(rel)` and call `maybeProxy(request, url)` first.

    **Local dev → prod volume**: set `CADTRAIN_VOLUME_REMOTE_URL` + `CADTRAIN_VOLUME_TOKEN` in `.env.local` and every `bun dev` call to `/api/volume` proxies to prod (token gates cross-origin; same-origin browser sessions are trusted; unset locally = open). Operational reference — `.env.local` setup, curl transfer commands (upload/download/list/delete/mkdir), upload ceilings, and the Playwright verification spec — lives in **`docs/VOLUME_TRANSFER.md`**.

14. **Compounding context for drawings — primitive + assembly recipes.** Before authoring a new volume primitive or composing a multi-part assembly, check the catalog:
    - **Volume primitive authoring**: `docs/CAD_AUTHORING.md` is the canonical guide (param types, apply/save contract, Manifold gotchas, the `r_*` compose pattern — Rule 20). Template: `docs/PRIMITIVE_TEMPLATE.md`. (The old per-bundle-component `src/lib/cad/components/<id>.md` specs were deleted with the components product 2026-05-27.)
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

16. **`/primitives` sidebar classification — location IS category.** The `/primitives` sidebar groups volume primitives by their on-volume category directory: **Basic** (`primitives/basic/`), **Completions** (nested by family, `primitives/completions/<family>/`), and **Archive** (`primitives/archive/`, soft-deleted). There's no central map to drift — a primitive's directory location IS its sidebar group. Creating with the `+` popup writes into the chosen category dir; the trash button moves to `archive/`. `/api/primitives/list` enumerates these via `src/lib/server/primitive-paths.ts`.

17. **Two layers — raw helpers → `r_*` leaf primitives → volume primitives.** (The bundle-component + JSON-library + part-recipe architecture was DELETED with the components product 2026-05-27; what remains is the `/primitives` model.)
    - **Raw helpers** (`src/lib/cad/manifold-helpers.ts` — `cyl`, `tube`, `helix_band`, `revolve`, …): backend geometry toolkit. Raw functions returning a `Manifold`. NOT a stable API — signatures can churn. Used ONLY inside the `r_*` leaf primitives; the sandbox injects them but volume primitives must NOT call them directly (Rule 20).
    - **Volume primitives** (`<volume>/primitives/<cat>/<id>.prim.ts`): typed source files that compose the `r_*` library primitives (`r_cylinder`, `r_tube`, `r_cone`, `r_revolve`, `r_rotate`, `r_threads`, …) via `.add`/`.subtract`/`.intersect` + `mv`/`rot`. Authored/edited live in `/primitives`, baked server-side by `src/lib/server/primitive-loader.ts` (`buildPrimitiveGeom`) behind `/api/primitives/{preview,bake-preview}`. See Rule 20 + `docs/CAD_AUTHORING.md`.

18. _(removed 2026-05-27 — was "The library — directory-per-part." The volume `library/` system + `server/library.ts` + `/api/components/*` were deleted with the components product. Volume primitives now live under `primitives/` — Rule 13 + 17.)_

19. **`/plan` is the single source of truth for the roadmap (one common plan + todo).** The Gantt at `src/routes/plan/+page.svelte` (item rows: `id`/`bundle`/`lane`/`status` ∈ `done|active|open|todo|deferred`/`title`; bundles in `BUNDLES`; optional popups in `details.ts`) is the durable, user-facing plan. The session task-tracker (TaskCreate/TaskList) is ephemeral working state; the memory `todo_*.md` files are a private cache. **Both MUST be reconciled INTO `/plan`** — don't let them diverge. At the end of a work session (and when the user asks "what's done / update the plan"): mark completed items `done`, retitle to reflect reality, and ADD new shipped work + new TODOs as `/plan` items (new bundle when it's a distinct area). Marking `done` is a factual claim — verify before flipping. Editing `/plan` is a source change → commit + push to update prod.

20. **Authoring a new volume primitive — compose `r_*` parts, NOT the raw helpers.** A new primitive's source (the flat `<id>.prim.ts` file — Rule 13) builds geometry by calling the `r_*` library primitives (`r_cylinder`, `r_tube`, `r_cube`, `r_cone`, `r_ball`, `r_extrude`, `r_revolve`, `r_threads`, …) listed in `meta.uses`, composed with `.add`/`.subtract`/`.intersect` (+ `mv`/`rot` to place). The two revolve/extrude engines `r_revolve` + `r_extrude` are **stdlib primitives in src** now (Rule 21), resolved as `meta.uses` deps like any other `r_*`. **Do NOT call the raw `cyl`/`tube`/`profile_extrude`/`revolve` helpers** from `manifold-helpers.ts` — those are the unstable base toolkit used ONLY inside the `r_*` leaf primitives themselves (Rule 17: signatures churn). The sandbox *injects* the raw helpers (so they LOOK available) — ignore them for authoring. **Function naming + parts visibility:** the geom function is `export function <id>(positional args)` (named after the id, positional params in `meta.params` order — NOT `geom(p)`); and a part only shows in the Parts tab when it's a NAMED instance — `const body = r_tube(...); return body;`, never a bare `return r_tube(...)` (the recognizer matches `const X = <prim>(...)`). The sidebar `+` new-primitive popup scaffolds all of this.

21. **Stdlib primitives — canonical in `src/`, read-only, NOT on the volume (2026-05-27).** Engine/standard-library primitives live in **`src/lib/cad/stdlib/<id>.ts`** (git-tracked, type-checked, reviewable) — currently **`r_revolve` + `r_extrude`**, both **function-only parametric** (`meta.params.profile` is `type: 'profile'` with a `{kind,params}` descriptor default → `resolveProfile` in the body → NO vertex grid). Pattern: **stdlib in code, user parts on the volume**.
    - **Registry** `src/lib/server/stdlib.ts`: `import.meta.glob('/src/lib/cad/stdlib/*.ts', {query:'?raw', eager})` bakes each file's source into the build (ships to prod — **no runtime Dockerfile COPY**, unlike the deleted `src/lib/cad/components`). Exposes `stdlibSource`/`isStdlib`/`stdlibIds`/`stdlibEntries`. Add a stdlib primitive = drop a new `<id>.ts` (exporting `meta` + a fn named `<id>`) into the dir; it auto-registers. Imports in those files are for type-checking only — the sandbox strips them and injects `resolveProfile`/`revolveProfile`/`weldAndBuild`/`G` by name at runtime.
    - **Resolver**: `/api/primitives/{source,list}` serve stdlib **FIRST** (`origin:'stdlib'`, `editable:false`) and **dedupe** any same-named volume copy; `/api/primitives/{save,delete}` **refuse** stdlib ids (edit in src + redeploy). `/list` returns a dedicated **`stdlib` group** the `/primitives` sidebar renders read-only (blue `src` tag) above Basic; `PrimitiveView` normalizes `type:'profile'`→`polygon`+`functionOnly` (selector + lifted params, no vertex grid) + shows a read-only banner. Create picker offers `r_revolve`/`r_extrude` as function-first bases (`buildFnProfileStub`). See memory `stdlib_primitives_in_src` + `/plan` K.30.

## Open TODOs (out-of-scope findings)

Research findings (default-param pHash/CLIP collapse, the cold-classification
counter-finding, and the deferred ablation queue) live in **`docs/FINDINGS.md`**
and the session memory. Not day-to-day rules.

## Current work in flight (2026-05-27 — resume point)

> Living section — clear entries as they land. Full detail in the session
> memory handoffs. **Launch `claude --chrome`
> for fast visual iteration on /primitives** (`feedback_claude_chrome_efficiency`).

**Shipped 2026-05-27 evening (pushed, `397d44b`..`3d6df51`):** **color-by-source rendering** — each part colored by its `r_*` source via Manifold's mesh relation (`runOriginalID`/`runIndex`) through CSG; stamped with a hashId (`src/lib/cad/part-id.ts`), LUT built by `analyzeParts` (`src/lib/server/part-colors.ts`), applied in `builder.ts` + the GLB bake. **Per-part outer/inner colors** with two swatches (square=outer, circle=inner) in each part's accordion title → `meta.instanceColors[name]={outer,inner}`. **`drill_pipe_pin` profile cut 9→5 params** (std upset + 45° nose). **NEW `dp_spec_pin`** spec drill-pipe-pin profile (pipeOD/jointOD/wall→ri, flat `jtUpset` shoulder, 45° upset + 5° thread taper, **thread length DERIVED** — terminates at ri+wall) + **`r_threads` `threadType` selector** (NC38/40/46/50, FH — presets form + OD; values APPROX, refine vs API 7-2) — both on the prod VOLUME. **One-click searchable profile selector** (grid, not nested combobox) + **viewport-clamped FloatingPanels**. Fixes: **edge outlines** re-added to the live canvas, `uniqueInstName` add-part collision, **live profile params from the inline descriptor**, **`defaultsDirty`** ("values changed — Save defaults"), **GLB warp-on-load**. Detail: `session_handoff_2026-05-27c`.

**Shipped 2026-05-27 (committed `a712986`, NOT yet pushed):** **components product DELETED** — `/components` route, all 12 `/api/components/*` endpoints, `src/lib/cad/components/` (bundle registry + families), `components-l3`, `server/library.ts`, `component-loader.ts`, the recipe chain (`part-recipe`/`primitive-recipe`/`recipe-preview`), `/archive/**/components`, and the `industrial` category — all gone. `/primitives` is now the one CAD UI; nav + landing repointed; e2e specs updated (runes/instance-ops deleted). `builder.ts` kept (live preview render helpers) but detached from the bundle registry. Also: finished the half-applied profile-swap refactor in `PrimitiveView` (▾ selector → `ProfilePalette` popup) + `r_rotate` function-first scaffold.

**Shipped 2026-05-24 (on `main`, pushed):** warp-at-end toggle + no-stretch 1:1 fix (`warp-spline.ts`) · construction-tree view + **BODMAS diagram** (`ConstructionTree.svelte`) · searchable **profile palette** + volume profiles (`/api/primitives/profiles/{list,save}`) · **volume consolidated to 4 dirs** (archive/components/ai/primitives — kb+kb-sources+training_data+eval → `ai/`; see `volume_4dir_layout`) · drag-resizable /primitives sidebar.

**Earlier shipped:** profile popup · Save As · profiles→named params · instantiable components · single canvas (WebGL leak closed) · collapsible sidebar · transform move + ✕ delete · tests→industrial + completions/<family> nested group.

**TODOs to revisit (deferred by decision):**
- **Warp z-spline** (`todo_warp_popup_and_logic`) — give the warp path its OWN popup (not the ProfileEditor) + revisit the suspected interpretation bug (Z-down anchor `z0=min.z`=top→s=0; planar-only frame; x-centered assumption). **Parked at user request 2026-05-24.**
- **Profile P3** — custom-function generator profiles (sandbox-eval, async endpoint pre-resolution).
- **WASM** (`todo_wasm_deferred`) — server-render already conceals; revisit only for offline-client-concealed parts.
- **Customize dir / OAuth** (`todo_customize_dir_deferred`, `docs/plans/oauth-identity.md`) — private per-user parts need the SVTC Google-OAuth port (event.locals.userId) first; needs OAuth creds from the user.
- Other: `todo_r_threads_radial_taper`, `todo_cutaway_unify`, `todo_nonmanifold_csg_split`, `todo_per_part_dynamic_editor`, construction-tree P1–P4 (JSON-tree drag/reparent editor).

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
| `/primitives` | **CAD product UI** — sidebar-of-primitives + canvas + inspector. The one CAD UI (see `src/lib/shared/PrimitiveView.svelte`). |
| `/wells` | Wells product overview — stub pointing at `/archive/wells` until ported |
| `/volume` | File manager for the persistent data volume (`/api/volume` CRUD UI) |
| `/archive` | Index of legacy routes — see `src/routes/archive/CLAUDE.md` |
| `/plan` | Gantt-style roadmap (bundles A–F) with click-through detail popups |

**Removed**: `/components` + all `/api/components/*` (the components
product — route, bundle library, JSON-library system; deleted 2026-05-27,
`/primitives` is now the one CAD UI), `/cad`, `/author`, `/library`,
`/archive/author`, `/archive/library`, `/archive/components`,
`/archive/tests/components` — none of these directories exist any more.
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
    ├── server/                       # server-only: volume.ts, primitive-paths.ts, primitive-loader.ts, profile-fn.ts
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
# 4 dirs: archive/ (figures, test-recordings, legacy) · components/ (DORMANT —
# former library, reader code deleted 2026-05-27) ·
# ai/ (training_data, kb, kb-sources, eval) · primitives/
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
- New volume primitives are authored in `/primitives` (Rule 20) — compose `r_*` parts, no bundle/`families.ts` edits (that system was deleted 2026-05-27)
- Training data under `training_data/cache.jsonl` should be committed when it grows meaningfully — it's the app's learned memory

## Related directories

- `archive/` — archived legacy work (gitignored): `BOTTOM_SUB_legacy/`, `HAL_PACKERS/`, `HAL_WPS/`, `scripts/`, `training_data_extras/`. Kept locally as a safety net, not committed.
