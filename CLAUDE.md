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
(endpoint catalog + proxy), `src/lib/cad/` (geometry, Manifold gotchas),
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
- **Composition graph**: `src/lib/cad/composition-graph.ts` — nodes
  `Call / Container / Method / Mv / Rot / Repeat / Polygon / PolyRepeat`,
  `ArgValue = literal | expr | param`. Graph → source via
  `composition-emit*.ts` (parts carry `meta.graph` + emitted body); bake via
  `composition-bake.ts` + server bake cache (`src/lib/server/bake-cache.ts`).
- **Engines**: `src/lib/cad/stdlib/` (active: `r_cuboid`, `r_loft`,
  `r_weld_extrude` — the last used by g_cube/g_spiral/g_star/g_barrel) +
  `stdstale/` (`r_revolve`, `r_extrude` — deprecated, still resolvable).
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
17. **Layers: raw helpers → engine primitives → volume parts.** Raw helpers (`src/lib/cad/manifold-helpers.ts`: `cyl`, `tube`, `revolve`, …) are an unstable toolkit used ONLY inside engine primitives — volume parts must NOT call them even though the sandbox injects them. Volume parts compose engine/library parts via `.add`/`.subtract`/`.intersect` + `mv`/`rot`/`place`; baked by `src/lib/server/primitive-loader.ts` behind `/api/primitives/{preview,bake-preview}`.
18. _(retired)_
19. **`/plan` is the single source of truth for the roadmap.** Gantt at `src/routes/plan/+page.svelte` (+ `details.ts` popups). Session task-trackers and memory `todo_*.md` are ephemeral — reconcile INTO `/plan` at session end. Marking `done` is a factual claim — verify first. `/plan` edits are source changes → commit + push.
20. **Authoring a volume part — use the typed-create scaffolds (Extrude Part / Profile Part / Assembly) or the graph editor; don't hand-name engines.** Profiles live INLINE on the part. The geom function is `export function <id>(positional args)` in `meta.params` order — NOT `geom(p)`; parts show in the Parts tab only as NAMED instances (`const body = ...; return body;`). Dependencies in `meta.uses`.
21. **Engine primitives — canonical in `src/`, read-only, NOT on the volume.** `stdlib/` = active; `stdstale/` = deprecated-but-resolvable so existing `meta.uses` keep baking. Registry `src/lib/server/stdlib.ts` (`import.meta.glob('?raw')` bakes source into the build). Resolver serves them FIRST + dedupes volume twins; `/api/primitives/{save,delete}` refuse both (403). Add = drop `<id>.ts` into `stdlib/`; deprecate = `git mv` to `stdstale/`.
22. _(retired 2026-06 — FEM archived)_ ~~**FEM is encapsulated** — engine `src/lib/fem/`, UI `src/routes/fem/`.~~ FEM + `/forge` moved to `archive/` (`1d90a16`). If revived: engine `src/lib/fem/` (pure logic, no Svelte/DOM/Three), UI `src/routes/fem/` imports formulas from `$lib/fem/*` only; oilfield units (lbf / ft-lbf / in / ksi); new stages = NEW sub-routes, never tabs.
23. **Non-trivial UI flow rebuilds ship with a subagent test spec** in `.claude/agents/<name>.md` (gitignored) BEFORE "done": drives the real UI via `mcp__claude-in-chrome__*` AND verifies server-side via curl; outputs a summary table + GIF; **must run twice with identical output**; patch the spec in-place when a run surfaces a wrinkle. Reference: `.claude/agents/test-dp-build.md`.
24. **Generative authoring — RAG-then-translate against the vocabulary first.** On a "new part" request, retrieve from `docs/parts/vocabulary.json` and compose via the deterministic translator (`src/lib/authoring/rule-translator.ts`): (1) synonym match → params only, (2) `extends` parent, (3) `kind:'compose'`, (4) hand-author ONLY when nothing fits — and say so before extending the schema. Save via `/api/primitives/save`; bake-verify via `/api/primitives/preview` (report verts/z-extent/outer-r). Patches via `scripts/promote-to-vocab.ts`; regen `vocabulary-graph.mmd` via `bun scripts/render-vocab-graph.ts`. **NEVER hand-author `/tmp/<id>_swap.ts` ad-hoc scripts when a vocab path exists.**
25. **The welded-mesh system is the PRIMARY geometry builder.** `src/lib/cad/manifold-mesh.ts` (`gridPatch` / `capFan` / `weldAndBuild`, injected via `primitive-sandbox.ts`; memories `welded_mesh_toolkit_shared` + `raw_mesh_helix_pattern`) builds geometry with **explicit, controllable segmentation** — unlike `CrossSection.revolve`, which gives no axial sampling. It exists specifically to (a) **warp smoothly** (enough Z-samples → a smooth sine, not faceted chords) and (b) **build along a spline** for the coming **deviated / curved profiles**. **Segmentation / warp resolution belongs at BUILD time, never as a post-bake mesh rewrite** — subdividing the final welded Manifold's MeshGL OOB-crashes the WASM core and corrupts the singleton so every later bake fails (why warp-subdivide `d41877b` was reverted in `3fb1fa8`). The old client-side `subdivideAlongZ` (`src/lib/shared/warp.ts`) was a render-time stopgap; the durable fix is build-time Z-segmentation in the weld builders.

