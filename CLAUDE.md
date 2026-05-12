# CAD Train — Project Context for Claude Code

Parametric 3D CAD pipeline for downhole tool components, built as a **SvelteKit** app with **ManifoldCAD** for geometry, **Threlte** for 3D rendering, and **Claude vision** + a **persistent training cache** for reverse identification (PNG → component + params).

## Rules for Claude (read me first)

1. This repo uses **Bun + SvelteKit + adapter-node**. Never switch to adapter-static or add Python to the runtime.
2. **Two-product structure** (since commit `55b1f43`, 2026-05-10): `/cad` and `/wells` are the two top-level products. The previous implementation lives under `/archive/*` as reference. New product code goes in `src/lib/cad/` or `src/lib/wells/` (when those exist) — these MUST NOT cross-import. Both may import from `src/lib/shared/*`.
3. All API endpoints must use `$env/dynamic/private` (not `$env/static/private`) so env vars are read at runtime, not build time.
4. The training cache at `training_data/cache.jsonl` is the app's long-term memory. Writes must be atomic (temp file + rename). Never delete it without backup.
5. Follow plan files in `~/.claude/plans/`. Don't add features outside the current plan's scope.
6. Before destructive operations (`rm`, `git rm`, `git reset --hard`), show the plan and wait for approval.
7. Commit after each numbered plan step completes, not after each small edit.
8. Test changes locally (`bun run build` + `bun test` + e2e if relevant) before committing.
9. When asked to review or audit, use Explore subagents for read-only exploration. Don't modify files during exploration.
10. Railway deploys via `Dockerfile` (not Railpack). `railway.toml` sets `builder = "DOCKERFILE"`.
11. **Prompt for e2e testing after non-trivial UI/route/backend changes.** When the change adds/moves/removes routes, modifies the navbar, alters API contracts, or could break inter-page navigation, ask the user before merging: *"Run e2e tests now? **headless** (fast, ~15s, just verifies routes load and links resolve) or **headed** (slower, opens a real browser at slow_mo 250 so you can watch)?"* Don't auto-run tests for trivial edits (typo fixes, comment changes, single-style tweaks).
12. **Each logical plan step gets a recorded e2e run.** When completing a `/plan` task (anything with a numeric ID in `src/routes/plan/+page.svelte`), run the e2e suite, harvest the WEBM recordings to `static/tests/e2e/<task-id>/`, and add a `video` field to the `details.ts` entry pointing at the recording. The Gantt detail popup auto-renders the video. Use `bun run record:task <id>` (script wraps `bun run test:e2e` + the harvest step). For docs-only or trivial tasks, mark `recorded: false` in the details entry instead of skipping silently.

## Open TODOs (out-of-scope findings)

