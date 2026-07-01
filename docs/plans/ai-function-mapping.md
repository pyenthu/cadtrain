# Plan — Context-Aware AI Function Mapping for the Graph Editor ✨

**Status:** SHIPPED (Phase-1 registry + dispatcher + `/api/rag/assist` are on
main). Detail sheet under **`docs/plans/ai-master-plan.md` (the north star)** —
this = P0. Header "proposed" is stale; kept for its design rationale.
**Goal (user's words):** "The ✨ AI button should be relevant to the window
we're working in. Map some basic editor functions into the AI system — e.g.
mapping a node to a param, adding a point, adding a node — so if the functions
are available the AI can translate better. We did this in the SVTC repo and it
worked well."

The idea: move the ✨ button from a one-shot "describe a part → get a whole new
graph" flow to a **tool-using assistant** that calls the editor's own mutation
functions as Anthropic tools, scoped to the active tab / part / selection.

---

## (a) Current flow — what ✨ does today

One round-trip, whole-graph replacement. No tools, no editor-state awareness.

```
✨ button (rail bottom, GraphEditorPane.svelte:4739)
  → openAiMenu() popover (textarea: "Generate a part")
  → generateFromPrompt()  [GraphEditorPane.svelte:1206]
      POST /api/rag/prompt  { prompt }
        → tryL1(prompt)              [rag-l1.ts]  — known part → instant graph, 0 tokens
        → topK(prompt, 5)            [rag-query.ts] — BM25 over ai/rag/parts.jsonl
        → buildRagPrompt(...)        [rag-prompt.ts] — system + user, schema-by-example
        → client.messages.create({ model: RAG_MODEL, max_tokens: 8192,
                                    system, messages:[{role:user, content:user}] })
        → parseJsonLoose(text) → { id, candidates, graph }
      → graph = autoLayoutGraph(hydrateGraph(j.graph))   // REPLACES current tab in place
      → exemplarId = j.id; props.onGenerated?.(...)       // relabels tab; volume untouched
```

Key files:
- `src/lib/shared/GraphEditorPane.svelte` — `aiMenuOpen`, `openAiMenu()`,
  `generateFromPrompt()` (~1164–1246); button at ~4739–4747.
- `src/routes/api/rag/prompt/+server.ts` — single Claude call, returns a graph.
- `src/lib/server/{rag-l1,rag-query,rag-prompt,rag-corpus}.ts` — retrieval.
- `src/lib/shared/anthropic-api.ts` — `createAnthropicClient()` (SDK + key).
- `RAG_MODEL` default `claude-sonnet-4-6`. **Recommend `claude-opus-4-8`** for
  the tool-loop path (better tool selection; sonnet is fine for cost-sensitive).

**Limitation the user is naming:** the model never sees what's open. It can't
"add a point to the polygon I'm looking at," "wire arg `r` of `g_collar` to
param `OD`," or "rename this node" — it can only emit an entire fresh graph.

---

## (b) Proposed TOOL REGISTRY — editor actions as Anthropic tools

The editor already exposes a large, **pure** mutation surface in
`src/lib/cad/composition-graph.ts`: every function takes a `Graph` and returns a
new `Graph` (or `{graph, id}`). That is the dispatch target. We wrap a curated
subset as Anthropic tools, exactly like SVTC's `toolSchema.js` → `tools.js`.

Two new modules mirror the SVTC split:

| New file | Mirrors SVTC | Responsibility |
|---|---|---|
| `src/lib/cad/ai/editor-tools-schema.ts` | `ai/toolSchema.js` | Pure data: `EDITOR_TOOLS` array + `toClaudeTools()` + `toolListText()`. **Server-safe, no Svelte imports.** |
| `src/lib/cad/ai/editor-tools.ts` | `ai/tools.js` | `dispatchEditorTool(name, args, graph) → { graph, result }`. Pure graph→graph; thin wrappers over `composition-graph.ts`. **No DOM** (so it's unit-testable + reusable by both API and a future offline path). |

The dispatcher returns the **new graph** plus a small JSON result the model
sees. GraphEditorPane applies `graph = nextGraph` after each call (reactive
re-render + auto-bake), the same assignment pattern every existing `drop*` /
`wire*` handler already uses.

### Tool surface (curated from composition-graph.ts)

Each row = one tool. "Backing fn" is the existing exported function we wrap.
Names that need a node target take a `nodeId` (or, friendlier, an `alias` —
the dispatcher resolves alias→id via `takenAliases`/node scan).

**Read / context (no mutation — let the model orient):**
| Tool | Backing | Returns |
|---|---|---|
| `getEditorState` | (new `readEditorState()`) | `{ partId, params:[{name,schema}], nodes:[{id,alias,type,callId?}], selectedId, activeTab }` |
| `describeNode` | node lookup | one node's args/children/coords |

**Params + wiring (Phase 1 — safe, high value, the user's headline ask):**
| Tool | Backing fn (`composition-graph.ts`) |
|---|---|
| `addParam(name, schema)` | `addParam` (:1460) |
| `setParamSchema(name, schema)` | `setParamSchema` (:1610) |
| `removeParam(name)` | `removeParam` (:1598) |
| `wireArgToParam(nodeId, key, paramName)` | `wireArg` (:1451) / `setCallArg`+`asParam` |
| `unwireArg(nodeId, key, fallback)` | `unwireArg` (:1455) |
| `setCallArg(nodeId, key, value)` | `setCallArg` (:1443) |

**Sketch / polygon points (Phase 1 — "adding a point"):**
| Tool | Backing fn |
|---|---|
| `addPolygonPoint(polygonId, afterIdx?)` | `addPolygonPoint` (:1086) |
| `setPolygonCoord(polygonId, idx, axis, value)` | `setPolygonCoord` (:1031) |
| `removePolygonPoint(polygonId, idx)` | `removePolygonPoint` (:1236) |
| `addSketchOp(sketchId, op, afterIdx?)` | `addSketchOp` (:850) |
| `setSketchOpField(sketchId, idx, field, value)` | `setSketchOpField` (:864) |

**Structural / nodes (Phase 2):**
| Tool | Backing fn |
|---|---|
| `addCall(libId, args?, parentId?)` | `addCall` (:623) |
| `addCsg(op, parentId?)` | `addMethodPlaceholder` (:669) |
| `addMove(parentId?)` / `addRotate(parentId?)` | `addMvPlaceholder` (:1295) / `addRotPlaceholder` (:1299) |
| `addRepeat(parentId?)` | `addRepeatPlaceholder` (:766) |
| `addPolygon(parentId?)` / `addSketch(parentId?)` | `addPolygon` (:808) / `addSketch` (:830) |
| `setTransformAxisValue(id, axis, value)` | `setTransformAxisValue` (:1319) |
| `wrapInTransform(targetId, kind)` | `wrapInTransform` (:1345) |
| `removeNode(id)` | `removeNode` (:1419) |

**Part properties (Phase 2, low-risk):**
| Tool | Backing fn |
|---|---|
| `setPartColor(which, hex)` | `setPartColorOuter` (:1499) / `setPartColorInner` (:1515) |
| `setPartMaterial(mat)` | `setPartMaterial` (:1529) |

Notes:
- All backing fns are already pure + already used by the UI's `drop*` handlers,
  so the blast radius of wrapping them is near zero.
- `ArgValue` is the one shape the model must learn: `{kind:'literal',value}` |
  `{kind:'expr',expr}` | `{kind:'param',param}`. Encode it plainly in the tool
  description (helpers `asLiteral/asExpr/asParam` at :54–56). SVTC proved that a
  good `description` string per param is what makes the model get this right.

### Schema generation (borrow SVTC verbatim)

`editor-tools-schema.ts` exports `EDITOR_TOOLS` as `{name, desc, params:{...}}`
records and a `toClaudeTools()` that lowers them to Anthropic
`{name, description, input_schema:{type:'object', properties, required}}`. Same
12-line function as SVTC `toolSchema.js`. This keeps tools as plain data,
importable on the server, and (bonus) feeds a future offline/WebLLM path.

---

## (c) The AI call: "return a graph" → "return a sequence of tool calls"

New endpoint `POST /api/rag/assist` (keep `/api/rag/prompt` for the legacy
whole-graph generate; the ✨ menu gains an "edit current part" mode that hits
`/assist`). It runs the **manual agentic tool loop** (Anthropic tool use):

```
POST /api/rag/assist  { prompt, editorState, messages? }
  system = buildAssistPrompt(editorState)   // schema-by-example + the ArgValue shape
                                            //   + current params/nodes/selection
  tools  = toClaudeTools()                  // from editor-tools-schema.ts
  loop (server-side, max ~6 steps):
    msg = client.messages.create({ model: 'claude-opus-4-8', max_tokens, system,
                                   tools, messages, thinking:{type:'adaptive'} })
    if stop_reason !== 'tool_use': return { type:'text', text }
    for each tool_use block:
        push { type:'tool_use', ... } to messages (assistant)
        → DO NOT execute on the server (no Graph there)
        → return the tool calls to the CLIENT, which:
             graph = dispatchEditorTool(name, input, graph).graph
             posts tool_result back to /assist to continue the loop
```

Two viable executions of the loop — pick **client-applied** (recommended):

- **Client-applied (recommended, matches SVTC chat.svelte.js).** The browser
  holds the live `Graph`. The endpoint is a thin proxy that does ONE Claude
  call per turn and returns either text or the tool-use block(s); the client
  runs `dispatchEditorTool` against the reactive `graph`, then re-POSTs the
  `tool_result`. The user *sees each edit land live* and can stop mid-loop.
  This is exactly SVTC's `chat.svelte.js` `while (data.type === 'tool_use')`
  loop (≤5 steps) + `dispatchToolCall`.
- **Server-applied (rejected for v1).** Send the whole graph to the server,
  run the loop there applying tools to a server-side copy, return the final
  graph. Simpler loop but: ships the graph both ways, no live feedback, and
  duplicates the dispatcher on the server. Revisit only if we want headless
  batch edits.

Anthropic specifics (from the claude-api skill):
- Tool format: `{ name, description, input_schema }`; `tool_choice:{type:'auto'}`.
- Model: **`claude-opus-4-8`** for the tool loop (best tool selection), with
  `thinking:{type:'adaptive'}`. `RAG_MODEL` env still selects; keep sonnet-4-6
  as the cheap option. (SVTC shipped on haiku — fine for its flat file ops, but
  graph editing benefits from a stronger model.)
- Parse `msg.content` for `type:'tool_use'` blocks; multiple blocks per turn
  are allowed — apply all, return all `tool_result`s in one user turn.
- Always append the full assistant `content` (tool_use blocks included) before
  the `tool_result` user turn — required by the API.

---

## (d) The SVTC pattern — what we're borrowing

SVTC (`~/code/SVTC/src/lib/ai/`) ships exactly this and the project memory says
it "worked well." Structure we copy:

| SVTC artifact | What it does | cadtrain analog |
|---|---|---|
| `toolSchema.js` — `TOOLS` data + `toClaudeTools()` + `toolListText()` | Pure, server-safe tool definitions; one lowering fn to Anthropic format | `editor-tools-schema.ts` |
| `tools.js` — `dispatchToolCall(name,args)` over live stores | Client-side action dispatcher; `TOOL_IMPLS` map; returns `{...}` or `{error}` | `editor-tools.ts` — `dispatchEditorTool(name,args,graph)` (pure, returns next graph) |
| `chat.svelte.js` — multi-step tool loop (≤5), maps app msgs → Anthropic msgs | The agentic loop + msg bookkeeping | new `ge-assist.svelte.ts` store (or inline in GraphEditorPane) |
| `/api/chat/+server.js` — one Claude call, returns tool_use OR text; **accepts scoped `system`/`tools`/`tool_choice` overrides** | Thin proxy; lets a narrow task ship a tight prompt + tiny toolset | `/api/rag/assist/+server.ts` |
| `readAppState()` injected into the system prompt | Context awareness — the "relevant to the window" piece | `readEditorState()` → params/nodes/selection of the active tab |
| `trainingLog.js` — captures `{instruction, output}` pairs | Fine-tune corpus from real use | OPTIONAL later: log accepted tool sequences to `ai/training/` (we already have the dir convention) |

Worth-borrowing extras (defer): the **scoped-task framework** (`tasks/*.js` —
each narrow action ships its own tiny toolset + tight system prompt + heuristic
offline fallback) maps perfectly to per-window scoping (Phase 3). The
**unresolved/needs-work** capture is a cheap quality flywheel.

What we deliberately DON'T copy yet: WebLLM offline path, IndexedDB RAG,
training auto-flush. The pure schema/dispatcher split keeps those doors open.

---

## (e) Phased build

**Phase 1 — a few safe tools, prove the loop (smallest shippable).**
1. `editor-tools-schema.ts` + `editor-tools.ts` with: `getEditorState`,
   `addParam`, `setParamSchema`, `wireArgToParam`, `setCallArg`,
   `addPolygonPoint`, `setPolygonCoord`. (params + wiring + "add a point".)
2. `/api/rag/assist/+server.ts` — one-call-per-turn proxy (returns tool_use|text),
   model `claude-opus-4-8`, tools from `toClaudeTools()`.
3. ✨ popover gains a mode toggle: **Generate** (legacy `/prompt`) vs
   **Edit this part** (`/assist`). Edit-mode wires the client loop:
   `dispatchEditorTool` → `graph = next` → re-POST tool_result, ≤6 steps, live.
4. Unit-test `dispatchEditorTool` (pure fn — no browser) for each tool. e2e:
   "wire r to OD", "add a point at r=2,z=0".

**Phase 2 — structural tools.** Add `addCall/addCsg/addMove/addRotate/`
`addRepeat/addPolygon/addSketch/removeNode/wrapInTransform/setPartColor/`
`setPartMaterial`. Re-run e2e for "subtract a cylinder," "repeat this 6×."

**Phase 3 — context scoping by active window.** `readEditorState()` already
narrows to the active tab; tighten further: when a polygon/sketch/node is
selected, ship a **scoped toolset** (only the point/coord tools for a selected
polygon) + a tight system prompt — SVTC's `tasks/` pattern. The ✨ button's
available tools then literally change with the window, which is the user's
exact request. Optional: training-pair capture of accepted sequences.

---

## (f) Files to touch

New:
- `src/lib/cad/ai/editor-tools-schema.ts` — `EDITOR_TOOLS` + `toClaudeTools()` + `toolListText()`.
- `src/lib/cad/ai/editor-tools.ts` — `dispatchEditorTool(name,args,graph)`, `readEditorState(graph, selectedId, tab)`.
- `src/lib/cad/ai/editor-tools.test.ts` — pure-fn unit tests.
- `src/routes/api/rag/assist/+server.ts` — tool-loop proxy (one Claude call/turn).
- `src/lib/cad/ai/CLAUDE.md` — module doc (mirror `~/code/SVTC/src/lib/ai/CLAUDE.md`).

Edit:
- `src/lib/shared/GraphEditorPane.svelte` — ✨ popover Generate|Edit toggle;
  `runAssist()` client loop calling `dispatchEditorTool`; reuse `aiMenuOpen`/
  `aiBusy`/`aiError`. (Optionally extract loop into `ge-assist.svelte.ts`.)
- `src/lib/server/rag-prompt.ts` — add `buildAssistPrompt(editorState)` (or new
  file `rag-assist-prompt.ts`) — schema-by-example + ArgValue shape + state.
- `src/routes/api/CLAUDE.md` — register the new `/api/rag/assist` endpoint.
- `docs/HISTORY.md` / `/plan` — record once shipped (Rule 14, Rule 19).

Reuses unchanged: `composition-graph.ts` (the whole mutation surface),
`anthropic-api.ts` (`createAnthropicClient`), `composition-bake.ts` (auto-bake
fires on `graph =` assignment).

### Risks / watch-items
- **`ArgValue` literacy** — the model must emit the union correctly. Mitigate
  with explicit per-param descriptions + 1–2 worked examples in the system
  prompt (SVTC's lesson: descriptions carry the load).
- **alias vs nodeId** — accept `alias` and resolve server-agnostically in the
  dispatcher; nodes are `n_xxxxxx` ids the model can't guess, so `getEditorState`
  must list `{id, alias, type}` up front.
- **Loop bound + cost** — cap at ~6 steps like SVTC's 5; opus tool loops cost
  more than the single sonnet generate — keep `RAG_MODEL` override.
- **Live-apply UX** — each tool mutates `graph` → auto-bake may fire per step;
  consider debouncing bake until the loop ends (or `⚡draft` bake) so a 6-step
  edit doesn't bake 6×.
- **Volume safety** — the loop only mutates the in-memory `graph`; nothing
  saves until the user hits Save (same stance as the current generate flow).
