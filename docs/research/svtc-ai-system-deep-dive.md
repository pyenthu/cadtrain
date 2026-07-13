<!-- research-group: Local AI -->
<!-- research-date: 2026-07-13 -->
<!-- research-priority: 2 -->

# SVTC's AI system — deep dive + cadtrain mapping

Groundwork for a **chat→wells** interface where a user prompts and the system
**creates/edits wells**, eventually powered by the user's **own locally-trained
model** (prompt → WSON / composition-graph). This doc is the reconnaissance:
(Part 1) exactly how SVTC's proven `src/lib/ai/` loop works — with emphasis on
`trainingLog.js`, the "wrongresponse" register — and (Part 2) which cadtrain
pieces already exist and where the gap is.

Companion design + roadmap: **`docs/plans/chat-to-wells-ai.md`**.

Binding constraints (stated here, honoured in the plan + code):
- **Local-first AI** (memory `ai_data_residency_local_first`): runtime AI must
  be LOCAL / in-browser; cloud Claude is dev/authoring only. The local runtime
  path is `webllm` (memory `todo_webgpu_slm`). The prompt→LLM hop is the leak to
  close.
- **Durable stores are on the volume with atomic writes** (root CLAUDE.md Rule
  4/13). A subagent verifies only against the local `.dev-volume` / a temp dir,
  never the shared prod volume.

---

## Part 1 — SVTC's AI system (`~/code/SVTC/src/lib/ai/`)

### 1.0 The end-to-end loop

```
user types in ChatPanel
   │
   ├─ ensureKnowledgeLoaded()  (first open)  → ragIngest.js seeds IndexedDB from
   │     /api/ai-knowledge + /ai/schema.json + /ai/graph.json (static + volume)
   │
   ├─ chat.send(text)
   │     ├─ readAppState()          → live tab/datasource summary (tools.js)
   │     ├─ buildRagContext(text)   → rag.js TF-IDF top-5 chunks (IndexedDB)
   │     └─ POST /api/chat { messages, appState, ragContext }   ← ONE thin proxy
   │
   ├─ inference (ONE of two backends, SAME tool vocabulary):
   │     A. Claude API  (chat.svelte.js)      → native tool_use, ≤5-step loop
   │     B. WebLLM      (webllm/chat.svelte.js)→ Phi-3.5-mini in-browser, 2-pass
   │
   ├─ tool dispatch (SHARED, runs in the BROWSER against live Svelte stores):
   │     dispatchToolCall(name,args) in tools.js
   │       e.g. readFile → mutate JSON in-memory → writeFile → tab re-renders
   │
   └─ training capture (SHARED, EVERY turn):
         logTrainingPair(instruction, output, type)   → IndexedDB
         markUnresolved(...)  on failure/flag         → POST /api/ai-training
```

The design invariant: **one tool vocabulary, two inference backends, one
training corpus.** Both the cloud and the local model call the same client-side
`dispatchToolCall`, and every interaction — from either backend — logs to the
same store, so the local model's fine-tune corpus grows from *all* usage.

### 1.1 Module responsibilities

