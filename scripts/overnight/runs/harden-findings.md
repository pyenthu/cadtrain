# Overnight code-hardening findings (2026-08-02)

## `src/lib/appkit/ai/build-cli.ts` — 23:07
Read the file plus its dependency chain (`prompt.ts`, `dispatch.ts`, `gui.ts`, `sanitize.ts`, `pipeline.ts`, and the caller `/api/app/generate`), then ran the aliasing case to confirm rather than infer.

## Confirmed bug — the trace records post-mutation state, not what the model emitted (lines 33/38/40)

`trace.push({ …, args: c.args })` stores a **live reference** to the parsed args object. The gui verbs mutate that same object and insert it into `app`: `definePanel` (gui.ts:124-126) sets `panel.id`, pushes `a.panel` itself into `app.panels`, then `promote()` rewrites `panel.props` into `$vars.*` refs. `sanitizeApp(app)` at line 43 then deletes bindings **through the alias**.

Verified with a fake runner emitting three calls (`bun -e`, real registry):

```
model emitted : {"panel":{"id":"greeting","kind":"text","props":{"color":"red"}}}
trace[0].args : {"panel":{"id":"greeting","kind":"text","props":{"color":"$vars.greeting.color",
                 "text":"$vars.greeting.text","size":"$vars.greeting.size", …}}}   // +5 props it never sent

model emitted : {"panel":{"id":"lst","kind":"list","source":{"verb":"static","args":{}}}}
trace[2].args : {"panel":{"id":"lst","kind":"list"}}        // source gone — sanitizeApp deleted it
trace[0].args.panel === out.app.panels[0]  →  true
```

Two concrete consequences:

1. The hallucinated `source:{verb:"static"}` — the exact case `sanitize.ts` exists to catch, and the exact example named in its header comment — is **erased from the trace by the sanitizer itself**. The trace can never show what was stripped, which is the one thing it's for (`pipeline.ts:29-30`: "what turns 'N steps ran' into 'setComponentProp({…})'").
2. `captureBuild({ trace })` in `generate/+server.ts:97-107` persists these fabricated args to the corpus JSONL, so the audit log of every CLI build is wrong. (Grounding only renders `app.panels` kind/id, so few-shot text isn't poisoned — the damage is confined to the audit/debug record and the studio's trace view.)

Fix: snapshot before dispatch and push the snapshot — `const args = structuredClone(c.args)` (args are always JSON-parsed, so cloneable), used for all three `trace.push` sites.

`pipeline.ts:67` has the identical defect for the same reason, so this isn't CLI-only.

## Secondary (real but lower impact)

- **Line 29 — `opts.engine` is silently dropped.** `BuildOpts` declares `engine?: AppEngine` and `pipeline.ts:53` builds `{ appStore: app, engine }`; here it's `{ appStore: app }`. Latent today (no `gui` verb reads `ctx.engine` — grepped), but the two paths claim parity and the first engine-using gui verb will fail only on the CLI path, with `ctx.engine` undefined rather than a clear error.
- **Line 44 — `steps: trace.length` counts failures and rejects as steps.** A response whose calls all get `'not a callable gui verb'` still reports `steps: N ≥ 1` to the client and the corpus. `isCleanBuild` (app-corpus.ts:296) catches it via the `some(t => t.ok)` gate, but `rankPromotionCandidates`' "focused (≤8 steps)" bonus scores on the inflated count, and the route returns 200 with a "N steps" result for a build that did nothing.
- **No repair round for a failed verb.** Unlike the SDK path (where a throwing `execute` returns the error to the model, which can correct on the next step), this is one turn: e.g. `bindAction` is advertised as callable by `emitInstruction()` (prompt.ts:41 lists all `gui` names) but its handler is `pending()` and throws unconditionally, so an `addControl` + `bindAction` pair yields a button wired to nothing, `ok:true`/`ok:false`, and a 200. Worth at least surfacing failed-verb count to the caller.

