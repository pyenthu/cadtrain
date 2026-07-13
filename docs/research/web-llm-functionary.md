# Research — web-llm + XGrammar + Functionary as the in-browser tool-call backend

**Status:** research (read-only feasibility, 2026-06-16). Companion to
`docs/plans/ai-rag-system.md` §E and a deeper cut of `docs/research/webgpu-slm.md`
(which already chose web-llm/MLC + XGrammar and set a conditional-GO). This doc
adds: (a) the **Functionary** evaluation the user asked for, (b) the **local
prompt / few-shot DB build** in detail (SVTC's `rag.js` pattern, fully
client-side), and (c) a concrete model-candidate + integration shortlist.

**Goal.** Run the cadtrain ✨ editor assistant's *tool-call turn* fully in the
browser so no graph, instruction, or corpus leaves the org — including building
the few-shot/prompt databases locally — behind the **same** tool-call interface
as the Anthropic backend (`dispatchEditorTool` in `src/lib/graph/editor-tools.ts`).
Default OFF; Anthropic stays default + fallback.

> ⚠️ **No verified internet access while writing this.** Library names, model
> ids, and API shapes below are from training knowledge + the SVTC working code
> (`@mlc-ai/web-llm` 0.2.82 is what SVTC ships) + cadtrain's
> `docs/research/webgpu-slm.md`. Every version number and capability flagged
> "VERIFY" must be confirmed online before building. Sources to check are
> listed in §7.

---

## 1. TL;DR / recommendation

- **Runtime: web-llm (`@mlc-ai/web-llm`), in a Web Worker, WebGPU.** It is what
  SVTC already runs in-browser (`~/code/SVTC/src/lib/ai/webllm/engine.js`,
  `CreateMLCEngine('Phi-3.5-mini-instruct-q4f16_1-MLC')`), and its decisive
  advantage for our task is **XGrammar constrained decoding** — *guaranteed*
  schema-valid JSON output. That removes the single biggest small-model failure
  mode (malformed/wrong-shape JSON), leaving only the semantic question (right
  tool, right args).
- **Function-calling approach: use the MODEL's own tool/JSON-schema path +
  XGrammar, NOT a Functionary deployment.** Functionary (MeetKai) is a strong
  *model family + server* for function calling, but its first-class runtime is
  **vLLM / llama.cpp on a server**, not WebGPU-in-browser. Running it in the
  browser would mean its GGUF on `wllama` (CPU/WASM) or an ONNX conversion — both
  worse than web-llm's WebGPU+XGrammar path here. **Borrow Functionary's prompt
  format and its grammar-sampling idea; do not deploy Functionary as the
  backend.** (Full reasoning in §4.)
- **Model: start at Qwen2.5-1.5B-Instruct** (best size/accuracy knee for
  structured tool emission, ~1.5 GB q4), bench against Qwen2.5-0.5B and
  Llama-3.2-1B for the latency-critical single-tool case. (§3.)
- **Local prompt/few-shot DB: SVTC's `rag.js` pattern verbatim** — TF-IDF over
  IndexedDB, no embedding API, no server. Built in-browser from the on-volume
  parts (or a bundled snapshot). System prompt assembled client-side. (§5.)
- **Integration: a backend toggle** on `createAssistSession`, sharing
  `EDITOR_TOOLS` + `dispatchEditorTool`. Add `toJsonSchema()` next to
  `toClaudeTools()`. (§6.) The seam already exists.
- **Decision: CONDITIONAL GO for a time-boxed spike.** Ship as opt-in "offline
  edits (beta)" only if a scoped bench clears ≥90% tool + ≥85% arg accuracy;
  otherwise shelve as a documented finding. Anthropic path unaffected.