| File | Responsibility |
|---|---|
| `chat.svelte.js` | **Claude-API chat state** (Svelte 5 `$state` class `ChatState`). Builds the Anthropic message array (mapping `tool_result` + `tool_use` blocks), calls `/api/chat`, runs the **multi-step tool loop** (`MAX_TOOL_STEPS = 5`), logs each step. `isCreateIntent()` heuristic flags a "create X" prompt that produced prose-only (no tool) as a `create-intent-miss` for capture. |
| `webllm/chat.svelte.js` | **Local chat state** (`WebllmChatState`). Same tool vocabulary but **two-pass**: model → regex-parse a `{tool,args}` object → dispatch → feed result back → second pass for the natural answer. Manages engine load/progress. |
| `systemPrompt.js` | The big Claude system prompt: app capabilities, **WSON/DGEO schemas by example**, editing rules, `tool_comp` catalogue, few-shot create-intent examples, refusal rule. Imports `API.md`. |
| `webllm/prompt.js` | The **small-model** system prompt: app state + `toolListText()` + few-shot + a spelled-out deviation vocabulary. Phi-3.5 needs the schema restated far more explicitly than Claude. |
| `toolSchema.js` | **Pure data** (server-safe): the `TOOLS` array (13 tools) + `toClaudeTools()` (→ Anthropic `input_schema`) + `toolListText()` (→ WebLLM plain text). The single source both backends read. |
| `tools.js` | **Client-side dispatcher.** `TOOL_IMPLS` executes each tool against the live `tabStore` / `datasourceStore` / File System Access handles. Includes `readFile`/`writeFile`/`patchFile`/`createFile`/`createFromArchetype`/`addFault`/`createPlot`/`editCurve`. `_summariseWson()` returns a FACTUAL summary so the model quotes it instead of hallucinating. |
| `rag.js` | **TF-IDF retrieval** in IndexedDB. `ingestChunks(source, chunks)` → term-frequency vectors; `retrieve(query, topK)` → cosine similarity; `buildRagContext()` → prompt block. Plus per-format extractors (`extractLasChunks` / `extractDlisChunks` / `extractTplChunks` / `extractWsonChunks`). No embedding-model download — works offline. |
| `ragIngest.js` | **Auto-ingestion hooks.** `ingestLas/Dlis/Tpl/Wson` called by each app after parse; `ensureKnowledgeLoaded()` seeds the static knowledge/schema/graph on first chat open. |
| `trainingLog.js` | **The training/correction register** (detailed below). |
| `tasks/*.js` | **Scoped AI tasks** — a narrow system prompt + a 1-tool allowlist + client `executeTool` + `run()`, all logging to the same `trainingLog` with `type:'task:<id>'`. First task: `surveyGen` (directional survey generator). Lets a button trigger a focused action without the full RAG+toolbox. |
| `webllm/engine.js` | **WebLLM engine singleton.** `MODEL_ID = 'Phi-3.5-mini-instruct-q4f16_1-MLC'`; lazy `import('@mlc-ai/web-llm')` → `CreateMLCEngine` with a progress callback. `isWebGPUAvailable()` gate. |
| `webllm/parse.js` | `tryParseToolCall(text)` — regex-extract the first `{..."tool"...}` object from the small model's free text. |
| `libs.js` | `window.__SVTC__` registry so dynamically-compiled `.svelte` components resolve `$lib/...` to the live module instances. |
| `API.md` | Allow-list of `$lib/` imports for AI-generated components. |

### 1.2 `trainingLog.js` — the "wrongresponse" register (the key file)

Two persistence paths, both keyed on the training-pair shape
`{ instruction, output }`:

**(a) `logTrainingPair(instruction, output, type='direct')`** — the happy-path
capture. Every completed turn logs one pair:
- `type` ∈ `'direct'` (a prose answer), `'tool_call'` (the `{tool,args}` JSON the
  model chose), or `'task:<taskId>'` (a scoped task).
- Stored in **IndexedDB** (`svtc-ai-training` / store `pairs`), keyed by
  autoincrement `id`, with `{ instruction, output, type, timestamp, flushed:false }`.
- **Auto-flush every 20 unflushed pairs** (`FLUSH_EVERY`) → `flushToServer()`
  POSTs the unflushed batch to `/api/ai-training`, which **appends** them to
  `static/ai/training/captured.jsonl`; on success the rows are marked
  `flushed:true`. Survives cache clears.
- Silent on error — training capture is non-critical and must never break chat.

**(b) `markUnresolved(instruction, output, opts)`** — the **"needs work"
register** (the "wrongresponse" the user referenced). It **bypasses the
IndexedDB queue** and POSTs immediately so the review file lands promptly. The
record schema (→ `static/ai/training/unresolved.jsonl`):

```jsonc
{
  "instruction": "make a horizontal producer",   // the user prompt
  "output":      "…prose or {tool,args,error}…",  // what the model produced
  "type":        "unresolved",
  "note":        "optional user note",            // from the 🔧 button
  "source":      "user" | "tool-error" | "api-error" | "create-intent-miss",
  "toolName":    "createFromArchetype" | null,    // when a tool failed
  "context":     [{ role, content }, …] | null,   // up to 3 prior turns
  "timestamp":   1699999999999
}
```

