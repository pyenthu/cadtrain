# Local function-calling model + synthetic prompt→call data (research)

**Status:** research (2026-07-01, user-supplied). Goal: drive down AI token cost and
eventually run function-calling OFFLINE, by (1) compact tool schemas, (2) a
synthetic + real prompt→call dataset, (3) few-shot injection now / small local
fine-tune later. **This consolidates with what we already ship — do not build a
parallel stack.** Tie into #27 (feedback/RL DB), #2 (web-llm local backend),
#1 (RAG assist), and the shipped tool loop.

> **DATA-RESIDENCY (binding, memory `ai_data_residency_local_first`):** the shipped
> app restricts sending data out — ESPECIALLY prompt data. So the local/in-browser
> runtime below is a REQUIREMENT, not just a token optimization; cloud Claude is
> dev/authoring/build-time-synthetic-data only. This moves the local-model path UP
> in priority — a cloud-only assist can't ship.

## What we ALREADY have (don't reinvent)
- **Tool-calling edit loop** — `ge-assist.ts` + `editor-tools.ts`/`editor-tools-schema.ts` (12 tools) + `/api/rag/assist`. The model emits small tool-calls to patch the open graph. `toolListText()` already renders a prose/TS-ish tool list.
- **Prompt-caching** — the stable tool-schema+persona prefix is cache_control'd; only the volatile editor-state is fresh each turn. This is our current token lever and it's real.
- **RAG corpus** — static `ai/rag/parts.jsonl` + **BM25** retrieval (`rag-query.ts`), no embeddings yet (Phase 3 deferred until ~200 parts).
- **#27 feedback DB** — `ai/feedback/turns.jsonl`: approved/disapproved/corrected turns (the *real* prompt→call pairs, higher-value than synthetic).
- **Vocabulary + promote-to-vocab** — deterministic prompt→source, learns from user edits.

## The research ideas, mapped to our stack
1. **Compact tool schemas (TypeScript notation, not verbose JSON).** Claim: ~60% fewer schema tokens. We already have `toolListText()` — evaluate emitting the tool contract as terse TS signatures (`type setCallArg = (node, key, value) => Graph`) + comment descriptions, and whether Anthropic tool-use (which needs JSON `input_schema`) benefits vs a text-tools + parse approach. NOTE: with prompt-caching the schema is only paid ONCE per session, so the win is mainly for a *local* model with no caching. Measure before adopting.
2. **Synthetic prompt→call generation with Claude.** Use Claude to generate diverse `{user_prompt, minimized_call}` pairs across a domain×function matrix (slang/typos/pro/vague/multi-step) → JSONL. For US the "functions" are the 12 editor tools + the ArgValue union; the "domain" is downhole/CAD phrasing. This SEEDS the corpus that #27 then grows from real usage.
3. **Two ways to spend the dataset (both already on our roadmap):**
   - **Few-shot injection (near-term, no training):** vector-search the top-3 nearest pairs for a live query, inject as examples. Needs an embedding index (our RAG Phase 3) over `parts.jsonl` + `turns.jsonl` + synthetic pairs + #27's `simplified.jsonl`.
   - **Local fine-tune (later):** LoRA a small model so it emits our compressed call syntax natively, letting us DROP the tool-schema system prompt (~0 base tokens). This is the endgame of #2 (web-llm) — or an Ollama/Unsloth path.