- **Deploying OUR fine-tuned model (the #28 endgame).** This doc runs a *general*
  instruct model with a big few-shot prompt. The **deployment of a FINE-TUNED**
  model — compile our own Qwen2.5-**Coder-0.5B** via MLC-LLM, host the ~350 MB
  `.wasm`+weights, load it via a custom-URL `CreateMLCEngine`, and drop the
  system prompt (zero-prompt inference) — lives in
  `docs/research/local-fncall-synthetic-data.md` → **"In-browser deployment
  (WebLLM + MLC + XGrammar)"**. Same runtime/seam/`dispatchEditorTool` as here,
  smaller weights bought by the fine-tune.

---

## 2. Why in-browser (the requirement)

Data must never leave the browser, including the prompt/few-shot DBs. Anthropic
(default) POSTs `{graphState, messages}` to `/api/rag/assist`; a local SLM keeps
everything client-side — zero API cost/network, full privacy, low latency after
warm load (30–60 tok/s, a short tool call ~few hundred ms). Fit = high-frequency
micro-edits ("add a point", "wire r to OD"), the sub-2B sweet spot. cadtrain
already runs WebGPU-class WASM (Manifold), so capable users are common — but
feature-detect, never assume.

## 3. WebGPU SLM runtime landscape (re-confirm online — §7)

| Runtime | Engine/format | WebGPU | Models that fit (q4) | Structured JSON / tools | SvelteKit fit |
|---|---|---|---|---|---|
| **web-llm (MLC)** ✅ | MLC-LLM + TVM, compiled WGSL kernels | yes (primary) | Qwen2.5-0.5B/1.5B/3B, Llama-3.2-1B/3B, Phi-3.5-mini (in `prebuiltAppConfig`) | **Best** — OpenAI-style API; JSON-mode + function-calling via **XGrammar** constrained decoding | `npm @mlc-ai/web-llm`; Web Worker; `CreateMLCEngine`/`MLCEngine`; `chat.completions.create({response_format:{type:'json_object'|'json_schema', schema}})` (VERIFY exact field) |
| transformers.js v4 | ONNX Runtime Web | yes (v4) | Qwen3-0.6B, Llama-3.2-1B (~1.24 GB q4f16), Qwen2.5-0.5B | good; JSON mode; tool-calling less mature than XGrammar | `@huggingface/transformers`; #2 / portability fallback |
| ONNX Runtime Web (raw) | ORT Web | yes | same ONNX models | manual decode loop | low-level; little reason vs transformers.js |
| wllama / llama.cpp-wasm | llama.cpp → WASM | **no** (CPU/WASM) | GGUF Q4_K_M ≤~3B (incl. **Functionary GGUF**) | GGUF grammars exist; browser story rough | `@wllama/wllama`; **no-WebGPU CPU fallback** |

**Model candidates (smallest → larger), for the bench:**
- **Qwen2.5-0.5B-Instruct** (~0.5 GB) — fastest, weakest; test for the
  single-tool latency floor.
- **Qwen2.5-1.5B-Instruct** (~1.5 GB) — **recommended start**; best knee for
  structured tool emission. Qwen2.5 has documented tool-calling/JSON behavior.
- **Llama-3.2-1B-Instruct** (~1.24 GB q4f16) — alt for the latency case.
- **Phi-3.5-mini** — what SVTC ships; stronger reasoning, heavier (~2.4 GB
  cached); the high end of "small" for our purposes.
- **Functionary-small (GGUF)** — only if we go the wllama/CPU route (we don't,
  by default — §4); its value is the model's tool-calling tuning.

**XGrammar is the lever.** It "leverages constrained decoding to guarantee
syntactic correctness for outputs such as JSON … and custom CFGs", with
near-zero JSON-generation overhead, and explicitly targets **function calling
(JSON guided by a JSON schema)**. For a sub-2B model that's the difference
between "usable" and "not": shape is *guaranteed*, only content is the model's
job. (Integrated into MLC; VERIFY the current web-llm field name for passing a
schema — historically `response_format: {type:'json_object', schema}` and a
newer per-tool grammar in XGrammar-2.)

---

## 4. Functionary (MeetKai) — evaluation

**What it is (from training knowledge — VERIFY online, §7):** Functionary is an
open-source **model family fine-tuned for function/tool calling** plus a serving
stack. It produces structured function calls and supports parallel/multi-step
calls and "any/auto" tool choice, with an **OpenAI-compatible server**. Its
native runtimes are **vLLM** and **llama.cpp** (GGUF) on a server; it ships
grammar-sampling support so the generated call conforms to the function schema —
conceptually the same idea as XGrammar. Models historically ranged ~7B and a
"small" (~few-B) variant; there have been several versions (e.g. v2.x/v3.x —
VERIFY current).

**Is it usable as a web-llm backend?**
- **Not directly.** Functionary's first-class path is server-side (vLLM /
  llama.cpp). It is **not** in web-llm's `prebuiltAppConfig`, so there's no
  ready MLC-compiled WebGPU build. Two hypothetical browser routes, both worse
  than the recommended path:
  1. **GGUF on wllama (CPU/WASM):** runs in-browser without WebGPU, and
     llama.cpp grammars give schema constraint — but it's slow (CPU), the GGUF
     for a capable Functionary variant is large, and we lose web-llm's WebGPU
     speed and XGrammar integration. Keep only as a no-WebGPU fallback *idea*,
     not the plan.
  2. **Convert to MLC/ONNX:** compiling a Functionary checkpoint to MLC for
     WebGPU is real work (weight conversion + kernel config) and unproven for
     this family in-browser — not worth it when Qwen2.5-1.5B + XGrammar already
     covers the task.
