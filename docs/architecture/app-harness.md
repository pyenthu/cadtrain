# App Harness — architecture

**Status:** DESIGN (2026-07-29). Approved plan: `~/.claude/plans/ancient-exploring-kurzweil.md`.
Roadmap: `docs/plans/app-harness.md`. Research: `docs/research/cursor-sdk-vs-ai-layer.md`.

cadtrain is an **engine + harness**. A *sub-app* (wells, or a future user app) is a declarative
**`.app`** file. An AI authors/edits `.app` files and calls data verbs through a **tool schema
generated from one verb registry**, driven by a **multi-prompt orchestration pipeline**. The
runtime AI is **local-first** (Ollama/WebLLM) with a cloud option, and must run **air-gapped**.

---

## 1. The five layers

```
 1 VERB REGISTRY   src/lib/appkit/verbs/   — the SINGLE SOURCE OF TRUTH
      each op once: { name, group, desc, params(JSON-schema), returns, handler }
      groups:  data · mutate · gui
        │
        ├──▶ 2 TOOLS   verbs → Vercel AI SDK tool() defs  (SDK formats per provider)
        │              + to-cursor.ts (D7)  + to-apimd.ts (the authoring guide)
        ├──▶ 2 HTTP    /api/app/verb/[name]   (execution surface)
        └──▶ 2 DOCS    generated API.md       (human + AI authoring contract)
 3 .app MANIFEST   apps/<id>.app   declarative: panels · popovers · controls → verbs
 4 HARNESS UI      src/lib/shared/harness/   reads .app → PanelKind registry → wires dispatch()
 5 ORCHESTRATION   src/lib/appkit/ai/   Vercel AI SDK multi-prompt pipeline
                   providers: claude(cloud) · ollama/webllm(local) · [cursor(cloud, D7)]
                   grounded by cadtrain's existing BM25 RAG (reused)
```

**Why a single registry:** the API, the AI tool schema, the HTTP routes, and the authoring
guide are all *projections of one definition* — they cannot drift. Add a verb once; every
surface updates.

---

## 2. Layer 1 — the verb registry

```ts
// src/lib/appkit/verbs/registry.ts
export interface Verb {
  name: string;                                   // 'setRow'
  group: 'data' | 'mutate' | 'gui';
  desc: string;                                   // AI-facing — this IS the tool prompt
  params: JSONSchema;                             // input schema
  returns?: JSONSchema;                           // documented for API.md
  handler: (args: any, ctx: Ctx) => Promise<any>; // the executable
}
export const VERBS: Verb[] = [ /* data.ts, mutate.ts, gui.ts register here */ ];
```

`Ctx` carries the runtime handles a verb needs: the doc store (load/patch a graph doc),
the engine (`bake` via `/api/primitives/bake-preview`), and the app store (the live `.app`).

### Verb catalog v1 (the wells slice)

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
| mutate | `patchDoc` | `{id, op, path, value}` | `{ok}` | JSON push/set/remove |
| gui | `definePanel` | `{app, panel}` | `{ok}` | `.app` `panels[]` |
| gui | `addControl` | `{app, panelId, control}` | `{ok}` | `.app` control |
| gui | `bindAction` | `{app, controlId, verb, args}` | `{ok}` | `.app` binding |
| gui | `patchApp` | `{app, op, path, value}` | `{ok}` | JSON patch on the `.app` |
| gui | `listPanelKinds` | `{}` | `[{kind, props}]` | PanelKind registry |

The `mutate` verbs reuse the **#77** machinery: a well's shape is typed `list<record>` params
driven by `parts_map`/`parts_table`, so `addRow`/`setParam` are exactly the wells-params ops —
now expressed as verbs. See `wells_graph_native_decision`.

---

## 3. Layer 2 — schema projections

```ts
// src/lib/appkit/schema/to-aisdk.ts
export function toAiSdkTools(verbs = VERBS): Record<string, Tool>;   // Vercel AI SDK tool()
// to-cursor.ts   → Cursor customTools {description, inputSchema, execute}   (D7, deferred)
// to-apimd.ts    → the API.md authoring guide (panel kinds, control types, .app schema)
```

The **Vercel AI SDK absorbs per-provider formatting** — one projection (`to-aisdk`) feeds
Anthropic, Ollama, OpenAI, etc. `to-cursor` and `to-apimd` are separate, small projections.

---