4. **Dataset-size guidance (from the research, to validate):** 100–300 pairs = few-shot/LoRA alpha; **1,000–3,000 = standard LoRA, ~95% accuracy (the sweet spot)**; 5,000+ = multi-step tool chaining.
5. **Multi-level network DB (Neo4j graph + Chroma/Qdrant vectors).** Interesting but HEAVY for us — we're a SvelteKit/Node app with a file-volume, no Python runtime (Rule 1: never Python in prod). A graph+vector server is likely overkill vs a JSONL corpus + an in-process embedding index. Treat Neo4j/Chroma as OPTIONAL/experimental, not the default; a local vector index (or the browser web-llm's own) fits our stack better. Revisit only if relationship-graph retrieval proves necessary.
6. **Model candidates for a local fn-call model:** Qwen2.5-7B-Instruct / Mistral-7B / Llama-3-8B (LoRA via Unsloth on one GPU), or Phi-3.5-mini / Llama-3-3B / **Qwen2.5-1.5B (already our #2 target)** for laptop/Mac. Constrained decoding (XGrammar, already named in #2) enforces the call syntax.

## Recommended consolidation (sequence)
1. **Land #27 Phase 1** (capture real turns) — real pairs beat synthetic.
2. **Add a synthetic-seed generator** (Claude, the domain×tool matrix) → the same JSONL store #27 uses. Small: 300 pairs to start.
3. **RAG Phase 3 embeddings** over parts+turns+synthetic+simplified → **few-shot injection** into the assist loop (biggest near-term accuracy/token win, no training).
4. **Benchmark** compact-TS vs JSON tool schemas for a LOCAL model (web-llm) — only matters off-cache.
5. **Only then** consider a LoRA fine-tune (Unsloth, ~1–3k pairs) to zero-out the local model's schema overhead — the #2 endgame.
6. Graph/vector-server (Neo4j/Chroma) stays a parked experiment unless multi-hop relation retrieval is proven needed.

## In-browser deployment (WebLLM + MLC + XGrammar)

**This is the DEPLOYMENT half of this doc's fine-tune endgame (step 5 above) and a
REFINEMENT of #2** (`docs/research/web-llm-functionary.md` — read it for the runtime
landscape §3, the integration seam §6, the honest risk table §8, and the spike plan
§9; this section does not repeat them). #2 covers running a *general* instruct model
(Qwen2.5-1.5B) in the browser with XGrammar + a local few-shot DB. This section covers
the extra piece unique to #28: **compiling and shipping OUR fine-tuned model** so it
emits our editor-tool syntax natively. Where #2 says "Qwen2.5-1.5B + generic instruct +
big few-shot prompt", #28's endgame says "smaller fine-tuned Coder-0.5B + near-zero
prompt". Same runtime, same seam, same `dispatchEditorTool` — different weights.