- **What to borrow, not deploy:**
  - **Prompt/format for tool calling** — Functionary's documented
    system-prompt + tool-spec format is a good reference for how to present
    `EDITOR_TOOLS` to a small model in *plain text* (the WebLLM path can't rely
    on native `tool_use` — see §5), complementary to XGrammar enforcing the
    output shape.
  - **The grammar-sampling principle** — Functionary validates the *idea* that
    grammar-constrained decoding is the right way to make a small model emit
    valid calls. web-llm/XGrammar is our implementation of that idea.

**Verdict:** **Reference, don't deploy.** Use web-llm + XGrammar with a
general-purpose instruct model (Qwen2.5-1.5B). Functionary is a server-side
function-calling stack; if we ever stand up a *server* SLM (not the goal — the
goal is in-browser/private), Functionary-on-vLLM behind the same
`/api/rag/assist` shape would be the candidate to revisit. **Items to VERIFY
online (§7):** current Functionary version + smallest variant + params; whether
any MeetKai or community **MLC/WebGPU** Functionary build exists; whether
web-llm's `prebuiltAppConfig` has added any function-calling-tuned model since
0.2.82.

---

## 5. The local prompt / few-shot DB — built entirely in-browser

This is the part the requirement specifically names. SVTC already does it; port
the pattern (`~/code/SVTC/src/lib/ai/rag.js` + `ragIngest.js` +
`webllm/prompt.js` + `webllm/parse.js` + `webllm/chat.svelte.js`):

### 5.1 Retrieval corpus — TF-IDF in IndexedDB, no server, no embedding API
SVTC `rag.js` (confirmed by reading it):
- `tokenize(text)` → lowercase, strip non-alphanumeric, split, drop len≤1.
- `termFrequency(tokens)` → counts normalized by max count.
- `cosineSimilarity(tfA, tfB)` over the union of terms.
- `ingestChunks(source, chunks)` → store `{id, source, type, text, tf, ts}` in
  IndexedDB (DB `svtc-rag`, store `chunks`, index on `source` for re-ingest).
- `retrieve(query, topK=5)` → cosine vs every chunk, filter score > 0.05.
- `buildRagContext(query, topK=5)` → `"RELEVANT CONTEXT…\n- [source] text\n…"`.

