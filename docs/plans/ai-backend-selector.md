# AI backend selector (prompt window) — Claude / WebLLM / future

**Status:** planning (2026-07-01, user). A component of the AI master plan
(`docs/plans/ai-master-plan.md`). Make the graph-editor prompt window (`AiMenu.svelte`)
SVTC-style: the user picks which AI backend runs the assist, from a pluggable list.

## What
- The AiMenu prompt window gets a **backend selector** (dropdown / segmented control),
  mirroring SVTC's model picker.
- Options: **Claude** (cloud, today's `/api/rag/assist`) · **WebLLM (local)** (in-browser,
  #2/#28) · **extensible for FUTURE backends** (any additional cloud/local model).
- Pluggable via the EXISTING seam: `ge-assist` already accepts a **`postTurn` override**
  (`ge-assist.svelte.ts`). Each backend is one `postTurn` implementation behind a single
  interface; the selector just swaps which one the multi-shot loop calls. No loop rewrite.

## Backends registry
A small registry (one entry per backend) so adding a future model is a data change:
`{ id, label, kind: 'cloud' | 'local', postTurn, needsKey }`.
- **Claude** — `kind:'cloud'`, `needsKey:true` (server `ANTHROPIC_API_KEY`, or a configured key).
- **WebLLM (local)** — `kind:'local'`, `needsKey:false` — nothing leaves the browser (the
  point, under `ai_data_residency_local_first`).
- **Future** — add a registry entry (e.g. another local MLC model, or a cloud provider).

## Keys (Rule 15 — SECURE, never pasted-to-disk)
- Cloud backends may need an API **key**. Per Rule 15 the app must NEVER accept a pasted
  secret, echo it, or write it to disk. Key handling = **secure entry only**: server env
  (`ANTHROPIC_API_KEY`) / Railway Variables / a settings pane that POINTS to secure entry
  (or a password-manager credential flow) — the raw key never lives in app state or the volume.
- **LOCAL WebLLM needs NO key** → the default backend under the data-residency constraint;
  the whole point is that prod can run with zero external calls + zero keys.
- The selector shows a small "needs a key — configure in settings" affordance for cloud
  backends that aren't configured, rather than a key input field in the prompt window.

## Persistence + scope
- Selected backend persisted per session (localStorage); **per-user later** once OAuth lands
  (#30) so a user's default backend travels with their identity/private space.

## Sequencing (under the master plan)
1. **Now:** the selector UI + the backend registry, with **Claude** live and **WebLLM
   "coming"** (disabled entry) until the local runtime lands. Establishes the seam + UX.
2. **Master-plan P3:** WebLLM local backend becomes selectable — the data-residency runtime.
3. **Later:** additional backends drop in as registry entries; per-user default via OAuth.

## Reconcile
- Extends #2 (`web-llm-functionary.md` — the local runtime + `postTurn` seam) with the
  USER-FACING picker + key story. Folds into `ai-master-plan.md` as the "backend layer."
