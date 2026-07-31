# CAD Train — Project Context for Claude Code

Parametric 3D CAD pipeline for downhole tool components: **SvelteKit** +
**ManifoldCAD** (WASM) + **Threlte**. The active editor is a **node-graph
parametric CAD editor** (`GraphEditorPane`) backed by typed source files on a
persistent volume, plus vocabulary-driven generative authoring and a 3D-first
well schematic. (FEM + the image→3D/forge scaffold were **archived** 2026-06,
commit `1d90a16` — landing-only, unused elsewhere; revive from `archive/`.)

## Where to look for what

Rule numbers below are stable — docs and memories cross-reference them.
Subdirectory CLAUDE.md files (auto-loaded in-subtree): `src/routes/api/`
(endpoint catalog + proxy), `src/lib/graph/` (composition graph + geometry), `src/lib/engines/` (kernel gotchas — Manifold/TF/BREP),
`src/lib/shared/` (shared UI), `src/lib/authoring/` (vocab translators),
`src/routes/vocab/` + `src/routes/api/vocab/` (vocab editor), `src/lib/wells/`
+ `src/routes/wells/`, `tests/`. Also:

- **`docs/CAD_AUTHORING.md`** — volume-part authoring guide, read FIRST
- `docs/COMPOSITION.md` — .asm.ts composition + TreeNode + editor API
- `docs/HISTORY.md` — shipped-session ledger (moved out of this file)
- `archive/CADTRAIN_CLEANUP.md` — what was archived 2026-06-01 + revival steps

## Architecture snapshot (2026-06-11)

- **One editor, two surfaces.** `src/lib/shared/GraphEditorPane.svelte` is THE
  CAD editor. `/graph-editor` mounts it full-screen (`?id=&embed=1`);
  `/primitives` is a sidebar + multi-tab wrapper mounting N panes.