**cadtrain port (`src/lib/graph/ai/webllm/corpus.ts`):** ingest the same records
the server `parts.jsonl` corpus carries (`rag-corpus.ts` shape: `id`, `kind`,
`description`, `tags[]`, `params[]`, `structure_summary`, `exemplar_path`).
Source the records **client-side** from either (a) a bundled JSON snapshot
shipped in the build (truly offline, no network), or (b) a one-time fetch of
`/api/rag/...` cached into IndexedDB (network once, then offline). For the
"data never leaves" requirement, retrieval is read-only over public part
metadata, so either is fine — the *instruction* and *graph* are what must not
leave, and in `webllm` mode they never hit the network at all.

### 5.2 Few-shot examples — bundled + locally minable
- **Seed few-shots** (hand-authored): bundle `editor-tool-fewshots.json` in the
  build — ~10–20 `{instruction, editorState, expected tool call(s)}` examples
  covering each Phase-1 tool. SVTC's `webllm/prompt.js` embeds 8 such examples
  as plain JSON tool calls; mirror that.
- **Locally grown** (optional flywheel, fully local): the `ai/fix-errors.jsonl`
  /  accepted-edit capture (`ai-rag-system.md` §F Phase 4) can also write
  *successful* `{instruction, toolCalls}` pairs to IndexedDB; `retrieve()` then
  surfaces the most similar prior successful edits as few-shots. No server, no
  fine-tune required to benefit — it's retrieval, not training. (Fine-tune is a
  far-future option, SVTC-style MLX → GGUF → MLC; out of scope.)

### 5.3 Prompt assembly + the two-pass tool flow (no native tool_use)
Small instruct models don't emit Anthropic-style `tool_use` blocks. SVTC's
`webllm/chat.svelte.js` does **two-pass**: pass 1 generates a tool call (parsed
out of text), execute, pass 2 feeds the result back for the final answer.
SVTC's `parse.js` uses a regex (`/\{[\s\S]*"tool"[\s\S]*\}/` + `JSON.parse`).
**cadtrain improves on this with XGrammar:** instead of regex-scraping free text,
constrain pass-1 decoding to the tool-call JSON schema (`toJsonSchema()`), so the
output *is* a valid `{name, input}` (or `{tool, args}`) object — no regex, no
malformed-JSON failure mode. Pass-1 output → `dispatchEditorTool` → result →
optional pass-2 for a confirmation sentence. The multi-shot loop in
`ge-assist.svelte.ts` (`ai-rag-system.md` §B) drives this exactly as it drives
the Anthropic backend; the only swap is "ask the worker" vs "POST the endpoint."

`src/lib/graph/ai/webllm/prompt.ts` assembles the system prompt locally:
persona + `toolListText()` (from `editor-tools-schema.ts`) + `buildRagContext()`
few-shots + retrieved exemplars + `readEditorState(graph, ctx)` — the **same
context the Anthropic system prompt gets**, just built in the browser.

---

## 6. Integration into cadtrain (the seam already exists)

`docs/research/webgpu-slm.md` §3 already established that the design is
backend-agnostic. Concretely:

1. **`toJsonSchema()`** in `src/lib/graph/editor-tools-schema.ts` — a sibling to
   `toClaudeTools()` (same `EDITOR_TOOLS` source). `toClaudeTools()` already
   produces `{name, description, input_schema:{type:'object', properties,
   required}}`; `toJsonSchema()` wraps that into the per-tool grammar XGrammar
   wants (tool name selects the arg schema; e.g. a top-level
   `{name: enum[...], input: oneOf[...]}` schema). **Same source of truth, three
   lowerings** (`toClaudeTools`, `toolListText`, `toJsonSchema`).
2. **Worker** `src/lib/graph/ai/webllm/engine.ts` — lazy `import('@mlc-ai/web-llm')`,
   `CreateMLCEngine(MODEL_ID, {initProgressCallback})`, WebGPU feature-detect
   (`navigator.gpu`), weights cached in the browser Cache API (persist across
   sessions). Runs in a **Web Worker** (SVTC runs on the main thread — cadtrain
   must NOT, to keep off the bake/render thread; memory
   `stack_cutaway_perf_root_cause`).
