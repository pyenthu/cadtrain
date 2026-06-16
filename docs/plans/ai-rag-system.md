# Plan — The CAD-editor AI assistant: RAG + multi-shot tool loop + tab context + dual backend

**Status:** architecture (umbrella plan, 2026-06-16)
**Author intent (the three requirements):**
1. A **RAG-based assistant with MULTI-SHOT prompting**, modeled on the sibling
   repo `~/code/SVTC/src/lib/ai/` (its `toolSchema.js` + `tools.js`
   `dispatchToolCall` + `chat.svelte.js` multi-step loop pattern).
2. The assistant **MUST have CONTEXT of the active tab/route** (graph-editor vs
   vocab vs fem vs forge) **and the open part's graph**, injected into the prompt.
3. An **OPTION to run a WEB-LLM fully in-browser** so data never leaves the org,
   **including building the prompt / few-shot databases locally**.

**Relationship to the other plans (read this first).** This is the *umbrella*
doc. The build detail already lives in two siblings — keep all three:

- `docs/plans/ai-function-mapping.md` — **Phase 1, partly SHIPPED**: the tool
  registry + pure dispatcher + the single-turn proxy. On `main` today:
  `src/lib/cad/editor-tools-schema.ts`, `src/lib/cad/editor-tools.ts`
  (+ `.test.ts`), `src/routes/api/rag/assist/+server.ts`.
- `docs/plans/ai-multishot-assist.md` — **Phase 1.5/2, the active build sheet**:
  the client multi-shot loop (`ge-assist.svelte.ts`), tab context (`selectedId`),
  `fix-errors.jsonl` capture, the ✨ Generate|Edit UI, Phase-2 structural tools.
- `docs/plans/rag-prompt-builder.md` — the **generate** path
  (`/api/rag/prompt` + `ai/rag/parts.jsonl` corpus + BM25), already shipped
  through Phase 2.
- `docs/research/webgpu-slm.md` + `docs/research/web-llm-functionary.md`
  (companion to this plan) — the in-browser backend.

This doc states the **whole-system architecture** so the three requirements read
as one design, names the seams that make the web-llm option a *toggle* and not a
rewrite, and gives a single phased build that supersedes the per-plan phasing
where they overlap (§F).

> Model IDs and API parameters below were verified against the `claude-api`
> skill on 2026-06-16. Re-verify before shipping — do not hardcode from memory.

---

## A. The shape: two AI surfaces, one tool/dispatch core, two inference backends

```
                         ┌──────────────────────────────────────────────┐
   USER (in a route/tab) │  EDITOR-AWARE CONTEXT  (requirement #2)        │
        │                │  buildAssistContext() →                        │
        │                │   { route, activeTab, partId, selectedId,      │
        ▼                │     graphState: readEditorState(graph,ctx),    │
  ✨ assistant            │     ragExemplars? }                            │
   popover (per pane)    └──────────────────────────────────────────────┘
        │                                   │
        ▼                                   ▼
  ┌───────────────────────── createAssistSession() (per pane) ───────────────────────┐
  │  MULTI-SHOT LOOP (requirement #1, SVTC chat.svelte.js parity):                    │
  │   messages=[user]; loop ≤ MAX_STEPS:                                              │
  │     calls = backend.nextTurn({ system, tools, messages })  ← ONE turn             │
  │     if text → STOP                                                                │
  │     for call in calls:                                                            │
  │        {graph,result,error} = dispatchEditorTool(call.name, call.input, graph,ctx)│
  │        graph = next  (live $state ⇒ auto-rebake)   error → logFixError + is_error │
  │     messages.push(assistant content verbatim, then tool_result user turn)         │
  │     re-inject readEditorState(graph) each turn                                    │
  └────────────────────────────────────────┬─────────────────────────────────────────┘
                                            │  backend = 'anthropic' | 'webllm'
                ┌───────────────────────────┴───────────────────────────┐
                ▼                                                         ▼
   ANTHROPIC BACKEND (default)                          WEB-LLM BACKEND (opt-in, offline)
   POST /api/rag/assist → one Claude call/turn          worker: @mlc-ai/web-llm + XGrammar
   native tool_use, claude-opus-4-8                     JSON-schema-constrained tool call
   (server-proxied; key stays prod-side)                NOTHING leaves the browser
                │                                                         │
                └──────────── both produce the SAME {calls|text} shape ──┘
                                            │
                                            ▼
              dispatchEditorTool(name, args, graph, ctx)   ← PURE, src/lib/cad/editor-tools.ts
              wraps the existing mutation surface in src/lib/cad/composition-graph.ts
```

