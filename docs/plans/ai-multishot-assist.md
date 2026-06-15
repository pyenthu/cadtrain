# Plan — Multi-shot in-context AI assist (tool loop + tab context + fix-errors.jsonl)

**Status:** proposed (Phase 1.5 / 2 wiring, 2026-06-15)
**Supersedes the open half of** `docs/plans/ai-function-mapping.md` (which built
Phase 1: the tool registry + dispatcher + the single-turn `/api/rag/assist`
proxy). This plan is the *client loop + tab context + error-capture* wiring that
ai-function-mapping.md described but did not implement. See §G for the exact
diff of "covered vs. added."

**TODO.md intent (verbatim):**
1. "A RAG based AI system with multi shots. Like we have in SVTC."
2. "The AI system should have context of the tab being used."
Plus the carried-over ask: capture AI/tool errors to `ai/fix-errors.jsonl` on the
volume so the system can self-repair later.

**The win:** the ✨ assistant EDITS the currently-open part by calling editor
tools in a multi-shot loop (call tool → apply to the live `$state` graph →
feed the result back → repeat until done), instead of regenerating a whole
graph. Modeled on SVTC's `~/code/SVTC/src/lib/ai/` (`toolSchema.js` +
`tools.js` `dispatchToolCall` + `chat.svelte.js` loop).

---

## A. What already exists on main (build ON this — do not redesign)

Verified 2026-06-15 (line numbers drift — re-grep before editing):

| File | Status | Role |
|---|---|---|
| `src/lib/cad/editor-tools-schema.ts` | DONE | `EDITOR_TOOLS: ToolDef[]` (7 tools), `toClaudeTools()` (→ Anthropic tool format), `toolListText()`. Header mirrors SVTC `toolSchema.js`. PURE data — server- AND browser-safe. |
| `src/lib/cad/editor-tools.ts` | DONE | `dispatchEditorTool(name, args, graph, ctx?) → { graph, result?, error? }` (PURE, Graph→Graph), `readEditorState(graph, ctx)`, `EditorContext = { selectedId?, activeTab?, partId? }`. Alias→id resolution + ArgValue coercion + try/catch → `error` string. |
| `src/lib/cad/editor-tools.test.ts` | DONE | 9 pure-fn tests for the dispatcher. |
| `src/routes/api/rag/assist/+server.ts` | DONE | ONE model turn. Body `{ prompt?, graphState?, messages?, model? }`. Returns `{type:'tool_use', calls:[{id,name,input}], content, stopReason}` OR `{type:'text', text, content, stopReason}`. Does NOT execute tools (no Graph server-side). Model `RAG_ASSIST_MODEL || claude-opus-4-8`, adaptive thinking, `tool_choice:auto`, `max_tokens 4096`. Designed for a CLIENT-driven loop. |

The 7 Phase-1 tools: `getEditorState`, `addParam`, `setParamSchema`,
`wireArgToParam`, `setCallArg`, `addPolygonPoint`, `setPolygonCoord`.

`/api/rag/assist` is NOT yet in `VOLUME_PROXY_PATHS` — it must be added so the
Anthropic key stays prod-side (it currently calls `createAnthropicClient()`
directly, which only works where `ANTHROPIC_API_KEY` is set). See §E.4.

What's still MISSING (this plan): (1) the client loop in the editor, (2) tab
context wiring, (3) `fix-errors.jsonl` capture, (4) the ✨ UI host for both
generate AND edit modes.

---

## B. Data flow — the client-driven multi-shot loop

