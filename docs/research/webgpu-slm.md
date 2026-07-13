<!-- research-group: Archive -->
# Research — A WebGPU small-LM (SLM) as a local backend for the ✨ tool-call editor

> ARCHIVED (2026-07-13): superseded + dead-end premise. Its framing question
> (port `rlm-minimal`) was answered NO — a category mismatch (Python remote-API
> recursion harness, not an in-browser SLM). Its useful residue (the web-llm/MLC
> + XGrammar runtime choice, the model landscape, the risk table, the spike
> plan) is carried forward and deepened by `web-llm-functionary.md` — which
> explicitly calls itself "a deeper cut of webgpu-slm.md (which already chose
> web-llm/MLC + XGrammar)" and re-states this doc's risk/spike sections as
> "still binding". Read that + `local-fncall-synthetic-data.md` for the live
> #2/#28 path; this is kept only as the origin of the web-llm decision.

**Status:** research (read-only spike assessment, 2026-06-15)
**Goal (user's words):** "study https://github.com/alexzhang13/rlm-minimal and
see if we can create a working model with a small WebGPU-based SLM to execute
simple tasks."
**Scope of "simple tasks":** the editor tool-calls described in
`docs/plans/ai-function-mapping.md` — emit a JSON tool call (`addParam`,
`addPolygonPoint`, `wireArgToParam`, `setCallArg`, …) from a natural-language
instruction + the live editor state, against the `EDITOR_TOOLS` schema, without
an Anthropic API round-trip.

---

## TL;DR / recommendation

- **rlm-minimal is a category mismatch for this goal.** It is NOT a model, NOT
  WebGPU, NOT in-browser, NOT a small LM. It is a ~Python educational harness
  for **Recursive Language Models** (an LM making recursive sub-LM calls inside
  a REPL to decompose huge contexts). It is a research/architecture reference,
  not a runtime we can run in cadtrain. We do **not** port it. (We can borrow
  the *idea* of decomposition later, but it is orthogonal to "run an SLM in the
  browser.")
- **The real runtime question is web-llm vs transformers.js.** Both run a
  0.5–1.5B instruct model in-browser on WebGPU today.
- **Recommended runtime: web-llm (MLC).** Its decisive advantage for our task is
  **XGrammar constrained decoding** — it can *guarantee* the model's output is
  valid JSON conforming to a supplied JSON schema. For a 0.5–1.5B model, that
  removes the single biggest failure mode (malformed JSON / wrong shape) and
  leaves only the semantic question (did it pick the right tool / right args).
- **Go / no-go: CONDITIONAL GO for a time-boxed spike**, built as an **optional
  local backend behind the *same* tool-call interface** as the Anthropic path,
  defaulting OFF. Anthropic stays the default; the SLM handles the simplest
  single-tool ops offline. See "Phased spike plan" + "Honest caveats."

---

## 1. What rlm-minimal actually is

Source: `github.com/alexzhang13/rlm-minimal` (README + `main.py`, fetched
2026-06-15).

- **RLM = Recursive Language Models.** "a simplified, educational implementation
  … meant to be a notebook or gist version" to help others build their own RLM.
- **What it does:** an LM makes **recursive sub-calls to itself inside an
  `exec`-based REPL environment**. Core classes: `RLM_REPL` (with a
  `completion()` that replaces a normal `LM.completion()`) in `rlm_repl.py`, and
  an `exec` REPL that "adds an LM sub-call function" in `repl.py`. Implements
  recursion at `depth=1`, extensible deeper by swapping `Sub_RLM` for `RLM_REPL`.
- **Demo task:** `main.py` is a **needle-in-a-haystack** — generate ~1M lines of
  random words, embed a magic number around line 400k–600k, ask the system to
  find it. `RLM_REPL(... max_iterations=10)`, models named `"gpt-5"` (primary)
  and `"gpt-5-nano"` (recursive) — placeholder names; it calls the **OpenAI API
  client**, not a local model.
- **Language / deps:** **Python (100%)** + OpenAI client + `python-dotenv` +
  `rich` (optional). **Inference only**, CPU host, all heavy lifting is remote
  API calls.

**Verdict on rlm-minimal:** it is about *long-context decomposition via remote
LM calls*, the opposite axis from *running a tiny model locally on WebGPU*.
There is no WebGPU code, no quantized weights, no browser runtime to harvest.
Treat it as a conceptual reference only; it does not advance the in-browser-SLM
goal.

---

## 2. WebGPU SLM landscape (June 2026)

| Runtime | Engine / format | WebGPU | Models that fit (q4) | Load / speed | Structured JSON / tools | SvelteKit integration |
|---|---|---|---|---|---|---|
| **web-llm (MLC)** | MLC-LLM + Apache TVM, compiled WebGPU kernels | **Yes (primary compute)** | Qwen2.5-0.5B/1.5B/3B-Instruct, Llama-3.2-1B/3B, Phi-3.5-mini — in `prebuiltAppConfig` | 1.5B ≈ **1.5 GB** download; **30–60 tok/s** on a decent GPU | **Best.** OpenAI-style API; **JSON-mode + function-calling via XGrammar constrained decoding** (integrated into MLC since Nov 2024; XGrammar-2 compiles most JSON schemas in ~1 ms) — guarantees schema-valid output | npm `@mlc-ai/web-llm`; runs in a Web Worker; OpenAI-shaped `chat.completions` → drop-in behind our proxy interface |
| **transformers.js v4** | ONNX Runtime Web | **Yes (v4 backend, Feb 2026)** | onnx-community Qwen3-0.6B, Llama-3.2-1B-Instruct (**1.24 GB** q4f16), Qwen2.5-0.5B | comparable; broader model zoo | **Good.** Structured-generation / JSON mode; tool-calling less mature than web-llm's XGrammar path | npm `@huggingface/transformers`; HF-ecosystem ergonomics; pipelines API |
| **ONNX Runtime Web (raw)** | ONNX Runtime Web | Yes | same ONNX models | ONNX files **larger** (Protobuf 2 GiB cap forces sharding) | Manual — you own the decode loop + any grammar | lower-level; transformers.js wraps it — little reason to use raw |
| **wllama / llama.cpp-wasm** | llama.cpp → WASM (SIMD) | **No** (CPU/WASM; WebGPU only offloads some ops) | GGUF Q4_K_M up to ~3B | slower (CPU); split weights ≤512 MB chunks; multi-thread via SharedArrayBuffer | GGUF grammars exist but browser story is rougher | npm `@wllama/wllama`; zero runtime deps; **fallback when WebGPU absent** |

**Models worth testing (smallest → larger):** Qwen2.5-0.5B-Instruct (~0.5 GB,
fastest, weakest), **Qwen2.5-1.5B-Instruct** (~1.5 GB — best size/accuracy knee
for structured tool emission), Llama-3.2-1B-Instruct (1.24 GB), Qwen3-0.6B,
Phi-3.5-mini (larger, stronger reasoning, heavier download).

**Constrained decoding is the key enabler.** XGrammar "leverages constrained
decoding to guarantee syntactic correctness for outputs such as JSON, regex …
and custom CFGs," with "near-zero overhead in JSON generation," and explicitly
targets **function calling (JSON generation guided by a JSON schema)**. This is
exactly the lever that makes a sub-2B model viable for emitting our
`EDITOR_TOOLS` calls: shape correctness is *guaranteed* by the grammar; only
content correctness is left to the model.

---

## 3. Fit for cadtrain's tool-call task

The `ai-function-mapping.md` design is, fortunately, **already
backend-agnostic**, which is what makes a local SLM feasible at all:

- **Tools are plain data** — `EDITOR_TOOLS` + `toClaudeTools()` in
  `editor-tools-schema.ts` (server-safe, no Svelte). `toClaudeTools()` lowers to
  Anthropic `input_schema`; an analogous `toJsonSchema()` would feed
  web-llm/XGrammar. **Same source of truth, two lowerings.**
- **The dispatcher is pure** — `dispatchEditorTool(name, args, graph) → {graph,
  result}` in `editor-tools.ts`, no DOM, unit-testable. It does not care whether
  the tool call came from Anthropic or a local SLM.
- **The loop is a thin proxy** — today `/api/rag/assist` does one Claude
  call/turn and returns `tool_use | text`; the client applies the tool. A local
  SLM backend slots in as **an alternative producer of that same `tool_use`
  block**, client-side, with no server hop.

So the integration shape is: add a `backend: 'anthropic' | 'local-slm'` switch
in the ✨ Edit-mode loop. `local-slm` calls a Web Worker running web-llm with
`response_format` set to the JSON schema for the (selected) toolset; the
returned JSON is fed to the *same* `dispatchEditorTool`.

### Where the SLM wins
- **Offline / zero API cost / privacy** — no key, no network, no per-edit token
  spend. Good for high-frequency micro-edits ("add a point", "wire r to OD").
- **Latency after warm load** — 30–60 tok/s locally; a single short tool call is
  a few hundred ms once the model is resident, no network RTT.
- **Sub-2B is the documented sweet spot** for "high-frequency, privacy-sensitive,
  latency-critical" structured tasks (classification, autocomplete, local
  search) — our single-tool editor ops are squarely in that band.

### Where the SLM loses (vs Anthropic)
- **Tool selection across a large surface.** With ~25 tools (Phase 1–2), a
  0.5–1.5B model will more often pick the wrong tool or mis-order a multi-step
  edit. Anthropic (opus/sonnet) is markedly better at "subtract a cylinder then
  repeat it 6×."
- **The `ArgValue` union semantics.** Grammar guarantees the *shape*
  (`{kind:'literal'|'expr'|'param', …}`) but not that the model chose `param`
  vs `literal` correctly, or referenced an existing param name / node alias.
  This is the exact risk `ai-function-mapping.md` already flags for the API
  path — and it is *worse* on a small model.
- **Multi-step agentic reasoning** is the SLM's weakest area; keep it to
  single-call or two-call tasks.

### rlm-minimal usable, or borrow-ideas-only?
**Borrow-ideas-only, and even that is marginal.** It is a remote-API recursion
harness in Python; nothing in it runs in a browser or as an SLM. The only
transferable concept is "decompose a hard instruction into sub-calls" — which we
would not need for single-tool edits and would implement ourselves if ever
wanted. **Use web-llm (or transformers.js) for the runtime; do not depend on
rlm-minimal.**

---

## 4. Recommended approach

Add an **optional local SLM backend behind the existing tool-call interface**,
defaulting OFF, with Anthropic remaining the default and the fallback:

1. **Runtime:** **web-llm (`@mlc-ai/web-llm`)** in a Web Worker, because of
   XGrammar JSON-schema constrained decoding. transformers.js v4 is the
   #2 / portability fallback; wllama is the no-WebGPU CPU fallback.
2. **Model:** start at **Qwen2.5-1.5B-Instruct** (best knee); also bench
   Qwen2.5-0.5B-Instruct and Llama-3.2-1B for the latency-sensitive single-tool
   case.
3. **Constraint:** lower `EDITOR_TOOLS` to a **JSON schema** (a `toJsonSchema()`
   sibling of `toClaudeTools()`) and pass it as web-llm `response_format` so
   every output is schema-valid by construction. For dynamic tool→args schemas,
   XGrammar-2's per-tool grammar (tool name selects the arg schema) is the
   target.
4. **Scope to win:** only expose the SLM for **scoped, single-tool** edits (the
   Phase-3 "scoped toolset by active window" idea) — when a polygon is selected,
   the SLM sees only the 3–4 point/coord tools, drastically improving
   tool-selection accuracy. Hand off to Anthropic for multi-step / whole-graph.
5. **Same dispatcher / same loop:** reuse `dispatchEditorTool` and the
   client-applied loop unchanged; the only new surface is the worker + a backend
   toggle.

### Phased spike plan
- **Spike 0 — feasibility bench (½–1 day, no app changes).** Standalone
  `/primitives`-scoped demo page (per memory: demos live under existing routes,
  never a new top-level route). Load web-llm + Qwen2.5-1.5B, feed 10 canned
  "instruction + editorState" cases, JSON-schema-constrain to a 5-tool subset,
  measure: cold load time, tok/s, **tool-selection accuracy**, **arg/ArgValue
  accuracy**. Compare 0.5B vs 1.5B vs 1B. Record verts/latency table.
- **Spike 1 — wire behind the interface (1 day).** Add `toJsonSchema()` to
  `editor-tools-schema.ts`; add a `local-slm` branch to the Edit-mode loop that
  produces a `tool_use`-shaped object and feeds the existing
  `dispatchEditorTool`. Toggle defaults OFF. Unit-test the lowering + dispatch.
- **Spike 2 — scoped toolsets (1 day).** When a node/polygon is selected, ship
  only its relevant tools to the SLM (Phase-3 scoping). Re-bench accuracy — this
  is where a small model becomes reliable.
- **Decision gate.** Ship as opt-in "offline edits (beta)" only if Spike-2
  single-tool accuracy clears a bar (suggest ≥90% tool + ≥85% args on the canned
  set). Otherwise shelve as a documented finding; Anthropic path is unaffected.

---

## 5. Honest risk / accuracy caveats

- **Accuracy is the gate, and it is not guaranteed.** Constrained decoding gives
  *valid JSON*, not *correct edits*. Expect a 0.5–1.5B model to be unreliable at
  multi-tool sequences and at the `param`-vs-`literal` `ArgValue` choice. Bench
  before believing.
- **~1–1.5 GB first-load download** (cached after) + a few seconds to compile
  WebGPU kernels. Acceptable for an opt-in feature, not for default-on.
- **WebGPU availability.** Strong on Chrome/Edge; Safari and Firefox WebGPU
  support is improving but historically spotty — must feature-detect and fall
  back (Anthropic, or wllama CPU). cadtrain already runs WebGPU-class WASM
  (Manifold), so capable users are the common case, but do not assume it.
- **VRAM / device spread.** A 1.5B q4 model + KV cache needs real GPU memory;
  low-end laptops and most phones will struggle or OOM. Gate by device.
- **Bundle weight + worker plumbing.** web-llm pulls TVM runtime + WGSL kernels;
  isolate in a lazy-loaded Web Worker so it never touches the main bake/render
  thread (cf. the GLB-bake-blocked-mesh-thread incident) and never ships in the
  default bundle.
- **Maintenance surface.** A second inference path = a second prompt to keep in
  sync. Mitigated by sharing `EDITOR_TOOLS` + `dispatchEditorTool`, but the
  system prompt and schema lowering still need parallel upkeep.
- **Do not port rlm-minimal.** Its presence in the goal is a premise error;
  building on it would burn time for no runtime payoff. Keep it filed as a
  long-context-decomposition reference only.

---

## Sources
- rlm-minimal: github.com/alexzhang13/rlm-minimal (README, main.py)
- WebLLM: github.com/mlc-ai/web-llm; webllm.mlc.ai/docs; arXiv:2412.15803
- XGrammar: blog.mlc.ai/2024/11/22 …xgrammar; github.com/mlc-ai/xgrammar; arXiv:2411.15100; XGrammar-2 arXiv:2601.04426
- transformers.js v4 (WebGPU, Feb 2026): huggingface transformers.js; webml-community/llama-3.2-webgpu
- wllama: github.com/ngxson/wllama; "Llamas on the Web" arXiv:2605.20706
- In-browser AI 2026 surveys: intel.com in-browser-llms; sitepoint webgpu vs webasm
