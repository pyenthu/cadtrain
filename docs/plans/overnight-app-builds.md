# Overnight `.app` builds — `plan.app` · `design.app` · `ewell.app` (BY PROMPT)

Status: PLAN (2026-07-30). Tasks #34 (plan) · #35 (design) · #36 (ewell) · #37/#38
(AI-system enhancement) · #39 (cost-safe backend, a prerequisite).

## North star — "the prompt is the programming language"

Every target app is built **only by feeding natural-language prompts to the harness AI
builder** (`/api/app/generate` → `buildApp`). We do **not** hand-author the `.app` JSON.
Hand-authoring is allowed **only** for (a) component code in `src/lib/app_components/` and
(b) curated golden RAG examples. The three demos are the **forcing function**: building
them by prompt reveals exactly what the component library and the AI system are missing —
and we **fix those** until the app is fully promptable. The win is not three demos; it is a
builder that can produce them (and their kin) deterministically from prompts.

## Backends — prod = API · dev = CLI or Ollama · browser = Phi (DECIDED 2026-07-30)

The app-builder (`/api/app/generate`) selects a backend via `APP_BUILD_PROVIDER`; the
**chatbot exposes all three as a model toggle: `CLAUDE CLI · CLAUDE API · PHI`.** Overnight
runs MUST NOT use the metered API key — use CLI, Ollama, or Phi.

| Toggle | `APP_BUILD_PROVIDER` | Bills | Residency | Env | Status |
|---|---|---|---|---|---|
| **CLAUDE API** | `cloud` (default) | metered **ANTHROPIC_API_KEY** | cloud | prod (Railway — the only option there) | ✅ existing |
| **CLAUDE CLI** | `cli` | **Max/Pro subscription** (flat) | cloud | dev only (`claude` binary) | ✅ **BUILT** — `server/claude-cli.ts` + `appkit/ai/build-cli.ts` |
| **Ollama** | `local` | nothing | local server (:11434) | dev | ✅ wired (`providers.ts`) |
| **PHI (WebLLM)** | (browser, not this endpoint) | **nothing** | **perfect (in-browser, offline)** | dev/browser | ⏳ **#40** — port SVTC `src/lib/ai/webllm/` |

- **CLAUDE CLI (built):** the `claude --print` subprocess bills the flat subscription, NOT
  the API key (subscription billing works ONLY through the CLI, never the SDK). It can't run
  our tool `execute` callbacks, so the model **emits a JSON verb-list → we `dispatch()` each**
  (`build-cli.ts`), reusing the SAME `systemPrompt` + verb registry + trace. ~5–7× slower.
- **PHI / WebLLM** is the residency star — zero API + zero subscription, runs in the browser
  via WebGPU (satisfies AI-data-residency outright). Tool-calling needs constrained output
  (XGrammar/JSON) — SVTC `webllm/prompt.js` shows it. Ties to `todo_webgpu_slm`.
- **Note on SVTC:** its Claude path (`src/routes/api/chat/+server.js`) is a direct fetch to
  `api.anthropic.com` with `x-api-key` = the **metered API key**, not a CLI subprocess — so
  there was nothing to reuse; our `cli` backend is new. SVTC's only cost-free path is Phi.

## Prompting interface — port SVTC's floating ChatPanel (#41)

The user prefers the SVTC prompting UX (screenshot 2026-07-30): a **floating chat panel**
(launcher FAB → panel) with a **`Claude | Local` model toggle** (SVTC labels the local one
"Phi"), a conversational thread, and tool-calling ("generate a custom component"). Port it
into the studio to sit ALONGSIDE / above the current inline ✨ bars. Reference (all local):
`~/code/SVTC/src/lib/ai/` — `ChatPanel.svelte` + `chat.svelte.js` + `systemPrompt.js` +
`tools.js`/`toolSchema.js` (the tool SSOT, our analogue = the verb registry) + `webllm/`
(the WebLLM variant). The model toggle switches the app-builder backend (WebLLM ↔ Claude);
the SAME verb registry drives both. This is where "the prompt is the programming language"
becomes the primary surface.

## The build loop (per app, INCREMENTAL)

1. **Study the source** to derive a build order (structure → data → interaction). We have
   the source for all three:
   - `plan.app`   ← `src/routes/plan/+page.svelte` + `details.ts` (in-repo)
   - `design.app` ← `src/routes/design/` (`ArchGraph`/`C4View` + `architecture.ts`/`c4.ts`) (in-repo)
   - `ewell.app`  ← wellnew `/ewell` (`~/Desktop/GitHub/wellnew`, iCloud read-only — memory
     `wellnew_repo`; live https://wellnew.up.railway.app/ewell)
2. **Write a PROMPT SCRIPT** — an ordered list of small natural-language prompts, each an
   increment (add a panel · seed rows · wire an event · restyle). This script IS the program.
3. **Run each prompt** → inspect the **server-rendered** result at `/app/local`.
4. **On failure** (missing component · wrong/absent verb · unknown prop): diagnose via the
   **verb trace** (now captured per build) + the retrieved grounding, then **ENHANCE**:
   - add/extend a component bundle in `app_components/` (+ its `meta.ts` rule-card), OR
   - add a kind-rule (`pipeline.ts` systemPrompt) / promote a golden RAG pair so the builder
     knows how. Re-prompt → success.
5. **On success** → promote `(prompt → .app)` as a **golden pair** (RAG) so the capability
   compounds and the next run is more deterministic.
6. **Data**: seed via the variable system (`app.vars` / `app.structures`) with default data
   now; file-backed data slots (§0.5) come later.

## Two enhancement tracks (run continuously, alongside the builds)

- **Components** — build what the apps need and don't have yet: a **Gantt/timeline**
  (plan), a **tree/graph** (design), a **panel-shell layout** (ewell = left vtoolbar +
  sidebar + main). Each new component ships as a bundle + `meta.ts` so it is promptable +
  retrievable.
- **AI system** — #37 (`meta.ts` → retrievable RAG cards → slim, per-component prompt =
  token cut) + #38 (bug-report → refine flywheel via the verb trace). These are what make
  the components USABLE by prompt.

## Order (simplest → hardest; each seeds the next's golden pairs)

1. **plan.app** — tabular/timeline; exercises table/grid + a new Gantt + var-seeded rows.
2. **design.app** — tree + C4 tabs; exercises tabs/container + a new tree/graph component.
3. **ewell.app** — full panel-shell; exercises layout/shell components + composition
   (hardest — benefits from the first two's learnings).

## Overnight execution shape

A **bounded loop** (or a Workflow) per app: iterate the prompt script → verify the
server-render → record the outcome (verb trace + pass/fail) → accumulate golden pairs. It
must **log what it could not build** (so the morning review sees the exact gaps, not a
false "done"). Uses the CLI/Ollama backend (no API-console spend). Never marks an app
"done" it did not actually render.

## Definition of done

- **Per app**: renders the target's core structure server-side, built ENTIRELY from the
  replayable prompt script (no hand-authored `.app`).
- **System (the real success metric)**: the same prompts reproduce the apps deterministically
  (RAG-grounded), and net-new components + `meta.ts` rule-cards exist for everything that was
  missing — so the builder is measurably smarter than before the run.
