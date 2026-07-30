# App server-render — the `.app` as a server-compiled document

**Status:** PLAN (2026-07-30, approved-in-principle). Supersedes the client-render path for the
**launch/view** surface. Decided WITH the user across a design conversation. Builds on the shipped
app-harness (`docs/architecture/app-harness.md`) + studio (`docs/plans/app-studio-enhancements.md`).

## The principle

> **The `.app` file IS the app** — a small, declarative document. **The server (our superapp)
> compiles it to HTML and serves it.** All the richness — the **engines** and the **components** —
> lives in the superapp and **never ships to the client**. The client is a thin viewer.

```
 .app  (small, declarative)                 SERVER = the superapp (the richness)             CLIENT (thin)
 ─────────────────────────                  ─────────────────────────────────────           ─────────────
 • lives on the VOLUME (by id)   ──POST/──▶  1. resolve each panel's data (server engine      receives HTML
 • or the LOCAL filesystem       ──ptr──▶       + dispatch)                                    (+ tiny event
   (contents posted; it's small)             2. render(HarnessView) via `svelte/server`  ──▶   forwarder for
                                             3. → HTML string                                   interactive bits)
   engines + components  ✗ never cross the server boundary  ✗
```

Why it's a good system: **IP protection by construction** (engines/components stay server-side),
**one source of truth for richness** (every `.app` benefits as the superapp evolves — no client
redeploy), a **thin portable artifact** (the `.app` moves volume↔local and *is* the whole app),
and it **reuses the working HarnessView** (rendered through `svelte/server`, not rewritten).

## Two sources, one compile — the route is a pointer to the file

| Source | Route (pointer) | How the server gets the `.app` |
|---|---|---|
| **Volume** | `/app/[id]` | server reads it from the volume by id |
| **Local file** | `/app/local` | client reads the file + POSTs its (small) contents; server compiles |

Either way **the server compiles it**. The browser sandbox can't hand the server a filesystem path,
so a local `.app` rides along as contents — the user accepted this ("the `.app` is small, send it").

## Data resolution — per-component `dataMode` (the islands model)

`svelte/server`'s `render()` is synchronous — **`$effect`/`onMount` do NOT run** — so panels that
load data async would render empty. Each component declares, in its catalog `meta`, HOW it gets data:

- **`static`** — no data source (text · card · tabs · toolbar · button). Pure structure → HTML.
- **`server`** — the server resolves the panel's `source` verb up-front (server engine + `dispatch`)
  and **bakes the data into the HTML** (list · form · table · grid · bake3d-stats). Fast, protected.
- **`client`** — a **thin island** that fetches its data onMount from a server endpoint, keyed by
  `panelId` + a render-session token — it carries NO `.app`/engine logic (file · chat · future 3D).

This is where the panel data-loading "will have to be done anyway" (user) lives — built into each
component's functionality, driven by `meta.dataMode`.

## What's reused vs. new

**Reused (unchanged):** `HarnessView.svelte` (rendered server-side via `svelte/server`), the whole
verb registry + `dispatch` + `refs` + `compute` (already headless/SSR-safe), `createClientEngine`
(driven by **SvelteKit's server `fetch`**, which resolves `/api/primitives/*` in-process — so no
separate server engine to write).

**New:** `POST /api/app/render`, the `preloaded` prop threading, `meta.dataMode`, and (Phase 2+) the
server-rendered routes + the event round-trip.

## Phases (each build-green + testable, then stop for review)

- **Phase 1 — server render endpoint.**
  - `catalog/components.ts`: add `dataMode` to every kind.
  - `HarnessView → PanelNode → data panels`: thread a `preloaded` map (panelId → resolved data);
    panels read it **synchronously** if present, else fall back to the client `$effect` (so the
    studio's live client preview still works unchanged).
  - `POST /api/app/render { app } → { html }`: `createClientEngine(fetch)` on SvelteKit server
    `fetch`, resolve every `server`-mode panel's `source` via `dispatch`, then `svelte/server`
    `render(HarnessView, { props: { app, preloaded } })` → HTML.
  - **Verify:** curl a sample `.app` (static card + a `list`) → rows are baked into the HTML. STOP.
- **Phase 2 — routes as pointers.** `/app/[id]` (`+page.server.ts` loads from the volume → renders
  → returns `{ html }`; `+page.svelte` = `{@html html}`) and `/app/local` (renders the POSTed
  `.app`). **HarnessView + the `.app` leave the client bundle** for these routes. *Verify:* launch a
  volume app + a local file; view-source shows HTML, not the `.app`.
- **Phase 3 — interactivity (server-driven).** A thin client shell forwards events (click/select/
  input) → `POST /api/app/render` (or `/event`) with `{ app|appId, panelId, event, state }` → server
  re-renders → swaps HTML (LiveView/htmx style). *Verify:* click a list row → re-render with it selected.
- **Phase 4 (later).** Interactive **3D** = a client component that does its own GLB conversion
  (deprioritized — no GLB pipeline now; `bake3d` server-renders stats until then). Optionally make the
  studio's live preview server-rendered too, so the code is protected everywhere.

## Tradeoffs (accepted)

- Interactivity + 3D become **server round-trips** — fine for tool apps, cache-able; partial
  re-renders mitigate latency.
- The **offline/trusted package** is the deliberate exception where the engine ships client-side (a
  separate tier — see `docs/research/app-embedding-and-ip-protection.md`).
- AI stays **local at runtime** in all modes (memory `ai_data_residency_local_first`) — orthogonal.

## Files (indicative)

- `src/routes/api/app/render/+server.ts` (new) · `src/routes/app/[id]/{+page.server.ts,+page.svelte}`
  · `src/routes/app/local/…` (Phase 2)
- `src/lib/shared/harness/{HarnessView,panels/PanelNode,panels/*}.svelte` (`preloaded` prop)
- `src/lib/appkit/catalog/components.ts` (`dataMode`)
- `docs/architecture/app-harness.md` (record the server-render surface)