The load-bearing decision: **tools are plain data and the dispatcher is pure**,
so the only thing a backend does is *produce the next tool call from
{system, tools, messages}*. Anthropic does that with native `tool_use`; web-llm
does it with constrained JSON decoding. Everything downstream (apply → rebake →
feed result back) is identical. This is exactly the seam
`docs/research/webgpu-slm.md` §3 calls out, and it already exists in the shipped
`editor-tools.ts`.

### Two AI surfaces (don't conflate them)
- **Generate** (new/empty part) — `/api/rag/prompt`: BM25-retrieve exemplars
  from `ai/rag/parts.jsonl` → ONE Claude call → a whole graph. Single-shot.
  This is the existing `rag-prompt-builder.md` flow; KEEP it for empty tabs.
- **Edit this part** (open part) — `/api/rag/assist`: the multi-shot tool loop
  above. This is the headline of requirements #1 + #2.

The ✨ popover hosts both, mode-toggled (default Edit when the graph is
non-empty, Generate when empty) — `ai-multishot-assist.md` §J owns the UI.

---

## B. Requirement #1 — RAG-based + multi-shot, modeled on SVTC

### What we borrow from `~/code/SVTC/src/lib/ai/` (verbatim structure)
| SVTC artifact | What it does | cadtrain analog (status) |
|---|---|---|
| `toolSchema.js` — `TOOLS` data + `toClaudeTools()` + `toolListText()` | pure, server-safe tool definitions; one lowering to Anthropic shape | `src/lib/cad/editor-tools-schema.ts` — SHIPPED (7 tools) |
| `tools.js` — `dispatchToolCall(name,args)` over live stores | client action dispatcher | `src/lib/cad/editor-tools.ts` — `dispatchEditorTool(name,args,graph,ctx)`, PURE Graph→Graph — SHIPPED |
| `chat.svelte.js` — `while (data.type==='tool_use')` loop (≤5), maps app msgs → Anthropic msgs | the multi-step loop + bookkeeping | NEW `src/lib/shared/ge-assist.svelte.ts` `createAssistSession()` — TODO (`ai-multishot-assist.md` §C) |
| `/api/chat/+server.js` — one Claude call, returns tool_use OR text; accepts scoped system/tools | thin per-turn proxy | `src/routes/api/rag/assist/+server.ts` — SHIPPED |
| `readAppState()` injected into the prompt | context awareness | `readEditorState(graph, ctx)` in `editor-tools.ts` — SHIPPED |
| `rag.js` — TF-IDF retrieval over IndexedDB; `buildRagContext(query)` | per-query exemplar injection | `src/lib/server/rag-query.ts` (BM25 over `parts.jsonl`) — SHIPPED for generate; reuse for edit (§D) |
| `trainingLog.js` `markUnresolved` | capture failures for a flywheel | NEW `ai/fix-errors.jsonl` + `/api/ai/fix-errors` — TODO (`ai-multishot-assist.md` §H) |
| `tasks/*.js` scoped tasks | narrow toolset + tight prompt per action | Phase 3 "scope tools by selection" (§F) |

