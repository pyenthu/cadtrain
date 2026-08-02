# cad3d — the comprehensive CAD component (+ the ADK direction)

Status: **v0 SHIPPED, comprehensive build DEFERRED** (user 2026-08-02 — "later").
This doc is the resume-spec so we pick up from the full vision, not scattered notes.

## The vision — cadtrain graph/engine as an ADK

The end goal is bigger than one component: **componentize the cadtrain graph + engine itself as
an ADK** (app-development kit) that drops into *other* apps. `cad3d` is the first, flagship
instance of that — a self-contained component that carries the whole draw→compile→bake→render
pipeline behind a clean prop surface, so any `.app` (or an external host) can embed live CAD.

## What v0 already ships (`c6b42e5`, on main)

- `cad3d` bundle: `meta.ts` (kind `cad3d`, group `3d`, `dataMode:'client'`, **`computeMode:'server'`**),
  `Cad3d.svelte` (client island — SSR placeholder → onMount lazy-imports Threlte + a trimmed
  `Cad3dScene.svelte` → renders a server-baked mesh), props `partId · params · cutaway · height ·
  background · autoRotate · engine`.
- Server-compute transport: `/api/app/cad-bake` (a one-off route) loads the part SOURCE server-side
  and bakes via `/api/primitives/preview` → serialized mesh JSON. **Engine + source never ship.**
- Browser-verified: `g_shaft`/`g_cube` render as lit 3D, no COOP/COEP errors.

## Comprehensive build — the requirements (DEFERRED)

1. **Render-mode selector — MF mesh | BREP | SVG.** The component exposes the render path as a
   control/prop (mirrors the graph-editor RightPane tabs `bake`/`brep`/`brepsvg`):
   - **MF mesh** (v0, Manifold) — the default triangle mesh.
   - **BREP** — OCCT boundary render; ideally the client-side OCCT bake (see
     `docs/plans/` BREP recon — `brep-client.ts` + a warm worker + a `brep` tab / toggle).
   - **SVG** — the 2D silhouette / HLR drawing (reuse `PrimitiveSvgView` / `CompJsonSilhouette`).
2. **Popover editor — the drawing authoring surface.** cad3d carries an embedded EDITOR (the
   graph editor in chrome-free embed mode, like `/wells` mounts `GraphEditorPane`) in a popover, so
   the user can author/edit the drawing in place, not just view a fixed `partId`. Implies the
   `graph` prop (a live composition) alongside `partId` (a saved part).
3. **Volume API access for components.** Components (not just cad3d) need to reach the volume — a
   part **picker** (list `/api/primitives/list`), load source, save edits. This is exactly what the
   **dispatch engine** (below) is for: the bundle's server logic hits the volume server-side.

## The architecture it rides on — the component dispatch engine

The pattern settled 2026-08-02 (diagram published as an artifact). It's how a component gets
bespoke server work (volume access, heavy bake) WITHOUT growing the server per-component:

- **Third bundle leg:** `<Name>.server.ts` (the `.server` suffix = SvelteKit hard guarantee it never
  enters the client bundle → engine/source/volume-creds stay server-side).
- **Generated registry:** glob `app_components/**/*.server.ts` → `COMPONENT_ACTIONS[kind][action]`
  (a `*.server.ts` module, e.g. `shared/harness/panels/component-actions.server.ts`), exactly like
  `meta`→`COMPONENT_CATALOG` and `.svelte`→`PANEL_COMPONENTS`.
- **One generic route:** `/api/app/component/[kind]/[action]/+server.ts` → looks up + runs the action.
  The ONLY component-API route; it never changes as components are added.
- **AI SSOT preserved:** the component binds `source:{verb:…}`; the verb handler delegates to the
  server action. The verb registry stays the single API the AI/local model sees.
- **Rule of thumb:** most components use a generic data verb (`readVar`/`http`/`loadData`); a
  `.server.ts` is only for heavy/protected/volume work (cad3d bake, BREP bake, a part picker).

### Resume plan (when we pick this up)
1. Build the dispatch engine (registry + generic route) + migrate cad3d's bake into
   `Cad3d.server.ts`; retire `/api/app/cad-bake`. (headless-verifiable)
2. Add the render-mode selector (MF mesh first; BREP + SVG behind the same control).
3. `Cad3dEditor.svelte` — part picker (volume list via a `listParts` server action) + params + toggles.
4. The popover graph editor (chrome-free `GraphEditorPane` embed) + the `graph` prop.
5. Then generalize: the same bundle pattern is the ADK seam for embedding cadtrain in other apps.
