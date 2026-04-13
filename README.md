# CAD Train

Parametric 3D CAD modelling pipeline for downhole tool components, combining:

- **ManifoldCAD** — parametric solid modelling in the browser
- **Svelte 5 + Threlte** — interactive 3D viewers
- **Claude vision API** — component identification from reference images
- **Retrieval-Augmented Generation** — persistent training cache that improves with use

## Routes

| Path | Purpose |
| --- | --- |
| `/` | Landing page with feature cards |
| `/components` | Parametric component library (18 primitives) with live 3D + SVG + PNG export |
| `/reverse` | Upload an image → VLM identifies component + estimates params → live 3D render |
| `/training` | Tabbed viewer for completion tool training data |
| `/tests` | Visual test recordings + cache statistics |
| `/tools/bottom-sub` | Dedicated Bottom Sub (HAL10408) parametric viewer |
| `/tools/ratch-latch` | Dedicated Ratch-Latch Receiving Head viewer |
| `/api/identify` | POST: RAG-based image → component identification (Claude + training cache) |
| `/api/refine` | POST: Iterative parameter refinement via SSIM + Claude |
| `/api/accept` | POST: Append user-validated result to persistent training cache |
| `/api/cache/stats` | GET: Training cache statistics |

## Local development

```bash
bun install
bun run dev
```

Open http://localhost:3333.

Set `ANTHROPIC_API_KEY` in a `.env` file for the identification endpoints.

To re-seed the training cache from the primitive training data:

```bash
bun run seed
```

## Build and run in Docker

```bash
# Build
docker build -t cadtrain .

# Run (cache is in-memory only)
docker run -p 3333:3333 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  cadtrain

# Run with persistent cache volume
docker run -p 3333:3333 \
  -e ANTHROPIC_API_KEY=sk-ant-... \
  -v $(pwd)/data:/data \
  cadtrain
```

The container listens on `$PORT` (default 3333). The persistent cache is stored at `/data/cache.jsonl`, and is seeded from the baked-in cache on first run.

## Deploy to Railway

1. **Push this repo to GitHub.**
2. In Railway, click **New project → Deploy from GitHub** and select this repo.
3. Railway detects `Dockerfile` automatically. The `railway.json` file sets the health check.
4. Open the service → **Variables** → add `ANTHROPIC_API_KEY`.
5. Open the service → **Volumes** → add a volume mounted at `/data` (1 GB is plenty).
6. Railway builds and deploys. The public URL will be shown in the service overview.

Health check path: `/api/cache/stats` — returns `{ total, bySource, totalUses }`.

## Architecture overview

```
┌───────────────┐   ┌───────────────────┐   ┌──────────────────┐
│  Upload image │──▶│  pHash retrieval  │──▶│  Few-shot Claude │
└───────────────┘   │  from cache.jsonl │   │  (top-K examples)│
                    └───────────────────┘   └────────┬─────────┘
                                                     │
                                                     ▼
                                           ┌────────────────────┐
                                           │  Component + params│
                                           └────────┬───────────┘
                                                    │
                                                    ▼
                                           ┌────────────────────┐
                                           │  Live 3D render    │
                                           │  (ManifoldCAD)     │
                                           └────────┬───────────┘
                                                    │
                                                    ▼
                                           ┌────────────────────┐
                                           │  Auto-refine loop  │
                                           │  SSIM → Claude     │
                                           └────────┬───────────┘
                                                    │
                                                    ▼
                                           ┌────────────────────┐
                                           │  Save to cache     │
                                           │  (persistent)      │
                                           └────────────────────┘
```

- **Training cache** — JSONL file at `training_data/cache.jsonl`. Seeded from primitive training data (122 records) and grows with user-accepted identifications.
- **Retrieval** — perceptual hash (`sharp` + manual DCT) + Hamming distance. Top-5 neighbors included as few-shot context.
- **Image comparison** — pure-TS implementation (`src/lib/training/image_diff.ts`) computing SSIM, pixel diff, and Sobel edge diff. No Python dependency.

## Project layout

```
src/
├── routes/           # SvelteKit routes (pages + API)
├── lib/
│   ├── components/   # Component library + ManifoldCAD builder + SVG exporter
│   ├── tools/        # Bottom Sub + Ratch-Latch dedicated tools
│   ├── training/     # Persistent cache, pHash, image diff
│   ├── shared/       # Shared Svelte components
│   └── viewer/       # Generic builder for batch/training viewer
scripts/
└── seed_cache.ts     # Re-seed cache.jsonl from prim_* training data
training_data/
├── cache.jsonl       # Persistent training index (committed)
└── prim_*/           # Source training data per primitive component
vlm/                  # Python CLI tools (refine.py, compare.py) — dev only
```
