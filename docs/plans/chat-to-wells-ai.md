<!-- research-group: Local AI -->
<!-- research-date: 2026-07-13 -->
<!-- research-priority: 2 -->

# Plan — chat→wells AI (foundation)

**Vision.** A chat interface where a user prompts and the system **creates/edits
wells**, powered by the user's **own locally-trained model** (prompt → WSON /
composition-graph). We build the **foundation**, not the whole thing: a
retrieval-grounded, tool-calling assistant that mutates the WSON model, and — the
core of this plan — an **interaction / correction / training register** that
turns every use into supervised data for the eventual local fine-tune.

Reconnaissance + gap analysis: **`docs/research/svtc-ai-system-deep-dive.md`**.
This plan is the design (Part 3) + the phased roadmap (Part 4-forward).

**Binding constraints** (from the deep-dive, honoured here):
- **Local-first AI** (memory `ai_data_residency_local_first`): runtime AI must be
  LOCAL/in-browser; cloud Claude is dev/authoring only. The local path is
  `webllm` (memory `todo_webgpu_slm`). The training register is a **dev/authoring
  artefact** — its job is to feed the local model, closing the prompt→LLM leak.
- **Durable stores on the volume, atomic writes, never clobber** (root CLAUDE.md
  Rule 4/13). The register is one more `ai/*.jsonl` next to `ai/rag/parts.jsonl`.
  Persisting endpoints MUST `volumePath(rel)` + `maybeProxy` first; a subagent
  verifies only against a temp dir / local `.dev-volume`, never prod.

---

## Part 3 — The training / interaction register (design)

SVTC's `trainingLog.js` captures flat `{instruction, output}` pairs +
`markUnresolved` flags. We **generalise past that** to capture, as supervised
data: chat pairs, **wrong-response corrections**, **well-EDIT tuples**, and
**full-well snapshots** — each with provenance. The implementation of this
section lands in `src/lib/server/training-log.ts` (shipped with this plan; see
Phase 1).

### 3.1 Record schemas (TypeScript)

Discriminated union on `kind` (matching cadtrain's `RagRecord.kind`
convention). Common base carries provenance for eval slicing:

```ts
interface BaseRecord {
  id: string;            // stamped on write (sortable, collision-resistant)
  kind: 'wrongResponse' | 'wellEdit' | 'wellSnapshot';
  ts: string;            // ISO-8601, stamped on write
  session?: string;      // groups a multi-turn chat / edit session
  wellId?: string;       // file id or well name (provenance)
  model?: string;        // model that produced the response/edit (provenance)
}
```

**(1) `wrongResponse`** — SVTC's "needs work" register, plus an explicit
user **correction** (SVTC only flags; it has no expected-output field):

```ts
interface WrongResponseRecord extends BaseRecord {
  kind: 'wrongResponse';
  instruction: string;                    // the user prompt
  output: string;                         // the wrong model output (text or tool JSON)
  correction?: string;                    // user-supplied expected output (NEW vs SVTC)
  note?: string;                          // free text from the 🔧 button
  source: string;                         // 'user'|'tool-error'|'api-error'|'create-intent-miss'|…
  toolName?: string | null;               // when a tool failed
  context?: { role: string; content: string }[] | null;  // up to 3 prior turns
}
```

**(2) `wellEdit`** — the prompt→well-EDIT tuple. Recorded **whenever a user
enhances/modifies a well** (the explicit ask). `diff` is the compact edit;
`before`/`after` are the full WSON anchors so a job can reconstruct *either* the
patch *or* the pair:

```ts
interface WellDiffOp { op: 'add'|'remove'|'replace'; path: string; before?: unknown; after?: unknown }

interface WellEditRecord extends BaseRecord {
  kind: 'wellEdit';
  instruction: string;                    // '' for a purely manual edit (still valuable)
  before: WellJson;                       // WSON before
  after: WellJson;                        // WSON after
  diff: WellDiffOp[];                     // structural diff before→after
  summary: string;                        // one-line human summary of the diff
  origin: string;                         // 'chat'|'manual'|'tool'
}
```

**(3) `wellSnapshot`** — full-well capture + provenance. The prompt→well
(generation) supervision signal, and the anchor a `wellEdit` diff is relative to:

```ts
interface WellSnapshotRecord extends BaseRecord {
  kind: 'wellSnapshot';
  wson: WellJson;
  label?: string;                         // 'baseline'|'post-generate'|archetype name
  origin?: string;                        // 'generate'|'load'|'checkpoint'
  instruction?: string;                   // the prompt, when AI-generated
}
```

### 3.2 The diff representation — why WSON, not the composition-graph

`before`/`after` are the **WSON authored model**, and `diff` is a **structural
JSON diff** over it — NOT the derived composition-graph. Justification:

- **WSON is the layer the user edits.** The composition-graph is *regenerated*
  from WSON by `wson-to-graph.ts`; a graph diff would be a diff of a derived
  artefact, one step removed from the user's intent.
