# CAD Train

A parametric 3D CAD pipeline for downhole tool components, and an **engine + AI harness**
for building declarative sub-apps on top of it. Stack: **SvelteKit** (Svelte 5 runes) ·
**ManifoldCAD** / **TrueForm** / **OCCT-BREP** geometry kernels (WASM) · **Threlte** (3D) ·
`@anthropic-ai/sdk` · Docker → Railway.

> Detailed contributor guidance lives in **`CLAUDE.md`** (root) and the per-subtree
> `CLAUDE.md` files. Roadmap: the **`/plan`** Gantt. Status/handoff: `docs/STATUS.md`.

## What it is

**1. A node-graph parametric CAD editor.** Parts and assemblies are typed source files on a
persistent volume. You compose them in a visual node graph (`GraphEditorPane`), which compiles
to a self-contained geometry script and bakes to a mesh — client-side in a Web Worker (default)
or server-side. Three kernels: Manifold (mesh), TrueForm (native), and OCCT-BREP.

**2. An app harness — cadtrain as an engine you build *apps* on.** A sub-app is a
self-contained **`.app`** (a component tree). An AI assembles it by calling **verbs** (the verb
registry is the single API + the safety boundary); the app is **server-rendered** (`/app/[id]`),
and the geometry engine never ships to the client. The strategic bet is **local-first**: a small
in-browser model (Qwen via WebGPU) builds apps with **no cloud API**, grounded by a RAG dictionary
of components + verbs — for customers who can't reach the Claude API. Cloud Claude and a
subscription CLI backend exist for dev/authoring.

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Landing menu |
| `/graph-editor` | **The CAD editor** — a single part, full-screen (`?id=&embed=1`) |
| `/primitives` | Sidebar of volume parts + multi-tab editor (a `GraphEditorPane` per tab) |
| `/vocab` | Vocabulary editor — vocabulary-driven generative part authoring |
| `/wells` | 3D-first well schematic (WIP) — WSON → graph → 3D well diagram |
| `/design` | Architecture overview — Tree · C4 · verb/route **API** reference |
| `/app_design` | **App-harness STUDIO** — visual tree editor · AI chat (CLI · API · local Qwen) · live server-rendered preview · `/app_design/eval` (local-model eval matrix) |
| `/app/[id]` · `/app/local/[token]` | **Launch** a `.app` — server-rendered (engine stays server-side) |
| `/volume` · `/plan` · `/research` | Volume file manager · Gantt roadmap · research notes |

The app component kit (34 kinds) includes data (`list`/`form`/`grid`/`datatable`/`edittable`),
dashboards (`stat`/`statgrid`/`chart`), diagrams (`gantt`/`nodetree`/`wellschematic`), layout,
input, and **`cad3d`** — an interactive 3D CAD viewer that embeds baked geometry inside an app.

## Local development

```bash
bun install
bun run dev        # dev server on :3333
bun run build      # production build
bun run test       # vitest unit tests   (NOT `bun test` — it ignores the $lib alias)
bun run test:e2e   # Playwright e2e (headless)
```

Open http://localhost:3333.

**Environment** (`.env.local`): `ANTHROPIC_API_KEY` (cloud Claude backends — optional; the
local model + subscription `claude` CLI need no key), and `CADTRAIN_VOLUME_REMOTE_URL` +
`CADTRAIN_VOLUME_TOKEN` to proxy the local dev volume to the shared prod store (see
`docs/VOLUME_TRANSFER.md`).

## Deploy (Railway)

GitHub `pyenthu/cadtrain` → Docker build (`railway.toml` sets `builder = "DOCKERFILE"`).
A volume is mounted at `/app_data` (all redeploy-surviving state). Health check:
`/api/cache/stats`. Set `ANTHROPIC_API_KEY` in the service Variables. Prod:
**https://cadtrain.up.railway.app** (not `.com`).

## Project layout

```
src/
├── routes/              # graph-editor · primitives · vocab · wells · design · app_design · app · api
└── lib/
    ├── appkit/          # HEADLESS app-harness kit — verbs (SSOT) · schema · manifest · store · ai · rag
    ├── app_components/  # component BUNDLES (render + meta.ts + optional editor) — the .app UI kit
    ├── shared/harness/  # the harness UI (HarnessView · PanelNode · registry · VisualEditor)
    ├── graph/           # composition graph · emit · bake · sketch · stdlib engines
    ├── engines/         # geometry KERNELS — manifold/ · trueform/ · brep/
    ├── server/          # volume · primitive-paths · bake-cache · app-corpus · rag
    ├── authoring/       # vocabulary → source translators
    └── wells/           # WSON → 3D well-schematic engine

docs/     # architecture · plans · CAD_AUTHORING · HISTORY · STATUS · rag/ (dictionary + prompts)
archive/  # tracked, dormant legacy src (see archive/CADTRAIN_CLEANUP.md)
Dockerfile + docker-entrypoint.sh + railway.toml
```

## History

The original product (image → component identification via pHash/CLIP + a training cache,
`/components` · `/reverse` · `/training` · `/api/identify`) was archived 2026-06 — see
`archive/CADTRAIN_CLEANUP.md` and `docs/HISTORY.md`. The active product is the node-graph CAD
editor + the app harness above.