- **Default-param primitive renders collapse for pHash AND CLIP.**
  Originally discovered 2026-04-13 with pHash; confirmed for CLIP on
  2026-05-09. The four primitives `seal_bore_polished`,
  `packer_element`, `nc_numbered_connection`, `grooved_cylinder` share
  a 64-bit pHash (`ed14926b6d94166d`) because their `var_1.png`
  renders are nearly identical black-on-white silhouettes. The CLIP
  retrieval rollout (commits `842d76c..3cec404`) added CLIP embeddings
  to every cache record + 700 synthetic samples for those four
  primitives, but a diagnostic across all 18 primitives showed CLIP
  giving cosine = 1.000 between **12 of 18** primitives — i.e. CLIP
  collapses far MORE primitives than pHash does on this domain. The
  retrieval test stays at 9/18.

  Why CLIP fails here: the default-param renders strip away every
  visual cue CLIP was trained on (color, shading, texture, 3D form).
  What's left is a 256×256 black silhouette that maps to the same
  point in CLIP's vector space regardless of which primitive it
  represents. Threaded variants, `hollow_cylinder`, `reg_regular`,
  `if_internal_flush` retain enough geometric distinctness to differ.

  CLIP infrastructure stays in place: it likely still helps for real
  photo uploads to `/api/identify` (different domain than these test
  silhouettes), and the embeddings are already on every cache record.

  Options when revisiting:
  (a) re-render `var_1.png` and cache thumbnails with the project's
      red-outer / grey-internal vertex coloring + shading before
      embedding — restores the visual cues CLIP needs.
  (b) supplement with edge-histogram or shape-context fingerprints
      designed for line-art domains.
  (c) fine-tune the CLIP visual encoder on the 18-primitive set.
  (d) drop the 18-image test as a retrieval benchmark and use real
      photo uploads instead — the test was always a bad proxy for
      actual user input.

  **Counter-finding (2026-05-09):** CLI/Opus cold classification (no
  RAG, no embeddings, no retrieval — just the catalog text + image)
  hit **17/18 (94.4%)** on `var_1.png` per primitive. The single miss
  (`taper_cone` → `thread_eue`) came in at 0.6 confidence — the model
  knew it was uncertain. This contradicts the assumption that the
  retrieval scaffolding is load-bearing; for the rendered synthetic
  domain at least, raw VLM is enough. Before investing in any of
  options (a)–(d), run option (e): the multi-variant ablation
  (`var_1..var_20` × CLI/Opus, no RAG vs API/Sonnet with RAG) to see
  whether the CLIP/RAG pipeline is meaningfully helping at all. See
  `~/.claude/plans/components-cli-recognition.md` for the reordered
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

## Routes

### Top-level (active)

| Route | Purpose |
|---|---|
| `/` | Landing page — 4 inline links (CAD · Wells · Plan · Archive) |
| `/cad` | CAD product overview — under construction; library-first rebuild planned |
| `/wells` | Wells product overview — pointer to working `/archive/wells` until ported |
| `/archive` | Index of legacy routes with descriptions |
| `/plan` | Gantt-style roadmap (bundles A–F) with click-through detail popups |

### Archive (legacy implementation, preserved for reference)

| Route | Purpose |
|---|---|
| `/archive/components` | Parametric component library — 18 primitives, live 3D + SVG + PNG export |
| `/archive/reverse` | Upload image → RAG-based identify → live 3D render → auto-refine loop → save to cache |
| `/archive/training` | Tabbed viewer for completion tool training data |
| `/archive/wells` | Upload PDF/image → Claude vision → WSON extraction (working — likely ported wholesale) |
| `/archive/tests` | Playwright test recordings (WEBM) + cache stats + links to eval viewers |
| `/archive/tests/wells` | Real-world wells extraction eval — 8 cases × API/CLI × 3 models, side-by-side diff vs ground-truth WSON |
| `/archive/tests/components` | Components recognition eval — 18 primitives via CLI/Opus, 17/18 (94.4%) top-1 accuracy |
| `/archive/author` | Manual component editor — compose from primitives, Claude tool-calling assistant |
| `/archive/library` | Browse and reload authored components |
| `/archive/tools/bottom-sub` | Dedicated Bottom Sub (HAL10408) parametric viewer |
| `/archive/tools/ratch-latch` | Dedicated Ratch-Latch Receiving Head viewer |

### API endpoints (URL-stable across the restructure)

API routes were intentionally **not** moved to `/api/archive/*` — they're called by URL and renaming would break archived pages. New product code may add `/api/cad/*` or `/api/wells-v2/*` later.

| Route | Purpose |
|---|---|
| `/api/identify` | POST — RAG-based image → component + params (consumed by `/archive/reverse`) |
| `/api/refine` | POST — iterative refinement (SSIM + Claude param update) |
| `/api/accept` | POST — append user-validated result to persistent cache |
| `/api/feedback` | POST — correct/wrong match feedback on identification |
| `/api/cache/stats` | GET — training cache statistics |
| `/api/author/save` | POST — append/upsert authored component to cache |
| `/api/author/list` | GET — index of authored components; GET `?id=` for full record |
| `/api/author/chat` | POST — Claude tool-calling chat |
| `/api/wells/extract` | POST — PDF/image → WSON extraction. `WELLS_BACKEND=cli\|api` (default api). |