### The multi-shot loop (the "multi shots" the user named)
SVTC caps at 5 chained calls; we cap at `MAX_STEPS = 6` to cover a realistic
edit (`addParam → wireArgToParam → addCall → addCsg → setMethodInput → confirm`).
Mechanics that MUST be correct against the Messages API (verified via
`claude-api`):
- **Client-applied loop** (recommended, SVTC parity): the browser holds the live
  `Graph`; `/api/rag/assist` is a thin per-turn proxy that returns `{calls|text}`
  but never executes (no Graph server-side). The user *sees each edit land* and
  can Stop. Server-applied is rejected for v1 (round-trips the graph, no live
  feedback, duplicates the dispatcher).
- Append the assistant `content` **array verbatim** (incl. `tool_use` and any
  `thinking` blocks) before the `tool_result` user turn — adaptive-thinking
  blocks replay verbatim. The endpoint already returns `content` raw for this.
- Multiple `tool_use` blocks per turn are legal — apply ALL, return ALL
  `tool_result`s in ONE user turn.
- Loop exit: `type:'text'` | step cap | user Stop. Step cap is a HARD stop with
  a "continue?" prompt — never trust the model to stop.
- The cap is enforced **client-side** so it holds for BOTH backends.

### Per-pane sessions, not a singleton
`createAssistSession` is a **factory** (one transcript + busy flag per pane).
SVTC could singleton because it has one chat panel; cadtrain's `/primitives`
mounts N `GraphEditorPane`s, each needs its own session and its own `graph`
getter/setter. A module singleton would cross-wire two open tabs.