```
USER types instruction in ✨ "Edit this part" mode (active pane)
   │
   ▼
buildGraphState()  ── readEditorState(graph, ctx)  where ctx = {
   │                     partId:    pane.partId,
   │                     activeTab: primitives.activeKey (the tab being used),
   │                     selectedId: pane.aiSelectedId   ← NEW (§D)
   │                  }
   ▼
messages = [{ role:'user', content: prompt }]
   │
   ▼  ┌───────────────────────── loop (≤ MAX_STEPS, default 6) ─────────────┐
   │  │  POST /api/rag/assist  { graphState, messages, model? }             │
   │  │     → ONE Claude call (opus, tools=toClaudeTools(), adaptive think) │
   │  │     → { type, calls?, text?, content, stopReason }                  │
   │  │                                                                     │
   │  │  if type === 'text':  show text, STOP (done / no tool fits)         │
   │  │                                                                     │
   │  │  messages.push({ role:'assistant', content })   ← VERBATIM (incl    │
   │  │                                       tool_use + thinking blocks)   │
   │  │  toolResults = []                                                   │
   │  │  for each call in calls:                                            │
   │  │     const { graph: next, result, error } =                         │
   │  │         dispatchEditorTool(call.name, call.input, graph, ctx)       │
   │  │     graph = next            ← LIVE reactive $state ⇒ auto re-bake   │
   │  │     if error:                                                       │
   │  │         logFixError({ tool, input, error, ... })  (fire-and-forget) │
   │  │         toolResults.push({ type:'tool_result', tool_use_id:call.id, │
   │  │                            content: error, is_error: true })        │
   │  │     else:                                                           │
   │  │         toolResults.push({ type:'tool_result', tool_use_id:call.id, │
   │  │                            content: JSON.stringify(result) })       │
   │  │     transcript.push(step)   ← UI step view                          │
   │  │  messages.push({ role:'user', content: toolResults })              │
   │  └─────────────────────────────────────────────────────────────────────┘
   │  (also: regraph state each turn — re-inject readEditorState(graph,ctx)
   │   so the model sees ids/aliases created mid-loop)
   ▼
Loop exits on: type:'text' | step cap | user "Stop" | dispatch throw.
Volume is UNTOUCHED — only the in-memory $state graph changed; user hits Save
(existing flow) to persist. Same stance as the generate flow.
```

Two notes that make this correct against the Anthropic API:
- The assistant `content` array MUST be appended verbatim before the
  `tool_result` user turn (adaptive thinking blocks replay verbatim — the
  endpoint already returns `content` raw for exactly this reason; its header
  documents it).
- Multiple `tool_use` blocks per turn are legal — apply ALL, return ALL
  `tool_result`s in ONE user turn (the loop above does this).
- Re-baking: the pane already re-bakes on `graph =` assignment (every existing
  `drop*`/`wire*` handler reassigns `graph` and the bake `$effect` fires). The
  loop reassigns `graph` per applied call, so bake fires per step. See §F.3 for
  the debounce/draft-bake mitigation so a 6-step edit doesn't bake 6×.

---

## C. Where the loop LIVES — a new `.svelte.ts` module, not the monolith

`GraphEditorPane.svelte` is ~9500 lines (K.65 modularization debt,
`docs/plans/modularize.md` + memory `todo_modularize_grapheditorpane`). Do NOT
grow it. Extract the loop into a runes-aware module:

**NEW `src/lib/shared/ge-assist.svelte.ts`** — mirrors SVTC `chat.svelte.js`.

```ts
// A factory, not a singleton — /primitives mounts N panes, each needs its own
// transcript + busy flag. (SVTC could use a module-level singleton because it
// has ONE chat panel; cadtrain has one assist session PER PANE.)
export function createAssistSession(opts: {
  getGraph: () => Graph;
  setGraph: (g: Graph) => void;      // assigns the pane's reactive `graph` $state
  getCtx:   () => EditorContext;      // { partId, activeTab, selectedId }
  logFixError: (rec: FixErrorInput) => void;
}) {
  let busy   = $state(false);
  let error  = $state<string | null>(null);
  let steps  = $state<AssistStep[]>([]);   // transcript for the UI
  let stop   = $state(false);
  const MAX_STEPS = 6;

  async function run(prompt: string) { /* the loop in §B */ }
  function requestStop() { stop = true; }
  function reset() { steps = []; error = null; }
  return { get busy(){return busy}, get error(){return error},
           get steps(){return steps}, run, requestStop, reset };
}
```

