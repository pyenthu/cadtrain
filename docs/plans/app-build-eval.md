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