- **Kernel-version independence.** The graph encodes engine choices (`r_revolve`
  segments, `bw_*` wiring). Diffing it couples training data to the geometry
  pipeline version; a re-emit changes the graph without the user changing
  anything. WSON is stable across pipeline changes.
- **Compact + human-readable + reversible.** A WSON doc is small plain JSON; a
  field-level diff (`/ch/2/bot 1070→1200`, `+/completions/4`) reads directly and
  inverts trivially.
- **The training target we actually want** is prompt→WSON-edit (the model should
  emit a WSON patch / tool calls), not prompt→graph.

The diff is **element-wise for WSON arrays** (`ch`/`oh`/`completions`/
`perforations`/`cementing`/`profile`) and **field-wise for objects** (`meta`, an
element row, `meta.location`), so an appended completion reads as one
`add /completions/N` and a depth tweak as one `replace /ch/2/bot`. Paths are
JSON-pointer (RFC 6901). Implemented as `diffWell(before, after)` +
`summarizeWellDiff(ops)` in `training-log.ts` (pure, headless-tested).

**Capture seam (no new engine needed).** `well-edit-core.ts` already does
snapshot undo and fires `onChange(info)` after every mutation. A client edit hook
snapshots `store.doc` before an AI/manual edit and, on `onChange`, builds a
`wellEdit` record from (before, after) via `buildWellEditRecord(...)` and POSTs
it. Manual edits get `origin:'manual'`, chat tool-calls get `origin:'chat'` +
the driving `instruction`.

### 3.3 On-volume layout

Mirrors the existing `ai/rag/parts.jsonl` convention — the whole `ai/` subtree is
one family of newline-delimited stores under `$APP_DATA_DIR`:

```
<volume>/ai/
├── rag/parts.jsonl          # EXISTING — the parts RAG corpus (rag-corpus.ts)
├── training-log.jsonl       # NEW  — the interaction/correction register (this plan)
│                            #        one TrainingRecord per line (wrongResponse|wellEdit|wellSnapshot)
├── fix-errors.jsonl         # EXISTING — ge-assist graph-tool dispatch errors (subsumable later)
└── (future) chat-corpus.jsonl  # optional cached chat corpus (parts+wells+vocab), Phase 2
```

- **Append-only JSONL**, `fs.appendFile` (O_APPEND) — the atomic append for a
  log; prior records are never rewritten (Rule 4 "never clobber"). This
  intentionally differs from `rag-corpus.ts`'s temp-file+rename, which is right
  for a *regenerable* corpus but wrong for an append-only log. `listRecords`
  tolerates a torn trailing line (skips unparseable), so a crash mid-append costs
  at most the in-flight record.
- **Runtime capture stays local-first.** In production the browser buffers
  records (IndexedDB, like SVTC) and flushes on an explicit, user-consented sync;
  `training-log.ts` is the **server sink** that flush targets. No well/prompt data
  leaves the browser without consent.

### 3.4 How a later training job consumes it

```
BUILD TIME (offline, dev machine — memory ai_data_residency_local_first):
  training-log.jsonl
    ├─ wellEdit     → prompt→WSON-EDIT pairs:  x = { instruction, before },
    │                  y = diff (or after).  The primary edit-model signal.
    ├─ wellSnapshot → prompt→WSON pairs:       x = instruction, y = wson.
    │                  The generation signal (+ archetype seeds).
    └─ wrongResponse→ preference / negative set:
                       positives = captured good turns;  NEGATIVES = these.
                       Subtract flagged pairs from positives before SFT (SVTC's
                       captured.jsonl − unresolved.jsonl), or use as DPO pairs
                       (output = rejected, correction = chosen).

  → SFT / LoRA a local model (web-llm target; Phi-3.5-mini or a WSON-tuned
    successor) → GGUF → MLC weights → swap MODEL_ID.  The fine-tune bakes in the
    WSON schema + tool grammar so the runtime prompt shrinks.
```

Consumers are pure over the JSONL: `listRecords({ kind })` yields each stream;
`diff`/`before`/`after` give the job freedom to train patch-prediction or
full-state prediction. `session` + `wellId` + `model` allow held-out eval slices.

---

## Roadmap (phased; each phase headless-testable)

Ordered register → RAG-for-chat → tool-calling mutations → webllm → training
loop. Phases 1–2 ship with this plan (code + vitest); 3–5 are scoped.

### Phase 1 — the register (SHIPPED with this plan)
- `src/lib/server/training-log.ts` — the 3 record types, `appendRecord` (atomic
  JSONL append via `volumePath('ai/training-log.jsonl')` + `filePath` override
  for tests), `listRecords`/`countRecords`, pure `diffWell` + `summarizeWellDiff`
  + `buildWellEditRecord`.
- **Acceptance (headless):** `training-log.test.ts` — append/list roundtrip
  against a temp dir; `diffWell` on before/after pairs (scalar change, appended
  element, removal, multi-edit); torn-line tolerance; never-clobber over 25
  appends. `bun run test` green.