### Why it fits: the whole fn-call turn runs in the browser, no server
The model output is a tool call against the LIVE in-memory composition `Graph`, executed
by `dispatchEditorTool` (`src/lib/graph/editor-tools.ts`) — no round-trip. Client-side
*geometry* execution already exists in spirit (the bake-worker, `docs/plans/client-side-execution.md`);
this adds client-side *reasoning*. The "graph" the model edits is our in-memory
composition `Graph`, NOT a graph database — ignore the Cytoscape/Neo4j/graph-lib framing
in the source research (see #5 in the mapping above: Neo4j/Chroma stay a parked
experiment). Any local store here is IndexedDB/Cache-Storage for MODEL WEIGHTS and the
TF-IDF few-shot corpus (#2 §5.1), not for the graph.

### Model choice — Qwen2.5-Coder-0.5B (smaller than #2's 1.5B)
- **WebLLM natively supports Qwen2.5-Coder-0.5B** (in `prebuiltAppConfig`; VERIFY the
  exact MLC id + q4 size online — #2 §7). Coder tuning suits terse structured-call
  emission; 0.5B is the latency floor #2 §3 already flags for the single-tool case.
- **4-bit quant ≈ <350 MB** (well under #2's ~1.5 GB for the 1.5B). Caches in the browser
  (Cache Storage API) after first visit → **fully offline + fast thereafter**; a short
  tool call is sub-second once resident (VERIFY tok/s in the Spike-0 bench).
- Trade-off vs #2's 1.5B: **less headroom for semantics.** 0.5B is only viable BECAUSE
  it's fine-tuned on our syntax (steps 2–5) + XGrammar-constrained; a *stock* 0.5B would
  be worse than the 1.5B. This is the whole reason #28 and #2 are one story: the fine-tune
  is what buys down the size.

### XGrammar CFG constrained to OUR editor-tool call syntax
- Pass XGrammar a strict CFG/regex so the model can ONLY emit tokens matching our exact
  tool-call shape — the tool NAMES from `EDITOR_TOOLS` (`src/lib/graph/editor-tools-schema.ts`)
  and args drawn from the `ArgValue` union (`literal | expr | param`). Output is then
  *guaranteed* parseable by `dispatchEditorTool` — no regex-scrape, no malformed-JSON
  failure mode (the #2 §5.3 improvement over SVTC's regex parse).
- Grammar shape is a policy choice: either the JSON `{name, input}` form (feed it from a
  new `toJsonSchema()` — the third lowering of `EDITOR_TOOLS` alongside `toClaudeTools()`
  / `toolListText()`, #2 §6) OR a terser `function_name(param="value")` surface form the
  source research names, which the fine-tune can be trained to prefer for fewer tokens.
  **Same source of truth either way** — the CFG is generated FROM `EDITOR_TOOLS`, never
  hand-maintained, so it can't drift from `dispatchEditorTool`.

### Zero-system-prompt-after-fine-tune
- Once the model is fine-tuned on our synthetic+real dataset (this doc, steps 2–5), it
  knows the tool syntax NATIVELY → we can **DROP the tool-schema system prompt** (~0 base
  tokens per call). For a local model with no prompt-caching, that base-token saving is
  the real lever (unlike the cloud model, where caching already amortizes the schema —
  Open Question 1). Few-shot exemplars can still be injected for HARD cases, but the
  standing schema block goes to zero.

### Deploy pipeline (the concrete build step this section adds)
1. **Fine-tune** (Python, DEV-ONLY — never in the prod container, Rule 1): Unsloth/LoRA on
   the synthetic+real JSONL (steps 2–5; ~1–3k pairs → ~95% per step 4) → merged HF weights.
2. **MLC-LLM compile (AOT)**: `mlc_llm convert_weight` + `gen_config` + `compile` → a
   `.wasm` model library (WebGPU/WGSL kernels via the TVM runtime) + quantized weight
   shards. This is a REAL, non-trivial build step (weight conversion + kernel config),
   run offline in the dev/CI toolchain, not at runtime.
3. **Host the ~350 MB artifacts** statically: an HF model repo OR our own static assets
   (served by adapter-node; they're immutable, long-cache). First visit downloads once,
   Cache-Storage keeps them offline after.
4. **Load in-browser**: `import('@mlc-ai/web-llm')` in the Web Worker (#2 §6 — NEVER the
   bake/render thread), pass the CUSTOM model URL to `CreateMLCEngine(...)` via an
   `appConfig.model_list` entry pointing at our hosted `.wasm` + weights.
5. **Infer + dispatch**: `engine.chat.completions.create({messages, temperature:0,
   max_tokens:~30})` with the XGrammar CFG → raw call string/object → `dispatchEditorTool`
   on the live `Graph`. Default OFF behind the same `backend: 'anthropic' | 'webllm'`
   toggle #2 §6 defines; Anthropic stays default + fallback.

### Honest realism (this is a conditional-GO spike, not a plan of record)
- **XGrammar guarantees SYNTAX, not SEMANTICS.** A valid `setCallArg(...)` is not a
  *correct* one. Picking the right tool + the right `ArgValue` (esp. the `param` vs
  `literal` vs `expr` choice our schema flags) is exactly where a 0.5B is weakest — and
  where the #28 dataset (steps 2–5) has to carry the load. No dataset → no accuracy, CFG
  or not.
- **MLC compile is a real build step** (step 2) and **hosting ~350 MB of model assets** is
  a real deploy cost + a bundle/CI concern.
- **0.5B accuracy is the OPEN RISK** → gate exactly as #2 §9: a `/primitives`-scoped
  Spike-0 bench, ship opt-in "offline edits (beta)" ONLY if it clears the accuracy bar
  (#2 sets ≥90% tool / ≥85% args), else shelve as a documented finding. A fine-tuned 0.5B
  MIGHT clear a scoped single-tool bar that a stock 0.5B can't — that's the bet — but it
  must be measured, not assumed.
- **Sequence, unchanged:** the near-term win is **few-shot injection (step 3, no
  training)** — that lands the accuracy/token benefit with zero fine-tune and zero WebLLM
  deploy. Fine-tune + MLC compile + in-browser deploy (this section) is the LATER endgame,
  attempted only after few-shot has proven the dataset and the seam.

## Open questions
- Does compact-TS actually beat our prompt-caching for the CLOUD model? (Likely not — cache already amortizes it.) It matters for the LOCAL model.
- Can the browser web-llm host both the embedding model (few-shot search) AND the fn-call model, fully offline?
- Synthetic-vs-real ratio + dedup so synthetic phrasing doesn't drown real corrections.
- Does a FINE-TUNED Qwen2.5-Coder-0.5B clear the #2 §9 accuracy bar that a stock 0.5B can't — i.e. is the fine-tune enough to drop from 1.5B to 0.5B? (Spike-0 bench, fine-tuned vs stock, 0.5B vs 1.5B.)
- Surface-form `function_name(param="value")` CFG vs JSON `{name,input}` CFG — which is fewer tokens AND more reliable for a fine-tuned 0.5B?