### The tool surface (what the model can call)
Shipped Phase-1 (`editor-tools-schema.ts`): `getEditorState`, `addParam`,
`setParamSchema`, `wireArgToParam`, `setCallArg`, `addPolygonPoint`,
`setPolygonCoord` — covers the user's headline asks "map a node to a param" and
"add a point." Phase-2 structural tools ("add a node", "subtract a cylinder",
"repeat 6×") are enumerated in `ai-multishot-assist.md` §E and wrap the existing
pure fns in `composition-graph.ts` (`addCall` :623, `addMethodPlaceholder` :669,
`setMethodInput` :674, `addRepeatPlaceholder` :766, `removeNode` :1419, …). The
one shape the model must learn is the `ArgValue` union
(`{kind:'literal'|'expr'|'param'}`) — encoded verbosely in `ARG_VALUE_PARAM`
(SVTC's lesson: the per-param description carries the load).

**Atomic-combo tools (the SVTC `addFault` lesson).** A single tool that does a
multi-step graph mutation can't half-apply and can't burn loop steps. Add in
Phase 2b: `subtractPart(libId, parentId?)` = addCall + addCsg('subtract') +
setMethodInput; `repeatNode(node, count, op)` = wrapInRepeat + setRepeatCount +
setRepeatOp + setRepeatChild. These also raise small-model accuracy (§E), since
the model picks one tool instead of sequencing four.

---

## C. Requirement #2 — context of the active tab/route + the open graph

Three layers of context, assembled by a single `buildAssistContext()` on the
client and serialized into the system prompt by `buildAssistSystem(graphState)`
in `/api/rag/assist` (which already emits a `CURRENT EDITOR STATE` block):

### C.1 Route / tab context
- **`route`** — `'graph-editor' | 'primitives' | 'vocab' | 'fem' | 'forge'`,
  from `$page.route.id` (or `$page.url.pathname`). This is the coarse "which
  window am I in" signal the user named. It selects *which tool registry and
  system persona* the assistant gets:
  - `graph-editor` / `primitives` → `EDITOR_TOOLS` + the CAD-editor persona
    (the path built out here).
  - `vocab` → a future `VOCAB_TOOLS` registry wrapping the deterministic
    translators in `src/lib/authoring/` + the `/api/vocab/*` endpoints
    (`infer`, `bake-proposed`, `promote`). Persona: "edit the vocabulary entry."
  - `fem` → a future `FEM_TOOLS` registry over `src/lib/fem/*` formulas
    (read-only "compute / explain a stress result"); per Rule 22 FEM stays
    encapsulated, so these tools are pure-formula calls, no graph.
  - `forge` → likely no tool surface (image→3D is a single POST); the assistant
    there is Q&A only.
  This is the SVTC `tasks/`-style scoping done at the route grain: the available
  tools literally change with the window. Registries are plain-data modules
  (`src/lib/{cad,authoring,fem}/ai/*-tools-schema.ts`) so `toClaudeTools()` /
  `toJsonSchema()` lower each one for either backend.
- **`activeTab`** — within `/primitives`, the sidebar category (`basic`,
  `completions/<family>`, …) from `primitives/+page.svelte`'s `activeTab`
  state. Cheap orienting signal ("the part lives under completions").
- **`partId`** — the active pane's id. In `/graph-editor` it's the `?id=` param;
  in `/primitives` it's the active pane's `Tab.id`. Because the loop runs *in
  the pane*, "the tab being used" is automatic — each pane has its own session
  and its own `graph`; no cross-pane plumbing.

### C.2 The open part's graph (the substance)
`readEditorState(graph, ctx)` (shipped) returns
`{ partId, root, params:[{name,schema}], nodes:[{id,alias,type,src}], selectedId, activeTab }`.
This is injected as `CURRENT EDITOR STATE` every turn (re-injected after each
applied tool so the model sees ids/aliases created mid-loop). It deliberately
lists ids + aliases + types but NOT every arg — the model calls `describeNode`
(Phase 2) on demand. For big graphs this keeps the per-turn prompt bounded.

### C.3 `selectedId` — THE GAP (what makes "this node" work)
`EditorContext.selectedId` exists in the type but **nothing populates it today**.
Add `let aiSelectedId = $state<NodeId|null>(null)` in `GraphEditorPane`, set it
in the existing node-click / card-open path, and feed it into `getCtx()`. One
new `$state` + one assignment. Then "add a point to THIS polygon" / "wire THIS
node" work without the user quoting an `n_xxxxxx` id. Add one system-prompt line:
*"When the user says 'this'/'here'/'the selected one', they mean `selectedId`."*

### C.4 RAG-then-tools for the edit path
For *edit*, the live editor state IS the retrieval context, so turn-1 BM25 is
usually unnecessary. OPTIONAL enhancement (behind a flag, land core loop first):
when the instruction names a *concept absent from the open part* ("make it like
a no-go nipple"), do a one-shot `topK(prompt, 3)` over `parts.jsonl` and inject
the exemplar graph(s) as reference text into the first user turn — same corpus
the generate path uses. This is the "RAG-based" half of requirement #1 applied
to editing.

---

## D. The Anthropic backend (default) — model, loop, cost, caching

`/api/rag/assist` is the per-turn proxy. Verified API facts (claude-api skill):

- **Model:** `RAG_ASSIST_MODEL || 'claude-opus-4-8'` (already the endpoint
  default). Opus 4.8 — 1M context, $5/$25 per MTok, best tool selection.
  Decoupled from `RAG_MODEL` (the cheaper single-shot *generate* model,
  `claude-sonnet-4-6`). A cost-sensitive deploy can set
  `RAG_ASSIST_MODEL=claude-sonnet-4-6` (also 1M, $3/$15) or
  `claude-haiku-4-5` ($1/$5, 200K) — SVTC shipped tool use on Haiku and it was
  fine for flat-file ops; graph editing wants a stronger default.
- **Thinking:** `thinking: {type:'adaptive'}` (already set). On Opus 4.8 do NOT
  send `budget_tokens` or `temperature`/`top_p`/`top_k` — all 400. Optionally
  `output_config:{effort:'high'}` (default high; the loop is the place where
  fewer/consolidated tool calls help, so `medium` is a reasonable cost knob).
- **Tools:** `tools: toClaudeTools()`, `tool_choice: {type:'auto'}` (set).
- **Replay:** append assistant `content` verbatim (set — endpoint returns it
  raw). With Opus 4.8, `display:'omitted'` is the default; that's fine here
  (we don't surface thinking text), but the blocks still replay correctly.
- **Prompt caching (a real win on a 6-turn loop):** render order is
  `tools → system → messages`. The tools array + the *static* prefix of the
  system prompt are byte-identical every turn → put one
  `cache_control:{type:'ephemeral'}` breakpoint on the last static system block,
  and keep the **volatile `CURRENT EDITOR STATE` after it** (it changes each
  turn, so it must sit past the breakpoint or it invalidates the cache). Verify
  with `usage.cache_read_input_tokens > 0`. Note Opus 4.8's min cacheable prefix
  is ~4096 tokens — the tools+persona prefix must clear that or it silently
  won't cache. Today `buildAssistSystem` interpolates `graphState` *into* the
  prompt body — **split it** so the stable persona+tools come first and the
  state block comes last, or caching never fires.
- **Proxy + key:** add `/api/rag/assist` to `VOLUME_PROXY_PATHS` in
  `src/hooks.server.ts` so local dev hits the prod key (Rule 13). It currently
  calls `createAnthropicClient()` directly, which only works where
  `ANTHROPIC_API_KEY` is set (prod). Until then, local dev can't run the edit
  loop. (`/api/primitives/refine` deliberately stays LOCAL — it uses the local
  key and never proxies; `/assist` is the opposite, like `/api/rag/prompt`.)

### Dual backend within the Anthropic side (API vs CLI subprocess)
cadtrain already has the `anthropic-api.ts` (SDK + `ANTHROPIC_API_KEY`, per-token
billed) vs `claude-cli.ts` (`claude --print` subprocess, bills Pro/Max OAuth,
local-only, ~5–7× slower) split — `/api/primitives/refine` uses it. The assist
loop should default to the **API backend** (predictable, works on Railway). A
CLI toggle is possible but the loop is multi-turn (≤6 spawns/edit) and the CLI
has no native `tool_use` envelope, so it would need the WebLLM-style two-pass
text-parse. **Defer the CLI variant**; the in-browser web-llm backend (§E) is
the better "zero-API-cost / private" answer and is the user's actual ask.

---

## E. Requirement #3 — the web-llm in-browser backend (option, default OFF)

Full feasibility, model candidates, XGrammar, functionary, and the local
prompt-DB build are in the companion `docs/research/web-llm-functionary.md`.
Architecture-level summary of how it slots in *here*:

- **It's a backend toggle, not a rewrite.** Add `backend: 'anthropic' | 'webllm'`
  to `createAssistSession` (default `'anthropic'`). The `webllm` branch replaces
  the `POST /api/rag/assist` with a local
  `worker.nextTurn({ system, tools: toJsonSchema(), messages })` and feeds the
  returned JSON straight into the *same* `dispatchEditorTool`. The loop, the cap,
  the tab context, and the fix-errors capture are all unchanged.
- **Constrained decoding is the enabler.** web-llm (MLC) + XGrammar can
  *guarantee* schema-valid JSON. Add a `toJsonSchema()` sibling to
  `toClaudeTools()` in `editor-tools-schema.ts` (same `EDITOR_TOOLS` source,
  second lowering) and pass it as web-llm `response_format`. Shape is then
  free; only tool/arg *choice* is left to the model.
- **Everything stays local, including the prompt/few-shot DB.** The corpus and
  few-shot examples are built **in the browser** from the same on-volume parts
  (or a bundled snapshot) using a TF-IDF index in IndexedDB — SVTC's `rag.js`
  exact pattern (`ingestChunks`/`retrieve`/`buildRagContext`, no embedding API,
  no server). The system prompt (persona + `toolListText()` + few-shots +
  retrieved context + `CURRENT EDITOR STATE`) is assembled client-side. So in
  `webllm` mode **no graph, no instruction, and no corpus ever leaves the
  browser** — the privacy requirement is met by construction.
- **Scope to win.** A 0.5–1.5B model is weak at choosing among ~25 tools and at
  the `param`-vs-`literal` choice. Gate the web-llm backend to the **route- and
  selection-scoped** toolset (C.1 + Phase 3): when a polygon is selected, ship
  only the 3–4 point/coord tools. Hand multi-step / whole-graph work back to
  Anthropic. Web-llm handles the high-frequency single-tool micro-edits offline.
- **Isolation.** Lazy-load web-llm in a **Web Worker**, never on the bake/render
  thread (cf. the GLB-bake-blocked-mesh-thread incident), feature-detect WebGPU,
  and fall back to Anthropic when absent. Never ship it in the default bundle.
- **Gate / decision.** Conditional-GO per `webgpu-slm.md`: ship as opt-in
  "offline edits (beta)" only if a bench clears ≥90% tool + ≥85% arg accuracy on
  a scoped, canned set. Otherwise shelve as a documented finding; the Anthropic
  path is unaffected because the seam is the same.

---

## F. The unified phased build (supersedes per-plan phasing where they overlap)

Each step: `bun run build` + `bun test` (incl. `editor-tools.test.ts`) green
before commit (Rule 8); recorded e2e for UI steps (Rules 12, 23). Restart
`bun run dev` cleanly after server/large-component edits (NOT the in-app restart
button — it wedges; memories `feedback_build_restart_after_significant_change`,
`source_404_flood_2026-06-13`).

- **Phase 0 — DONE (on `main`).** Tool registry + pure dispatcher + single-turn
  proxy: `editor-tools-schema.ts`, `editor-tools.ts` (+test),
  `/api/rag/assist`. (= `ai-function-mapping.md` Phase 1.)
- **Phase 1 — make the edit loop real (the visible feature).** Build
  `ge-assist.svelte.ts` `createAssistSession` (per-pane factory, client loop,
  ≤6 steps, Stop). Add `/api/rag/assist` to `VOLUME_PROXY_PATHS` + split
  `buildAssistSystem` for prompt-cache. Wire the ✨ Generate|Edit toggle +
  transcript. e2e: "wire r to OD", "add a point at r=2 z=0", "make the wall 0.3".
  (= `ai-multishot-assist.md` Steps 2,3,5.)
- **Phase 2 — tab/graph context (requirement #2).** Populate `selectedId`
  (`aiSelectedId` $state + node-click set) + the `selectedId` system-prompt line.
  Add `route`/`activeTab` to `buildAssistContext()`. (= `ai-multishot-assist.md`
  Step 4 + this doc §C.)
- **Phase 3 — structural + atomic tools.** Phase-2 tools from
  `ai-multishot-assist.md` §E in batches (describeNode/addCall/removeNode → CSG +
  transforms → repeat/sketch/part-props → atomic combos `subtractPart`,
  `repeatNode`).
- **Phase 4 — fix-errors flywheel.** `ai/fix-errors.jsonl` + `/api/ai/fix-errors`
  (append-only, in `VOLUME_PROXY_PATHS`) + `logFixError` in the loop. (=
  `ai-multishot-assist.md` §H.)
- **Phase 5 — route-scoped tool registries (requirement #2, breadth).** Per-route
  `*-tools-schema.ts` for `vocab` (and read-only `fem`); the ✨ persona + tools
  change with `route`. Selection-scoped toolsets (the SVTC `tasks/` grain).
- **Phase 6 — RAG-into-edit (optional).** Turn-1 `topK` injection for concept
  instructions absent from the open part (§C.4), behind a flag.
- **Phase 7 — web-llm backend (requirement #3, conditional).** `toJsonSchema()`,
  the Web Worker, the local TF-IDF corpus build, the `backend` toggle,
  WebGPU feature-detect + fallback. Bench → decision gate. See
  `docs/research/web-llm-functionary.md`.

---

## G. Files

**New:**
- `src/lib/shared/ge-assist.svelte.ts` (+ `.test.ts`) — the multi-shot session loop.
- `src/routes/api/ai/fix-errors/+server.ts` — JSONL appender (Rule-13 plumbing).
- `src/lib/cad/ai/webllm/` (Phase 7) — `engine.ts` (worker + MLC init),
  `corpus.ts` (IndexedDB TF-IDF, SVTC `rag.js` port), `prompt.ts`
  (local system-prompt + few-shot assembly).
- `src/lib/{authoring,fem}/ai/*-tools-schema.ts` (Phase 5) — route registries.

**Edit:**
- `src/lib/cad/editor-tools-schema.ts` — Phase-2/atomic tools; add `toJsonSchema()`.
- `src/lib/cad/editor-tools.ts` (+ `.test.ts`) — Phase-2/atomic dispatch arms.
- `src/lib/shared/GraphEditorPane.svelte` — `aiSelectedId`, the ✨ Generate|Edit
  popover + transcript + Stop, host `createAssistSession`, `backend` toggle.
- `src/routes/primitives/+page.svelte` — pass `route`/`activeTab`/`partId` into `getCtx()`.
- `src/routes/api/rag/assist/+server.ts` — split system for prompt-cache; one
  `selectedId` line; `cache_control` breakpoint.
- `src/hooks.server.ts` — `VOLUME_PROXY_PATHS += '/api/rag/assist', '/api/ai/fix-errors'`.
- `src/routes/api/CLAUDE.md`, `docs/HISTORY.md`, `/plan` — register/record on ship.

**Reused unchanged:** `composition-graph.ts` (mutation surface),
`composition-bake.ts` (auto-bake on `graph=`), `anthropic-api.ts`,
`rag-query.ts`/`rag-prompt.ts` (generate + optional edit-RAG), `volume.ts`.

---

## H. Risks / watch-items

- **`ArgValue` literacy** — model must emit `{kind:'literal'|'expr'|'param'}`.
  Mitigated by verbose per-param descriptions + 1–2 worked examples; *worse* on a
  small model (§E) → constrained decoding + scoping.
- **alias vs nodeId** — `getEditorState` lists `{id,alias,type}`; dispatcher
  resolves alias→id; `selectedId` removes most guessing.
- **Bake storm** — 6 `graph=` reassignments → 6 bakes. Debounce the bake
  `$effect` while `assist.busy`, or use `⚡draft` coarse bake during the loop +
  one full bake on completion. Measure first (small parts bake fast).
- **Prompt-cache invalidation** — if `CURRENT EDITOR STATE` sits before the
  `cache_control` breakpoint, every turn is a cold write. Split the system prompt
  (§D) and verify `cache_read_input_tokens`.
- **Loop never terminates** — always honor the hard step cap + Stop for BOTH
  backends.
- **Per-pane sessions** — `createAssistSession` is a FACTORY; a singleton
  cross-wires open tabs.
- **Volume safety** — the loop mutates only the in-memory `$state` graph; nothing
  saves until the user hits Save (same stance as generate). An isolated-worktree
  subagent still writes the prod volume (memory
  `subagent_shared_volume_2026-06-14`) — test against a seeded local volume.
- **Web-llm download/VRAM** — ~1–1.5 GB first load, real GPU memory; opt-in only,
  device-gated, never default-on. Maintenance: a second inference path = a second
  prompt to keep in sync (mitigated by sharing `EDITOR_TOOLS` + `dispatchEditorTool`).
- **Model IDs drift** — re-verify against the `claude-api` skill before shipping;
  never hardcode dated suffixes.
