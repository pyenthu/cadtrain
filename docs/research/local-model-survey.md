# Local / in-browser small-model survey for the app-harness builder

_Written 2026-07-31. Read-only research — no code changed._

## What we actually run the model for

The app-harness lets a **local** model author a declarative `.app` UI. The model is fed a
system prompt (`src/lib/appkit/ai/prompt.ts` → `systemPrompt`) containing the verb `API.md`
projection (`schema/to-apimd.ts`) + component-knowledge cards + RAG few-shots, then asked to
**emit a strict JSON array of `{verb, args}` calls** which we dispatch (`parseVerbCalls` →
`dispatch`). So the job is: **reliable JSON / structured output + strong instruction-following**,
over a prompt that is a few thousand tokens, at `temperature: 0`, `max_tokens: 2048`.

Two independent code paths, two different mechanisms:

| Path | File | Mechanism | What the model must be good at |
|---|---|---|---|
| **Browser (WebLLM/WebGPU)** | `src/lib/appkit/ai/webllm-build.ts` (`MODEL_ID`) | **Emit** a JSON array of verb calls from a text instruction (no native tool loop) | Clean JSON-array output following a prose instruction; fit ~2–4 GB q4 in the browser Cache API |
| **Local (Ollama)** | `src/lib/appkit/ai/providers.ts` (`resolveModel`, default `qwen2.5-coder`) | **Native tool calling** via the AI-SDK (`schema/to-aisdk.ts`) over Ollama's OpenAI-compatible endpoint | Real function/tool-call conformance (Ollama-flagged tool-capable model) |

Today: browser = `Phi-3.5-mini-instruct-q4f16_1-MLC` (3.8B, ~3.67 GB VRAM). Local Ollama
default = `qwen2.5-coder`.

**A browser model is only usable if MLC ships (or we compile) a `-MLC` build.** The good news
(single most important finding): the WebLLM prebuilt catalog now ships **Qwen3 (0.6B–8B,
Apache-2.0)**, **Qwen2.5 / Qwen2.5-Coder**, **Phi-4-mini**, **Hermes-3-Llama-3.2-3B**, and
more — so we can swap the one-line `MODEL_ID` to a materially stronger, fully-open model *today,
with no compile step*.

---

## TL;DR recommendations

