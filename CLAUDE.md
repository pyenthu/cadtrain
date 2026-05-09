# CAD Train — Project Context for Claude Code

Parametric 3D CAD pipeline for downhole tool components, built as a **SvelteKit** app with **ManifoldCAD** for geometry, **Threlte** for 3D rendering, and **Claude vision** + a **persistent training cache** for reverse identification (PNG → component + params).

## Rules for Claude (read me first)

1. This repo uses **Bun + SvelteKit + adapter-node**. Never switch to adapter-static or add Python to the runtime.
2. Production code is in `src/`. Legacy standalone Vite apps (`BOTTOM_SUB/manifold/`, `RATCH_LATCH/manifold/`, `components/`, `viewer/`) are non-authoritative and scheduled for deletion.
3. All API endpoints must use `$env/dynamic/private` (not `$env/static/private`) so env vars are read at runtime, not build time.
4. The training cache at `training_data/cache.jsonl` is the app's long-term memory. Writes must be atomic (temp file + rename). Never delete it without backup.
5. Follow plan files in `~/.claude/plans/`. Don't add features outside the current plan's scope.
6. Before destructive operations (`rm`, `git rm`, `git reset --hard`), show the plan and wait for approval.
7. Commit after each numbered plan step completes, not after each small edit.
8. Test changes locally (`bun run build` + tests if applicable) before committing.
9. When asked to review or audit, use Explore subagents for read-only exploration. Don't modify files during exploration.
10. Railway deploys via `Dockerfile` (not Railpack). `railway.toml` sets `builder = "DOCKERFILE"`.

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
bun install            # install deps
bun run dev            # dev server on :3333
bun run build          # production build (adapter-node)
bun run start          # run the production build (node build)
bun run seed           # rebuild training_data/cache.jsonl from prim_* records
```

**Always prefer Bun over Node** for running scripts (bun.lock is the lockfile).

## Routes

| Route | Purpose |
|---|---|
| `/` | Landing page |
| `/components` | Parametric component library — 18 primitives, live 3D + SVG + PNG export |
| `/reverse` | Upload image → RAG-based identify → live 3D render → auto-refine loop → save to cache |
| `/training` | Tabbed viewer for completion tool training data |
| `/wells` | Upload PDF/image → Claude vision → WSON extraction (well-engineering documents) |
| `/tests` | Playwright test recordings (WEBM) + cache stats + links to eval viewers |
| `/tests/wells` | Real-world wells extraction eval — 8 cases × API/CLI × 3 models, side-by-side diff vs ground-truth WSON |
| `/tests/components` | Components recognition eval — 18 primitives via CLI/Opus, 17/18 (94.4%) top-1 accuracy |
| `/author` | Manual component editor — compose from primitives, Claude tool-calling assistant |
| `/library` | Browse and reload authored components |
| `/tools/bottom-sub` | Dedicated Bottom Sub (HAL10408) parametric viewer |
| `/tools/ratch-latch` | Dedicated Ratch-Latch Receiving Head viewer |
| `/api/identify` | POST — RAG-based image → component + params |
| `/api/refine` | POST — iterative refinement (SSIM + Claude param update) |
| `/api/accept` | POST — append user-validated result to persistent cache |
| `/api/feedback` | POST — correct/wrong match feedback on identification |
| `/api/cache/stats` | GET — training cache statistics |
| `/api/author/save` | POST — append/upsert authored component to cache |
| `/api/author/list` | GET — index of authored components; GET `?id=` for full record |
| `/api/author/chat` | POST — Claude tool-calling chat (replaces /api/author/suggest) |
| `/api/wells/extract` | POST — PDF/image → WSON extraction. `WELLS_BACKEND=cli\|api` (default api). |

## Project layout

```
src/
├── app.html                          # SvelteKit HTML shell
├── hooks.server.ts                   # Auth gate + rate limiting
├── routes/
│   ├── +layout.svelte                # Three-segment nav (Training · Build · Tools)
│   ├── +layout.ts                    # ssr=false, prerender=false
│   ├── +page.svelte                  # Landing page
│   ├── (training)/                   # Route group — URLs unchanged
│   │   ├── components/+page.svelte   # 18-primitive library viewer
│   │   ├── reverse/+page.svelte      # Reverse identification + refine + save
│   │   ├── training/+page.svelte     # Completion tools tab viewer
│   │   └── tests/+page.svelte        # Playwright WEBM recordings + cache stats
│   ├── (build)/                      # Route group — Build sub-app
│   │   ├── author/+page.svelte       # Manual composition editor + Claude chat
│   │   └── library/+page.svelte      # Browse authored components
│   ├── tools/
│   │   ├── bottom-sub/+page.svelte
│   │   └── ratch-latch/+page.svelte
│   └── api/
│       ├── identify/+server.ts       # RAG few-shot with cache + Claude vision
│       ├── refine/+server.ts         # SSIM loop + Claude param updates
│       ├── accept/+server.ts         # Append to cache.jsonl
│       ├── feedback/+server.ts       # Correct/wrong match feedback
│       ├── cache/stats/+server.ts    # Cache statistics
│       └── author/
│           ├── save/+server.ts       # Append/upsert authored component
│           ├── list/+server.ts       # Index or single-record fetch
│           └── chat/+server.ts       # Claude tool-calling chat
└── lib/
    ├── components/
    │   ├── library.ts                # 18 ComponentDef entries (params, tags, defaults)
    │   ├── builder.ts                # ManifoldCAD buildComponent + buildPrimitiveManifold + finalizeManifold
    │   └── exporter.ts               # three-svg-renderer SVG export
    ├── authoring/                    # Build sub-app core
    │   ├── schema.ts                 # AuthoredComponent / Part / Op / Step types
    │   ├── compose.ts                # buildAuthored(spec) interpreter
    │   ├── cache.ts                  # AuthoredCache class (JSONL)
    │   ├── context.ts                # Growing context doc builder
    │   ├── toolSchema.ts             # Tool definitions for Claude (planned)
    │   ├── tools.ts                  # Client-side tool dispatcher (planned)
    │   ├── chat.svelte.ts            # ChatState class with tool loop (planned)
    │   ├── systemPrompt.ts           # System prompt builder (planned)
    │   └── ChatPanel.svelte          # Floating chat UI (planned)
    ├── training/
    │   ├── cache.ts                  # TrainingCache class (JSONL persistence)
    │   ├── phash.ts                  # Perceptual hash via sharp + manual DCT
    │   └── image_diff.ts             # Pure-TS SSIM + pixel diff + Sobel edge diff
    ├── tools/
    │   ├── bottom-sub/               # assembly.ts, builder.ts, Scene.svelte, ParamPanel.svelte
    │   └── ratch-latch/              # same structure
    ├── shared/
    │   └── ComponentScene.svelte     # Shared Threlte scene for component viewer
    ├── rate_limit.ts                 # Token-bucket rate limiter
    └── viewer/
        └── builder.ts                # Generic tabbed training data viewer builder

static/
├── training_data -> ../training_data # symlink so images are URL-accessible
├── tests/                            # Playwright WEBM recordings + manifest.json
├── eval/                             # Persisted eval datasets viewed at /tests/wells + /tests/components
│   ├── wells/                        # 8 cases × 2 backends × 3 models extracted JSON + 7 truth WSON + index.json
│   └── components/                   # 18 primitives × CLI/Opus extraction + summary index.json
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

scripts/
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
- **Z-down** axis (matches drilling convention)
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

- **Playwright** is the primary testing tool
- Tests are in `tests/` (NOT shipped to production Docker)
- `tests/test_rag_with_gif.py` drives the `/reverse` flow and saves frames → `static/tmp/rag.gif`
- For visual inspection, open Chromium with `headless=False, slow_mo=300`
- The `/tests` route displays recorded GIFs + live cache stats

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