## Project layout

```
src/
├── app.html                          # SvelteKit HTML shell
├── hooks.server.ts                   # Auth gate + rate limiting
├── routes/
│   ├── +layout.svelte                # 4-segment nav: CAD | Wells | Archive | Meta
│   ├── +layout.ts                    # ssr=false, prerender=false
│   ├── +page.svelte                  # Landing — 4 inline links
│   ├── cad/+page.svelte              # CAD product overview (stub)
│   ├── wells/+page.svelte            # Wells product overview (stub)
│   ├── archive/                      # Legacy implementation, preserved for reference
│   │   ├── +page.svelte              # Archive index (lists all routes below)
│   │   ├── components/+page.svelte   # 18-primitive library viewer
│   │   ├── reverse/+page.svelte      # Reverse identification + refine + save
│   │   ├── training/+page.svelte     # Completion tools tab viewer
│   │   ├── tests/+page.svelte        # Playwright WEBM recordings + cache stats
│   │   ├── tests/wells/+page.svelte  # Wells extraction eval viewer
│   │   ├── tests/components/+page.svelte # Components recognition eval viewer
│   │   ├── author/+page.svelte       # Manual composition editor + Claude chat
│   │   ├── library/+page.svelte      # Browse authored components
│   │   ├── wells/+page.svelte        # Working WSON extraction (drag-drop PDF/image)
│   │   └── tools/
│   │       ├── bottom-sub/+page.svelte
│   │       └── ratch-latch/+page.svelte
│   ├── plan/+page.svelte             # Gantt roadmap (bundles A-F)
│   └── api/                          # URL-stable; consumed by archive pages
│       ├── identify/+server.ts       # RAG few-shot with cache + Claude vision
│       ├── refine/+server.ts         # SSIM loop + Claude param updates
│       ├── accept/+server.ts         # Append to cache.jsonl
│       ├── feedback/+server.ts       # Correct/wrong match feedback
│       ├── cache/stats/+server.ts    # Cache statistics
│       ├── author/
│       │   ├── save/+server.ts       # Append/upsert authored component
│       │   ├── list/+server.ts       # Index or single-record fetch
│       │   └── chat/+server.ts       # Claude tool-calling chat
│       └── wells/extract/+server.ts  # PDF/image → WSON via Claude vision
└── lib/
    ├── shared/                       # Cross-domain infrastructure (cad ↔ wells share these)
    │   ├── anthropic-api.ts          # SDK key check + client factory
    │   ├── claude-cli.ts             # `claude --print` args + spawn + envelope parse
    │   ├── temp-file.ts              # withTempFile(prefix, ext, buf, fn) wrapper
    │   ├── mime.ts                   # guessImageExt(mime)
    │   └── ComponentScene.svelte     # Shared Threlte scene for component viewer
    ├── identify/
    │   └── backend.ts                # CAD identify dispatch (API + CLI) — uses shared/
    ├── wells/
    │   ├── backend.ts                # Wells extract dispatch (API + CLI) — uses shared/
    │   ├── prompt.ts                 # WSON system + user prompts
    │   └── schema.ts                 # WSON TypeScript types + validateWson()
    ├── components/
    │   ├── library.ts                # 18 ComponentDef entries (params, tags, defaults)
    │   ├── builder.ts                # ManifoldCAD buildComponent + buildPrimitiveManifold
    │   └── exporter.ts               # three-svg-renderer SVG export
    ├── authoring/                    # Authoring (Build) core — used by /archive/author
    │   ├── schema.ts compose.ts cache.ts context.ts
    │   ├── toolSchema.ts tools.ts systemPrompt.ts chat.svelte.ts
    │   └── ChatPanel.svelte
    ├── training/
    │   ├── cache.ts                  # TrainingCache class (JSONL persistence)
    │   ├── phash.ts                  # Perceptual hash via sharp + manual DCT
    │   ├── embed.ts                  # CLIP embedding via @xenova/transformers
    │   └── image_diff.ts             # Pure-TS SSIM + pixel diff + Sobel edge diff
    ├── tools/
    │   ├── bottom-sub/               # assembly.ts, builder.ts, Scene.svelte, ParamPanel.svelte
    │   └── ratch-latch/              # same structure
    ├── rate_limit.ts                 # Token-bucket rate limiter
    └── viewer/
        └── builder.ts                # Generic tabbed training data viewer builder

static/
├── training_data -> ../training_data # symlink so images are URL-accessible
├── tests/                            # Playwright WEBM recordings + manifest.json
├── eval/                             # Persisted eval datasets viewed at /tests/wells + /tests/components
│   ├── wells/                        # 8 cases × 2 backends × 3 models extracted JSON + 7 truth WSON + index.json
│   └── components/                   # 18 primitives × CLI/Opus extraction + summary index.json
├── kb/                               # Knowledge base for Bundle H constrained parametrization
│   ├── index.json                    # KB manifest (one entry per JSON KB file)
│   └── api/
│       └── casing-tubing-data.json   # 299 rows · LP/CSG/TBG operational specs (OD, wall, ID, drift, yield, MUT)
└── tmp/                              # Generated test frames + rag.gif

training_data/
├── cache.jsonl                       # Persistent RAG cache (seeded 122 records, grows with use)
├── authored_cache.jsonl              # Authored components (grows with /api/author/save)
├── authored_context.md               # Growing context doc (regenerated on save)
├── prim_<component>/                 # Seed training data (18 primitives × ~5 variations)
│   ├── images/default.png
│   ├── images/var_N.png
│   └── training.json                 # [{component_id, params, image}, ...]
└── reference/                         # Thread spec data etc

kb-sources/                            # Vendor/operator PDFs feeding scripts/kb/ extractors. GITIGNORED — outputs in static/kb/ ARE committed, raw inputs are not (license-uncertain).

scripts/
├── kb/
│   └── build_casing_tubing_data.ts   # Re-extractor: kb-sources/*.pdf → static/kb/api/casing-tubing-data.json
└── seed_cache.ts                     # Populate cache.jsonl from prim_* training data

vlm/                                   # CLI-only utilities (NOT shipped to production)
├── refine.py                         # Python iterative refinement CLI
├── compare.py                        # Claude/Ollama comparison
├── compare_images.py                 # cv2/skimage image diff (kept for CLI batch)
└── fine_tune.py                      # Training data prep for fine-tuning

Dockerfile                             # bun build → node:22-slim runtime (~250MB)
docker-entrypoint.sh                  # Handles /data volume symlink for cache.jsonl
railway.json                           # Railway deployment config
.env                                   # ANTHROPIC_API_KEY (gitignored)
```

