# CAD Train — Project Context for Claude Code

Parametric 3D CAD pipeline for downhole tool components, built as a **SvelteKit** app with **ManifoldCAD** for geometry, **Threlte** for 3D rendering, and **Claude vision** + a **persistent training cache** for reverse identification (PNG → component + params).

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
| `/tests` | Visual test GIFs + cache stats |
| `/tools/bottom-sub` | Dedicated Bottom Sub (HAL10408) parametric viewer |
| `/tools/ratch-latch` | Dedicated Ratch-Latch Receiving Head viewer |
| `/api/identify` | POST — RAG-based image → component + params |
| `/api/refine` | POST — iterative refinement (SSIM + Claude param update) |
| `/api/accept` | POST — append user-validated result to persistent cache |
| `/api/cache/stats` | GET — training cache statistics |

## Project layout

```
src/
├── app.html                          # SvelteKit HTML shell
├── routes/
│   ├── +layout.svelte                # Top nav bar
│   ├── +page.svelte                  # Landing page
│   ├── components/+page.svelte       # Component library viewer
│   ├── reverse/+page.svelte          # Reverse identification + refine + save
│   ├── training/+page.svelte         # Completion tools tab viewer
│   ├── tests/+page.svelte            # Test recording gallery
│   ├── tools/
│   │   ├── bottom-sub/+page.svelte
│   │   └── ratch-latch/+page.svelte
│   └── api/
│       ├── identify/+server.ts       # RAG few-shot with cache + Claude vision
│       ├── refine/+server.ts         # SSIM loop + Claude param updates
│       ├── accept/+server.ts         # Append to cache.jsonl
│       └── cache/stats/+server.ts    # Cache statistics
└── lib/
    ├── components/
    │   ├── library.ts                # 18 ComponentDef entries (params, tags, defaults)
    │   ├── builder.ts                # ManifoldCAD buildComponent(id, params) → { full, cutVC, manifold }
    │   └── exporter.ts               # three-svg-renderer SVG export
    ├── training/
    │   ├── cache.ts                  # TrainingCache class (JSONL persistence)
    │   ├── phash.ts                  # Perceptual hash via sharp + manual DCT
    │   └── image_diff.ts             # Pure-TS SSIM + pixel diff + Sobel edge diff
    ├── tools/
    │   ├── bottom-sub/               # assembly.ts, builder.ts, Scene.svelte, ParamPanel.svelte
    │   └── ratch-latch/              # same structure
    ├── shared/
    │   └── ComponentScene.svelte     # Shared Threlte scene for component viewer
    └── viewer/
        └── builder.ts                # Generic tabbed training data viewer builder

static/
├── training_data -> ../training_data # symlink so images are URL-accessible
└── tmp/                              # Generated test recordings (rag.gif, etc)

training_data/
├── cache.jsonl                       # Persistent RAG cache (seeded 122 records, grows with use)
├── prim_<component>/                 # Seed training data (18 primitives × ~5 variations)
│   ├── images/default.png
│   ├── images/var_N.png
│   └── training.json                 # [{component_id, params, image}, ...]
├── comp_<CATEGORY.NAME>/              # Catalog component analyses (from extraction)
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
ANTHROPIC_API_KEY=sk-ant-...   # required for /api/identify and /api/refine
```

SvelteKit reads this via `$env/static/private` in server files.

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

## Things to know / avoid

- **Never** revert to `@sveltejs/adapter-static` — we need SSR for API routes
- **Never** add Python to the production container — the `/api/refine` endpoint uses pure-TS image diff (`src/lib/training/image_diff.ts`). Python `vlm/compare_images.py` is kept only for CLI usage.
- **Node 22.2.0** is too old for Vite 8 — use `bun --bun run vite dev` locally if you see the warning, or use Node ≥ 22.12
- Running multiple Vite servers on different ports at once will conflict — each dedicated tool viewer (`BOTTOM_SUB/manifold`, `RATCH_LATCH/manifold`, `components/`, etc.) has its own legacy `vite.config.ts`. **The main SvelteKit app on port 3333 supersedes all of those** — the `src/routes/` and `src/lib/` paths are the authoritative source
- When adding a new component to `src/lib/components/library.ts`, also add a builder function in `src/lib/components/builder.ts` — they're matched by `component.id`
- Training data under `training_data/cache.jsonl` should be committed when it grows meaningfully — it's the app's learned memory

## Related directories (legacy / not authoritative)

- `BOTTOM_SUB/manifold/`, `RATCH_LATCH/manifold/`, `components/`, `viewer/` — earlier standalone Vite apps for each tool. Superseded by the unified SvelteKit app. Kept for reference until the migration is fully trusted.
- `vlm/` — Python CLI tools (`refine.py`, `compare.py`, `fine_tune.py`, `compare_images.py`). Useful for batch training data preparation but NOT used at runtime in the deployed app.
- `HAL_PACKERS/`, `HAL_WPS/` — extracted PDFs and SVGs from source catalogs. Input data for the training set, not runtime.
- `pipeline.py`, `extract_all.py`, `extract_packers.py`, `find_duplicates.py` — dev-only scripts for building training data from source PDFs.
