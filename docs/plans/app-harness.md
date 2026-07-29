# App Harness — plan

**Status:** DESIGN (2026-07-28). Chosen over hand-building the wells GUI. This is the
platform spine ([[todo_app_platform]], `/plan` #983 + bundles C/D).

> **One line:** cadtrain becomes an *engine + harness*. A sub-app is a declarative
> **`.app`** file. An AI authors and edits `.app` files (and calls data verbs) through a
> **Functionary-style tool schema generated from one verb registry**. The runtime AI is
> **local** (WebLLM); cloud Claude is dev/authoring only.

---

## 0. Decisions LOCKED (do not re-litigate)

| # | Decision | Why |
|---|---|---|
| D1 | **`.app` is a declarative JSON manifest**, not AI-generated Svelte | user: "template that uses api functions that read files in"; constrained = safe + local-model-friendly |
| D2 | **cadtrain is the harness/host** | user: "my app to be harness for subapps" |
| D3 | **One verb registry is the single source of truth** → projects to (a) tool schema, (b) HTTP routes, (c) the `API.md` authoring guide | the API and the tool schema can never drift |
| D4 | **Runtime AI = local (WebLLM); dev/authoring = cloud Claude** | [[ai_data_residency_local_first]] — close the prompt→LLM leak |
| D5 | **Manifest-only first**; the "generate a custom Svelte panel component" escape hatch is a **later, gated** capability (DEFAULT — revisit) | ship the safe, fully-constrained path; the SVTC `API.md` codegen path is proven but riskier |
| D6 | **Runtime AI context = generated + cadtrain-specific ONLY** (tool schema + generated `API.md`). Framework LLM docs (`svelte.dev/llms*.txt`) are a **dev-time** accelerant, never runtime context | fewer tokens → local model works; never tempt it to write banned Svelte |

---

## 1. Prior art — this is PROVEN, not speculative

SVTC (`~/code/SVTC/src/lib/ai/`, [[svtc_repo]]) already runs almost this exact pattern:

- **File-based apps** — `.tpl` (plot template), `.wson` (well), `.dgeo`, `.wflow`, `.tdg`; each a JSON doc a viewer renders. → our **`.app`** generalizes `.tpl`.
- **Tool schema** — `toolSchema.js`: a pure-data `TOOLS[]` array (`{name, desc, params:{JSON-schema}}`) + `toClaudeTools()`, **shared between the Claude API and WebLLM paths**. → our **Layer 2**.
- **Dispatch** — `tools.js`: a `name → async handler` object + `dispatchToolCall(name, args)` + `readAppState()`. → our **Layer 1 dispatch**.
- **AI edits the manifest** — `patchFile` (push/set/remove on JSON), `createPlot`/`editCurve` build `.tpl` `panels[]`, `createFromArchetype` reads a curated template + overrides. → our **gui/mutate verbs**.
- **Curated codegen allowlist** — `ai/API.md` lists ~5 importable paths and "any other import fails." → our **`API.md` generator** (D6) + the future escape hatch (D5).
- **Local runtime** — `ai/webllm/`, same `TOOLS`. → our **D4**.

**cadtrain already owns the other half:** typed files on a volume + a renderer +
engine-as-API (`/api/primitives/{compile,preview,bake-preview}`). What's missing is the
*app* layer: a verb registry, its tool schema, the `.app` manifest, and a harness renderer.

---

## 2. Architecture — 5 layers

```
┌─ 1. VERB REGISTRY   src/lib/appkit/verbs.ts   ── the single source of truth
│    each op once: { name, desc, params:{JSON-schema}, returns, handler, group }
│    groups: data · mutate · gui
│        │
│        ├──▶ 2a. TOOL SCHEMA   tool-schema.ts   toClaudeTools() + toWebLLM()
│        │        fed to the AI up front (local runtime / cloud dev)
│        ├──▶ 2b. HTTP ROUTES   /api/app/verb/[name]   (execution surface)
│        └──▶ 2c. API.md        api-md.ts   generated authoring guide (human + AI)
│
├─ 3. .app MANIFEST   apps/<id>.app   declarative: panels + popovers + controls,
│                     each bound to a verb (source / onEdit / add / onSelect)
├─ 4. HARNESS RENDERER   reads a .app → renders panels via a PanelKind registry →
│                        wires every control to dispatch(verb, args)   (wellnew shell)
└─ 5. AI LOOP   chat → schema → model → parse tool_use → dispatch → tool_result → repeat
                the AI builds/patches the .app + calls data verbs; the sub-app materializes
```

**Data flow (one user turn):** user types in the sub-app's chat → harness sends
`{messages, tools: toolSchema}` to the model → model returns `tool_use` calls → harness
runs `dispatch(name,args)` (a data read, a doc mutation, or a `patchApp`) → tool results
go back → model narrates / calls more → the panels re-render from the (possibly new) `.app`
+ the (possibly mutated) bound doc → 3D re-bakes via the engine API.

---

## 3. Layer 1 — the verb registry

**Verb shape** (mirrors SVTC's `TOOLS[]` + handler map, but co-located):

```ts
// src/lib/appkit/verbs.ts
export interface Verb {
  name: string;                 // 'setRow'
  group: 'data' | 'mutate' | 'gui';
  desc: string;                 // AI-facing; this IS the prompt
  params: JSONSchema;           // input_schema (Anthropic) / functionary params
  returns?: JSONSchema;         // for the API.md doc
  handler: (args, ctx) => Promise<unknown>;   // ctx = { docStore, engine, appStore }
}
export const VERBS: Verb[] = [ ... ];
export function dispatch(name: string, args: unknown, ctx: Ctx): Promise<unknown>;
```

**Catalog v1** (start small — the wells slice):

| group | verb | params | returns | backed by |
|---|---|---|---|---|
| data | `listDocs` | `{docType?}` | `[{id,title}]` | `/api/primitives/list` |
| data | `loadDoc` | `{id}` | `{graph, params}` | `/api/primitives/source` |
| data | `getParams` | `{id}` | `{name→value / list<record>}` | graph `meta.params` |
| data | `bake` | `{id, params}` | `{mesh, stats}` | `/api/primitives/bake-preview` |
| data | `listParts` | `{category?}` | `[{id,meta}]` | `/api/primitives/list` |
| mutate | `setParam` | `{id, name, value}` | `{ok}` | graph param write |
| mutate | `addRow` | `{id, list, row}` | `{ok, index}` | `parts_map` list<record> (#77) |
| mutate | `removeRow` | `{id, list, index}` | `{ok}` | list<record> |
| mutate | `reorderRow` | `{id, list, from, to}` | `{ok}` | list<record> |
| mutate | `patchDoc` | `{id, op, path, value}` | `{ok}` | JSON push/set/remove (SVTC `patchFile`) |
| gui | `definePanel` | `{app, panel}` | `{ok}` | `.app` `panels[]` |
| gui | `addControl` | `{app, panelId, control}` | `{ok}` | `.app` control |
| gui | `bindAction` | `{app, controlId, verb, args}` | `{ok}` | `.app` binding |
| gui | `patchApp` | `{app, op, path, value}` | `{ok}` | JSON patch on the `.app` |
| gui | `listPanelKinds` | `{}` | `[{kind, props}]` | PanelKind registry |

The **`mutate` verbs reuse the #77 machinery** ([[wells_graph_native_decision]]): a well's
shape lives in typed `list<record>` params driven by `parts_map`/`parts_table`, so `addRow`
/`setParam` are exactly the ops the wells params GUI needed — now expressed as verbs.

---

## 4. Layer 2 — tool-schema generation

```ts
// src/lib/appkit/tool-schema.ts   (pure data — no Svelte, server-safe, like SVTC)
export function toClaudeTools(verbs = VERBS)   // {name, description, input_schema}
export function toWebLLM(verbs = VERBS)        // OpenAI-style function defs for WebLLM/XGrammar
```

- Same registry → both shapes, so **the schema can never drift from the executable** (D3).
- Runtime = local (WebLLM + XGrammar constrained decoding, `/plan` #906). Dev/authoring =
  cloud Claude via the existing `@anthropic-ai/sdk` path. The schema is byte-identical to both.

---

## 5. Layer 3 — the `.app` manifest

A new typed volume file (`apps/<id>.app`, JSON). Declarative; the AI only ever patches THIS.

```jsonc
{
  "app": "wells", "title": "Well Designer", "docType": "well",
  "panels": [
    { "id": "list",  "kind": "list", "source": {"verb":"listDocs","args":{"docType":"well"}},
      "onSelect": {"verb":"loadDoc","args":{"id":"$item.id"}} },
    { "id": "params","kind": "form", "source": {"verb":"getParams","args":{"id":"$active"}},
      "controls": [
        { "id":"casings", "kind":"table", "bind":"casings", "cols":["od","id","top","bot"],
          "onEdit": {"verb":"setParam"},
          "add":    {"verb":"addRow","args":{"list":"casings"}} } ] },
    { "id": "view",  "kind": "bake3d", "source": {"verb":"bake","args":{"id":"$active","params":"$params"}} }
  ],
  "popovers": []      // AI appends these via patchApp / addControl
}
```

**Binding refs** the renderer resolves: `$active` (selected doc id), `$item` (row in a list),
`$params` (the bound doc's live params). **PanelKind registry v1:** `list · form · table ·
bake3d · svg · text · chat`. New kinds are added in code (each a small Svelte component);
the AI can only *compose* existing kinds — that's the D1/D5 safety boundary.

---

## 6. Layer 4 — harness renderer

- Route: **`/app/[id]`** (a sub-app), plus an `/app` gallery. Reuses `EmbedConfig` so the
  graph editor can still be embedded as one panel kind if wanted.
- Renders `panels[]` by looking each `kind` up in the **PanelKind registry** and passing the
  resolved `source` data + a `dispatch` fn. Mirror **wellnew's `Panel*.svelte` + runes-store
  shell** ([[wellnew_repo]]) — confirm its exact panel-registration mechanism when we build
  Layer 4 (the one external detail still to pin down).
- The renderer is **generic**: it knows nothing about wells. Wells-ness lives entirely in
  `wells.app` + the verbs.

---

## 7. Layer 5 — the AI loop

Standard tool-use loop (copy SVTC `chat.svelte.js`): feed `{messages, tools}` → parse
`tool_use` → `dispatch` → `tool_result` → repeat until the model stops. Guardrails: gui/mutate
verbs are transactional on the `.app`/doc; every AI edit is undoable (reuse the graph history
trunk). RAG optional (reuse the existing corpus for grounding). Dual backend already exists
(`anthropic-api.ts` cloud / WebLLM local) — D4.

---

## 8. Context & docs strategy (the `llms.txt` question)

There are **two AIs** and they need **opposite** docs:

| consumer | produces | sees | `svelte.dev/llms*.txt`? |
|---|---|---|---|
| **dev-time** (Claude Code writing the harness) | Svelte 5 / SvelteKit code | full framework docs | ✅ vendor `llms-small.txt` → `docs/vendor/svelte-llms.txt` |
| **runtime AI** (authoring `.app`) | declarative JSON | tool schema + generated `API.md` ONLY | ❌ never — it writes JSON, not Svelte |
| **escape hatch** (D5, later) | one sandboxed component | a **curated allowlist** (our importable libs) | ⚠️ constrained subset only |

**Rule:** runtime AI context = minimal + generated + cadtrain-specific. SVTC's `API.md` lists
~5 imports and "everything else fails" — that constraint is *why* its codegen runs. Our
`api-md.ts` generates the same kind of tiny closed contract from the registry (D3, D6).

---

## 9. Rung ladder — testable at every step

1. **Registry + tool schema** (`src/lib/appkit/verbs.ts` + `tool-schema.ts`, ~6 wells verbs) —
   headless test: `schema → tool call → dispatch → result` round-trips. *No UI.*
2. **Harness renders a STATIC `wells.app`** — hand-write it; prove panels render + verbs wire
   (list → 3D bake). *No AI.*
3. **AI patches the `.app`** (cloud Claude) — "add a casing row" / "add a popover" → the panel
   re-renders → re-bakes.
4. **AI authors a `.app` from scratch** — "make me a well designer" → `wells.app` appears.
5. **Swap runtime to WebLLM** — same schema, no tokens leave (D4).

---

## 10. Open questions (to lock before/at each rung)

- **`.app` storage** — `apps/<id>.app` on the volume (new top dir), per `primitive-paths.ts`?
- **Per-user scoping** — sub-apps are inherently per-user; blocked on the OAuth port
  ([[todo_customize_dir_deferred]]). Start single-user/local.
- **PanelKind set v1** — is `list/form/table/bake3d/svg/text/chat` enough for wells?
- **Verb ctx binding** — do verbs act on the LIVE editor state (in-memory graph) or stateless
  HTTP + reload? (Rung 2 decides; likely a per-app runes store like wellnew's.)
- **Escape hatch trigger** (D5) — what gates promoting a user to "generate a custom panel"?

---

## 11. File plan

```
src/lib/appkit/
  verbs.ts          # the registry (Verb[] + dispatch + Ctx)
  tool-schema.ts    # toClaudeTools() + toWebLLM()   (pure data)
  api-md.ts         # generate the AI/human authoring guide from VERBS
  manifest.ts       # .app types + validate + $-ref resolver
  verbs.test.ts     # schema → call → dispatch round-trip (rung 1)
src/lib/appkit/panels/   # PanelKind registry: List/Form/Table/Bake3d/Svg/Text/Chat.svelte
src/routes/app/[id]/+page.svelte   # the harness renderer (rung 2)
src/routes/api/app/verb/[name]/+server.ts   # HTTP projection of the registry
docs/vendor/svelte-llms.txt        # dev-time only (D6)
apps/wells.app                     # the first sub-app (rung 2)
```
