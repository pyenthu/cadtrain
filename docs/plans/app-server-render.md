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

### Compute location — per-component `computeMode` (server default, client opt-in)

The engine has BOTH a server path and a client path (the existing Manifold WASM worker — the `💻`
bake). A component chooses where its **heavy compute** runs — a sibling knob to `dataMode`:
- **`server`** (default, protected) — engine + the part's compiled script stay server-side; the client
  gets meshes/GLB. Costs server CPU.
- **`client`** (opt-in) — runs the WASM engine in the browser to **offload the server** / go offline.
  **Tradeoff:** ships the WASM engine + that part's compiled script → *that part's* geometry logic is
  exposed (compiled/opaque, runnable).

Same hosted-vs-offline axis, expressed per component: protection-critical parts bake server-side;
compute-heavy or offline-friendly ones bake client-side. Reactivity (client) is orthogonal to compute
location (server or client).

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
- **Phase 3 — interactivity (TWO-TIER — not everything round-trips).**
  - **Local (client-only, instant)** — generic widget behavior with no engine/`.app` logic: tab
    switches, expand/collapse, input typing before commit, client-side sort/filter of already-loaded
    rows, hover/tooltips, and **`computed` re-evaluation** (the `compute.ts` evaluator is tiny +
    generic → runs in the browser over data already present). Lives IN the generic island components;
    never touches the server. This is standard widget behavior, **not IP**.
  - **Server (round-trip)** — ONLY events that fire a **verb** (`dispatch`): load a doc, bake, mutate
    data (add/remove row), anything needing the engine or that changes *what data* is shown →
    `POST /api/app/render` (or `/event`) with `{ app|appId, panelId, event, state }` → server
    re-renders → swaps the affected HTML (LiveView/htmx style). Partial re-render, cache-able.
  - The rule: **a verb ⇒ server; everything else ⇒ local.** Snappy local UX + a protected core.
  - *Verify:* a tab switch stays client-side (no network); clicking a list row (fires `loadDoc`) round-trips.
  - **Rung 1 SHIPPED** — `edittable`: rows are LOCAL client `$state` (add/edit/delete instant, no
    round-trip), seeded synchronously from server-resolved data (so they SSR). A `💾 Save` appears
    only when `on.save` is wired and is the sole round-trip. **Persistence is deferred + targets DATA
    FILES** (the §0.5 slot model): later, `on.save` wires to a verb that writes the slot's file
    (local via File System Access, or the volume) — not part of rung 1.
- **Phase 4 (later).** Interactive **3D** = a client component that does its own GLB conversion
  (deprioritized — no GLB pipeline now; `bake3d` server-renders stats until then). Optionally make the
  studio's live preview server-rendered too, so the code is protected everywhere.

## Tradeoffs (accepted)

- Interactivity + 3D become **server round-trips** — fine for tool apps, cache-able; partial
  re-renders mitigate latency.
- The **offline/trusted package** is the deliberate exception where the engine ships client-side (a
  separate tier — see `docs/research/app-embedding-and-ip-protection.md`).
- AI stays **local at runtime** in all modes (memory `ai_data_residency_local_first`) — orthogonal.

## TODO — component bundles + `.app` → component (user direction 2026-07-30)

Make each component a **self-contained, repeatable bundle** so it's consistent, flexible, and
Claude-definable — and so the superapp scales:
```
src/lib/app_components/<Name>/
   <Name>.svelte        render (the actual Svelte element)
   <Name>Editor.svelte  per-component editor (e.g. Table = Excel-like)
   meta.ts              props schema · slots · dataMode · computeMode · wiresTo · acceptsChildren
```
Today this is SPLIT (render in `shared/harness/panels/`, metadata in `appkit/catalog/components.ts`,
editors are GENERIC via the tree settings popover). The bundle unifies them. **Then:** promote a saved
`.app` (or a subtree) into a NEW first-class component (encapsulate a composition, parameterized by its
own props/slots) — `.app` → component. That is the scalability/usability unlock.

## Files (indicative)

- `src/routes/api/app/render/+server.ts` (new) · `src/routes/app/[id]/{+page.server.ts,+page.svelte}`
  · `src/routes/app/local/…` (Phase 2)
- `src/lib/shared/harness/{HarnessView,panels/PanelNode,panels/*}.svelte` (`preloaded` prop)
- `src/lib/appkit/catalog/components.ts` (`dataMode`)
- `docs/architecture/app-harness.md` (record the server-render surface)
