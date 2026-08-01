# App-build eval — measuring how well a model reproduces our golden `.app` builds

The app-harness lets a model author a declarative `.app` by emitting a JSON array of gui-verb
calls (`parseVerbCalls` → `dispatch`). This harness measures how faithfully a given provider
reproduces our **golden** `.app` builds from the natural-language prompt scripts.

## Harness

- **Runner:** `scripts/eval-app-build.ts` (headless, `bun run`).
- **Scorer:** `src/lib/appkit/ai/score-app.ts` — `scoreApp(built, golden)` returns a 0..1
  structural similarity + per-facet breakdown (preorder kinds, nesting edges, panel ids, data
  var/structure names).
- **Fixtures:** `scripts/eval-fixtures/` — `prompts.json` (ordered prompt steps per app) +
  `golden/<id>.{app,md}` for `plan · design · ewell`.
- **Default provider** is a deterministic FAKE runner (no LLM, no network — CI-safe): it
  decompiles the golden into a verb list and replays it, establishing the score CEILING (≈1.0).

```bash
bun run scripts/eval-app-build.ts                  # FAKE oracle, all 3 apps (CI-safe)
bun run scripts/eval-app-build.ts --app plan       # one app
bun run scripts/eval-app-build.ts --json           # machine-readable
bun run scripts/eval-app-build.ts --provider cli --app plan   # ONE real `claude --print`
```

A real model's deviation from the FAKE ceiling is the meaningful signal. A model swap is only
"done" when its JSON-array conformance / score is ≥ the incumbent's.

## In-browser eval harness (`/app_design/eval`)

For a **comprehensive, repeatable** run over ALL apps — and to measure the LOCAL model
(Qwen3-4B in-browser, WebGPU) which the headless Node runner **cannot** execute — use the
in-browser route **`src/routes/app_design/eval/+page.svelte`** (a sub-route of the studio).

- **Prompts + app ids** come from the SHARED module `src/lib/appkit/ai/eval-fixtures.ts`
  (`EVAL_PROMPTS` + `APP_IDS`) — the single source of truth, also imported by
  `scripts/eval-app-build.ts` (so the two never drift; the old `prompts.json` is superseded).
- **Providers:** Phi / Qwen3-4B (in-browser, free — `buildAppWithPhi`) · Claude CLI · Claude API
  (the last two POST `/api/app/generate` and bill the subscription/metered path).
- **How to run:** open `/app_design/eval`, pick a provider + app (all / one) + a *runs N* (average
  over N to de-noise LLM variance). For Phi, click **Load model** (one-time ~3.4 GB into the
  browser Cache API) — nothing runs on mount, only on **Run**. Each app × run starts from an EMPTY
  `{app,title,panels:[]}`, replays `EVAL_PROMPTS[id]` one prompt at a time, then
  `scoreApp(built, golden)` (golden fetched from `/api/volume?path=ai/app-rag/golden/<id>.app&raw=1`).
- **Report:** a colour-graded matrix (rows = apps · cols = Overall + the 6 facets + a Claude-ref
  column) with a summary average row, live-updating per run; each app expands to the built-vs-golden
  kind/var/structure lists, the per-run scores + σ variance, any build error, and a **capture** link
  to download the built `.app` (for `--score-file`-style offline checks). Committed Claude reference
  numbers (design 1.0 · plan ~0.8 · ewell 0.67) shown as a static comparison.
- **Verified headless:** `bun run build`, `svelte-check` on the new files, and the FAKE-oracle
  `scripts/eval-app-build.ts` (still 100% ceiling after the fixtures refactor). The actual Phi/Qwen3
  WebGPU run + the visual matrix are the **interactive follow-up** (needs a WebGPU browser —
  Chrome/Edge desktop; not headless / Node).

## Log

### 2026-08-01 — browser model swapped to Qwen3-4B

The in-browser (WebLLM/WebGPU) build path — still surfaced in the chat toggle as **Phi** — was
switched from `Phi-3.5-mini-instruct-q4f16_1-MLC` to **`Qwen3-4B-q4f16_1-MLC`** (Apache-2.0,
~3.4 GB q4f16, smaller than Phi-3.5 and a materially stronger JSON/instruction model). See
`docs/research/local-model-survey.md`. Ollama's local default was likewise moved from
`qwen2.5-coder` to `qwen3:8b` (fallback `qwen3:4b`) in `src/lib/appkit/ai/providers.ts`.

**Gotcha handled:** Qwen3 is a hybrid-thinking model. `webllm-build.ts` now passes
`extra_body: { enable_thinking: false }` to the WebLLM `chat.completions.create` call, which
prepends a closed empty `<think></think>` block and suppresses reasoning tokens — without it,
`<think>…</think>` prose can make `parseVerbCalls` return `[]` (silent no-op build). (`parseVerbCalls`
also has a brace-depth object-scan fallback for lone `{verb}`/NDJSON, but disabling thinking is the
correct fix, not relying on the fallback.)

**To verify the browser swap (needs a WebGPU browser — NOT headless / Node):**

1. Open `/app_design`.
2. In the chat toggle, pick **Phi** (the in-browser Qwen3-4B path).
3. Let the model download once (~3.4 GB into the browser Cache API), then run a known prompt
   (e.g. one of the `scripts/eval-fixtures/prompts.json` scripts).
4. Confirm `buildAppWithPhi` produced a non-empty trace — i.e. `parseVerbCalls` got a non-empty
   verb array with **no `<think>` leakage** in the raw output.
5. Score it against the golden with `scripts/eval-app-build.ts` (or eyeball the produced `.app`)
   and confirm conformance is ≥ the Phi-3.5 baseline before calling the swap done.

### 2026-08-01 — WebLLM inference moved OFF the main thread into a Web Worker (/plan #906)

The MLC engine previously ran `CreateMLCEngine` + `chat.completions.create` on the MAIN THREAD, so
the WebGPU generation loop **froze the renderer for ~90s per prompt** — the `/app_design` studio and
`/app_design/eval` harness locked up and CDP/automation timed out. WebGPU is available inside Web
Workers, so the heavy engine now lives in `src/lib/appkit/ai/webllm.worker.ts` (SVTC does the same).

- **In the worker:** ONLY the MLC engine — `CreateMLCEngine` (load, forwarding init progress) and
  `chat.completions.create` (inference). `MODEL_ID`/`IS_QWEN3`/sampling consts come from the shared
  `src/lib/appkit/ai/webllm-model.ts` so worker + main can never drift.
- **On the main thread (`webllm-build.ts`, now the DRIVER):** the SAME emit-verbs prompt build,
  `parseVerbCalls`, and the verb `dispatch` loop (that's where the `.app` state lives, and it's cheap).
  The public API (`loadPhi`/`buildAppWithPhi`/`isWebGPUAvailable`/`phiReady`/`phiLoading`) is UNCHANGED,
  so the studio + eval routes need no edits.
- **Fallback:** if `new Worker` throws or the worker can't bring up WebGPU (Safari / worker-WebGPU
  disabled), `loadPhi` transparently falls back to the old main-thread engine path.

**To verify (needs a WebGPU browser — NOT headless / Node):** open `/app_design/eval` → **Load model**
→ **Run**. Generation must proceed while the UI stays responsive (drag/scroll during a build) — that's
the whole point of the worker move. Confirm the trace is still non-empty (parity with the pre-worker
path).