## Architecture: Retrieval-Augmented Identification

The reverse pipeline is the heart of the app. Three components work together:

### 1. Perceptual hash retrieval (`src/lib/training/phash.ts`)
- `computePHash(buffer)` — resize to 32×32 grayscale, apply 2D DCT, threshold against median → 64-bit hex string
- `hammingDistance(a, b)` — XOR + popcount for similarity
- Pure TS, uses `sharp` for decode

### 2. Persistent cache (`src/lib/training/cache.ts`)
- Loaded once per server startup from `training_data/cache.jsonl`
- `findSimilar(hash, k)` returns top-K by Hamming distance
- `append(record)` persists immediately (JSONL append)
- Each record has: `id`, `hash`, `component_id`, `params`, `image_b64` (256px thumbnail), `source` ('seed' | 'refined' | 'manual'), `uses`, `accepted`

### 3. Few-shot Claude prompt (`src/routes/api/identify/+server.ts`)
```
[ COMPONENT CATALOG (18 types) — cache_control: ephemeral ]
[ TRAINING EXAMPLE 1: image + params ]
[ TRAINING EXAMPLE 2: image + params ]
... 5 retrieved neighbors
[ TARGET IMAGE ]
"Identify this following the same format."
```

### 4. Feedback loop
- `/reverse` UI has a "Save to Training" button
- Calls `/api/accept` → appends to `cache.jsonl`
- Next request benefits from the new example
- Cache grows over time; `source` field tracks provenance