- PURE of DOM; only touches the pane's graph via the injected getters/setters.
- `dispatchEditorTool` is already pure + already imported-safe → the module
  just imports it + `readEditorState` from `$lib/cad/editor-tools`.
- The pane owns one `const assist = createAssistSession({...})` and binds its
  popover to `assist.busy / assist.steps / assist.run / assist.requestStop`.
- This keeps the editor-tools loop unit-testable WITHOUT a browser: a test can
  call `createAssistSession` with plain closures over a local `graph` variable
  and a stubbed `fetch`, and assert the graph after a scripted tool sequence.

Rationale for client-applied (vs. server-applied), reaffirming
ai-function-mapping.md §C: the browser holds the live `Graph`; the user SEES
each edit land and can Stop mid-loop; no graph round-trips; no second copy of
the dispatcher on the server. Server-applied is only worth it for headless
batch edits — deferred.

---

## D. Tab context (TODO item 2) — "context of the tab being used"

Three context fields feed `readEditorState(graph, ctx)`; the graph already
carries params + nodes. The gaps:

1. **`activeTab` / `partId`.** `/primitives` (`src/routes/primitives/+page.svelte`)
   tracks the active *pane* via `activeKey` (the `Tab.key`); each `Tab` has
   `{ id, key, createDir?, seedGraph? }`. The active pane's `id` IS the partId.
   `activeTab` (the sidebar folder, `activeTab` state var, e.g. `basic`) is the
   category. Feed `partId = activeTab-pane.id`, `activeTab = sidebar activeTab`.
   In `/graph-editor` (single full-screen pane) there's one pane → partId = the
   `?id=` param. The loop runs in the pane, so it only ever sees ITS OWN graph
   → "the tab being used" is automatic: each pane has its own assist session and
   its own `graph`. No cross-pane plumbing needed.

2. **`selectedId` (THE GAP).** `EditorContext.selectedId` exists in the type but
   **nothing populates it today.** The pane has no single "selected node" — it
   tracks `selectedCornerOpIdx`, `selectedSplineOpIdx`, a vertex-edit highlight,
   etc., but not a canonical "the node the user is looking at." Add a minimal
   `let aiSelectedId = $state<NodeId | null>(null)` set when the user opens a
   node's card/popover or clicks a node on the canvas (reuse whichever
   click-handler already highlights a node). Feed it into `getCtx()`. This is
   what makes "add a point to THIS polygon" / "wire THIS node" work without the
   user quoting an `n_xxxxxx` id. Low risk: one new `$state` + one assignment in
   the existing node-click path.

3. **System-prompt reflection.** `buildAssistSystem(graphState)` in
   `/api/rag/assist` already serialises `graphState` (params/nodes/selectedId/
   activeTab) into the system prompt under "CURRENT EDITOR STATE." Once
   `selectedId` is populated, the model is told what's selected with zero
   server change. Optionally add one line to the system prompt: *"When the user
   says 'this'/'here'/'the selected one', they mean the node with id
   `selectedId`."* (small edit to `buildAssistSystem`).

**RAG-then-tools (TODO item 1, "RAG based"):** the *generate* path
(`/api/rag/prompt`) already does BM25 retrieval over `ai/rag/parts.jsonl`. For
the *edit* path, the live editor state IS the retrieval context (the part you're
editing), so heavy BM25 is unnecessary turn-1. OPTIONAL enhancement (defer to a
later step): when the instruction names a *concept* not present in the open
part ("make it like a no-go nipple"), do a one-shot `topK(prompt, 3)` and inject
the exemplar graph(s) as reference text into the first user turn — gives the
multi-shot loop the same corpus the generate path uses. Keep it behind a flag;
land the core loop first.

---

