# `tests/` — vitest unit + Playwright e2e

Two layers, both gitignored from the production Docker image.

## Unit tests — vitest (`bun test`)

- `src/lib/training/cache.test.ts` — JSONL round-trip, atomic write
- `src/lib/training/phash.test.ts` — DCT correctness, Hamming distance
- `src/lib/training/image_diff.test.ts` — SSIM + Sobel edge diff
- `src/lib/training/retrieval.test.ts` — RAG ranking on synthetic primitives
- `src/lib/cad/mesh-serial.test.ts` — { full, cutVC } JSON round-trip
- `src/lib/authoring/compose.test.ts` — pre-existing module-resolution failure, unrelated to the product split

## End-to-end — Playwright (`bun run test:e2e`)

Config: `playwright.config.ts`. Spawns a fresh dev server on **port
4445** (so it doesn't fight your manual `bun run dev` on 3333).
Reports to `tests/results/playwright-report/`.

| Spec | What it covers |
|---|---|
| `routes.spec.ts` | Every active + archived route returns 200; removed top-level URLs (`/components`, `/reverse`, etc.) correctly 404 |
| `navbar.spec.ts` | Navbar shows the canonical segments, lists archived routes, highlights active route, click navigates correctly |
| `archive-links.spec.ts` | No stale top-level links remain inside any archived page; intra-archive navigation resolves |
| `volume.spec.ts` | `/api/volume` PUT/GET/DELETE round-trip + `/api/kb/sources` listing — 3 modes (local, dev→prod proxy, direct prod). See root CLAUDE.md Rule 13 |
| `runes.spec.ts` | Svelte 5 runes smoke — catches reactive regressions |
| `backend.spec.ts` | Dual-backend dispatch smoke for identify + wells endpoints |

### Run modes

- `bun run test:e2e` — headless, ~15s, suitable for pre-commit
- `bun run test:e2e:headed` — opens Chromium with `slowMo: 250` so you can watch
- `bun run test:e2e:report` — open last HTML report
- `bun run test:volume` — just the volume spec, with the env-var modes documented in root CLAUDE.md Rule 13

When prompting the user (per Rule 11), default the suggestion to
**headless** unless they ask to watch the flow — visible mode is
mostly for debugging a specific failure.

### Per-plan-task recordings

When completing a `/plan` task (anything with a numeric ID in
`src/routes/plan/+page.svelte`), run the e2e suite, harvest the WEBM
recordings to `<volume>/test-recordings/e2e/<task-id>/`, and add a
`video` field to the `details.ts` entry pointing at the recording
(`/api/volume?path=test-recordings/e2e/<task-id>/<spec>.webm`). Use
`bun run record:task <id>` (script wraps test:e2e + the harvest
step). For docs-only or trivial tasks, mark `recorded: false` in the
details entry instead of skipping silently. See Rule 12.

## Legacy test scripts

All previous Python and standalone-mjs tests (`test_*.py`,
`test_rag_with_gif.py`, `visual_components_eval.mjs`) and the empty
`scripts/legacy/{tests,vlm}/` placeholders have been removed. The
Playwright suite above is the sole supported e2e layer.
