# `src/lib/appkit/` — the app-harness kit (HEADLESS)

The engine of the **app harness**: cadtrain-as-a-platform for *sub-apps*. A sub-app is a
declarative **`.app`** file; an AI authors/edits it through a **tool schema generated from one
verb registry**, driven by a **multi-prompt orchestration pipeline** (Vercel AI SDK). See
`docs/architecture/app-harness.md` (design), `docs/plans/app-harness.md` (roadmap),
`docs/research/cursor-sdk-vs-ai-layer.md` (why not Cursor / why the AI SDK).

## Dependency rule (why this module is HEADLESS — same discipline as `engines/`)

- **`appkit/` imports only** graph *types* (`$lib/graph/composition/*`) + the
  `$lib/server/*` utilities it reuses (`rag-chat`, `anthropic-api`, `app-paths`, `volume`).
  **NEVER** Svelte, never a route. It runs in Node tests + workers.
- **UI → appkit is OK** (`src/lib/shared/harness/*` + `src/routes/app/*` import appkit).
  **appkit → UI is NEVER.**

## Layout

```
appkit/
├── verbs/     LAYER 1 — the SINGLE SOURCE OF TRUTH
│   registry.ts   Verb type + VERBS[] + register()
│   data.ts       listDocs · loadDoc · getParams · bake · listParts
│   mutate.ts     setParam · addRow · removeRow · reorderRow · patchDoc   (reuse #77 list<record>)
│   gui.ts        definePanel · addControl · bindAction · patchApp · listPanelKinds
│   dispatch.ts   dispatch(name,args,ctx) + Ctx { docStore, engine, appStore }
├── schema/    LAYER 2 — projections (pure data)
│   to-aisdk.ts   verbs → Vercel AI SDK tool() defs   (the SDK formats per provider)
│   to-cursor.ts  verbs → Cursor customTools           (D7, deferred)
│   to-apimd.ts   verbs → the API.md authoring guide    (D6 — the ONLY doc the runtime AI sees)
├── manifest/  LAYER 3 — the .app document
│   types.ts · validate.ts · refs.ts ($active/$item/$params resolver)
├── store/     the .app STORAGE choice (D9)
│   app-store.ts       backend-agnostic load/save/list
│   volume-backend.ts  apps/<id>.app on the shared volume (via server/app-paths.ts) — DEFAULT
│   local-backend.ts   the local drive (File System Access / a local dir) — private, offline
└── ai/        LAYER 5 — the multi-prompt orchestration (Vercel AI SDK)
    pipeline.ts   Intent→Plan→Build→Verify (generateObject/generateText + stopWhen)
    rag.ts        provider-agnostic grounding — adapts server/rag-chat.ts (BM25). Retrieval runs
                  UPSTREAM of the model, so the SAME context feeds cloud Claude AND local WebLLM.
    feedback.ts   D10 flywheel — capture {prompt, RAG ctx, verb calls, .app, correction} →
                  ai/feedback/non-conformances.jsonl → human-verify → promote to RAG golden +
                  verb desc + eval → re-index on Sync & Upgrade. All local.
    embeddings.ts EmbeddingProvider (Phase 2; ONE standardized local model so the vector index
                  is portable across cloud + local — D11).
    providers/    claude.ts (cloud) · ollama.ts (local) · cursor.ts (D7 stub)
```

## The one invariant

**One verb, defined once in `verbs/`, projects to everything**: the AI tool schema, the HTTP
route (`/api/app/verb/[name]`), and the `API.md` guide. Add a verb → every surface updates; the
API and the tool schema cannot drift (D3). The runtime AI sees ONLY the generated schema +
`API.md` — never framework docs (D6).

## Where the UI + routes live (NOT here)

- `src/lib/shared/harness/` — `HarnessView.svelte` + the PanelKind components (Layer 4).
- `src/routes/app/[id]/` — mounts the harness for one `.app`.
- `src/routes/api/app/` — `verb/[name]` (dispatch) · `chat` (the AI SDK pipeline, SSE) · `index` (RAG upgrade).
- `src/lib/server/app-paths.ts` — resolves `apps/<id>.app` (mirrors `primitive-paths.ts`).