## Current focus (2026-06-26 — resume point)

> Keep ≤ 20 lines. Shipped detail → `docs/HISTORY.md` + session-handoff
> memories; roadmap → `/plan` (Rule 19).
> **Launch `claude --chrome` for fast visual iteration on /primitives + /vocab.**

- **Latest session**: memory `session_handoff_2026-06-26` — READ IT FIRST.
- **The "builder" direction** (the live thread): the spiral collapses to ONE
  expression with a `map` emitting a `list<point>`, wired into polygon/sketch/
  repeat — ONE typed-list mechanism replacing poly_repeat + sketch_repeat +
  part-repeat. Plan `docs/plans/expression-list-builder.md` (grounded by a
  104-agent deep-research: flat list<element>, longest-repeat-last lacing,
  socket-shape typing, NO data trees). Three demo parts in `basic/spirals/`.
- **TWO subagent branches IN FLIGHT — review before merge** (isolated worktrees):
  #11 expression-as-builder DATA MODEL (`list<point>` outputs; agent a183f13b) +
  repeat-as-sweep prototype (loft a clean skin between repeat copies; agent
  a81acdcff, touches the Manifold core — check `manifold.volume()` sign + Rule 25).
- **Shipped this session**: BREP #19 fix, part-repeat NPts injection, OneDrive
  backup + diff v1/v2, expr popover redesign, auto bake-scale, /primitives folder
  rename+delete, sketch op-row numbers. All on origin/main through `e56f343`.
- Plans live in `docs/plans/`; research in `docs/FINDINGS.md`.

## Client-side execution (in progress)

Geometry **execution** is moving off the server into a browser **Web Worker**
(`src/lib/cad/bake-worker.ts` + `bake-client.ts`): the server stays the COMPILER
(`/api/primitives/compile` → dep-inlined Manifold script + `scriptHash`), the
client EXECUTOR bakes the script. **Toggle:** 💻/☁ button in the graph-editor
left rail (or `localStorage.cad-client-bake`) → `scene.clientBake`; the bake pane
shows a `⚡client`/`☁server` badge, and the SRC tab has a `⚡compiled` subtab.
Default OFF (server `/preview` fallback intact). Kills the deja-vu stale-bake bug
structurally. PR1–3 shipped; plan `docs/plans/client-side-execution.md`; memory
`client_side_execution`. **Tests: `bun run test` (vitest), NOT `bun test`.**

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
    ├── shared/          # GraphEditorPane, PrimitiveView, canvases, FloatingPanel, …
    ├── cad/             # composition-graph/emit/layout/bake, manifold-helpers, stdlib/, stdstale/
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

- **Never** adapter-static; **never** Python in the production container.
- **Restart `bun run dev` after editing server modules or large components** — Vite HMR silently skips them; stale dev server = stale geometry, no error (memory `feedback_build_restart_after_significant_change`). **Specific tell:** a `400` from `/api/primitives/preview` on EVERY part — `r_cuboid` → "memory access out of bounds (WASM Manifold core)", others → garbage args — is a corrupted local WASM singleton, NOT bad part data or prod. Note `/preview` + `bake-preview` + `profiles/resolve` are the ONE part of the API that runs **locally** (excluded from `VOLUME_PROXY_PATHS`); `source`/`save`/`list` proxy to the Railway server. So a preview-bake crash is always local → restart `:3333` cleanly from the terminal (NOT the in-app restart button — it wedges the server, memory `source_404_flood_2026-06-13`). Verify prod is fine: `curl -s https://cadtrain.up.railway.app/api/primitives/source?name=g_shaft`.
- Deleting a dir without removing its Dockerfile `COPY` → Railway silently serves a stale image (memory `dockerfile_stale_copy_freezes_deploy`).
- Node < 22.12 is too old for Vite 8 — use `bun --bun run vite dev` or newer Node.
- Some ISP DNS resolvers refuse `*.up.railway.app` — prod "down" locally usually isn't (memory `railway_dns_block`).
- **Z-down convention everywhere**: top = LOWER z; `mv(part,[0,0,+N])` moves down-hole (see `src/lib/cad/CLAUDE.md`).
- Railway deploy: GitHub `pyenthu/cadtrain` → Dockerfile build; env `ANTHROPIC_API_KEY` (`FAL_API_KEY` was forge-only — archived); volume at `/app_data`; health `/api/cache/stats`.
