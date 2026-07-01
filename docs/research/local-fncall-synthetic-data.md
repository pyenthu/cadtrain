# Local function-calling model + synthetic prompt→call data (research)

**Status:** research (2026-07-01, user-supplied). Goal: drive down AI token cost and
eventually run function-calling OFFLINE, by (1) compact tool schemas, (2) a
synthetic + real prompt→call dataset, (3) few-shot injection now / small local
fine-tune later. **This consolidates with what we already ship — do not build a
parallel stack.** Tie into #27 (feedback/RL DB), #2 (web-llm local backend),
#1 (RAG assist), and the shipped tool loop.

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

## Open questions
- Does compact-TS actually beat our prompt-caching for the CLOUD model? (Likely not — cache already amortizes it.) It matters for the LOCAL model.
- Can the browser web-llm host both the embedding model (few-shot search) AND the fn-call model, fully offline?
- Synthetic-vs-real ratio + dedup so synthetic phrasing doesn't drown real corrections.