## E. New editor tools `EDITOR_TOOLS` needs (audit + proposed additions)

Current 7 tools cover params + wiring + "add a point" — enough to PROVE the loop
(ship Step 1 with them). But the headline asks ("add a node", "subtract a
cylinder", "repeat this 6×", "rename/delete") need structural tools. Audit of
`composition-graph.ts` (all already pure Graph→Graph, already used by the UI's
`drop*` handlers, so wrapping is near-zero-risk):

### E.1 Phase-2 STRUCTURAL tools to add (rationale: the user's literal asks)

| New tool | Backing fn (`composition-graph.ts`) | Why |
|---|---|---|
| `describeNode(node)` | node lookup (new read) | One node's full args/children/coords — lets the model inspect before editing without dumping the whole graph in `getEditorState`. (SVTC parity: `readFile`.) |
| `addCall(libId, parentId?)` | `addCall` (:623) | "add a g_collar" — the core authoring verb. Returns the new id + alias. |
| `addCsg(op, parentId?)` | `addMethodPlaceholder` (:669) | "subtract / union / intersect" — then `setMethodInput`. |
| `setMethodInput(method, slot, target)` | `setMethodInput` (:674) | Wire the obj/arg of a CSG node (the other half of addCsg). |
| `addMove(parentId?)` / `addRotate(parentId?)` | `addMvPlaceholder` (:1295) / `addRotPlaceholder` (:1299) | "move it down 2", "rotate 30°". |
| `setTransformAxisValue(node, axis, value)` | `setTransformAxisValue` (:1319) | Set a mv/rot axis (ArgValue — literal/expr/param). Pairs with addMove/addRotate. |
| `addRepeat(parentId?)` + `setRepeatCount/Op/Child` | `addRepeatPlaceholder` (:766), `setRepeatCount` (:781), `setRepeatOp` (:789), `setRepeatChild` (:773) | "repeat this 6×" — the user's verbatim example. |
| `wrapInTransform(target, kind)` | `wrapInTransform` (:1345) | "move THIS node" when it isn't already under a transform. |
| `removeNode(node)` | `removeNode` (:1419) | "delete that". |
| `unwireArg(node, key, fallback)` | `unwireArg` (:1455) | Inverse of wireArgToParam. |
| `removeParam(name)` | `removeParam` (:1598) | Inverse of addParam (returns orphaned edges to report). |

### E.2 Sketch tools (parity with the polygon tools, for sketch-based parts)

| New tool | Backing fn |
|---|---|
| `addSketchOp(sketch, op, afterIdx?)` | `addSketchOp` (:850) |
| `setSketchOpField(sketch, idx, field, value)` | `setSketchOpField` (:864) |
| `removeSketchOp(sketch, idx)` | `removeSketchOp` (:907) |

### E.3 Part-properties tools (low-risk, high "wow")

| New tool | Backing fn |
|---|---|
| `setPartColor(which, hex)` | `setPartColorOuter` (:1499) / `setPartColorInner` (:1515) |
| `setPartMaterial(mat)` | `setPartMaterial` (:1529) |

**Cited SVTC parity:** SVTC's tool set is `listOpenTabs/getActiveTab/openFile/`
`createFile/createFromArchetype/readFile/patchFile/writeFile/createPlot/`
`editCurve/addFault` + tab ops. cadtrain's analog of `patchFile` is the
per-field setters (`setCallArg`, `setTransformAxisValue`); of
`createFromArchetype` is `addCall` (drop a library/engine part); of
`createPlot`+`editCurve` is `addCsg`+`setMethodInput` (compound authoring).
SVTC's `addFault` is the lesson to copy: **one ATOMIC tool that does a
multi-step graph mutation** (push + wire) so a single tool call can't half-apply
and burn loop steps. Candidate atomic combos for cadtrain:
- `subtractPart(libId, parentId?)` = addCall + addCsg('subtract') + setMethodInput in one dispatch (the single most common authoring move).
- `repeatNode(node, count, op)` = wrapInRepeat + setRepeatCount + setRepeatOp + setRepeatChild.
Add these atomic helpers in Phase 2b once the granular ones prove out.

### E.4 NOT adding (kept off-tools deliberately)
`finalize`, layout/`setLayout` (auto-layout handles position — model shouldn't
place nodes), `setViewport`, hydrate/emit internals. Keep the tool surface to
*semantic* edits.

---

## F. Model / cost / loop budget

- **Model:** `RAG_ASSIST_MODEL || claude-opus-4-8` (already the default in the
  endpoint). Opus for best tool selection; the env override lets a cost-
  sensitive deploy drop to `claude-sonnet-4-6`. **Decoupled from `RAG_MODEL`**
  (which the cheaper single-shot generate path uses) — two separate env vars,
  by design. SVTC shipped tool use on Haiku and it was fine for flat-file ops;
  graph editing wants a stronger default. (Verify model ids against the
  `claude-api` skill before shipping — do not hardcode from memory.)
- **Step cap:** `MAX_STEPS = 6` (SVTC used 5). A 6-step ceiling covers
  addParam→wire→addCall→addCsg→setMethodInput→confirm. The cap is a HARD stop:
  on hit, show "stopped after 6 steps — continue?" rather than silently ending.
- **Token budget:** `max_tokens 4096` per turn (current). The system prompt
  re-injects full editor state each turn → for big graphs trim `getEditorState`
  to id/alias/type/src (already does) and DON'T dump every arg (use
  `describeNode` on demand). Worst case ~6 turns × (state + tools) — budget a
  ceiling and surface cost in the transcript footer (token counts from
  `msg.usage`, optional).
