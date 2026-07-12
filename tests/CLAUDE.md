# `tests/` — vitest unit + Playwright e2e

Two layers, both gitignored from the production Docker image.

## Unit tests — vitest (`bun test`)

- `src/lib/training/cache.test.ts` — JSONL round-trip, atomic write
- `src/lib/training/phash.test.ts` — DCT correctness, Hamming distance
- `src/lib/training/image_diff.test.ts` — SSIM + Sobel edge diff
- `src/lib/training/retrieval.test.ts` — RAG ranking on synthetic primitives
- `src/lib/graph/mesh-serial.test.ts` — { full, cutVC } JSON round-trip
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

## Bake robustness — what to look for (regression checks)

Hard-won from the 2026-06-13 cascade where a degenerate assembly bake took the
whole app down. Full root-cause writeup: `docs/BAKE_ROBUSTNESS_PLAN.md`; incident
memory: `source_404_flood_2026-06-13`. When touching the graph editor, bake
endpoints, `manifold-helpers`, `builder`, or `composition-*`, sanity-check these:

**Symptom → likely cause (diagnose in this order):**
- "Nothing loads / whole app dead, even `/primitives`" → almost always a
  **client request-flood loop**, NOT a server crash. Local dev proxies the
  volume API to PROD, so a browser loop hammers prod. Check `railway logs` for a
  repeating `[404]`/`[400]` line; the local proxied `/api/primitives/list`
  returning 200 fast = prod is actually healthy. A flood stops only when the
  looping **browser tab is closed** (deployed fixes don't help an open tab).
- A repeating endpoint in logs = an `$effect` re-fetching without caching the
  failure. Guards in place: `loadExpectedParamsFor` attempted-once Set; server
  flood guard on `/api/primitives/source` (`hooks.server.ts`, 300/10s/IP).
- "`memory access out of bounds [in X → Y]`" = a **geometry** error (degenerate
  CSG/revolve), NOT a stale server. The editor shows a geometry hint (no restart
  button) when the message has a dep-chain / `EMPTY solid` / `stack:` marker.
- "Bake works but the part won't recreate after fixing params" → an uncaught
  throw in the bake (a 500, not a 400) left state stuck. Every bake error MUST
  return a structured **400** (`preview/+server.ts` wraps `primFn` AND
  `finalizeManifold`); a 500 "Internal Error" is the bug.

**Things that should produce a CLEAN, recoverable 400 (never a 500/OOB/flood):**
- Subtract of two identically-dimensioned solids → empty (e.g. g_tube with
  `wall=0`, or same OD both shafts) → `errorKind:'empty-solid'`.
- An empty child in a `stack`/group (its bbox is `[null,null,null]` → −Infinity →
  NaN offset) → `stack()` throws a clear "item N produced EMPTY geometry".
- NaN/0 param into a revolve. Verify: bake then bake again with valid params —
  the second MUST succeed (the WASM instance is NOT corrupted by bad input;
  confirmed by probe — no out-of-process worker needed).

**Cutaway:** parts over ~15k tris (multi-part assemblies) **auto-skip** the
server cutaway (`finalizeManifold`, perf). The live canvas must request
`cutaway: scene.showCutaway` so toggling the section ON re-fetches the cut for
large parts — else cutaway-ON renders blank while cutaway-OFF shows the mesh.
Test: open an assembly (e.g. `g_dp_joint`, ~74k verts), toggle cutaway — the
section should appear (a fresh bake), not blank.

**Server-side bake probe (fast, no browser):** POST `source` + `params` to
`/api/primitives/preview?bust=1` directly and assert the status/`errorKind`.
Degenerate params → expect a 400 with `errorKind`, never a 500. This is the
quickest way to verify a bake-robustness fix without the flaky browser tooling.

**Do NOT use the in-app "🔄 Restart dev server" button** — `/api/__dev_restart`
wedged the server (came back 000). Restart cleanly: `lsof -ti :3333 | xargs kill
-9` then `bun run dev`. Never `bun run dev &` inside a wrapper shell (the child
dies when the wrapper exits).

## Legacy test scripts

All previous Python and standalone-mjs tests (`test_*.py`,
`test_rag_with_gif.py`, `visual_components_eval.mjs`) and the empty
`scripts/legacy/{tests,vlm}/` placeholders have been removed. The
Playwright suite above is the sole supported e2e layer.
