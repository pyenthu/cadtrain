# `/archive` — legacy implementation, preserved for reference

The pre-restructure CAD pipeline (commit `55b1f43`, 2026-05-10). Kept
for reference and because some pages (`/archive/wells`,
`/archive/tests/*`) are still the working version until ported.

## Routes that actually exist here

| Route | Purpose |
|---|---|
| `/archive` | Index of legacy routes with descriptions |
| `/archive/reverse` | Upload image → RAG-based identify → live 3D render → auto-refine loop → save to cache |
| `/archive/training` | Tabbed viewer for completion-tool training data |
| `/archive/wells` | Upload PDF/image → Claude vision → WSON extraction (working — likely ported wholesale to `/wells`) |
| `/archive/tests` | Playwright test recordings (WEBM) + cache stats + links to eval viewers |
| `/archive/tests/wells` | Wells extraction eval — 8 cases × 2 backends × 3 models |
| `/archive/tools/bottom-sub` | Dedicated Bottom Sub (HAL10408) parametric viewer |
| `/archive/tools/ratch-latch` | Dedicated Ratch-Latch Receiving Head viewer |

**Removed**: `/archive/author` and `/archive/library` no longer exist
(the manual composition editor and authored-component browser were
deleted). Their backing endpoints (`/api/author/{chat,list,save}`) are
still on disk but have no UI consumer — see
`src/routes/api/CLAUDE.md`. Their backing schema
(`src/lib/authoring/*`) is still imported by `/plan` for
`AuthoredComponent` types and the compose interpreter.

## Architecture: Retrieval-Augmented Identification

Backs `/archive/reverse`. Three components work together; the cache
grows with use (compounding loop — see `src/lib/shared/CLAUDE.md`).

### 1. Perceptual hash retrieval — `src/lib/training/phash.ts`

- `computePHash(buffer)` — resize to 32×32 grayscale, apply 2D DCT,
  threshold against median → 64-bit hex string
- `hammingDistance(a, b)` — XOR + popcount for similarity
- Pure TS, uses `sharp` for decode

### 2. Persistent cache — `src/lib/training/cache.ts`

- Loaded once per server startup from `training_data/cache.jsonl`
- `findSimilar(hash, k)` returns top-K by Hamming distance
- `append(record)` persists immediately (JSONL append)
- Each record carries: `id`, `hash`, `component_id`, `params`,
  `image_b64` (256px thumbnail), `source` (`'seed' | 'refined' |
  'manual' | 'synthetic'`), `uses`, `accepted`

### 3. Few-shot Claude prompt — `src/routes/api/identify/+server.ts`

```
[ COMPONENT CATALOG (18 types) — cache_control: ephemeral ]
[ TRAINING EXAMPLE 1: image + params ]
[ TRAINING EXAMPLE 2: image + params ]
... 5 retrieved neighbours
[ TARGET IMAGE ]
"Identify this following the same format."
```

### 4. Feedback loop

- `/archive/reverse` has a "Save to Training" button.
- Calls `/api/accept` → appends to `cache.jsonl`.
- Next request benefits from the new example.

### 5. Auto-refine loop — `/api/refine`

- Captures the live canvas as PNG.
- Runs pure-TS SSIM + pixel diff + Sobel edge diff
  (`src/lib/training/image_diff.ts`).
- If SSIM < 0.92, sends target + current + scores + params to Claude,
  gets updated params.
- Loops until convergence or max iterations.

## Architecture: Build sub-app (deprecated UI; schema/core still live)

The Build sub-app (manual composition editor + authored-component
browser, formerly at `/archive/author` + `/archive/library`) has been
removed from the UI but its core (`src/lib/authoring/*`) is still
imported by `/plan` for the `AuthoredComponent` schema and
`buildAuthored()` compose interpreter.

### Data model — `src/lib/authoring/schema.ts`

- **AuthoredComponent** — id, name, description, tags, parts[], ops[],
  version, source, thumbnail, hash, authoring_log[]
- **AuthoredPart** — id, prim (library id), params, transform
  {tx,ty,tz,rx,ry,rz}
- **AuthoredOp** — op (union/subtract/intersect), inputs[], out
- **AuthoringStep** — timestamp, actor (user/claude), action, payload —
  captures every user action, Claude prompt/response, and
  accept/reject decisions for future fine-tuning. Only written by the
  removed UI; currently dormant.

### Composition interpreter — `src/lib/authoring/compose.ts`

`buildAuthored(spec)` turns a recipe into ManifoldCAD geometry:

1. For each part: call `buildPrimitiveManifold(prim, params)` → apply
   transform.
2. For each op: resolve inputs by id, apply CSG.
3. If no ops: implicit union of all parts.
4. Finalize via `finalizeManifold()` (center + cutaway +
   BufferGeometry).

### Key constraint — no dynamic eval

The interpreter executes a fixed grammar against the 18 known
primitives. No `new Function`, no `eval`, no sandboxing needed. (The
ONLY place `new Function` is allowed in the codebase is the volume
component loader — see Rule 17.)

## Archive index page

`/archive/+page.svelte` is the source of truth for which legacy routes
are still wired. If you remove a `/archive/*` page, update the index
list there too — the e2e suite (`tests/e2e/archive-links.spec.ts`)
asserts every link in the index resolves.