### 5. Auto-refine loop (`/api/refine`)
- Captures the live canvas as PNG
- Runs pure-TS SSIM + pixel diff + Sobel edge diff (`src/lib/training/image_diff.ts`)
- If SSIM < 0.92, sends target + current + scores + params to Claude, gets updated params
- Loops until convergence or max iterations

## Key conventions

### Geometry
- **Z-down** axis (matches drilling convention).
  - **RULE**: `top` = LOWER z. `bottom` = HIGHER z. As z increases, you go down the hole.
  - Translating a part by `mv(part, [0, 0, +N])` moves it DOWN (toward the bottom).
  - When composing a box conn (upset flange at top, body below): cone at z=0..coneLen with the WIDE end at z=0, body translated to z ≥ coneLen.
  - All runes primitives and helpers in `src/lib/components/runes/` + `manifold-helpers.ts` follow this. Any new primitive MUST follow it too.
- **ManifoldCAD** circular segments: **192** for quality
- **Vertex colors** classify faces: **red (#cc2222)** = outer body, **grey (#888888)** = bore/cut/internal
- `buildComponent(id, params)` returns `{ full, cutVC, manifold }` where `cutVC` has the CSG cutaway applied
- Camera convention: `position={[6, 0, 0]}` looking at origin, `up={[0, 0, -1]}`

### Rendering
- **MeshPhongMaterial** (not MeshPhysicalMaterial — physical material washes out on Mac GPUs)
- `preserveDrawingBuffer: true` on WebGLRenderer for canvas capture
- Shared `ComponentScene.svelte` for consistency between components, reverse, and dedicated tool viewers

### SVG export
- `src/lib/components/exporter.ts` uses `three-svg-renderer`
- Uses **OrthographicCamera** (type-cast as `any` since three-svg-renderer types only accept PerspectiveCamera, but the underlying `Vector3.project()` works with both)
- Geometry split by vertex color into two meshes (red + grey) because FillPass reads material color, not per-face vertex colors
- Passes: `FillPass` (polygons) + `VisibleChainPass` (edges)

### Data flow
- Training cache is **gitignored when empty, committed when populated** — it's the app's long-term memory
- In production (Docker), cache is symlinked to `/data/cache.jsonl` on a Railway volume so it persists across deploys
- Thumbnails in the cache are 256×256 PNG base64 (compact, self-contained)

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

## Environment

```env
ANTHROPIC_API_KEY=sk-ant-...   # required for /api/identify, /api/refine, and the default api backend of /api/wells/extract and /api/identify
WELLS_BACKEND=api              # 'api' (default) or 'cli' — for /api/wells/extract
WELLS_MODEL=claude-opus-4-7    # API-backend default model for /api/wells/extract
WELLS_CLI_MODEL=opus           # CLI-backend default model alias for /api/wells/extract
IDENTIFY_BACKEND=api           # 'api' (default) or 'cli' — for /api/identify
IDENTIFY_MODEL=claude-sonnet-4-20250514  # API-backend default model for /api/identify
IDENTIFY_CLI_MODEL=opus        # CLI-backend default model alias for /api/identify
```

SvelteKit reads these via `$env/dynamic/private` so they're read at runtime.

### `/api/wells/extract` runtime modes

| Mode | Auth | Where it works |
|---|---|---|
| **Local + CLI** (`WELLS_BACKEND=cli`) | `claude` CLI subprocess → Pro/Max OAuth → subscription | Local dev only (Railway has no `claude` binary) |
| **Local + API** (default) | `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY` from `.env` | Local dev |
| **Production + API** (default) | `@anthropic-ai/sdk` + Railway env var | Railway Docker |

**Prerequisites for CLI mode**: `claude` must be on `$PATH` and authenticated via OAuth (`claude auth status` should show `"authMethod": "claude.ai"` and `"loggedIn": true`). The CLI is spawned with `--print --output-format json --no-session-persistence --permission-mode bypassPermissions --add-dir <tmp>` and given a temp file path to read.

CLI mode is ~5–7× slower per call than API (CLI startup + agent loop overhead) but doesn't burn API tokens. Subject to Pro/Max session-window rate limits.

Backend dispatch lives in `src/lib/wells/backend.ts`; both backends return the same `WellsExtractResponse` shape so the endpoint code is unified.

### `/api/identify` runtime modes

`IDENTIFY_BACKEND=api|cli` (default `api`) selects the same way:

| Mode | RAG retrieval | Notes |
|---|---|---|
| **API** | Yes — top-K=5 neighbors from `cache.jsonl` are sent as image blocks alongside the target | Current production behavior |
| **CLI** | **No (step 1)** — sends only the target image path + 18-primitive catalog text. Cold classification. | RAG-via-file-paths is a deferred follow-up; the agent can't accept image blocks like the API can |

Backend dispatch lives in `src/lib/identify/backend.ts`. Step-1 cold-classification accuracy was verified end-to-end on 3 sample primitives (hollow_cylinder, packer_element, thread_nc) — all identified correctly without RAG.

## Testing

Two layers, both in `tests/` (NOT shipped to production Docker):

### Unit tests — vitest (`bun test`)

- `src/lib/training/cache.test.ts` — JSONL round-trip, atomic write
- `src/lib/training/phash.test.ts` — DCT correctness, Hamming distance
- `src/lib/training/image_diff.test.ts` — SSIM + Sobel edge diff
- `src/lib/training/retrieval.test.ts` — RAG ranking on synthetic primitives
- `src/lib/authoring/compose.test.ts` — currently has a pre-existing module resolution failure unrelated to the refactor

### End-to-end — Playwright (`bun run test:e2e`)

Config: `playwright.config.ts`. Spawns a fresh dev server on port 4445 (so it doesn't fight your manual `bun run dev` on 3333). Reports to `tests/results/playwright-report/`.

- `tests/e2e/routes.spec.ts` — every active + archived route returns 200; removed top-level URLs (`/components`, `/reverse`, etc.) correctly 404
- `tests/e2e/navbar.spec.ts` — navbar shows the 4 segments, lists canonical archived routes, highlights active route, click navigates correctly
- `tests/e2e/archive-links.spec.ts` — no stale top-level links remain inside any archived page; intra-archive navigation (Tests↔Wells/Components, Author↔Library) all resolve

**Run modes:**
- `bun run test:e2e` — headless, ~15s, suitable for pre-commit
- `bun run test:e2e:headed` — opens Chromium with `slowMo: 250` so you can watch
- `bun run test:e2e:report` — open last HTML report

When prompting the user about testing (per Rule 11), default the suggestion to **headless** unless they ask to watch the flow — visible mode is mostly for debugging a specific failure.

### Legacy test scripts (pre-restructure, kept for reference)

- `tests/test_rag_with_gif.py` — Python Playwright; drives `/reverse` (now `/archive/reverse`) and saves frames → `static/tmp/rag.gif`
- `tests/visual_components_eval.mjs` — node script that walks the 18 primitives via the components viewer and screenshots each
- `tests/test_*_smoke.py`, `tests/test_*_real.py` — Python smoke + real-world tests

The `/archive/tests` route displays recorded WEBMs + live cache stats.

## Methodology (shared patterns)

These are reusable insights that apply to both CAD and Wells products. Capture them as documented patterns rather than shared code — implementations stay per-domain, but the architecture of each follows the same shape.

### Dual-backend dispatch (API vs CLI)

Every Claude-vision-driven endpoint should expose **two interchangeable backends** behind one request/response shape, selected at runtime via env var:

- **API backend** — `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`. Per-token billed. Works in dev and Railway production.
- **CLI backend** — spawns `claude --print --output-format json` subprocess. Bills against the user's Pro/Max OAuth subscription. Local-only (Railway has no `claude` binary). ~5–7× slower than API per call, but doesn't burn API tokens.

Subscription billing only works through the CLI subprocess. The Agent SDK does NOT bill against Pro/Max OAuth despite docs/intuition.

Implementation lives in `src/lib/shared/`:
- `anthropic-api.ts` — SDK client factory + key-required check
- `claude-cli.ts` — args builder, subprocess spawn, envelope parser
- `temp-file.ts` — write input buffer, run callback, finally-unlink

Domain backends (`src/lib/identify/backend.ts`, `src/lib/wells/backend.ts`) compose these primitives with their own prompts, content-block assembly, and (for identify) RAG retrieval.

### Cold-classification baseline first, retrieval second

Before investing in CLIP/RAG/embedding pipelines, run the **cold classification** test: just the catalog text + the target image, no retrieval, no few-shot, just Claude's vision. If accuracy is already 90%+ on the realistic input distribution, the retrieval scaffolding is not load-bearing and the engineering investment is misallocated.

For the cadtrain CAD primitives this hit 17/18 (94.4%) on synthetic renders — see Open TODOs above. Always re-run this baseline before optimizing retrieval.

### Cache grows with use (compounding loop)

The training cache (`training_data/cache.jsonl`) is structured so every accepted user-validated identification appends a new record, which gets retrieved as a few-shot example for the next similar query. Quality compounds:

- Month 1: 60% auto-approved
- Month 6: 92% auto-approved (rules tightened from corrections)
- Month 12: 98% auto-approved

Atomic JSONL append (temp file + rename) keeps writes durable under concurrent load. Records carry `source: 'seed' | 'refined' | 'manual' | 'synthetic'` so provenance is queryable.

### 5-layer validation (cheapest to most expensive)

For any extraction pipeline (currently wells; planned for the new CAD work):

1. **Schema** — Pydantic-equivalent (zod / hand-rolled). Auto-rejects malformed structure. ~30% of errors caught here.
2. **Domain rules** — petroleum-engineering invariants (casings nest, depths monotonic, formation tops in stratigraphic order). ~50% of remaining errors caught.
3. **Cross-document consistency** — same well's deviation survey vs cross section vs program text agree on TD, casing depths, formation depths.
4. **Visual roundtrip** — render the extraction back as a synthetic drawing, SSIM-diff against the original. Catches subtle errors the rule-based layers miss.
5. **Confidence-driven human review** — only review when score < 0.80 OR critical doc type OR new operator. ~10% of volume.

Implementation lives per-product (wells: `src/lib/wells/schema.ts` `validateWson()`); the methodology is the shared part.

### `cad/*` ↮ `wells/*` no cross-import

`src/lib/cad/*` and `src/lib/wells/*` (when they exist) MUST NOT import from each other. Both may freely import from `src/lib/shared/*`. This keeps domain coupling explicit and lets either side eventually move to its own deploy without a refactor PR. Enforce in code review; consider an ESLint rule once both directories exist.

### Test-after-change protocol

Per Rule 11 — when route surface, navbar, or backend dispatch changes, run `bun run test:e2e` (or prompt the user to). Headless catches 95% of regressions in 15s; reach for `test:e2e:headed` only when debugging a specific failure visually.

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
4. Attach volume at `/data` (1 GB)
5. Health check: `/api/cache/stats`

## Architecture: Claude-assisted component authoring (Build sub-app)

The Build sub-app lives under `src/routes/(build)/` and lets users compose
new components from the 18 primitives, with Claude as an on-demand assistant.

### Routes

| Route | Purpose |
|---|---|
| `/author` | Manual editor — add primitives, set params/transforms, apply CSG ops, ask Claude for hints, save |
| `/library` | Browse authored components — click to open in /author |
| `/api/author/save` | POST — append/upsert an AuthoredComponent to `training_data/authored_cache.jsonl` |
| `/api/author/list` | GET — index of authored components; GET `?id=` for a full record |
| `/api/author/suggest` | POST — Claude hints endpoint (spec + prompt → suggested editing steps) |

### Data model

`src/lib/authoring/schema.ts` defines the JSON recipe:

- **AuthoredComponent** — id, name, description, tags, parts[], ops[], version, source, thumbnail, hash, authoring_log[]
- **AuthoredPart** — id, prim (library id), params, transform {tx,ty,tz,rx,ry,rz}
- **AuthoredOp** — op (union/subtract/intersect), inputs[], out
- **AuthoringStep** — timestamp, actor (user/claude), action, payload — captures every user action, Claude prompt/response, and accept/reject decisions for future fine-tuning

### Composition interpreter (`src/lib/authoring/compose.ts`)

`buildAuthored(spec)` turns a recipe into ManifoldCAD geometry:
1. For each part: call `buildPrimitiveManifold(prim, params)` → apply transform
2. For each op: resolve inputs by id, apply CSG
3. If no ops: implicit union of all parts
4. Finalize via `finalizeManifold()` (center + cutaway + BufferGeometry)

### Learning pipeline

1. **RAG retrieval** — `AuthoredCache.findSimilar()` returns recent/similar prior authored components as few-shot examples for `/api/author/chat`
2. **Growing context doc** — `training_data/authored_context.md` is regenerated on each save via `src/lib/authoring/context.ts`. Loaded into the chat endpoint's prompt as a cached preamble so Claude sees the full authored library
3. **Fine-tune data** — every authoring session records `AuthoringStep[]` entries in the `authoring_log` field: user actions (add/modify/remove parts/ops), Claude prompts and responses, and accept/reject decisions on Claude suggestions. When saved, this log persists in `authored_cache.jsonl` and can later be extracted for fine-tuning

### Key constraints

- **No dynamic eval.** Claude emits JSON recipes only — a fixed interpreter executes them against the 18 known primitives. No `new Function`, no `eval`, no sandboxing needed.
- **Authored components are independent of the training/identification pipeline.** The two caches (`cache.jsonl` for training, `authored_cache.jsonl` for authoring) don't cross-reference each other.
- **`/api/author/chat` is rate-limited** at the same 20/10min threshold as `/api/identify`.
- **Model is selectable** — defaults to `AUTHOR_MODEL` env var (or Haiku), overridable per-session via the ChatPanel dropdown (Haiku/Sonnet/Opus).

## Things to know / avoid

- **Never** revert to `@sveltejs/adapter-static` — we need SSR for API routes
- **Never** add Python to the production container — the `/api/refine` endpoint uses pure-TS image diff (`src/lib/training/image_diff.ts`). Python `vlm/compare_images.py` is kept only for CLI usage.
- **Node 22.2.0** is too old for Vite 8 — use `bun --bun run vite dev` locally if you see the warning, or use Node ≥ 22.12
- Running multiple Vite servers on different ports at once will conflict — **the main SvelteKit app on port 3333 supersedes all legacy viewers** — the `src/routes/` and `src/lib/` paths are the authoritative source
- When adding a new component to `src/lib/components/library.ts`, also add a builder function in `src/lib/components/builder.ts` — they're matched by `component.id`
- Training data under `training_data/cache.jsonl` should be committed when it grows meaningfully — it's the app's learned memory

## Related directories

- `archive/` — archived legacy work (gitignored): `BOTTOM_SUB_legacy/` (old standalone Vite app + CAD exports), `HAL_PACKERS/` + `HAL_WPS/` (extracted catalog PDFs/SVGs, already indexed into cache), `scripts/` (extract_all.py, pipeline.py, etc.), `training_data_extras/` (comp_* catalog dirs). Kept locally as a safety net, not committed.
- `vlm/` — Python CLI tools (`refine.py`, `compare.py`, `fine_tune.py`, `compare_images.py`). Useful for batch training data preparation but NOT used at runtime in the deployed app.
