# Plan — AI MASTER PLAN (the north star): one self-improving, local-first tool-calling CAD assistant

**Status:** north-star (fuses all AI/RAG plans, 2026-07-01). PLANNING/DOCS ONLY.
**Supersedes the *phasing* of** `ai-rag-system.md`, `ai-function-mapping.md`,
`ai-multishot-assist.md`, `ai-feedback-rl.md` (#27), `ai-tool-library.md` (#29),
`docs/research/web-llm-functionary.md` (#2), `docs/research/webgpu-slm.md`,
`docs/research/local-fncall-synthetic-data.md` (#28). Those docs stay as the
**detail sheets**; THIS doc is the single ordering + the one-system argument.
Re-verify every model id / library version against the `claude-api` skill and
the research docs' §7 "verify online" lists before building — never hardcode.

---

## North star (one paragraph)

cadtrain has ONE AI assistant: a **multi-shot tool-calling loop** that edits the
live composition `Graph` by dispatching small editor tools, and that **gets
better the more it is used**. Everything the assistant can do flows from a single
**function-library registry** (`editor-tools-schema.ts`) — the living source of
truth that *generates* every machine form (cloud JSON schema, prose/compact-TS
prompt, and the local model's constrained-decoding grammar), *seeds* the training
and few-shot data, and is itself *refined* by real usage. A single **corpus** on
the volume (parts + docs + simplified prompts + judged feedback turns) feeds
retrieval and few-shot selection into that same loop, and every judged turn
(👍 / 👎 / correction) grows the corpus — the incremental-knowledge flywheel with
**no training required for the near-term win**. Under the binding
**data-residency** constraint (memory `ai_data_residency_local_first`: prod may
not send prompt data out), the *runtime* is **local-first — a WebLLM/MLC model in
the browser**, constrained by a grammar generated from the same registry; cloud
Claude is used only at **dev / authoring / build-time** (synthetic-data
generation, doc simplification, offline eval). One registry, one corpus, one
loop, one local runtime.

---

## Architecture (diagram-in-prose)

```
                         ┌───────────────────────────────────────────────┐
                         │  FUNCTION-LIBRARY REGISTRY  (source of truth)   │
                         │  editor-tools-schema.ts — EDITOR_TOOLS[]        │
                         │  each entry: { name, intent[], desc, params,    │
                         │    mutator, nodeType?, category, atomic? }      │
                         └───────────────┬───────────────────────────────┘
        GENERATES (never hand-maintained, sync-tested) │
     ┌───────────────────────┬──────────────────────────┬──────────────────────┐
     ▼                       ▼                            ▼                      ▼
 toClaudeTools()       toolListText()             toJsonSchema()/toGrammar()   SEEDS
 JSON input_schema     prose + compact-TS         XGrammar CFG over            #28 synthetic
 (CLOUD, dev/build)    (system prompt)            EDITOR_TOOLS/ArgValue        {prompt→call}
     │                       │                    (LOCAL runtime)              pairs +
     └───────────┬───────────┴────────────┬───────────────┘                   #27 few-shot
                 ▼                         ▼
        ┌─────────────────── MULTI-SHOT LOOP ───────────────────┐
        │  runAssistLoop() (ge-assist.ts) — backend-agnostic     │
        │  messages=[user]; ≤ MAX_STEPS:                         │
        │    resp = postTurn({system, tools, messages,graphState})│◄── postTurn is the SEAM:
        │    if text → STOP                                       │    'anthropic' (dev) |
        │    for call in resp.calls:                              │    'webllm'   (prod, local)
        │       {graph,result,error}=dispatchEditorTool(call,graph)│   both return {calls|text}
        │       graph = next   (live $state ⇒ auto-rebake)        │
        │    re-inject readEditorState(graph) each turn           │
        └───────────────┬───────────────────────┬────────────────┘
      RETRIEVAL / few-shot IN                    │ FEEDBACK OUT
                 ▲                               ▼
     ┌───────────┴─────────────┐    ┌────────────────────────────────────┐
     │  ONE CORPUS (on volume)  │◄───│ turn → verdict 👍/👎/correction      │
     │  parts.jsonl (BM25→embed)│    │ POST /api/ai/feedback → turns.jsonl  │
     │  docs.jsonl (md ingest)  │    │ approved→+few-shot · disapproved→    │
     │  simplified.jsonl (seeds)│    │ avoid-list · corrected→vocab promote │
     │  feedback/turns.jsonl    │    │ + self-repair                        │
     └──────────────────────────┘   └────────────────────────────────────┘
                 │
                 ▼ (P4, optional)  synthetic + real pairs → LoRA fine-tune →
                    MLC compile → zero-prompt local Coder-0.5B (data-residency endgame)
```

**Load-bearing decision (already true in code):** tools are plain data and the
dispatcher is pure, so a backend does exactly one thing — *produce the next tool
call from `{system, tools, messages}`*. `ge-assist.ts` already injects that as a
`postTurn(...)` dependency, so the local WebLLM runtime is a **swap of one
injected function**, not a rearchitecture.

---

## The four targets are ONE system

The user named four asks. They are not four tracks — they are four views of the
same registry + corpus + loop + local runtime:

1. **Multi-shot AI with incremental knowledge** = the loop (`runAssistLoop`,
   SHIPPED) + the #27 feedback→corpus→few-shot flywheel. The loop is the
   "multi-shot"; the corpus growing from judged turns is the "incremental
   knowledge." No training needed for the near-term lift — retrieval + few-shot
   + vocab-promotion do it.
2. **Function–prompt interface (minimal tokens)** = the #29 registry + its
   compact lowerings (`toClaudeTools`, `toolListText`, `toJsonSchema`). Prompts
   map to small tool calls; the schema is paid once per cloud session
   (prompt-cache, SHIPPED) and dropped to ~0 base tokens once a local model is
   fine-tuned on the syntax (#28).
3. **Enhance the function docs + interface over time** = the registry IS the
   living documentation. `intent[]`/`desc`/`mutator` per tool are what the
   md-ingest indexes, what seeds the synthetic data, and what few-shot retrieves.
   Adding a tool regenerates the schema + the prompt + the grammar + fresh
   synthetic examples in lockstep; a **CI sync/coverage test** (#29 §2.4) keeps
   the library honest against the editor's real capability surface (so "add a
   spline" can't silently be impossible again).
4. **Use WebLLM** = the local runtime the *whole thing* targets, mandated by
   data-residency. The loop's `postTurn` seam + the registry-generated grammar
   (`toJsonSchema`/XGrammar CFG) + a browser-local TF-IDF corpus mean the exact
   same loop runs with no data leaving the browser.

They **share one registry** (generates schemas + seeds data + refined by
feedback), **one corpus** (parts + docs + simplified + feedback, one retriever),
and **one loop** (`runAssistLoop`, backend-agnostic via `postTurn`).

---

## The single sequenced roadmap (dependency-ordered; each phase shippable)

Legend: ✅ SHIPPED · 🔲 TODO · ◐ PARTIAL.

### P0 — Reconcile + registry foundation  (= #29 core, #1 groundwork)
The seams already exist; this phase makes the library authoritative and clears
stale docs.
- ✅ 12-tool registry `EDITOR_TOOLS` + `toClaudeTools()` + `toolListText()`
  (`src/lib/graph/editor-tools-schema.ts`).
- ✅ Pure dispatcher `dispatchEditorTool` + `readEditorState`
  (`src/lib/graph/editor-tools.ts` + `.test.ts`).
- ✅ Backend-agnostic loop `runAssistLoop` (`postTurn` seam, `MAX_STEPS=6`, Stop,
  capped/error states) + per-pane `createAssistSession` factory
  (`src/lib/shared/graph-editor/ge-assist.ts` / `.svelte.ts` / `.test.ts`).
- ✅ `/api/rag/assist` per-turn proxy WITH the prompt-cache split
  (`buildAssistSystem` → `ASSIST_STATIC_SYSTEM` cache_control breakpoint +
  volatile `CURRENT EDITOR STATE` after it) AND in `VOLUME_PROXY_PATHS`.
- ✅ AiMenu edit-mode mounted (`src/lib/shared/graph-editor/AiMenu.svelte`).
- ✅ BM25 generate path (`/api/rag/prompt`, `rag-corpus.ts`, `rag-query.ts`,
  `rag-prompt.ts`, `rag-l1.ts`, `ai/rag/parts.jsonl`) + `/api/rag/rebuild|stats`.
- 🔲 Grow `ToolDef` to `{ intent[], desc, params, mutator, nodeType?, category,
  atomic? }` (#29 §2.1) — turns the registry into the documentation source.
- 🔲 CI coverage/sync test `editor-tools-coverage.test.ts` (#29 §2.4): picker
  parity · mutator existence · public-mutator allow-list · cloud/local name
  round-trip.
- 🔲 **Reconcile stale docs** (see table + list below): task 905, plan headers,
  fix-errors sink, path refs.

### P1 — Complete the tool library + capture feedback  (= #29 §3, #1 remainder, #27 P1)
- 🔲 **Complete the missing tools — `addSpline` FIRST** (`+ setSplineClosed` /
  `setSplinePoints` / `setSplineSamples` — the reported bug: AI can't make a
  circular spline), then the rest of #29 §1.4 (create verbs `addPolygon` /
  `addSketch` / `addExprDef` / `addRepeat` / `addContainer`; the sketch/expr/
  repeat edit surface; `describeNode`, `unwireArg`, `removeParam`,
  `setPartColor` / `setPartMaterial`; atomic combos `subtractPart`,
  `repeatNode`). Each wraps an already-pure Graph→Graph mutator.
- ◐ Context wiring (#1 leftover): add `route` to `EditorContext`/`readEditorState`
  + populate `selectedId` on node-click so "edit THIS node" works.
- 🔲 **#27 Phase 1 feedback capture** — 👍/👎/free-text verdict on each completed
  turn in `AiMenu.svelte`; `POST /api/ai/feedback` → `ai/feedback/turns.jsonl`
  (Rule 4/13 plumbing + `VOLUME_PROXY_PATHS`); `corrected` auto-derived by
  diffing the AI graph vs. the user's end graph; **fold the never-built
  `fix-errors.jsonl`/`logFixError` sink in as `verdict:'error'` rows** (one
  sink, not two).

### P2 — Corpus unification + few-shot injection  (= #27 P2/P3, #28 a–c near-term, #29 §2.2)
The biggest near-term accuracy/token win, **no training**.
- 🔲 Unify the corpus: `ai/docs/docs.jsonl` (md ingest of `CAD_AUTHORING.md`,
  `PRIMITIVE_TEMPLATE.md`, `docs/parts/*.md`, conventions) +
  `ai/docs/simplified.jsonl` (deterministic first, optional cached LLM pass) +
  `feedback/turns.jsonl`, all retrieved alongside `parts.jsonl` via one
  multi-source `rag-query.ts`. Extend `/api/rag/rebuild` (↻) to rebuild all.
- 🔲 **Synthetic seed generator** (#28 b): Claude (dev/build-time) iterates
  `EDITOR_TOOLS × downhole/CAD vocab` → ~300 `{user_prompt, minimized_call}`
  pairs into the same JSONL store. The registry's `intent[]`/`params` drive it.
- 🔲 **BM25 → embeddings** (RAG Phase 3) over parts+turns+synthetic+simplified →
  top-3 nearest-pair **few-shot injection** into the assist loop's first user
  turn (#27 §3/§4, #28 c). Polarity: approved/corrected = positive examples,
  disapproved/error = bounded "avoid" list.
- 🔲 `corrected → vocabulary` promotion via the `promote-to-vocab.ts` precedent
  (so the deterministic Generate path produces it with zero model calls next
  time) + self-repair context.
- 🔲 **`toJsonSchema()` / `toGrammar()`** — the third registry lowering (#29
  §2.2). Needed by P3; land it here so the CFG is proven against the cloud schema
  (round-trip test) before the local runtime depends on it.

### P3 — WebLLM local runtime  (= #2, data-residency runtime)
The runtime the whole system targets. Default OFF, Anthropic stays dev fallback.
- 🔲 `src/lib/graph/ai/webllm/engine.ts` — lazy `@mlc-ai/web-llm` in a **Web
  Worker** (never the bake/render thread), WebGPU feature-detect, Cache-Storage
  weights. Start **Qwen2.5-1.5B-Instruct** + XGrammar constrained to
  `toJsonSchema()`.
- 🔲 `webllm/corpus.ts` — SVTC `rag.js` TF-IDF-in-IndexedDB pattern; build the
  few-shot DB **in the browser** from a bundled parts snapshot. Instruction +
  graph never leave the browser.
- 🔲 Backend toggle = inject a `webllm` `postTurn` into `createAssistSession`
  (`backend: 'anthropic' | 'webllm'`). The loop, `dispatchEditorTool`, context,
  and feedback capture are all unchanged. **User-facing picker + key story =
  the BACKEND LAYER: `docs/plans/ai-backend-selector.md`** — an SVTC-style
  selector in AiMenu (Claude / WebLLM-local / future), registry-driven, cloud
  keys handled securely (Rule 15), local needs none; per-user default via OAuth (#30).
- 🔲 **Scope to win** — route-/selection-scoped toolset to the small model
  (SVTC `tasks/` grain); hand multi-step work back to cloud (dev only).
- 🔲 **Conditional-GO bench** (Spike-0 under `/primitives`): ship opt-in "offline
  edits (beta)" only if ≥90% tool + ≥85% arg accuracy on a canned scoped set;
  else shelve as a documented finding. **Note:** under strict data-residency the
  *cloud* backend is dev-only — so a failing bench means the local path is the
  ONLY shippable runtime and must be revisited (invest in P4 / tighter scoping),
  not that AI-in-prod is optional.

### P4 — Synthetic data at scale + optional LoRA fine-tune → zero-prompt local  (= #28 endgame)
Only if P2 few-shot plateaus on a held-out eval.
- 🔲 Grow the synthetic + real dataset to ~1–3k pairs (#28 step 4: LoRA sweet
  spot ~95%).
- 🔲 LoRA fine-tune (Python, **dev-only**, Rule 1) a small model
  (Qwen2.5-Coder-0.5B target) on the registry-generated call syntax → MLC-LLM
  AOT compile (`.wasm` + weight shards, ~350 MB) → host static/HF → custom-URL
  `CreateMLCEngine`.
- 🔲 **Drop the schema system prompt** (model knows the syntax natively) →
  near-zero base tokens per local call.
- 🔲 (Parked) preference/DPO from approved-vs-disapproved pairs; Neo4j/Chroma
  graph+vector server stays a parked experiment (Rule 1, heavy).

---

## The self-improving loop, made explicit (the "incremental knowledge")

**Per-turn knowledge growth (no gradient step):**
```
user instruction ─▶ loop dispatches tools on the live Graph ─▶ user judges the turn
   │                                                                   │
   │  verdict = 👍 approved | 👎 disapproved | ✎ corrected (diff vs end-graph) | ⚠ error
   ▼                                                                   ▼
POST /api/ai/feedback ──▶ ai/feedback/turns.jsonl (append-only, on volume)
   │
   ├─ approved  ─▶ positive few-shot exemplar (retrieved for similar prompts)
   ├─ disapproved ─▶ bounded "avoid" list + demotes the recurring bad exemplar
   ├─ corrected ─▶ (gold bad→good pair) vocab promotion + self-repair context
   └─ error     ─▶ self-repair "known pitfall" (the old fix-errors channel)
                                        │
                                        ▼
                       next similar turn retrieves the better example ⇒ better output
```

**Docs/interface self-improvement (target #3):**
```
new capability needed  ─▶ add ONE ToolDef to the registry (intent+desc+mutator+params)
                                        │  (CI coverage test FAILS until it's added or allow-listed)
        ┌───────────────────────────────┼───────────────────────────────┐
        ▼                               ▼                               ▼
 toClaudeTools() regen          toolListText() regen             toJsonSchema()/CFG regen
 (cloud schema)                 (system-prompt docs)             (local grammar)
        └───────────────────────────────┼───────────────────────────────┘
                                        ▼
                    #28 synthetic {prompt→call} examples regenerate for the new tool
                    #27 md-ingest re-indexes the new intent[]/desc as documentation
                                        ▼
                    the assistant (cloud AND local) can now do the new thing — in sync
```
The registry is the single edit point; schema, prompt, grammar, synthetic data,
and few-shot corpus all *derive*. That is what keeps "AI capabilities in sync
with the editor" true over time, enforced (not aspirational) by the sync test.

---

## Decisions to make (call-outs for the user)

1. **Compact-TS vs JSON tool schema.** With cloud prompt-caching (SHIPPED) the
   schema is paid once/session, so compact-TS barely helps the *cloud* path. It
   matters for the *local* model (no caching) and is the precondition for the P4
   zero-prompt fine-tune. Decision: keep JSON `toClaudeTools()` for cloud; add
   `toJsonSchema()`/CFG for local; **evaluate compact-TS `toolListText()` only
   for the local prompt** — measure, don't assume.
2. **Embedding model for few-shot (P2).** Local (in-browser / in-process, keeps
   data-residency for retrieval too) vs a cloud embedding call (dev/build-time
   index only). Recommend a local/in-process embedding so few-shot search also
   honors data-residency; confirm the browser can host both the embedding model
   and the fn-call model offline (open question in `local-fncall-synthetic-data`).
3. **Fine-tune now vs few-shot-only.** Few-shot (P2) is the near-term win with no
   training. Fine-tune (P4) buys the smaller model + zero-prompt but costs a
   real Python/MLC build pipeline + ~350 MB hosting. Gate on a P2 eval plateau.
4. **Where feedback/corpus live: per-user vs shared.** Today one shared volume
   (Rule 13). Per-user private corpora tie to the OAuth identity port
   (`oauth-identity.md`, #30). Decision: ship shared first; scope per-user when
   OAuth lands (also the CLOUD-folder story in #30).
5. **Bench outcome policy (P3).** Because data-residency makes cloud dev-only,
   agree up front what happens if the local bench fails the accuracy bar — invest
   in fine-tune (P4) sooner, tighten scoping, or accept a narrower assistant.

---

## Reconcile — old docs/TODOs → role under the master plan

| Old doc / TODO | Status now | Role under master plan |
|---|---|---|
| `ai-rag-system.md` (umbrella) | architecture; Phase-1 shipped | Detail sheet for the **loop + dual-backend seam + context** = P0/P1/P3. Its phasing is superseded by this roadmap. |
| `ai-function-mapping.md` (Phase-1 registry + dispatcher) | **SHIPPED** (header stale: "proposed") | Detail sheet for the **registry + dispatcher** = P0. Its Phase-2/3 tool ideas fold into #29 (P1). |
| `ai-multishot-assist.md` (client loop + tab ctx + fix-errors) | loop SHIPPED (header stale: "proposed") | Detail sheet for the **loop wiring + selectedId + §E tools** = P0/P1. Its §H `fix-errors.jsonl` sink is **superseded by #27** (feedback store). |
| `ai-feedback-rl.md` (#27) | architecture | **P1–P2 (+ P4 optional):** feedback capture + corpus unification + few-shot/promotion = the incremental-knowledge flywheel. |
| `ai-tool-library.md` (#29) | proposed/audit | **P0–P1 foundation:** the registry-as-source-of-truth + generated forms + sync test + missing tools (`addSpline` first). |
| `web-llm-functionary.md` (#2) | research (conditional-GO) | **P3:** the local WebLLM runtime detail (runtime landscape, seam, spike). |
| `webgpu-slm.md` | research | **P3** background (rlm-minimal rejected; web-llm+XGrammar chosen). |
| `local-fncall-synthetic-data.md` (#28) | research | **P2 (synthetic seed + few-shot) + P4 (fine-tune/MLC deploy):** the zero-prompt endgame. |
| `scripts/promote-to-vocab.ts` + `vocabulary.json` | shipped | Precedent + target for `corrected → vocab` promotion (P2). |
| `/plan` task **905** | marked `open` — **STALE** | The loop, the `VOLUME_PROXY_PATHS` add, and the `buildAssistSystem` cache split are **all SHIPPED**. Remaining = only `route`/`selectedId` context (now P1). Mark done or re-scope + point to this plan. |

### Stale items to fix (P0 reconcile)
- **Task 905** — status `open` but its two named bugs (proxy path, cache split)
  and the `ge-assist` loop are shipped. Mark `done` (or re-title to the P1
  route/selectedId context) and point at `ai-master-plan.md`.
- **Plan headers** — `ai-function-mapping.md` and `ai-multishot-assist.md` say
  "proposed"; their Phase-1/loop work is shipped. Add a "SHIPPED / superseded by
  ai-master-plan.md" banner (done in this commit).
- **fix-errors sink** — referenced as `ai/fix-errors.jsonl` + `/api/ai/fix-errors`
  in `ai-multishot-assist.md` §H and `ai-rag-system.md`; it was never built and
  is **superseded by #27's `verdict:'error'` rows in `ai/feedback/turns.jsonl`**.
  Do not build two sinks.
- **Path refs** — several docs cite `src/lib/graph/ai/editor-tools*` and
  `src/lib/shared/ge-assist.svelte.ts`; actual shipped paths are
  `src/lib/graph/editor-tools*` and `src/lib/shared/graph-editor/ge-assist.*`
  (`.ts` pure loop + `.svelte.ts` factory). Use the actual paths going forward.
- **Tool count** — docs variously say "7 tools" / "12 tools"; actual shipped =
  **12** (`getEditorState, addParam, setParamSchema, wireArgToParam, setCallArg,
  addPolygonPoint, setPolygonCoord, addCall, removeNode, moveNode, rotateNode,
  csg`). `toJsonSchema()` is NOT yet present (lands P2).

---

## Files (pointers; NO implementation in this commit)
- Registry/dispatcher/loop (SHIPPED): `src/lib/graph/editor-tools-schema.ts`,
  `editor-tools.ts` (+`.test.ts`), `src/lib/shared/graph-editor/ge-assist.ts`
  (+`.svelte.ts`, `.test.ts`), `AiMenu.svelte`, `src/routes/api/rag/assist/+server.ts`.
- RAG (SHIPPED): `src/lib/server/{rag-corpus,rag-query,rag-prompt,rag-l1}.ts`,
  `src/routes/api/rag/{prompt,rebuild,stats}/+server.ts`, `ai/rag/parts.jsonl`.
- New (roadmap): `editor-tools-coverage.test.ts` (P0); missing-tool arms +
  `src/routes/api/ai/feedback/+server.ts` + `AiMenu` verdict UI (P1);
  `src/lib/server/ai-docs-corpus.ts` + synthetic generator + embeddings +
  `toJsonSchema()` (P2); `src/lib/graph/ai/webllm/{engine,corpus,prompt}.ts` (P3);
  fine-tune/MLC pipeline (P4, dev-only).
</content>