3. **Backend toggle** on `createAssistSession`:
   `backend: 'anthropic' | 'webllm'`, default `'anthropic'`.
   `backend.nextTurn({system, tools, messages})` returns the same
   `{type:'tool_use', calls} | {type:'text', text}` shape; the `webllm` impl
   constrains decoding to `toJsonSchema()` and maps the JSON to that shape.
   `dispatchEditorTool` is untouched.
4. **Scope to win** — gate `webllm` to the route- and selection-scoped toolset
   (`ai-rag-system.md` §C.1 + Phase 5). A selected polygon → 3–4 tools → small
   model is reliable. Hand multi-step / whole-graph to Anthropic.
5. **Fallback** — WebGPU absent / low VRAM / OOM → silently use Anthropic;
   surface "offline edits unavailable on this device."
6. **Demo first** — Spike-0 bench page lives **under `/primitives`** (memory
   `feedback_demos_under_primitives` — never a new top-level route).

---

## 7. What to verify online before building

(No verified internet at authoring time — confirm, then strike.)
- **web-llm** (github.com/mlc-ai/web-llm; SVTC pins 0.2.82): the exact
  `chat.completions.create` field for a JSON **schema** (vs bare `json_object`);
  per-tool grammar / function-calling helper; current `prebuiltAppConfig` + the
  Qwen2.5-1.5B / Llama-3.2-1B MLC ids + q4 sizes.
- **XGrammar** (arXiv:2411.15100; XGrammar-2 arXiv:2601.04426): MLC exposes
  JSON-schema constraint from web-llm; per-tool grammar status.
- **Functionary** (github.com/MeetKai/functionary): current version + smallest
  variant + param count; prompt-template spec; whether ANY MLC/WebGPU build exists.
- **Models/runtime:** Qwen2.5-Instruct 0.5B/1.5B tool-calling; Llama-3.2-1B;
  WebGPU matrix; transformers.js v4 (fallback) + wllama GGUF grammars (no-WebGPU).

## 8. Risk / accuracy caveats (binding)

- **Accuracy is the gate.** Constrained decoding guarantees *valid JSON*, not
  *correct edits* — a 0.5–1.5B model is unreliable at multi-tool sequences and
  the `param`-vs-`literal` `ArgValue` choice (the risk our schema flags), *worse*
  than Anthropic. Bench before believing; **scope to single-tool to win.**
- **~1–1.5 GB first-load** (cached) + a few-second WebGPU compile → opt-in only.
- **WebGPU spread + VRAM** — strong Chrome/Edge, spotty Safari/Firefox; 1.5B q4 +
  KV cache OOMs low-end devices. Feature-detect + gate by device + Anthropic
  fallback.
- **Isolate** in a lazy Web Worker (TVM runtime + WGSL kernels); never the default
  bundle, never the bake/render thread. A second inference path = a second prompt
  to keep in sync (mitigated by sharing `EDITOR_TOOLS`/`dispatchEditorTool`).
- **Functionary detour** — do NOT stand it up in-browser (server-side stack);
  reference its format/idea only.

## 9. Spike plan (time-boxed)

1. **Spike 0 — bench** (½–1 day, no app changes): a `/primitives`-scoped demo
   loads web-llm + Qwen2.5-1.5B in a worker, feeds ~10 canned
   `{instruction, editorState}` cases, XGrammar-constrained to a 5-tool subset;
   measure cold load, tok/s, tool-selection + arg/ArgValue accuracy (0.5B/1B/1.5B).
2. **Spike 1 — wire behind the interface** (1 day): `toJsonSchema()`; a `webllm`
   branch in `createAssistSession` → `{calls|text}` → existing `dispatchEditorTool`;
   default OFF; local TF-IDF corpus + bundled few-shots.
3. **Spike 2 — scoped toolsets** (1 day): selection-/route-scoped tools; re-bench.
4. **Gate:** ship opt-in "offline edits (beta)" only if Spike-2 clears **≥90%
   tool + ≥85% args**; else shelve as a documented finding. Anthropic unaffected.