- **Composition graph**: `src/lib/graph/composition/composition-graph.ts` — nodes
  `Call / Container / Method / Mv / Rot / Repeat / Polygon / PolyRepeat`,
  `ArgValue = literal | expr | param`. Graph → source via
  `composition/composition-emit*.ts` (parts carry `meta.graph` + emitted body); bake via
  `composition/composition-bake.ts` + server bake cache (`src/lib/server/bake-cache.ts`).
  (The 39 loose `graph/` root files were modularized into concern subfolders 2026-07-28,
  #995 — `composition/ expr/ primitive/ sketch/ spline/ port/ part/ editor/ csg/ survey/
  warp/ wire/ profile/`; see `src/lib/graph/CLAUDE.md`.)
- **Engines**: `src/lib/graph/stdlib/` (active: `r_cuboid`, `r_loft`,
  `r_weld_extrude` — used by g_cube/g_spiral/g_star/g_barrel — and `r_revolve`,
  the sole revolve engine, 12 consumers) + `src/lib/graph/stdlib/stale/`
  (`r_extrude` — 0 consumers, superseded by r_weld_extrude; origin `stdstale`,
  still resolvable; relocated 2026-06-28 from top-level `stdstale/`).
- **Legacy** lives in the top-level **tracked** `archive/` dir (2026-06-01):
  old `/archive/*` routes, identify/RAG chain, wells extraction, KB endpoints,
  old authoring stack. Invisible to vite/tsc/router. `/wells` is a stub.

## Rules for Claude (read me first)

1. **Bun + SvelteKit + adapter-node.** Never adapter-static (API routes need SSR); never add Python to the runtime.
2. **Product structure.** Active: `/primitives` + `/graph-editor` (CAD), `/vocab`, `/wells` (**3D-first well schematic, WIP** — `src/lib/wells/`, plan `docs/plans/well-schematic.md`), `/design` (architecture: Tree + C4 tabs), `/research`, `/volume`, `/plan`. **ARCHIVED** (2026-06, `1d90a16`): `/fem` + `/forge` → `archive/src/{routes,lib}/fem` + `.../forge` (landing-only, unused — revive with `git mv` back). The old `/components` product was deleted 2026-05-27; the old `/archive/*` implementation moved to top-level `archive/` 2026-06-01. New code goes in `src/lib/{cad,wells,authoring}`; cross-domain UI in `src/lib/shared/`.
3. API endpoints use `$env/dynamic/private` (not static) so env vars are read at runtime.
4. **Durable JSON/JSONL stores get atomic writes** (temp file + rename) — volume caches, `docs/parts/vocabulary*.json`. Never delete one without backup.
5. Follow plan files in `~/.claude/plans/`. Don't add features outside the current plan's scope.
6. Before destructive operations (`rm`, `git rm`, `git reset --hard`), show the plan and wait for approval.
7. Commit after each numbered plan step completes, not after each small edit.
8. Test locally (`bun run build` + `bun test` + e2e if relevant) before committing.
9. Reviews/audits use Explore subagents, read-only.
10. Railway deploys via `Dockerfile` (`railway.toml` sets `builder = "DOCKERFILE"`). Health check: `/api/cache/stats`.
11. **Prompt for e2e after non-trivial UI/route/backend changes**: ask *"Run e2e now? headless (~15s) or headed (slow_mo 250)?"* Don't auto-run for trivial edits.
12. **Each logical plan step gets a recorded e2e run** — recording + harvest workflow in `tests/CLAUDE.md`.
13. **Persistent data volume.** Prod: **`https://cadtrain.up.railway.app`** (NOT `.com`). All redeploy-surviving state lives on one volume rooted at `$APP_DATA_DIR` (Dockerfile `/app_data`; local dev `./.dev-volume/`). Top dirs: `archive/` (soft-deleted parts, figures, test-recordings) · `components/` (DORMANT — no reader code, don't build on it) · `ai/` (`training_data/`, `kb/`, `kb-sources/`, `eval/`, `rag/parts.jsonl` — RAG corpus) · `primitives/` · `cache/` (bake cache) · `types/` (typed-ports composite-type library — one `<id>.json` per user-defined record type, via `/api/primitives/types`; invisible to the parts sidebar). Parts are flat typed files `primitives/<cat>/<id>.prim.ts` — **mid-extension = type** (`.prim.ts` · `.asm.ts`; profiles `.prvl.ts`/`.prex.ts`); categories `basic/`, `completions/<family>/[<sub>/]`, `archive/`; **all path resolution goes through `src/lib/server/primitive-paths.ts`**. Root resolution (`src/lib/server/volume.ts`): `CADTRAIN_VOLUME_ROOT` → `RAILWAY_VOLUME_MOUNT_PATH` → `APP_DATA_DIR` → `/app_data` → `./.dev-volume`; new persistent endpoints MUST call `volumePath(rel)` + `maybeProxy(request, url)` first. Local dev with `CADTRAIN_VOLUME_REMOTE_URL` + `CADTRAIN_VOLUME_TOKEN` in `.env.local` proxies `/api/volume` + most `/api/primitives/*` data endpoints to prod — one shared store (ops: `docs/VOLUME_TRANSFER.md`).
14. **Compounding context for drawings.** Before authoring a part/assembly, check `docs/CAD_AUTHORING.md`, `docs/PRIMITIVE_TEMPLATE.md`, `docs/assemblies/`, `docs/parts/`. **Write/update the corresponding `.md` BEFORE committing** new assemblies or vocabulary renames — the only durable handoff.
15. **Never write user-pasted secrets to disk or echo them in tool calls.** Flag the exposure ("rotate that key"), point to secure entry (user edits `.env` · Railway Variables tab · console.anthropic.com), set up structure without touching the value.
16. **Sidebar classification — location IS category.** Sidebar groups = on-volume dirs (`basic/`, `completions/<family>/`, `archive/`) + read-only `stdlib`/`stdstale` src groups. Create writes into the chosen dir; trash moves to `archive/`; `/api/primitives/list` enumerates via `primitive-paths.ts`.
17. **Layers: raw helpers → engine primitives → volume parts.** Raw helpers (`src/lib/engines/manifold/manifold-helpers.ts`: `cyl`, `tube`, `revolve`, …) are an unstable toolkit used ONLY inside engine primitives — volume parts must NOT call them even though the sandbox injects them. Volume parts compose engine/library parts via `.add`/`.subtract`/`.intersect` + `mv`/`rot`/`place`; baked by `src/lib/server/primitive-loader.ts` behind `/api/primitives/{preview,bake-preview}`.
18. _(retired)_
19. **`/plan` is the single source of truth for the roadmap.** Gantt at `src/routes/plan/+page.svelte` (+ `details.ts` popups). Session task-trackers and memory `todo_*.md` are ephemeral — reconcile INTO `/plan` at session end. Marking `done` is a factual claim — verify first. `/plan` edits are source changes → commit + push.
20. **Authoring a volume part — use the typed-create scaffolds (Extrude Part / Profile Part / Assembly) or the graph editor; don't hand-name engines.** Profiles live INLINE on the part. The geom function is `export function <id>(positional args)` in `meta.params` order — NOT `geom(p)`; parts show in the Parts tab only as NAMED instances (`const body = ...; return body;`). Dependencies in `meta.uses`.
21. **Engine primitives — canonical in `src/`, read-only, NOT on the volume.** `stdlib/` = active; `stdlib/stale/` = deprecated-but-resolvable so existing `meta.uses` keep baking (origin label stays `'stdstale'`; relocated 2026-06-28 from a top-level `stdstale/` dir). Registry `src/lib/server/stdlib.ts` (`import.meta.glob('?raw')` bakes source into the build; the `stdlib/*.ts` glob is non-recursive so `stale/` is globbed separately). Resolver serves them FIRST + dedupes volume twins; `/api/primitives/{save,delete}` refuse both (403). Add = drop `<id>.ts` into `stdlib/`; deprecate = `git mv` to `stdlib/stale/`. **`r_revolve` is ACTIVE** (the only revolve engine); only `r_extrude` is stale.
22. _(retired 2026-06 — FEM + `/forge` archived to `archive/`, `1d90a16`; revival steps in `archive/CADTRAIN_CLEANUP.md`)_
23. **Non-trivial UI flow rebuilds ship with a subagent test spec** in `.claude/agents/<name>.md` (gitignored) BEFORE "done": drives the real UI via `mcp__claude-in-chrome__*` AND verifies server-side via curl; outputs a summary table + GIF; **must run twice with identical output**; patch the spec in-place when a run surfaces a wrinkle. Reference: `.claude/agents/test-dp-build.md`.
24. **Generative authoring — RAG-then-translate against the vocabulary first.** On a "new part" request, retrieve from `docs/parts/vocabulary.json` and compose via the deterministic translator (`src/lib/authoring/rule-translator.ts`): (1) synonym match → params only, (2) `extends` parent, (3) `kind:'compose'`, (4) hand-author ONLY when nothing fits — and say so before extending the schema. Save via `/api/primitives/save`; bake-verify via `/api/primitives/preview` (report verts/z-extent/outer-r). Patches via `scripts/promote-to-vocab.ts`; regen `vocabulary-graph.mmd` via `bun scripts/render-vocab-graph.ts`. **NEVER hand-author `/tmp/<id>_swap.ts` ad-hoc scripts when a vocab path exists.**
25. **The welded-mesh system is the PRIMARY geometry builder.** `src/lib/engines/manifold/manifold-mesh.ts` (`gridPatch` / `capFan` / `weldAndBuild`, injected via `primitive-sandbox.ts`; memories `welded_mesh_toolkit_shared` + `raw_mesh_helix_pattern`) builds geometry with **explicit, controllable segmentation** — unlike `CrossSection.revolve`, which gives no axial sampling. It exists specifically to (a) **warp smoothly** (enough Z-samples → a smooth sine, not faceted chords) and (b) **build along a spline** for the coming **deviated / curved profiles**. **Segmentation / warp resolution belongs at BUILD time, never as a post-bake mesh rewrite** — subdividing the final welded Manifold's MeshGL OOB-crashes the WASM core and corrupts the singleton so every later bake fails (why warp-subdivide `d41877b` was reverted in `3fb1fa8`). The old client-side `subdivideAlongZ` (`src/lib/shared/warp.ts`) was a render-time stopgap; the durable fix is build-time Z-segmentation in the weld builders.
26. **Subagent verification — ASK "headless or worktree dev-server?" BEFORE dispatching.** When a subagent's work needs verifying, confirm the mode first. **HEADLESS** (build + Node/vitest test, no browser — works in a bare worktree; the RIGHT choice for geometry/compile/logic, since TrueForm + Manifold run in Node) vs **WORKTREE DEV-SERVER + browser** (only when the deliverable is UI/interaction/visual/Svelte reactivity that can't be judged headless). Worktree browser-verify is FRAGILE and has STALLED agents repeatedly (2026-07-03): a bare worktree lacks `node_modules`/`.env.local`, and a random dev port COLLIDES with leftover servers → the agent loops on "port in use" and never commits. RULES: (a) default headless; only pay for the browser when the change is genuinely visual — and prefer doing THAT inline on the live `:3333` (per the modularize "GEP inline" rule) or verify it yourself after merging the branch (build-green ≠ visually correct); (b) a worktree that MUST serve uses **`bun run dev:worktree`** (`scripts/dev-worktree.sh`) — a **DETERMINISTIC port hashed from the branch name** (same worktree → same port, no collisions, trackable; logged to `.claude/worktree-ports.log`) + symlinks the parent `node_modules` + copies `.env.local`; (c) POLL liveness (agent output mtime + branch commit count) and if idle >~7 min with no commit, KILL and re-dispatch headless (or do it inline).

27. **`:3333` is the ONE shared dev port — NEVER blanket-kill ports or processes.** `bun run dev` serves `:3333`, and it is SHARED across your session, the user, and any concurrent Claude session/agent. NEVER run `pkill -f vite`, `killall node`, or `lsof -ti:<port> | xargs kill` on a port you did not personally start — it silently takes down the user's (or another session's) dev server (the recurring "`:3333` down" incidents, 2026-07-31). Stop ONLY a server YOU started, by its tracked background-task id (or its exact PID). The dev server is best left running by the **USER in their own terminal** (persistent, not tied to a tool-call lifecycle). Worktree servers use `bun run dev:worktree` (a deterministic branch-hashed port, logged to `.claude/worktree-ports.log`) — kill only that logged port, never `:3333`. Prod is `https://cadtrain.up.railway.app` (Rule 13) — never assume `:3333` = prod.

## Current focus + in-flight architecture

Moved to **`docs/STATUS.md`** — read it at the start of a working session. It
carries the resume point (latest session-handoff memory, TF tab, Route C lean
revolve, open follow-ups) and the client-side-execution design. Shipped detail →
`docs/HISTORY.md` + session-handoff memories; roadmap → `/plan` (Rule 19).

**App-platform direction (2026-07-27, host UNDECIDED — the long-term bet, `/plan`
#983 + bundles C/D):** cadtrain is the **graph ENGINE** (node-graph → compile →
bake → geometry, already HTTP-exposed via `/api/primitives/{compile,preview,
bake-preview}`). The sibling repo **wellnew** (`~/Desktop/GitHub/wellnew`, iCloud
read-only — memory `wellnew_repo`) is the **platform + panel-shell** that `/wells`
was ported from: its `/ewell` app is a `ToolBar` + `Panel*.svelte` + runes-store
shell, and it already has auth/signin + Postgres/prisma + multi-app. So a new
AI-driven wells app = wellnew's customizable panels around cadtrain's engine. The
open fork: which repo HOSTS — likely (A) wellnew consuming cadtrain's engine as a
`bake→mesh` API (sidesteps COOP/COEP client-worker isolation). AI layer = the SVTC
`tools.js`/`toolSchema.js` tool-calling pattern bound to panel actions + cadtrain's
authoring endpoints (`/refine`, `/rag/prompt`), runtime model LOCAL (Rule: AI
data-residency). Bundles C (OAuth) + D (SDK `/api/v1`) already frame it.

**App harness — BUILT (2026-07-30).** The declarative sub-app layer landed: a `.app` is a
component TREE (`children[]`); `src/lib/appkit/` is the HEADLESS kit (verb registry = SSOT →
AI-SDK tools + HTTP + API.md · manifest · `catalog/` component metadata · `store` · `ai`
pipeline); `src/lib/app_components/<Name>/` holds component BUNDLES (render + `meta.ts` +
optional `<Name>Editor.svelte`); `src/lib/shared/harness/` renders them (`HarnessView` +
recursive `PanelNode` + `VisualEditor` tree). **Server-render (decided WITH the user):** the
`.app` is the app, the SERVER compiles it — `/app/[id]` (volume) + `/app/local/[token]` (local
file) SSR + hydrate; the ENGINE never ships (only compiled UI + resolved data); components
hydrate for client reactivity; per-component `dataMode` (static/server/client) + `computeMode`
(server/client bake). Declarative logic: `computed`/`$vars` (safe interpreter, reuses graph/expr),
`http`/`loadData` verbs, `on` events, file SLOTS (§0.5 — data lives in files, not the `.app`).
Design-RAG = MD↔.app golden pairs on the VOLUME (`ai/app-rag/`, `server/app-corpus-store.ts`).
Plans: `docs/plans/app-server-render.md` + `docs/plans/app-studio-enhancements.md` (next-wave
backlog). Module guides: `src/lib/appkit/CLAUDE.md` + `src/lib/app_components/CLAUDE.md`.

**Tests: `bun run test` (vitest), NOT `bun test`.**

## Tech stack + commands

Bun (dev) / Node 22 (prod, adapter-node) · SvelteKit (Svelte 5 runes) ·
ManifoldCAD WASM + Threlte · `@anthropic-ai/sdk` (used by
`/api/primitives/refine`) · Docker → Railway.

```bash
bun run dev              # dev server on :3333
bun run build            # production build
bun test                 # vitest unit tests
bun run test:e2e         # Playwright e2e (headless); :headed for slow_mo 250
bun run test:graph       # just the graph-editor spec; test:volume likewise
bun run record:task <id> # e2e + harvest WEBMs for a /plan task (Rule 12)
```

**Always prefer Bun over Node** for running scripts (bun.lock is the lockfile).

## Top-level routes

| Route | Purpose |
|---|---|
| `/` | Landing menu (no global navbar since 2026-06-09) |
| `/graph-editor` | **The CAD editor** — single primitive, full-screen (`?id=&embed=1`) |
| `/primitives` | Sidebar of volume parts + multi-tab wrapper (GraphEditorPane per tab) |
| `/primitives/profiles` | Profile-function builder page |
| `/vocab` | Vocabulary editor (browse/topology · infer · bake · promote) |
| `/wells` | **3D-first well schematic** (WIP) — WSON → 3D well diagram + SVTC-style left tool rail. Plan: `docs/plans/well-schematic.md`; engine `src/lib/wells/`. |
| `/design` | Architecture overview — **Tree** (collapsible L→R) + **C4 model** (Context→Container→Component) tabs (`ArchGraph`/`C4View`, `architecture.ts`/`c4.ts`) |
| `/research` | Research notes route |
| `/volume` | Volume file manager |
| `/plan` | Gantt roadmap (Rule 19) |
| `/app_design` | **App-harness STUDIO** (2026-07-30) — file-editor for `.app` docs: a left **icon-tab sidebar** (☰ component TREE · ✨ AI-prompter popover · ƒ Variables · ⚡ Events · 🎨 Style · ▦ Data — Variables/Events/Style/Data via `harness/AppSettings.svelte`) ↔ **server-rendered** live preview (right; filename lives in the preview strip, no separate header). Per-node **⚙ popover** = kind badge + editable title + a **component-scoped ✨ AI bar** (posts to `/api/app/generate` with a one-component wrapper via `scopedBuild`) + **Props / Style / Events** tabs. ＋ search-popover · ←↑↓→ tree ops · auto-compile toggle. **No default app title** — a title is a Heading/Text component you add (HarnessView renders none). App-level `events` (name→action a component can trigger) on the manifest; propagation WIP. Plan: `docs/plans/app-server-render.md` + `docs/plans/app-studio-enhancements.md`. |
| `/app/[id]` · `/app/local/[token]` | **Launch** a `.app` — SERVER-rendered (SSR + hydrate). `[id]` = volume/apps-dir; `local/[token]` = a POSTed local file (readable slug). The ENGINE stays server-side; only compiled UI + resolved data ship. |

**Removed/archived**: `/components` (deleted 2026-05-27); `/archive/*` and
`/api/{identify,refine,accept,feedback,wells,kb}` (→ `archive/src/`, 2026-06-01);
**`/fem` + `/forge`** (→ `archive/src/{routes,lib}/{fem,forge}`, 2026-06 `1d90a16`
— landing-only, unused; `FAL_API_KEY` was forge-only). The active
`/api/primitives/refine` is a different, current endpoint. Full API catalog:
`src/routes/api/CLAUDE.md`.

## Project layout

```
src/
├── hooks.server.ts      # auth gate + volume proxy (VOLUME_PROXY_PATHS); rate-limit list empty
├── routes/              # graph-editor/, primitives/(+profiles/), vocab/, wells/, design/,
│                        # research/, volume/, plan/, api/  (+layout: NavMenu top-right, pins #app height)
└── lib/
    ├── appkit/          # HEADLESS app-harness kit (2026-07-30): verbs (SSOT) · schema · manifest · catalog · store · ai (see appkit/CLAUDE.md)
    ├── app_components/  # component BUNDLES (render + meta.ts + optional <Name>Editor.svelte) — the .app UI kit (see app_components/CLAUDE.md)
    ├── shared/          # GraphEditorPane, canvases, …; harness/ = app-harness UI (HarnessView · VisualEditor · PanelNode · panels/registry)
    ├── cad/             # composition-graph/emit/layout/bake, sketch, stdlib/ (+ stale/)  (see cad/CLAUDE.md)
    ├── engines/         # geometry KERNELS carved out of cad/+shared/ (E1 2026-07-12): manifold/ · trueform/ · brep/ (see engines/CLAUDE.md)
    ├── server/          # volume.ts, primitive-paths.ts, primitive-loader.ts, stdlib.ts,
    │                    # bake-cache.ts, rag-corpus.ts, …
    ├── authoring/       # vocabulary → source translators
    ├── wells/           # WSON → 3D well-schematic engine
    └── rate_limit.ts    # (fem/ + forge/ archived 2026-06 → archive/src/lib/)

archive/                 # TRACKED — archived legacy src (see archive/CADTRAIN_CLEANUP.md)
docs/                    # CAD_AUTHORING, COMPOSITION, HISTORY, FINDINGS, parts/, plans/, assemblies/
scripts/                 # volume transfer, vocab ingest/promote/render-graph, kb/, e2e harvest
training_data/           # local-dev mirror of legacy identify seed data (canonical on volume)
Dockerfile + docker-entrypoint.sh + railway.toml
```

## Svelte 5 runes gotchas

- `$state` / `$derived` / `$effect`; props via `let { foo = $bindable() } = $props()`.
- **SSR off** (`+layout.ts`: `ssr = false`) — ManifoldCAD WASM can't run server-side. Lazy-import Three/Threlte components in routes.
- `{@const}` must be the immediate child of a block tag, not a `<div>`.
- Pass STABLE references (memoised `$derived.by`) as props to canvas components — a fresh array per render re-mounts and can loop auto-fit.

## Things to know / avoid

- **Restart `bun run dev` after editing server modules or large components** — Vite HMR silently skips them; stale dev server = stale geometry, no error (memory `feedback_build_restart_after_significant_change`). **Specific tell:** a `400` from `/api/primitives/preview` on EVERY part — `r_cuboid` → "memory access out of bounds (WASM Manifold core)", others → garbage args — is a corrupted local WASM singleton, NOT bad part data or prod. Note `/preview` + `bake-preview` + `profiles/resolve` are the ONE part of the API that runs **locally** (excluded from `VOLUME_PROXY_PATHS`); `source`/`save`/`list` proxy to the Railway server. So a preview-bake crash is always local → restart `:3333` cleanly from the terminal (NOT the in-app restart button — it wedges the server, memory `source_404_flood_2026-06-13`). Verify prod is fine: `curl -s https://cadtrain.up.railway.app/api/primitives/source?name=g_shaft`.
- Deleting a dir without removing its Dockerfile `COPY` → Railway silently serves a stale image (memory `dockerfile_stale_copy_freezes_deploy`).
- Node < 22.12 is too old for Vite 8 — use `bun --bun run vite dev` or newer Node.
- Some ISP DNS resolvers refuse `*.up.railway.app` — prod "down" locally usually isn't (memory `railway_dns_block`).
- **Z-down convention everywhere**: top = LOWER z; `mv(part,[0,0,+N])` moves down-hole (see `src/lib/graph/CLAUDE.md`).
- Railway deploy: GitHub `pyenthu/cadtrain` → Dockerfile build; env `ANTHROPIC_API_KEY` (`FAL_API_KEY` was forge-only — archived); volume at `/app_data`; health `/api/cache/stats`.