- **Browser (WebLLM) — swap to `Qwen3-4B-q4f16_1-MLC`.** Apache-2.0 (genuinely open), the
  strongest small instruct+tool model that has a ready prebuilt build, and at **~3.43 GB VRAM**
  it fits the browser budget (essentially the same footprint as today's Phi-3.5, and *smaller*
  than Phi-3.5's 3.67 GB). **Mandatory caveat:** Qwen3 is a hybrid-thinking model — you must
  **disable thinking** (append `/no_think` to the prompt, or set the non-thinking chat template)
  or it emits `<think>…</think>` reasoning that breaks `parseVerbCalls`' strict-JSON assumption.
  - _Lighter fully-open alternative_ if you want half the download: **`Qwen2.5-1.5B-Instruct-q4f16_1-MLC`** (Apache-2.0, ~1.63 GB, plain instruct = no thinking blocks).
  - _Same-footprint MIT drop-in in the Phi family:_ **`Phi-4-mini-instruct-q4f16_1-MLC`** (MIT, ~3.44 GB) — a clean generational bump over Phi-3.5, but Microsoft's own card warns it can hallucinate function names, which is riskier against our closed verb list.

- **Local (Ollama) — switch the default from `qwen2.5-coder` to `qwen3:8b`** (or `qwen3:4b`
  for lighter). Apache-2.0, explicitly trained for reliable function/tool calling (Ollama's
  tool-capable list), and the AI-SDK path uses *native* tool calling where Qwen3 is strongest.
  Same `/no_think` consideration applies (Ollama exposes it via the model's think setting).

**Single most important finding:** the swap is a one-line change with no MLC compile —
Qwen3 and Phi-4-mini already have official `-MLC` prebuilts — and the one gotcha that will
silently break output is **Qwen3's thinking mode**; disable it.

---

## WebLLM prebuilt catalog — the relevant subset (exact ids + footprint)

VRAM figures are `vram_required_MB` read verbatim from the WebLLM `prebuiltAppConfig`
(`src/config.ts`); all these standard builds ship a **4096-token context window** (see caveat).

| model_id (WebLLM) | Params | VRAM (MB) | Notes |
|---|---|---|---|
| `Phi-3.5-mini-instruct-q4f16_1-MLC` | 3.8B | 3672 | **current default** |
| `Phi-4-mini-instruct-q4f16_1-MLC` | 3.8B | 3438 | newer Phi |
| `Qwen3-1.7B-q4f16_1-MLC` | 1.7B | 2037 | hybrid-thinking |
| `Qwen3-4B-q4f16_1-MLC` | 4B | 3432 | hybrid-thinking |
| `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` | 1.5B | 1630 | plain instruct |
| `Qwen2.5-3B-Instruct-q4f16_1-MLC` | 3B | 2505 | plain instruct (⚠ Qwen Research License) |
| `Llama-3.2-3B-Instruct-q4f16_1-MLC` | 3B | 2264 | plain instruct |
| `Hermes-3-Llama-3.2-3B-q4f16_1-MLC` | 3B | 2264 | tool-tuned |
| `gemma-2-2b-it-q4f16_1-MLC` | 2B | 1895 | plain instruct |
| `SmolLM2-1.7B-Instruct-q4f16_1-MLC` | 1.7B | 1774 | plain instruct |

Also in the catalog but not shortlisted: `Qwen2.5-7B-Instruct-q4f16_1-MLC` (~5.1 GB — best
quality if the machine has the VRAM, but over the ~4 GB browser budget); `gemma3-1b-it-q4f16_1-MLC`
(Gemma-3 exists in-browser only as a **1B** build — too weak for this task, and Gemma-3 2B/4B
have **no** WebLLM build yet); `Qwen2.5-Coder-{1.5B,3B,7B}-Instruct` builds; `Hermes-2-Pro-Llama-3-8B`.
The catalog additionally lists newer `Qwen3.5-{0.8B,2B,4B,9B}` MLC builds — promising and
Apache-2.0-lineage, but too new to have independent JSON/tool-calling track record, so treat as
experimental rather than the safe pick.

---

## Ranked comparison (for OUR task: strict JSON verb-array + instruction-following)

Ranked for the **browser** path first (must have a `-MLC` build + fit ~4 GB), with the Ollama
tag and license alongside.

| # | Model | Params / q4 VRAM | WebLLM model_id | Ollama tag | License | JSON / tool-calling | Instruction-following |
|---|---|---|---|---|---|---|---|
| **1** | **Qwen3-4B** | 4B / ~3.43 GB | `Qwen3-4B-q4f16_1-MLC` | `qwen3:4b` | **Apache-2.0** ✅ | Strong; trained for reliable function calling. Qwen3-4B rivals Qwen2.5-72B on many tasks | Excellent (a headline Qwen3 improvement) — **but disable thinking** |
| **2** | **Qwen2.5-7B-Instruct** | 7B / ~5.1 GB | `Qwen2.5-7B-Instruct-q4f16_1-MLC` | `qwen2.5:7b` | **Apache-2.0** ✅ | Very strong, mature JSON/tool track record | Excellent | ⚠ over the ~4 GB browser budget; ideal for Ollama, not most browsers |
| **3** | **Phi-4-mini-instruct** | 3.8B / ~3.44 GB | `Phi-4-mini-instruct-q4f16_1-MLC` | `phi4-mini` | **MIT** ✅ | Improved function calling vs Phi-3.5, JSON-dump tool format — **but card admits it hallucinates function names/URLs**; Ollama community rates Phi-4 *weak* for agents | Good | Clean generational bump over current default |
| **4** | **Qwen2.5-3B-Instruct** | 3B / ~2.5 GB | `Qwen2.5-3B-Instruct-q4f16_1-MLC` | `qwen2.5:3b` | ⚠ **Qwen Research License** (non-commercial-ish; the 3B tier is *not* Apache-2.0 unlike 0.5/1.5/7B) | Strong, plain instruct = clean JSON, no thinking blocks | Very good | Great tech, **license is the catch** — flag before shipping |
| **5** | **Qwen2.5-1.5B-Instruct** | 1.5B / ~1.63 GB | `Qwen2.5-1.5B-Instruct-q4f16_1-MLC` | `qwen2.5:1.5b` | **Apache-2.0** ✅ | Good for its size; plain instruct, reliable short JSON | Good | Best *lightweight fully-open* browser pick |
| **6** | **Hermes-3-Llama-3.2-3B** | 3B / ~2.26 GB | `Hermes-3-Llama-3.2-3B-q4f16_1-MLC` | `hermes3:3b` | ⚠ Llama-3.2 Community (inherits Meta restrictions) | Explicitly fine-tuned for **function calling + structured JSON** (ChatML, dedicated JSON-schema system prompt) — a genuine tool-tuned option | Good | Purpose-built for JSON; license restrictions to weigh |
| **7** | **Llama-3.2-3B-Instruct** | 3B / ~2.26 GB | `Llama-3.2-3B-Instruct-q4f16_1-MLC` | `llama3.2:3b` | ⚠ Llama-3.2 Community (<700M MAU; EU-domicile history) | Adequate; independent tests find base Llama-3.2-3B mediocre on non-trivial JSON schemas | Good | Solid, but out-classed by Qwen3-4B |
| **8** | **gemma-2-2b-it** | 2B / ~1.9 GB | `gemma-2-2b-it-q4f16_1-MLC` | `gemma2:2b` | ⚠ Gemma Terms (permissive-commercial, not OSI; use-restrictions) | OK for simple JSON; not tool-tuned | Good instruction-follower for size | Fine fallback; Gemma-3 2B has no browser build |
| **9** | **SmolLM2-1.7B-Instruct** | 1.7B / ~1.77 GB | `SmolLM2-1.7B-Instruct-q4f16_1-MLC` | `smollm2:1.7b` | **Apache-2.0** ✅ | Tool-capable per Ollama, but weakest here on strict multi-call JSON | Decent for size | Only if you need the smallest fully-open footprint |
| — | Nemotron-mini | 4B / ~2.7 GB | _no WebLLM build_ | `nemotron-mini` | NVIDIA Open Model | Noted elsewhere as strong at valid JSON | Good | **Ollama-only** (no `-MLC` prebuilt) — can't use in-browser without compiling |

License legend: ✅ = genuinely open (Apache-2.0 / MIT). ⚠ = usable but restricted/gated —
flag before shipping commercially.

---

## Notes that matter for correctness

- **Qwen3 thinking mode is the #1 footgun.** Qwen3 (and Qwen3.5) default to a hybrid reasoning
  mode that prepends `<think>…</think>`. `parseVerbCalls` slices from the first `[` to the last
  `]`, so stray reasoning usually still parses — **but** any bracket inside the think block, or a
  thinking-then-prose response with no array, yields `[]` (silent no-op build). **Always disable
  thinking**: append `/no_think` to the user turn (soft switch) or, better, use the non-thinking
  chat template (`enable_thinking:false`). Qwen recommends non-thinking sampling `temp≈0.7,
  top_p 0.8, top_k 20`; we run `temperature:0`, which is fine for determinism but re-test.
- **4096-token context ceiling.** Every standard MLC build above is compiled to a 4096 window.
  Our `systemPrompt` (verb `API.md` + component cards + RAG grounding + request) plus
  `max_tokens: 2048` output can approach that. If you see truncated/empty builds on large apps,
  either trim grounding, lower `max_tokens`, or raise the window via WebLLM engine
  `chatOpts`/an overridden `ModelRecord` (Qwen supports long context natively; the *build* caps
  it). Worth a quick token-count check after any swap.
- **Browser vs local are different tasks.** Browser = emit-JSON-array from a prose instruction
  (favor clean, obedient instruct models). Local Ollama = *native* tool calling via the AI-SDK
  (favor Ollama-flagged tool-capable models). A model can be great at one and mediocre at the
  other; Qwen3 is strong at both, which is why it wins both paths.
- **License honesty.** Fully open: Qwen3 (all sizes), Qwen2.5-{0.5/1.5/7B}, Phi-3.5/Phi-4-mini
  (MIT), SmolLM2 (Apache-2.0). Restricted/flag: **Qwen2.5-3B** (Qwen Research License — the odd
  one out in the Qwen2.5 lineup), Llama-3.2 & Hermes-3-Llama-3.2 (Meta Community License),
  Gemma-2 (Gemma Terms), Nemotron (NVIDIA Open Model License).

---

## How to swap + verify

**Browser (WebLLM):** edit the one constant in `src/lib/appkit/ai/webllm-build.ts`:

```ts
const MODEL_ID = 'Qwen3-4B-q4f16_1-MLC'; // was 'Phi-3.5-mini-instruct-q4f16_1-MLC'
```

Then handle thinking. In `buildAppWithPhi`, either append to the prompt:

```ts
const full = `${systemPrompt(app, grounding, prompt)}\n\n=== REQUEST ===\n${prompt}\n${emitInstruction()}\n/no_think`;
```

or pass the non-thinking chat template flag through the WebLLM `create` call if the build
exposes it. Verify in a WebGPU browser (Chrome/Edge desktop): the weights re-download once
(~3.4 GB into the Cache API), then run a build and confirm `parseVerbCalls` gets a non-empty,
valid array (no `<think>` leakage). Sanity-check the emitted verbs are all real gui verbs
(`verbsByGroup('gui')`), and eyeball the produced `.app`.

**Local (Ollama):** either pass `model` per call or change the default in
`src/lib/appkit/ai/providers.ts`:

```ts
return ollama(opts.model ?? 'qwen3:8b'); // was 'qwen2.5-coder'
```

Prereq: `ollama pull qwen3:8b` and Ollama serving on `http://localhost:11434`. This path uses
native tool calling (`schema/to-aisdk.ts`), so confirm the model is Ollama tool-capable (Qwen3
is) and that tool calls come back well-formed. For Qwen3 on Ollama, disable thinking (model
`think:false` / `/no_think`) for terse tool output.

**Recommended validation loop:** run the existing golden RAG pairs / any `build-cli` fixtures
through the new model and diff the produced `.app` traces against the current Phi-3.5 output —
a swap is only "done" when the JSON-array conformance rate is ≥ the incumbent's.

---

## Sources

- WebLLM engine + prebuilt model list — <https://github.com/mlc-ai/web-llm>, docs <https://llm.mlc.ai/docs/deploy/webllm.html>, npm <https://www.npmjs.com/package/@mlc-ai/web-llm>. Exact `model_id` + `vram_required_MB` read from `src/config.ts` — <https://raw.githubusercontent.com/mlc-ai/web-llm/main/src/config.ts>
- MLC prebuilt Qwen3 repos — <https://huggingface.co/mlc-ai/Qwen3-4B-q4f16_1-MLC>, <https://huggingface.co/mlc-ai/Qwen3-0.6B-q4f16_1-MLC>
- Qwen3 (Apache-2.0, sizes, tool use) — <https://github.com/QwenLM/Qwen3>, <https://qwenlm.github.io/blog/qwen3/>
- Qwen3 disable-thinking (`enable_thinking:false` / `/no_think`) — <https://qwen.readthedocs.io/en/latest/getting_started/quickstart.html>, <https://huggingface.co/Qwen/Qwen3-32B/discussions/21>
- Qwen3-4B q4 footprint — <https://willitrunai.com/models/qwen-3-4b>, <https://huggingface.co/bartowski/Qwen_Qwen3-4B-GGUF>
- Qwen2.5-7B-Instruct (Apache-2.0) — <https://huggingface.co/Qwen/Qwen2.5-7B-Instruct>
- Phi-4-mini-instruct (MIT, function calling, hallucinated-name caveat) — <https://huggingface.co/microsoft/Phi-4-mini-instruct>, <https://azure.microsoft.com/en-us/blog/empowering-innovation-the-next-generation-of-the-phi-family/>
- Hermes-3-Llama-3.2-3B (function calling / structured JSON) — <https://huggingface.co/NousResearch/Hermes-3-Llama-3.2-3B>, <https://www.promptlayer.com/models/hermes-3-llama-32-3b/>
- Ollama tool-capable model list (incl. Phi-4 "weak for agents" note) — <https://github.com/ollama/ollama/issues/9197>, <https://www.morphllm.com/best-ollama-models>, <https://www.promptquorum.com/local-llms/top-open-source-models-ollama>
- Small-model JSON reliability (Nemotron-mini strong; Llama-3.2-3B weak on complex schemas) — <https://medium.com/@lyx_62906/which-llms-actually-produce-valid-json-7c7b1a56c225>, <https://github.com/imaurer/awesome-llm-json>
- License comparison (Apache-2.0 vs Llama Community vs Gemma Terms; Qwen2.5-3B Research License) — <https://dev.to/llmradar/the-open-weight-licence-trap-apache-20-vs-the-community-licence-model-5dej>, <https://computingforgeeks.com/open-source-llm-comparison/>
</content>
</invoke>