## 4. Layer 3 — the `.app` manifest

A new typed volume file `apps/<id>.app` (JSON). Declarative; the AI only ever patches THIS.

```jsonc
{ "app": "wells", "title": "Well Designer", "docType": "well",
  "panels": [
    { "id": "list",  "kind": "list", "source": {"verb":"listDocs","args":{"docType":"well"}},
      "onSelect": {"verb":"loadDoc","args":{"id":"$item.id"}} },
    { "id": "params","kind": "form", "source": {"verb":"getParams","args":{"id":"$active"}},
      "controls": [
        { "id":"casings","kind":"table","bind":"casings","cols":["od","id","top","bot"],
          "onEdit": {"verb":"setParam"},
          "add":    {"verb":"addRow","args":{"list":"casings"}} } ] },
    { "id": "view",  "kind": "bake3d", "source": {"verb":"bake","args":{"id":"$active","params":"$params"}} }
  ],
  "popovers": []   // the AI appends these via patchApp / addControl
}
```

**Binding refs** the renderer resolves: `$active` (selected doc), `$item` (a list row),
`$params` (the bound doc's live params). **PanelKind registry v1:** `list · form · table ·
bake3d · svg · text · chat`. New kinds are added in code (a small Svelte component each); the AI
can only *compose* existing kinds — the D1/D5 safety boundary.

`apps/<id>.app` resolves through `src/lib/server/app-paths.ts` (mirrors `primitive-paths.ts`).

---

## 5. Layer 4 — the harness UI

- Route `src/routes/app/[id]/+page.svelte` mounts `shared/harness/HarnessView.svelte`.
- `HarnessView` renders `panels[]` by looking each `kind` up in the **PanelKind registry**,
  passing resolved `source` data + a `dispatch` fn. It knows nothing about wells — wells-ness
  lives entirely in `wells.app` + the verbs.
- Mirror wellnew's `Panel*.svelte` + runes-store shell ([[wellnew_repo]]) for the panel chrome.

---

## 6. Layer 5 — the multi-prompt orchestration (Vercel AI SDK)

A **pipeline of specialized prompts**, each small + checkable, with an agentic loop inside:

| Stage | AI SDK call | Output |
|---|---|---|
| **Intent** | `generateObject(IntentSchema)` | `{docType, goal}` |
| **Plan** | `generateObject(PanelPlanSchema)` + RAG examples | the panel/layout plan |
| **Build** | `generateText({tools: toAiSdkTools(), stopWhen: stepCountIs(N)})` | the agentic loop *emits verbs* until done |
| **Verify** | `generateObject(CritiqueSchema)` | "what's missing" → loops to Build |

- **Multi-step agentic loop** = Build: one call, N tool steps, results fed back automatically.
- **Prompt chaining** = the Intent→Plan→Build→Verify pipeline — more reliable than one prompt.
- **RAG multishot** = each stage seeded with retrieved examples from the BM25 corpus
  (`ai/rag.ts` adapts `src/lib/server/rag-chat.ts` — reuse, don't reinvent).
- **Multi-agent** (later) = split Build into Designer/Binder/Verifier (native in Mastra, the
  documented upgrade path; composable in the AI SDK).

**Providers** (`ai/providers/`): `claude.ts` (cloud, via `@ai-sdk/anthropic` reusing
`shared/anthropic-api.ts` key handling), `ollama.ts` (local, air-gapped), `cursor.ts` (D7
deferred stub). The pipeline is provider-agnostic; the runtime matrix (§8) picks one.

---

## 7. Dependency rules (enforced — same discipline as `engines/`)

- `appkit/` is **headless**: imports graph *types* + the `src/lib/server/*` utilities it reuses.
  **Never** Svelte, never a route. Runs in Node tests + workers.
- `shared/harness/` (UI) and the routes **import** `appkit/`. Never the reverse.
- The one edge: `ai/rag.ts` is a *thin adapter* over `server/rag-chat.ts` (server-only import).

---

## 8. Runtime matrix

| Environment | Model | Embeddings | Harness |
|---|---|---|---|
| **Restricted / air-gapped** | local (Ollama/WebLLM) | local (`nomic-embed-text`) | ours (declarative) |
| **Standard** | cloud Claude | cloud or local | ours (declarative) |
| **Power codegen (opt-in, D7)** | Cursor (cloud) | cloud | Cursor SDK (parallel harness) |

**RAG is a shared, provider-agnostic grounding layer.** Retrieval runs *upstream of and
independent from* the model call (`ai/rag.ts` builds a context block), so the SAME retrieved
context + golden examples feed BOTH the cloud-Claude path and the local-WebLLM/Ollama path. The
corpus is one source of truth (volume `ai/rag/` + `ai/feedback/`), mirrored locally for
air-gapped. → a non-conformance fixed once (§10) improves *both* runtimes at once.

RAG is **sequenced**: v1 reuses the existing BM25 corpus (lexical → zero deps, no embeddings, so
the index is trivially shared by every provider). Phase 2 (optional) adds a persistent vector
layer behind an `EmbeddingProvider`; to keep the index a SINGLE portable artifact usable by both
cloud and local, **standardize on ONE (local) embedding model** (`nomic-embed-text`) rather than
per-provider vectors — avoids dual indexes and preserves residency. Initial index + on-demand
"Sync & Upgrade".

---

## 9. Storage — `.app` on the volume or the local drive (the choice)

The **`.app` file IS the app structure** — self-contained and user-modifiable (it may change
shape over time). It loads through an **`AppStore`** abstraction (`src/lib/appkit/store/`) so its
*storage location stays flexible*, selectable per-app or globally (mirrors SVTC's
`datasourceStore.mode`):

- **`local`** (`local-backend.ts`) — **the v1 path**: the `.app` loaded from a path / the local
  drive (browser File System Access API, or a local dir the Node server reads). Private, offline.
- **`volume`** (`volume-backend.ts`, **DEFERRED** — user 2026-07-29: *no `apps/` dir for now*) —
  a future option: `apps/<id>.app` on the shared volume via a future `app-paths.ts`. Not built yet.

**We do NOT commit an `apps/` volume convention now.** Where `.app` files live is a user choice
decided later; coupled to the runtime matrix (§8), air-gapped ⇒ `local`.

**Lifecycle — dynamic → promoted (two tiers).** An `.app` is **self-contained** (panels,
controls, bindings, and the verbs it composes — hand someone the file and it runs on any
harness). It starts **dynamic**: runtime-loaded, AI-authored, no rebuild — *the focus now*.
When an app proves itself it can be **promoted** into `src/` as a first-class, hand-optimizable,
code-backed app (a real route + components) — the same duality cadtrain already has (dynamic
volume parts vs. canonical `src/` engine primitives; a volume part : stdlib :: an `.app` :
a promoted app). **Promotion is where codegen earns its place** — the D5/D7 AI-SDK/Cursor path
*compiles* a proven `.app` into source. Promotion is **deferred**; we build the dynamic tier first.

## 10. Feedback loop — refining the prompt/verb/RAG database on non-conformances

When a user reports a non-conformance (the AI built the `.app` wrong, or a verb sequence gave a
wrong result), a **closed flywheel** turns the report into a durable improvement — run LOCALLY
so no data leaves (data-residency). Lives in `src/lib/appkit/ai/feedback.ts`.

1. **Capture** the tuple `{prompt, retrieved RAG context, the tool/verb calls, the resulting
   .app/doc, the user's correction}` → a *non-conformance record*.
2. **Log** atomically to a feedback corpus on the volume (`ai/feedback/non-conformances.jsonl`,
   beside the existing `ai/training_data/` + `ai/eval/`).
3. **Human-verify** the correction (the fixed `.app` / verb sequence is the golden).
4. **Promote** into three places (reuse the `scripts/promote-to-vocab.ts` pattern):
   - the **RAG corpus** as a golden few-shot → future similar prompts retrieve the fix;
   - the **verb `desc`** (sharpen the tool prompt) or a per-verb "gotchas" note;
   - an **eval case** in `ai/eval/` (regression: "this prompt must produce this .app").
5. **Re-index** on the same "Sync & Upgrade" cycle as the RAG layer (§8), so corrections are
   live next run.

This is the training-data flywheel from the AI master plan (#27 feedback DB · #28 synthetic
data · #43 CHAT→WELLS correction log) + SVTC's `trainingLog.js`, applied to verb-authoring —
and the path to a good LOCAL model without cloud.

## 11. Decisions (locked)

D1 declarative `.app` (not generated Svelte) · D2 cadtrain hosts · D3 one registry = SSOT ·
D4 runtime local / dev cloud · D5 manifest-only first, codegen hatch later · D6 runtime AI sees
ONLY the generated tool schema + API.md (framework `llms.txt` is dev-time) · D7 Cursor SDK =
optional cloud-only codegen backend, deferred (never core, never restricted) · D8 Vercel AI SDK
= the orchestration layer (Mastra = documented upgrade path) · **D9** `.app` storage = an
`AppStore` (`volume` default + `local`), selectable, coupled to the runtime matrix · **D10**
every AI authoring run is feedback-logged; verified non-conformances promote into RAG golden
examples + verb desc + eval, re-indexed on Sync & Upgrade — all local · **D11** the RAG/feedback
corpus is ONE provider-agnostic source of truth, shared by cloud + local (retrieval runs upstream
of the model); if vectors are added, a single standardized local embedding model keeps the index
portable across both paths · **D12** two-tier — ENGINES (`src/`, Claude/dev-built, complex:
geometry Manifold/TF/BREP + primitives + any hard functionality) exposed as verbs; APPS (`.app`,
runtime-AI-built, thin) DRAW + WIRE engines. The verb registry is the boundary · **D13** the verb
registry = the COMPLETE API over the engines AND the app-builder; engine-verb coverage widens as
engines grow · **D14** per-engine RAG/LLM — federated experts, not one monolith; each engine
carries its own knowledge (authored with Claude) · **D15** the build pipeline is structured /
progressive / deterministic and captures every build to the corpus → a learning system; iterate
hello-world → wells · **D16** three authoring surfaces over ONE `.app`: AI chat · native visual
editor (rung 4b) · the rendered harness.

---

## 12. Build-via-AI — the two-tier model (engines vs apps)

**The boundary between the two tiers is the verb registry.**

- **ENGINES** (`src/`, built by **Claude / dev-time**) — the complex, heavy functionality: the
  geometry kernels (Manifold / TF / BREP), the primitives pipeline, any hard logic. Each is
  exposed as **verbs** (its slice of the API). "Promote complex functionality into an engine" =
  the D5 promotion path.
- **APPS** (`.app`, built by the **runtime AI** from prompts) — thin, declarative GUIs that
  **draw the engines and wire them together**. An app implements no complex logic; it composes
  verbs (a panel's `source` / `onEdit` bindings) into a GUI.

So: *Claude builds engines; the AI builds apps.* "The prompt makes the function build the app."
For the AI to draw + wire freely, the registry must expose the **full** engine API — rung 3+ keeps
widening that coverage (list · compile · bake · preview · save · the engine-specific ops).

## 13. Per-engine RAG / LLM — federated experts

Each engine carries its **own** RAG corpus (and optionally a specialized LLM / prompt) — a
**federated-expert** model, not one monolithic RAG. When the builder uses an engine it grounds on
*that* engine's knowledge. This scales: adding an engine adds its verbs **and** its knowledge,
self-contained; the app-builder orchestrates across experts. Per-engine RAG/LLM is authored with
**Claude** (dev-time); the registry ties each engine's verb-group to its corpus.

## 14. The progressive, deterministic build pipeline + the learning system

Not one freeform call — a **structured, progressive** recipe: ordered build-steps, each
`retrieve engine RAG → focused prompt → call verbs → verify the fragment → capture`. Deterministic
and reproducible. Every successful step is **captured** to the app-building corpus (seed:
`_builds.jsonl`, written by `/api/app/generate`) → retrieval grounds **future** builds → the system
**learns** to build apps and gets more deterministic over time (the D10/D11 flywheel applied to
*building*). **Iterate hello-world → wells:** start from a text "hello world" app and progressively
add panels (list → form/casings → survey → 3D bake) until it is the full wells app — against the
reference layout we already have (this repo's `wells.app` + `/wells`, SVTC, wellnew).

## 15. Authoring surfaces — three hands, one `.app`

```
        ┌── AI chat (the build pipeline) ──┐
.app ◄──┼── native visual editor (rung 4b) ─┼──►  the rendered harness
        └──────── all edit the ONE .app ─────┘
```

Rung 4b = a **native lightweight visual `.app` editor** (palette = the PanelKinds; drag-to-place;
bind-control-to-verb) — mining **Svelte Visual Builder** (MIT, Svelte 5, host-owns AI/data/
persistence) for patterns rather than adopting its page-model wholesale. AI and human co-edit the
same manifest; the AI piece is our own pipeline (residency-safe).