## `src/lib/appkit/ai/component-cards.ts` — 23:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:47
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:48
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:49
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:50
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:53
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:54
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:55
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:56
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 23:57
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 23:58
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 23:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:02
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:03
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:04
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:05
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:06
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:07
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:08
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:09
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:10
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:11
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:12
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:13
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:14
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:15
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:19
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:20
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:21
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:22
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:23
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:24
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:25
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:26
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:27
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:28
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:29
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:30
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:31
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:32
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:35
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:36
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:37
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:38
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:39
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:40
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:41
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:42
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:43
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 00:44
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 00:45
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 00:46
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 00:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 00:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 00:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 00:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 00:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 00:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 00:59
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 01:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 01:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 01:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 01:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 01:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 01:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 01:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 01:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 01:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 01:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 01:16
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 01:17
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 01:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 01:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 01:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 01:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 01:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 01:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 01:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 01:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 01:18
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 01:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 01:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 01:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 01:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 01:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 01:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 01:33
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 01:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 01:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 01:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 01:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 01:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 01:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 01:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 01:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 01:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 01:34
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 01:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 01:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 01:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 01:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 01:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 01:51
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 01:52
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 02:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 02:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 02:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 02:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 02:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 02:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 02:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 02:00
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 02:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 02:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 02:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 02:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 02:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 02:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/volume.ts` — 02:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 02:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 02:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 02:01
You've hit your session limit · resets 2:10am (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:18
Three real issues.

**1. `${path}.tmp` is a fixed name — concurrent same-id builds corrupt the .app (lines 92–94)**

```ts
const tmp = `${path}.tmp`;
await writeFile(tmp, ...);
await rename(tmp, path);
```

The temp name is derived only from `path`, so two overlapping POSTs for the same `id` share one temp file. Concrete failure: request A and B both build `plan`; A's `writeFile` is mid-flight when B's `writeFile` opens the same path with `O_TRUNC`; the bytes interleave, then A's `rename` moves that half-written file onto `plan.app.json`, and B's `rename` rejects `ENOENT` — unhandled, so B returns a 500 *after* the model call already ran, and `captureBuild` (line 97) is skipped for that build. The on-disk manifest is now truncated JSON. Neither `writeFile` nor `rename` is wrapped, so a failure at line 93 (ENOSPC, read-only dir) also 500s and discards `out.app` — for the id path that work is unrecoverable, since the client isn't holding the manifest.

This violates the atomic-write contract in CLAUDE.md Rule 4. Fix: unique suffix (`${path}.${process.pid}.${n}.tmp`) plus an in-process per-path lock, and `unlink` the temp in a `finally`.

**2. `JSON.parse(raw)` is unguarded (line 58)**

```ts
const res = validateManifest(JSON.parse(raw));
```

Every other failure on this branch is mapped deliberately — bad id → 400 (line 50), missing file → 404 (line 56), bad shape → 422 (line 59) — but a syntactically invalid file throws a bare `SyntaxError`, which SvelteKit renders as a 500 "Internal Error" with the message stripped in prod. Concrete: any hand-edited or truncated file in `appsDir()` (including one produced by issue #1) makes `POST {id:'plan',prompt:'x'}` return 500 forever with no hint that the file is corrupt. Wrap it and reuse the 422.

**3. `provider` is caller-controlled on a publicly reachable endpoint (lines 25–33)**

`req === 'cli'` short-circuits the env, and `hooks.server.ts:211` leaves `/api/*` open when `AUTH_TOKEN` is unset ("API is public (for demo mode)"); `RATE_LIMITED_PREFIXES` is `[]`, and this path isn't in `FLOOD_GUARD_PREFIXES`. So an unauthenticated `{"provider":"cli"}` spawns a `claude --print` subprocess per request — 180 s each (`claude-cli.ts:18`), unbounded concurrency, billing the Max subscription — and also bypasses the 503 guard at line 35 by picking a non-cloud backend. `provider:'local'` likewise redirects inference to `OLLAMA_URL`. On prod the spawn fails fast (no binary) so the practical exposure is a dev box, but nothing ties the per-request override to a dev environment. Gate the override on `env.APP_BUILD_PROVIDER` already permitting it (or on dev), rather than accepting it from the body unconditionally.

Not flagged: `captureBuild` at line 97 is safe to leave unguarded — every store implementation (`app-corpus-store.ts:95`, `:207`) swallows its own I/O errors.

## `src/routes/api/app/ground/+server.ts` — 03:19
Reviewed `src/routes/api/app/ground/+server.ts` against `buildGrounding` (`src/lib/server/app-corpus.ts:339`), `rankBuilds`/`rankGolden`, and `golden-templates.tokenize`. Two real issues:

**1. `prompt` type is unvalidated → 500 TypeError instead of 400 (`+server.ts:13`, `:20`)**

Line 13 only does a truthiness check, while `docType` (line 16) and `vector` (line 19) both get `typeof` guards. So any truthy non-string passes the gate and is handed to `buildGrounding` as a `string` via the cast on line 11.

Failure path: `POST {"prompt": 42}` (or `{"prompt": {"text":"a form"}}`, or `{"prompt": ["a form"]}`) with no `docType` → `buildGrounding` → `rankBuilds(prompt, …)` → `app-corpus.ts:58` `tokenize(prompt)` → `golden-templates.ts:35` `s.toLowerCase()` → `TypeError: s.toLowerCase is not a function`, uncaught → SvelteKit 500. Note `tokenize` is called unconditionally at the top of `rankBuilds`, before the corpus map, so an empty corpus does not save it. (If `docType` *is* supplied, `rankBuilds` is skipped at `app-corpus.ts:346` and the crash only happens once the docType-filtered golden pool is non-empty, via `goldenScore` → `tokenize` — so the bug reproduces intermittently depending on corpus contents, which is worse for diagnosis.)

Fix: `if (typeof body?.prompt !== 'string' || !body.prompt) throw error(400, 'missing prompt');`

**2. `k` has no upper bound or integer check (`+server.ts:14`)**

`k` is only checked for `typeof number && > 0`, so `Infinity` or `1e9` passes straight into `.slice(0, k)` at `app-corpus.ts:63` and `:91`. `POST {"prompt":"form","k":1e9}` returns *every* clean build plus *every* golden pair, each rendered with a full `compactApp` JSON dump (`renderGrounding`, `app-corpus.ts:269`) — one request materializes the entire corpus into a single string in memory and in the response. `/api/app/ground` sits under `/api/` and is public whenever `AUTH_TOKEN` is unset (demo mode, `hooks.server.ts:211`), and it is not in `FLOOD_GUARD_PREFIXES`. Clamp it: `Math.min(Math.floor(k), 10)`.

Related but lower severity, same line region: `vector` (line 19) lets any caller force the embedding path on regardless of the server's `APP_RAG_VECTOR` default, including the first-call transformers.js model load. It's index-cached and error-swallowing (`vector-retrieval.ts:23`, `:33`), so it won't fail — but a knob documented as "for the eval hill-climb" is reachable by untrusted callers. Worth gating on an env flag or dev-only.

No race conditions in this handler itself — it's stateless and read-only.

## `src/routes/api/app/learn/+server.ts` — 03:22
Reviewed the file plus its one dependency (`app-corpus.ts` → `app-corpus-store.ts`), since every real failure path here runs through that call.

**1. `+server.ts:25` — `{ ok: true }` is returned whether or not the report was persisted.**
`reportNonConformance` → `getCorpusStore().appendNonConformance()`, and both store implementations are deliberately best-effort: the fs one wraps `mkdir`+`appendFile` in `try {} catch { /* ignore */ }` (`app-corpus-store.ts:113-120`), and the remote one calls `putText`, which swallows the fetch rejection *and* never checks `r.ok` (`app-corpus-store.ts:196-202`). So the handler awaits a function that cannot report failure and then asserts success. Concrete: local dev with `CADTRAIN_VOLUME_REMOTE_URL` set and the known `*.up.railway.app` DNS refusal (or prod returning 401/500 on the PUT) → `putText` catches → `POST /api/app/learn` returns 200 `{ok:true}` → `LearnPanel.svelte:61` shows "⚠ reported — thanks", `app_design/+page.svelte:222` returns `{ok:true}` — and zero bytes were written. The negative signal this endpoint exists to capture is lost silently, in the one direction where the user believes it was captured.

**2. `+server.ts:18` (defect in `app-corpus-store.ts:219-221`) — a failed read truncates the entire non-conformance history.**
The remote store appends by read-modify-write: `getText('non-conformances.jsonl')` → concat → `putText` of the whole file. `getText` returns `null` for a genuinely missing file *and* for a non-2xx response *and* for a thrown fetch (`app-corpus-store.ts:188-195`) — the three are indistinguishable. So one transient 502/timeout on the GET makes `cur === null` → `prefix = ''` → the PUT overwrites the file with a single line. Concrete: 200 accumulated reports, prod hiccups on the read for one request, and the file comes back with just that request's record; the response is still 200 `{ok:true}`. `appendBuild` (line 208-210) has the identical bug against `builds.jsonl` — the whole RAG build corpus.

**3. `+server.ts:17` — non-string `note` throws instead of returning 400.**
`body?.note?.trim()` guards only `null`/`undefined`, not the type. The `as` cast on line 14-16 is an unchecked assertion over attacker/client-controlled JSON. `POST {"note": 123}` (or `{"note": {}}`, `{"note": ["x"]}`) → `body.note.trim` is `undefined` → `TypeError: body.note.trim is not a function` → SvelteKit 500, not the intended `error(400, 'missing note')`. Same class on line 20: `body.prompt ?? ''` persists a number/object into the JSONL typed as `string`, which will break the first consumer that calls a string method on `NonConformance.prompt`.

**4. `+server.ts:18` (in `app-corpus-store.ts:218-221`) — concurrent reports lose records.**
The remote append has no lock: two overlapping POSTs both GET the same content and the second PUT overwrites the first record. The store comment claims "dev-only (single user → no race)", but three separate UI surfaces post here (`LearnPanel.report`, `ChatPanel`'s report path, `app_design.reportPrompt`) and nothing serializes across tabs — two studio tabs, or a report firing while another is in flight, silently drops one. The fs path (`appendFile`, O_APPEND) is fine; only the remote path races.

Fixes 1 and 3 are local to this file (have `reportNonConformance` surface a boolean/throw and return 500 on write failure; validate `typeof body.note === 'string'`). 2 and 4 need `getText` to distinguish 404 from error and `putText` to check `r.ok`.

## `src/routes/api/app/list/+server.ts` — 03:23
**CLEAN** — for the file as given.

`src/routes/api/app/list/+server.ts` has no correctness defect. `listApps` is total (it catches `readdir` at `app-paths.ts:47` and `readFile`/`JSON.parse` at `:58`), so the un-try/caught `await` in the handler cannot realistically throw; a file deleted between `readdir` and `readFile` is a TOCTOU window that degrades to `title: undefined` rather than a 500. No proxy call is missing either — `app-paths.ts` documents this dir as deliberately local, not volume-backed, so Rule 13 doesn't apply.

Two things I verified in its sole dependency, outside the reviewed file, both currently **latent** (the default apps dir is empty and no `.app`/`.app.json` file in the repo has an unfetchable id):

- `app-paths.ts:52` derives ids with `slice()`, but `appFilePath` validates them against `/^[a-zA-Z0-9_-]+$/` at `:27`. These disagree: `dash.v2.app.json` → id `dash.v2`, which lists fine but throws on open. Consumers handle it cleanly (`load/+server.ts` → 400, `app/[id]/+page.server.ts` → 400), so the symptom is a listed-but-unopenable entry, not a crash. Worth noting that `app/[id]/+page.server.ts:17` first sanitizes `dash.v2` → `dash_v2` and checks the volume, so if `dash_v2.app.json` exists there it would silently serve a *different* app.
- A *directory* named `foo.app` is listed as a phantom app (`readFile` → `EISDIR`, swallowed at `:58`, entry still pushed at `:61`).

The comment on `:53` ("`.app.json` wins over a same-id `.app`") is inaccurate — dedupe follows `readdir` order, not `APP_EXTS` order — but it's harmless, since the title is always read through `appFilePath`, which does prefer `.app.json`.

## `src/routes/api/app/load/+server.ts` — 03:24
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:24
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:25
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:26
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:27
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:28
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:29
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:30
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:31
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:35
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:36
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:37
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:38
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:39
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:40
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:41
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:42
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:43
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:44
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:45
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:46
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:47
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:48
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:49
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:50
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:53
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:54
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:55
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:56
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 03:57
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 03:58
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 03:59
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 04:00
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 04:01
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 04:02
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 04:03
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 04:04
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 04:05
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 04:06
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 04:07
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 04:08
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 04:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 04:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 04:11
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 04:12
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 04:13
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 04:14
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 04:15
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 04:16
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 04:17
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 04:32
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-templates.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/bake-cache.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/claude-cli.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/golden-templates.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/local-embedder.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-bake.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/manifold-guard.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/part-colors.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-loader.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitive-paths.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/primitives-meta.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/profile-fn.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-chat.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-corpus.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-l1.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-prompt.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/rag-query.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/recognize-composite.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/script-cache.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/stdlib.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/training-log.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/vector-retrieval.ts` — 04:33
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/volume.ts` — 04:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/well-samples.ts` — 04:34
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/cad-bake/+server.ts` — 04:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/capture/+server.ts` — 04:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/generate/+server.ts` — 04:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/ground/+server.ts` — 04:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/learn/+server.ts` — 04:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/list/+server.ts` — 04:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/load/+server.ts` — 04:51
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/promote/+server.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/save/+server.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/session/+server.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/snapshot/+server.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/routes/api/app/templates/+server.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/build-cli.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/component-cards.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/embeddings.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/eval-fixtures.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/pipeline.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/prompt.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/providers.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/sanitize.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/score-app.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-build.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm-model.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/ai/webllm.worker.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/catalog.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/catalog/components.ts` — 04:52
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/compute.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/doc.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/promote-props.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/refs.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/types.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/manifest/validate.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-aisdk.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/schema/to-apimd.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/app-store.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/store/local-backend.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/api.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/data.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/dispatch.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/gui.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/mutate.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/appkit/verbs/registry.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/anthropic-api.ts` — 05:09
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus-store.ts` — 05:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-corpus.ts` — 05:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-paths.ts` — 05:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-render.ts` — 05:10
You've hit your weekly limit · resets 9:30pm (Asia/Calcutta)

## `src/lib/server/app-session.ts` — 06:45
API Error: Unable to connect to API (ENOTFOUND)
