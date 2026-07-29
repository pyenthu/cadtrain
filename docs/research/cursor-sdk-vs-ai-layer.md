# Research — Cursor SDK vs. the harness AI layer (SVTC vs. cadtrain vs. off-the-shelf)

**Date:** 2026-07-29. Feeds `docs/architecture/app-harness.md` (Layer 5) + the runtime matrix.
Question: what should drive the harness's AI — the Cursor SDK, a port of SVTC's local-first
loop, or a modern orchestration framework? And can any of them run **air-gapped**?

---

## 1. Cursor SDK — verified against the official docs

Source: **https://cursor.com/docs/sdk/typescript** (public beta 2026-04-29).

- **Real API:** `import { Agent } from "@cursor/sdk"` → `Agent.create({ apiKey, model:{id},
  local:{ cwd, customTools } })` → `agent.send(msg)` → `run.stream()` (async gen of
  `SDKMessage`, discriminated on `type`); also `Agent.resume(id)`, `Agent.prompt()`.
- **customTools shape:** `{ description, inputSchema (JSON-Schema), execute }` — *nearly
  identical to our verb shape and SVTC's `TOOLS`*. So our registry could project to Cursor too.
- **Modes:** `local` / `cloud` / self-hosted (`env:{type:'pool'|'machine'}`).
- **THE KILLER FACT (quoted):** *"All inference goes through Cursor's hosted models in both
  modes. Local mode keeps your files on your machine; cloud mode runs in a Cursor environment."*
  `local` only keeps **files + tool execution** on-box. **No air-gapped / offline mode is
  documented.** Token-billed; needs `CURSOR_API_KEY`; same pricing/Privacy-Mode as the IDE.

**Verdict:** Cursor is a *cloud code-writing agent*. Its model inference is always cloud, so it
**structurally breaks the restricted-env requirement** and it *writes code files* (our deferred
D5 codegen hatch) rather than patching a declarative manifest. → **Optional, cloud-only backend
(D7); never the core, never in a restricted environment.** The AI overview code circulating
(`new CursorAgent`, inline `customTools`, `runtime:'local'`) is partly inaccurate vs. the real
API above — do not copy it.

---

## 2. Three-way AI-layer comparison

| Dimension | **Cursor SDK** | **SVTC AI layer** (the reference) | **cadtrain today** |
|---|---|---|---|
| What it is | full cloud coding-agent harness | home-grown tool-loop over Claude/WebLLM | mature RAG + cloud backend, no loop |
| Tool schema | `customTools {description,inputSchema,execute}` | `TOOLS[]` + `toClaudeTools()` | none (we build the registry) |
| Loop / dispatch | Cursor runs it (opaque) | `dispatchToolCall` + `MAX_TOOL_STEPS` | none |
| Model | **Cursor cloud ONLY** | Claude (cloud) **or WebLLM (local)** | Claude cloud; WebLLM planned |
| RAG | Cursor cloud indexing | TF-IDF over IndexedDB (local) | **BM25 over a real corpus** — *more mature* |
| Data residency | ❌ inference always cloud | ✅ WebLLM path local | ✅ server-local + WebLLM planned |
| Output | writes **code files** | patches a **JSON manifest** (`.tpl`/`.wson`) | (target: patch `.app`) |
| Air-gapped | ❌ no offline mode | ✅ WebLLM offline | ✅ possible |

**SVTC's AI layer** (`~/code/SVTC/src/lib/ai/`): `toolSchema.js` (`TOOLS[]` + `toClaudeTools()`,
shared Claude/WebLLM) · `tools.js` (`name→handler` map + `dispatchToolCall` + `readAppState`) ·
`chat.svelte.js` (the `while (tool_use && steps<MAX) { dispatchToolCall; push tool_result }`
loop; logs every turn as training data) · `webllm/` (the local path) · `rag.js` (TF-IDF/IndexedDB,
no embed download) · `API.md` (a ~5-import allowlist for generated components).

**Conclusion:** SVTC's local-first tool-loop is the right *pattern*, and cadtrain already owns
the RAG half (`server/rag-{corpus,chat,l1,prompt,query}.ts` — BM25, pure/injectable — better
than SVTC's TF-IDF). Cursor duplicates the loop in cloud form and loses residency.

---

## 3. Orchestration layer — off-the-shelf beats a hand-rolled loop

We should NOT hand-port SVTC's raw loop — that means owning provider-abstraction, streaming,
and structured output forever (undifferentiated plumbing). The 2026 options:

| Dimension | **Vercel AI SDK** | **Mastra** | **Hand-port SVTC** |
|---|---|---|---|
| Local / air-gapped | ✅ server-side Ollama, one interface | ✅ Ollama (40+ providers) | ⚠️ we wire it |
| Multi-step agentic loop | ✅ `stopWhen`/`maxSteps` | ✅ | ⚠️ build it |
| Native multi-agent | ➖ composable | ✅ **native** | ⚠️ by hand |
| Built-in memory / recall | ➖ build on our RAG | ✅ **built-in** | ➖ our RAG |
| Structured output | ✅ `generateObject` + Zod | ✅ | ❌ hand-rolled (fragile locally) |
| SvelteKit fit | ✅ `@ai-sdk/svelte` | ➖ own agent backend | ⚠️ custom streaming |
| Reuse our registry + RAG | ✅ verbs → `tool()`, SSOT kept | ⚠️ wants to own tools/memory/RAG | ✅ |
| Dependency / lock-in | 🟢 modular, low | 🔴 heavy, opinionated | 🟢 zero deps |

**Recommendation: Vercel AI SDK (v6)** — best fit for our constraints: model-agnostic (cloud
Claude + local Ollama through one interface → same pipeline standard *or* air-gapped), least
invasive (consumes our verb registry as `tool()` defs, reuses BM25 RAG + `@ai-sdk/anthropic`,
registry stays SSOT), and it delivers multi-prompt directly (`generateText` agentic loop +
`generateObject` chaining). **Mastra = the documented upgrade path** when we want native
multi-agent + durable working memory (heavier, more lock-in, wants to own the RAG/tools we
already have). Borrow SVTC's *patterns* (tool-schema shape, training log, XGrammar for local
constrained decoding), not its loop.

**Honesty caveat:** the AI SDK is Node/edge-first, so *fully in-browser* WebLLM (no server) is a
narrower, later case. The clean air-gapped path is a locally-running SvelteKit server + a local
Ollama sidecar — nothing leaves the box.

---

## Sources
- [Cursor TypeScript SDK docs](https://cursor.com/docs/sdk/typescript)
- [Cursor SDK launch — MarkTechPost](https://www.marktechpost.com/2026/04/29/cursor-introduces-a-typescript-sdk-for-building-programmatic-coding-agents-with-sandboxed-cloud-vms-subagents-hooks-and-token-based-pricing/)
- [AI SDK by Vercel — docs](https://ai-sdk.dev/docs/introduction)
- [AI SDK 6 — Vercel](https://vercel.com/blog/ai-sdk-6)
- [Mastra — TypeScript AI framework](https://mastra.ai/)
- [Ollama + Vercel AI SDK](https://localaimaster.com/blog/ollama-vercel-ai-sdk)