- **Caching:** the tools array + the static system-prompt prefix are identical
  every turn → mark them with a `cache_control` breakpoint (prompt caching) to
  cut input cost across the loop. (Check `claude-api` skill for the exact
  field; this is a cheap win on a 6-turn loop.)

---

## G. Relation to `docs/plans/ai-function-mapping.md` (explicit diff)

| ai-function-mapping.md covered | This plan adds / changes |
|---|---|
| Tool REGISTRY design (`EDITOR_TOOLS` + `toClaudeTools`) — SHIPPED as `editor-tools-schema.ts`. | Phase-2 tool additions (§E) — names + backing fns + the **atomic-combo** lesson from SVTC `addFault`. |
| PURE dispatcher design — SHIPPED as `editor-tools.ts`. | No change; the loop CONSUMES it. Confirms `error` strings become `is_error` tool_results. |
| `/api/rag/assist` single-turn proxy — SHIPPED. | Add it to `VOLUME_PROXY_PATHS` (§E.4 of this plan / §H); prompt-cache the prefix; one system-prompt line for `selectedId`. |
| "client-applied loop (recommended)" — DESCRIBED, not built. | **Builds it** as `ge-assist.svelte.ts` (§C) — factory-per-pane, not a singleton. |
| Phase 3 "context scoping by active window" — sketched. | **Implements item 2** concretely (§D): the `selectedId` GAP (nothing populates it today) + the per-pane isolation that makes "the tab being used" automatic. |
| Did NOT mention error capture. | **New (§H):** `fix-errors.jsonl` corpus + `/api/ai/fix-errors` endpoint — the carried-over ask + SVTC's `markUnresolved`/`trainingLog` flywheel, adapted to the volume. |
| Phased build (Phase 1/2/3). | **Re-sequenced (§I)** into smallest-first, independently shippable PRs each `bun run build` + `bun test` green. |

Net: ai-function-mapping.md = Phase 1 (registry + dispatcher + proxy, DONE).
This plan = Phase 1.5 (loop + tab context + errors) and Phase 2 (structural
tools). Keep BOTH docs; this one is the active build sheet.

---

## H. Error capture → `ai/fix-errors.jsonl` (carried-over ask)