It is captured in **four** situations (three automatic):
1. **User flag** — `flagUnresolved(msgIndex, note)` (the 🔧 button) with
   `source:'user'`, attaching up to 3 prior turns as `context` for
   diagnosability.
2. **Tool-dispatch error** — `dispatchToolCall` threw or returned `{error}`
   (`source:'tool-error'`, `toolName` set). Auto.
3. **API / inference error** — the `/api/chat` (or WebLLM second-pass) call
   failed (`source:'api-error'`). Auto.
4. **Create-intent miss** — the prompt used a create verb + domain target
   (`isCreateIntent`) but the model returned prose with **no** tool call
   (`source:'create-intent-miss'`). Auto — this is the SVTC-specific "you should
   have acted but didn't" signal.

**How it feeds the next correction / enhancement.** The two files form a
**preference pair**: the fine-tune build script concatenates `captured.jsonl`
(the positives) and **subtracts** the flagged/`unresolved.jsonl` pairs before
training (per SVTC's `src/lib/ai/CLAUDE.md`): `captured.jsonl − unresolved.jsonl
→ train.jsonl`. So a flagged bad response doesn't poison the corpus, and its
prompt can be re-answered correctly later and re-captured as a positive. The
build recipe (offline, Mac M4): `mlx_lm.lora --model Phi-3.5-mini --data
train.jsonl` → `mlx_lm.convert --gguf` → `mlc_llm convert_weight` → HF upload →
bump `MODEL_ID` in `engine.js`. The goal: the fine-tune **bakes in** the layer-1
knowledge + tool grammar so the runtime prompt shrinks from ~2000 tokens to ~50.

**Reader/utility surface:** `getTrainingPairs()`, `getTrainingCount()`,
`exportAsJSONL()` (emits just `{instruction, output}` — the training shape),
`clearTrainingPairs()` (flush then wipe).

### 1.3 RAG (`rag.js` + `ragIngest.js`)

- **TF-IDF, not embeddings** — deliberately: no model download, fully offline,
  in the browser. `tokenize` → lowercase + split on non-word; `termFrequency`
  (max-normalised); `cosineSimilarity` over the union of terms. Retrieval filters
  `score > 0.05`, sorts desc, slices top-K (default 5).
- **Chunks are per-file-format** (`extractWsonChunks` emits a well-summary chunk,
  a casing chunk, a perfs chunk, …) plus a static knowledge layer
  (`knowledge.json` — 25 curated domain/app entries), a structured `schema.json`
  (file formats, curves, tools flattened to text), and a Graphify code-graph
  (`graph.json`, community summaries + key nodes). All land in one IndexedDB
  store; `buildRagContext` prepends `RELEVANT CONTEXT FROM USER'S FILES:` +
  `- [source] text` lines.

### 1.4 Tool-calling (`toolSchema.js` + `tools.js`)

- **13 tools**, defined once as pure data, projected to *both* the Anthropic
  `input_schema` and a plain-text list for the small model.
- **The client executes the tools**, not the server. `/api/chat` is a thin proxy
  that returns the model's chosen tool call; `dispatchToolCall` runs it against
  the live stores + File System Access handles and returns a JSON result the
  loop feeds back. This keeps app mutation **local** (a data-residency win that
  cadtrain independently arrived at — see Part 2).
- **Anti-hallucination pattern:** editing tools return a factual `summary`
  (`_summariseWson`) and the system prompt *forbids* paraphrasing from memory —
  the model must quote the tool result. Deviation/shape facts are only claimed
  when the `profile[]` actually carries them.

### 1.5 WebLLM local backend (`webllm/`)

- **Model:** `Phi-3.5-mini-instruct-q4f16_1-MLC` via `@mlc-ai/web-llm` (MLC/WebGPU
  runtime). ~2.4 GB weights, downloaded once, cached in the browser Cache API.
- **Gate:** WebGPU required (Chrome/Edge desktop; skipped on mobile/iOS Safari).
  `createEngine(onProgress)` is idempotent; a progress callback drives the load
  bar.
- **Two-pass** (no native tool grammar): pass 1 → free text → `tryParseToolCall`
  regex → `dispatchToolCall` → pass 2 with the tool result appended → natural
  answer. Same `trainingLog` capture as the cloud path.
- **Why it matters here:** this is the exact runtime the cadtrain **local-first**
  constraint mandates. cadtrain's `docs/plans/webgpu-slm.md` / memory
  `todo_webgpu_slm` proposes web-llm + XGrammar (grammar-constrained decoding for
  reliable tool JSON) — an upgrade over SVTC's regex parse.

---

## Part 2 — cadtrain's existing pieces (map, don't rebuild)

cadtrain **already has** a server-side RAG layer and a Claude-driven,
client-applied tool loop for the **graph editor**. The chat→wells work reuses
these, not reinvents them.

### 2.1 What each existing piece does

| Piece | What it does | Analogue in SVTC |
|---|---|---|
| `src/lib/server/rag-corpus.ts` | Walks `<volume>/primitives/**`, distils each `.prim/.asm/.prvl/.prex.ts` to a `RagRecord` (`id, kind, description, tags, params, structure_summary, exemplar_path`), atomically writes `<volume>/ai/rag/parts.jsonl`. Includes the `bw_*` well-element parts + `g_*` completion parts. | `ragIngest.js` extractors, but server-side + persisted as JSONL. |
| `src/lib/server/rag-query.ts` | **BM25** retrieval over `parts.jsonl` (`tokenize` + `bm25` + `recordSearchText` + `topK`). Pure, no SDK. | `rag.js` `retrieve()`, but BM25 not TF-IDF, server-side. |
| `src/lib/server/rag-l1.ts` | **L1 deterministic dictionary** — known-part phrases (`flat collar`, `tube`, `shaft`, …) resolve to a ready-to-bake revolve `meta.graph` **offline, 0 tokens**. Miss → L2. | No SVTC analogue (cadtrain-specific "instant known part"). |
| `src/lib/server/rag-prompt.ts` | Builds the Claude system+user prompt for graph generation: **graph schema by example** (a trimmed `g_spiral`), the available-primitives catalogue, hard "one JSON object" rules; user message = BM25 top-k exemplars + the prompt. | `systemPrompt.js`, but emits a composition-graph not WSON. |
| `/api/rag/prompt` | `{prompt,k?}` → L1 (instant) else BM25 top-k + **one** Claude call (`RAG_MODEL`, default `claude-sonnet-4-6`) → `{id, candidates, graph}` for the ✨ generate box. Prod-proxied. | `/api/chat` (single-shot generate flavour). |
| `/api/rag/assist` | **Thin per-turn tool-use proxy** for the ✨ "edit this part" assistant. ONE Claude call (`RAG_ASSIST_MODEL`, default `claude-opus-4-8`, adaptive thinking, prompt-cached stable prefix). Returns `{type:'tool_use', calls}` or `{type:'text'}` — does NOT execute; the client applies. | `/api/chat` — **the same thin-proxy stance**. |
| `src/lib/shared/graph-editor/ge-assist.ts` | The **pure multi-shot tool loop** (`runAssistLoop`), rune-free + injected I/O so it unit-tests. Holds the live `Graph`, calls `/api/rag/assist`, applies each returned call via the PURE `dispatchEditorTool`, feeds `tool_result`s back, hard-caps at `MAX_STEPS=6`, honours user Stop, logs tool errors via `logFixError` (→ `ai/fix-errors.jsonl` self-repair corpus). | `chat.svelte.js` multi-step loop — **directly modelled on it** (the file says so). |
| `ge-assist.svelte.ts` | The reactive `$state` wrapper (`createAssistSession`) that supplies the default `fetch`/`getGraph`/`setGraph`/transcript. | `ChatState` runes wrapper. |
| `src/lib/graph/editor-tools.ts` + `editor-tools-schema.ts` | The editor tool vocabulary (`addParam`, `wireArgToParam`, `addCall`, `addCsg`, …) as pure data + a PURE `dispatchEditorTool(name,input,graph,ctx)`. `readEditorState` injects live params/nodes/selection. | `toolSchema.js` + `tools.js` — same split, but graph-scoped + pure (no live-store side effects). |
| `/api/primitives/refine` | Claude-assisted source **refine** of a single part (dual backend: `@anthropic-ai/sdk` OR `claude --print` subprocess). | Not chat — a one-shot authoring helper. |

### 2.2 The gap vs. a chat→wells system

cadtrain has, essentially, **SVTC's whole pattern already — but pointed at the
graph editor, not at wells, and with no persistent interaction/correction log:**

1. **No chat surface, no wells tool vocabulary.** `ge-assist` edits a
   **composition Graph** via `editor-tools`; there is no `dispatchWellTool` over
   the WSON model (`add casing`, `add packer`, `set TD`, `deviate to horizontal`,
   …). The well **edit engine exists** (`well-edit-core.ts` /
   `well-edit-store.svelte.ts` — `addString`/`addCompletion`/`updateStation`/…
   with snapshot undo + an `onChange(info)` hook) and `well-edit-intent.ts`
   already maps a tool-rail button → a well-formed default element. A chat tool
   layer would be a **thin adapter over these**, exactly as `dispatchEditorTool`
   wraps the graph.

2. **No retrieval over the WELLS corpus.** `rag-query.topK` scores only
   `parts.jsonl`. A chat→wells retriever needs the **`bw_*` parts + the
   vocabulary (`docs/parts/vocabulary.json`) + the `.wson` samples
   (`src/lib/wells/samples/`) + docs** in one corpus. The scoring machinery
   (BM25) is reusable verbatim — only the corpus assembly + WSON/vocab extractors
   are missing.

3. **No interaction/correction/training register at all.** This is the biggest
   gap and the user's core ask. SVTC's `trainingLog.js` (`logTrainingPair` +
   `markUnresolved`) has **no cadtrain equivalent**. The closest thing is
   `ge-assist`'s `logFixError` → `ai/fix-errors.jsonl`, which captures **only**
   graph-tool dispatch errors — not prompts, not responses, not corrections, and
   nothing about wells. There is:
   - no capture of `(prompt, response)` pairs,
   - no "wrongresponse" / needs-work flag,
   - **no `(instruction, well_before, well_after, diff)` edit tuple** — the
     signal the user explicitly wants ("if I enhance and get a modified well,
     that should also be recorded"),
   - no full-well snapshot corpus.

4. **No local (webllm) runtime.** All cadtrain AI is cloud Claude (dev/authoring
   only). The local-first constraint (memory `ai_data_residency_local_first`)
   remains unmet; `webgpu-slm.md` is a conditional-GO spike, not built. SVTC's
   `webllm/` is the reference implementation to port.

### 2.3 What to reuse verbatim (do NOT rebuild)

- **BM25 + tokenize + the JSONL/atomic-write conventions** (`rag-query.ts`,
  `rag-corpus.ts`) — the chat retriever is a thin corpus adapter over `bm25`.
- **The thin-proxy + client-applied multi-shot loop** (`/api/rag/assist` +
  `ge-assist.runAssistLoop`) — a wells assistant is the *same* loop with a
  `dispatchWellTool` instead of `dispatchEditorTool`, and a WSON state instead of
  a Graph.
- **The well edit engine** (`well-edit-core.ts`) — snapshot undo already gives
  clean before/after docs; its `onChange(info)` is the exact seam to emit an edit
  tuple.
- **The volume/atomic-write/proxy plumbing** (`volume.ts`) — the training log is
  one more `ai/*.jsonl` store next to `ai/rag/parts.jsonl`.

---

## Appendix — file inventory read for this doc

SVTC: `chat.svelte.js`, `ChatPanel.svelte`*, `systemPrompt.js`, `toolSchema.js`,
`tools.js`, `rag.js`, `ragIngest.js`, `trainingLog.js`, `libs.js`,
`webllm/{engine,prompt,parse,chat.svelte}.js`, `CLAUDE.md`, `API.md`*, `tasks/`*.
(* skimmed.)

cadtrain: `src/lib/server/{rag-corpus,rag-query,rag-l1,rag-prompt,volume}.ts`,
`src/routes/api/rag/{assist,prompt}/+server.ts`,
`src/lib/shared/graph-editor/ge-assist.ts`, `src/lib/graph/editor-tools*.ts`,
`src/lib/wells/{wson,well-edit-core,well-edit-store.svelte,well-edit-intent,
well-part-map}.ts`, `src/lib/wells/samples/*.wson`, `src/routes/research/docs.ts`.