### Phase 2 — RAG-for-chat (SHIPPED with this plan)
- `src/lib/server/rag-chat.ts` — a **thin adapter** that REUSES `rag-query.ts`'s
  `bm25`/`tokenize` over a heterogeneous corpus (`bw_*`/`g_*` parts +
  `.wson` samples + `vocabulary.json`): `retrieveForChat(query, records, k)`,
  `renderChatContext`, extractors (`wsonToChatRecords`, `vocabToChatRecords`,
  `ragRecordToChatRecord`), `buildChatCorpus` (merges the on-volume parts corpus
  with supplied samples/vocab).
- **Acceptance (headless):** `rag-chat.test.ts` — ranking on a fixture (a packer
  query surfaces `bw_packer`/`vocab:packer` above casing; a casing query ranks
  `bw_casing` top; zero-score → []; k + descending scores; empty-query order);
  extractor coverage. `bun run test` green.
- **Follow-up (not in this plan):** a `POST /api/ai/chat-context` endpoint (thin,
  prod-proxied, `volumePath`+`maybeProxy`) that calls `buildChatCorpus` +
  `retrieveForChat` and returns the top-k + `renderChatContext`. Endpoint added
  separately so this plan touches no route/proxy surface.

### Phase 3 — tool-calling well mutations
- `dispatchWellTool(name, input, store)` — a PURE dispatcher over the existing
  `WellEditCore` surface (`addString`/`addCompletion`/`updateStation`/
  `addElement`/…), mirroring `dispatchEditorTool`. A `well-tools-schema.ts`
  (pure data → `toClaudeTools()` + `toolListText()`), reusing
  `well-edit-intent.ts`'s category→`tool_comp` map.
- A `runWellAssistLoop` modelled on `ge-assist.runAssistLoop` (thin proxy +
  client-applied, hard-capped, Stop-able), pointed at a new `/api/ai/well-assist`
  proxy (same shape as `/api/rag/assist`).
- **On every applied edit, emit a `wellEdit` record** via `buildWellEditRecord`
  (the Phase-1 seam) → the corpus grows from real use.
- **Acceptance (headless):** a `well-tools.test.ts` drives `dispatchWellTool`
  against a `WellEditCore` with a stubbed post-turn, asserts the WSON mutates +
  a `wellEdit` tuple is produced with the right diff. No browser, no LLM.

### Phase 4 — webllm local model
- Port SVTC `webllm/` (`engine.js`/`prompt.js`/`parse.js`/`chat.svelte.js`) as
  the local backend behind the existing 💻/☁ toggle, upgrading regex tool-parse
  to **grammar-constrained decoding** (web-llm + XGrammar, per
  `docs/plans/webgpu-slm.md`) for reliable WSON/tool JSON. Same
  `dispatchWellTool` + same register capture.
- **Acceptance:** headless build-green + a pure prompt-assembly test
  (`buildWellSystemPrompt` includes retrieved context + tool list); the WebGPU
  path itself is browser-verified (can't run headless — flagged, not auto-run).

### Phase 5 — the training loop
- A dev-only harvest script (`scripts/`) that reads `training-log.jsonl` →
  emits `train.jsonl` (wellEdit + wellSnapshot pairs, minus flagged
  wrongResponse) for an offline MLX LoRA run; a small `/api/ai/log` sink for the
  browser flush. A "needs work" 🔧 affordance + correction box in the chat UI →
  `wrongResponse` records.
- **Acceptance (headless):** a `harvest.test.ts` over a fixture log asserts the
  emitted `train.jsonl` shape + the flagged-subtraction. UI is browser-verified.

---

## Open questions (for the coordinator)

1. **Capture volume + PII.** Well data is user IP. Confirm the runtime stance:
   local IndexedDB buffer + **explicit user-consented** flush to the volume
   (recommended), vs. auto-flush like SVTC. Never auto-egress well geometry.
2. **`fix-errors.jsonl` convergence.** Should `ge-assist`'s existing
   `logFixError` fold into `training-log.jsonl` as `wrongResponse
   source:'tool-error'`? (Recommended — one register.)
3. **Endpoint + proxy.** The Phase-2/3 endpoints must be added to
   `VOLUME_PROXY_PATHS` (prod holds the volume + `ANTHROPIC_API_KEY`). Out of
   this plan's scope deliberately (no route touched here).
4. **Graph vs WSON edit signal.** This plan trains prompt→WSON-edit. If we later
   want prompt→graph directly, add a parallel `graphEdit` record kind rather than
   switching the well diff off WSON.
5. **/research categorisation.** `docs.ts` `canonicalCategory` buckets by regex
   over slug+marker and checks **Wells before Local AI**, so the "svtc" token in
   `svtc-ai-system-deep-dive` routes that doc to **Wells** despite its
   `research-group: Local AI` marker. If it should show under **Local AI**,
   honour an exact marker as an override in `canonicalCategory` (1-line change) —
   left undone here (out of scope; no source edit).