Goal: every tool error or bake failure during an AI turn appends one line to
`<volume>/ai/fix-errors.jsonl` — the corpus the system later mines to
self-repair (the cadtrain analog of SVTC `trainingLog.markUnresolved`, but
file-on-volume rather than IndexedDB).

### H.1 Record shape
```jsonc
{
  "ts": 1718400000000,        // client Date.now() — see note below
  "partId": "g_collar",       // ctx.partId
  "prompt": "wire r to OD",   // the user instruction that started the turn
  "tool": "wireArgToParam",   // failing tool name (or "bake")
  "input": { "node": "A", "key": "r", "param": "OD" },
  "error": "node not found: A",
  "model": "claude-opus-4-8",
  "step": 2,                  // which loop step
  "graphSnapshot": { ... }    // OPTIONAL hydrate-able graph; gate by size
}
```
Two error sources: (a) `dispatchEditorTool` returning `{error}` (validation
miss), (b) the post-apply bake throwing (geometry invalid). The loop calls
`logFixError` for both; bake failures carry `tool:"bake"`.

### H.2 Endpoint `POST /api/ai/fix-errors`
- NEW `src/routes/api/ai/fix-errors/+server.ts`.
- First lines MUST be Rule-13 plumbing:
  ```ts
  const proxied = await maybeProxy(request, url);
  if (proxied) return proxied;
  checkVolumeAuth(request, url);
  const file = volumePath('ai/fix-errors.jsonl');
  ```
- Append ONE line atomically. The file is append-only JSONL, so the cheapest
  durable pattern is `appendFile(file, line + '\n')` after `ensureDir('ai')`.
  Note Rule 4 prescribes temp-file+rename for *rewritten* stores; an append-only
  log is a legitimate exception (no reader sees a torn rewrite — a single
  `appendFile` write of one line is atomic on local FS). If we ever rewrite/
  compact it, THAT op uses temp+rename. Document this choice in the endpoint
  header.
- Add `'/api/ai/fix-errors'` to `VOLUME_PROXY_PATHS` in `src/hooks.server.ts`
  (alongside the `/api/rag/*` entries) so local dev appends to the PROD volume —
  one shared corpus (Rule 13). Without this, dev would write to `./.dev-volume`
  and the corpus would fragment.

### H.3 Client call (`logFixError` in the assist session)
- Fire-and-forget `fetch('/api/ai/fix-errors', {method:'POST', body: JSON})`,
  errors swallowed (capture is non-critical, mirrors SVTC `markUnresolved`
  swallowing fetch failures). Never blocks the loop.
- **Timestamps from the CLIENT** (`Date.now()` in the browser) for consistency —
  the prompt notes server *sandbox scripts* can't use `Date.now`, but an
  endpoint can; we still prefer the client ts so all records share one clock and
  the endpoint stays a dumb appender.
- **Rule 15:** never write secrets; the record carries only graph + instruction
  text. Fine.

### H.4 Future consumer (out of scope — note only)
A later step reads `fix-errors.jsonl` and either (a) feeds recurring
`{prompt, tool, error}` triples back into the system prompt as "known pitfalls,"
or (b) becomes a fine-tune/eval set. This plan only WRITES the corpus.

---

## I. Risk-sequenced, independently shippable steps

Each step: `bun run build` + `bun test` (incl. `editor-tools.test.ts`) green
before commit (Rule 8); recorded e2e for the UI steps (Rule 12, 23).

**Step 1 — fix-errors endpoint + proxy (smallest, zero UI, zero AI).**
`/api/ai/fix-errors/+server.ts` + `VOLUME_PROXY_PATHS` entry + a unit/curl test
that one POST appends one line and `maybeProxy` is honored. Ships alone; nothing
depends on it yet. SMALLEST-FIRST PR.

**Step 2 — `ge-assist.svelte.ts` loop module + tests (no UI yet).**
`createAssistSession` (§C) with injected getters/setters + a stubbed `fetch`.
Unit test: scripted `tool_use` responses drive a local graph through
addParam→wireArgToParam→text; assert final graph + that an `is_error` result is
fed back on a bad node id + that `logFixError` fires. No browser. Wire it to
`/api/rag/assist` but gate behind a dev-only call.

**Step 3 — add `/api/rag/assist` to `VOLUME_PROXY_PATHS` + prompt-cache + the
selectedId system-prompt line.** Tiny server PR; unblocks local dev (the key is
prod-side). Verify with a curl against the proxied path.

**Step 4 — `selectedId` in the pane (tab context, item 2).**
Add `aiSelectedId` `$state` + set it in the node-click/card-open path; feed
`getCtx()`. No AI yet — just makes `getEditorState` report a selection. Test:
click a node, open the dev assist call, confirm `graphState.selectedId` is set.

**Step 5 — ✨ UI: Generate | Edit mode + transcript (the visible feature).**
§J. Wire `assist.run(prompt)` to the live `graph`. e2e: "wire r to OD",
"add a point at r=2 z=0", "make the wall 0.3". Recorded run twice, identical
output (Rule 23). This is the first user-visible ship of items 1+2.

**Step 6 — Phase-2 structural tools (§E.1–E.3) in batches.**
6a: `describeNode` + `addCall` + `removeNode`. 6b: CSG (`addCsg`+
`setMethodInput`) + transforms (`addMove`/`addRotate`/`setTransformAxisValue`).
6c: `addRepeat` family + sketch tools + part-properties. 6d: atomic combos
(`subtractPart`, `repeatNode`). Each batch: extend `EDITOR_TOOLS` + dispatcher +
tests, re-run the e2e with a harder instruction. Independently shippable.

**Step 7 (optional) — RAG-into-edit (§D enhancement).** turn-1 `topK` injection
behind a flag, for concept instructions not present in the open part.

**Step 8 (deferred) — WebGPU SLM backend.** §K.

---

## J. UI — hosting BOTH generate and multi-shot edit on ✨

Today: ✨ button (`GraphEditorPane.svelte` ~4818) → `openAiMenu()` popover →
textarea → `generateFromPrompt()` → `/api/rag/prompt` → whole-graph replace via
`onGenerated`. Anchored-dropdown chrome (`.ge-canvas-menu`), `aiMenuOpen` /
`aiBusy` / `aiError` state.

Proposed (follows UI memories — `feedback_popup_over_inline`,
`feedback_apply_on_enter`, `feedback_no_help_cursor`):
- KEEP the single ✨ rail button + its FloatingPanel popover (don't add a second
  affordance). Add a **mode toggle** at the popover top: **Generate** (existing
  `/prompt` whole-graph, for an EMPTY/new tab) vs **Edit this part** (new
  `/assist` loop, for an OPEN part). Default to **Edit** when the graph is
  non-empty, **Generate** when empty (`graph.root` has no children).
- Edit mode renders a **transcript / step view** below the textarea: one row per
  applied tool (`✓ wireArgToParam(A, r→OD)`), an `is_error` row in red, a live
  spinner during `assist.busy`, and a **Stop** button (`assist.requestStop()`).
  This is the "multi shots" made visible — the user watches each edit land and
  can halt. Chat-style: the textarea stays; submitting appends a new user turn
  to the SAME session (so "now make it taller" continues with context).
- Apply on Enter (Shift+Enter newline) — reuse the existing textarea keydown
  (already wired for generate). No `?`/help cursor; `data-tip` already signals
  hoverability.
- Reuse `aiBusy`/`aiError` for generate; the edit mode reads
  `assist.busy/error/steps`. Keep the two modes visually distinct (violet
  accent already established for ✨).

---

## K. WebGPU-SLM future backend (slot only — do NOT design here)

`docs/research/webgpu-slm.md` recommends a CONDITIONAL-GO time-boxed spike for an
**optional, default-OFF** in-browser backend (web-llm/MLC + XGrammar constrained
JSON decoding, Qwen2.5-1.5B) behind the SAME tool-call interface. Because the
loop in §C talks to `dispatchEditorTool` (pure) and the only network boundary is
"give me the next tool call from {graphState, messages}", swapping the Anthropic
`/api/rag/assist` POST for a local `webllm.chatCompletion(..., {response_format:
json_schema = toClaudeTools()-derived})` is a backend toggle, not a rearchitect.
Slot: a `backend: 'anthropic' | 'webllm'` option on `createAssistSession`,
default `'anthropic'`. The constrained-decoding schema is literally the
`input_schema` already produced by `toClaudeTools()`. Out of scope for this
plan; the loop is built to accommodate it.

---

## L. Files

**New:**
- `src/lib/shared/ge-assist.svelte.ts` — `createAssistSession` loop (§C).
- `src/lib/shared/ge-assist.test.ts` — loop unit tests (stubbed fetch + local graph).
- `src/routes/api/ai/fix-errors/+server.ts` — JSONL appender (§H.2).

**Edit:**
- `src/lib/cad/editor-tools-schema.ts` + `editor-tools.ts` + `editor-tools.test.ts` — Phase-2 tools (§E, Step 6).
- `src/lib/shared/GraphEditorPane.svelte` — `aiSelectedId` state (§D.2); ✨ popover Generate|Edit toggle + transcript + Stop (§J); host `createAssistSession`.
- `src/routes/primitives/+page.svelte` — pass `activeTab`/`partId` into the pane's `getCtx()` if not already derivable inside the pane.
- `src/routes/api/rag/assist/+server.ts` — prompt-cache prefix + one `selectedId` system-prompt line (§D.3, §F).
- `src/hooks.server.ts` — `VOLUME_PROXY_PATHS` += `/api/rag/assist`, `/api/ai/fix-errors`.
- `src/routes/api/CLAUDE.md` — register `/api/ai/fix-errors` + note `/api/rag/assist` is now proxied.
- `docs/HISTORY.md` / `/plan` — record when shipped (Rule 14, 19).

**Reused unchanged:** `composition-graph.ts` (mutation surface), `editor-tools.ts`
dispatcher (the loop consumes it), `anthropic-api.ts`, `volume.ts`
(`volumePath`/`maybeProxy`/`checkVolumeAuth`), the bake `$effect`.

---

## M. Risks / watch-items
- **`ArgValue` literacy** — the model must emit `{kind:'literal'|'expr'|'param'}`.
  Already mitigated by verbose per-param descriptions (SVTC's lesson, encoded in
  `ARG_VALUE_PARAM`). Keep 1–2 worked examples in the system prompt.
- **alias vs nodeId** — `getEditorState` lists `{id, alias, type}`; dispatcher
  resolves alias→id. `selectedId` removes most of the guessing.
- **Bake storm (§B note)** — 6 reassignments → 6 bakes. Mitigate: debounce the
  bake `$effect` while `assist.busy`, or use `⚡draft` coarse bake during the
  loop and one full bake on completion. Measure before optimizing (small parts
  bake fast; memory `stack_cutaway_perf_root_cause` is the cautionary tale).
- **Stale dev server** — editing `ge-assist.svelte.ts`/server modules needs a
  clean `bun run dev` restart (memory `feedback_build_restart_after_significant_change`);
  the in-app restart button wedges (memory `source_404_flood_2026-06-13`).
- **Loop never terminates on text** — always honor the step cap + Stop; never
  trust the model to stop.
- **Volume fragmentation** — `/api/ai/fix-errors` MUST be in `VOLUME_PROXY_PATHS`
  or dev writes a second corpus locally.
- **Per-pane sessions** — `createAssistSession` is a FACTORY; a module singleton
  would cross-wire two open tabs (SVTC could singleton because it has one chat).
```
