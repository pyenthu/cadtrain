# Plan — `/design` as an interactive architecture graph (svelte-flow)

Status: PLAN (not built). Owner: design route. Created 2026-06-16.

## Goal

Replace the static, prose-and-cards `/design` page
(`src/routes/design/+page.svelte` — hand-maintained arrays of `layers`,
`flow`, `capabilities`, `routes`) with a **real, navigable graph** of the
app's architecture and navigation: the routes, the data/volume flow, the API
endpoints, and the editor → emit → bake → viewer pipeline. The page should
read like a living system diagram you can pan/zoom, click a node to jump to
the live route, and that does not silently rot as routes/endpoints move.

Keep the existing hero/prose intro (it's good marketing copy); swap the three
diagrammatic sections (Architecture layers, Bake flow, Routes table) for one
interactive `SvelteFlow` canvas, with the prose retained as a legend/sidebar.

## Dependency

`@xyflow/svelte` is **NOT** currently a dependency (confirmed: not in
`package.json`; no `xyflow`/`svelte-flow`/`reactflow` anywhere). It must be
added:

```bash
bun add @xyflow/svelte
```

Notes:
- `@xyflow/svelte` v1.x is the **Svelte 5-compatible** package (the old
  `svelte-flow`/v0 line was Svelte 4). This repo is Svelte 5.55 runes, so pin
  v1.x. MIT-licensed (with an attribution requirement in the corner — keep the
  default attribution or buy a pro key; for an internal `/design` page the free
  attribution is fine).
- Requires importing its stylesheet once:
  `import '@xyflow/svelte/dist/style.css';` inside the route (scoped is fine
  because the page already owns full-bleed layout). SSR is globally off
  (`+layout.ts: ssr = false`), so the WASM/DOM concerns that bite Manifold
  don't apply here — but still **lazy-import** the `SvelteFlow` component in the
  route (`onMount` / dynamic `import()`) to keep it off any server path and out
  of the initial bundle for other routes.
- This is the FIRST flow library in the tree. If item (2) — using svelte-flow
  for the main graph editor — is later approved, this `/design` adoption
  doubles as the low-risk pilot that proves the dependency in production
  (`docs/research/svelteflow-for-graph-editor.md`).

## Node / edge model

Four node CLASSES, each a custom node type (a small Svelte component registered
in `nodeTypes`), color-coded, so the diagram is legible at a glance:

| class | meaning | examples | clickable target |
|---|---|---|---|
| `route` | a SvelteKit page route | `/graph-editor`, `/primitives`, `/vocab`, `/fem`, `/forge`, `/volume`, `/plan`, `/design`, `/wells` (stub) | navigates to the route (`<a href>`) |
| `api` | an HTTP endpoint group | `/api/primitives/*`, `/api/rag/*`, `/api/vocab/*`, `/api/volume`, `/api/cache/*`, `/api/brep/*`, `/api/forge/*`, `/api/manifest` | opens the endpoint (GET) or shows the manifest blurb |
| `lib` | an engine/pipeline stage | composition-graph → emit → bake (Manifold WASM) → viewer (Threlte); stdlib/stdstale engines; primitive-loader; bake-cache | none / docs anchor |
| `store` | a persistent data sink | the volume (`$APP_DATA_DIR`): `primitives/`, `ai/rag/parts.jsonl`, `cache/`, `archive/`; `docs/parts/vocabulary.json` | none / `/volume` |

Edge TYPES (custom edges, distinct stroke/marker/animation):

| edge type | semantics | example |
|---|---|---|
| `nav` | user navigation between routes | `/` → `/primitives` → `/graph-editor` |
| `mounts` | a route mounts a shared component/pipeline | `/graph-editor` → `GraphEditorPane`; `/primitives` → N× `GraphEditorPane` |
| `calls` | route → API endpoint (data fetch / mutation) | `/graph-editor` → `/api/primitives/{source,save,preview}` |
| `flow` | the bake pipeline data flow (animated) | graph → emit → Manifold → mesh/GLB/SVG |
| `proxy` | local-dev volume proxy to prod | data endpoints → prod volume (Rule 13) |
| `reads`/`writes` | API ↔ persistent store | `/api/primitives/save` → `primitives/<id>.prim.ts`; `/api/rag/rebuild` → `ai/rag/parts.jsonl` |

Each node carries `data: { id, label, kind, href?, blurb }`. Layout: use
fixed/positioned nodes initially (a hand-tuned left-to-right column layout:
routes column → api column → lib/pipeline column → store column), since the
graph is small (~30–40 nodes). Optionally add a `dagre`/`elkjs` auto-layout
pass later — but a small curated graph reads better hand-placed. svelte-flow's
`Background`, `Controls`, and `MiniMap` come for free.

## Keeping it in sync with the real route/api structure

The whole point is to not hand-maintain a second copy of the arrays. Three
levels of sync, in increasing fidelity:

1. **Route nodes — derive from the filesystem at build time.** SvelteKit
   exposes the route tree via `import.meta.glob('/src/routes/**/+page.svelte')`.
   A tiny `src/routes/design/architecture.ts` (or a `+page.ts` `load`) can glob
   those keys, strip `/src/routes` and `/+page.svelte`, and emit the `route`
   node list. New top-level route → new node automatically. Same trick for API:
   `import.meta.glob('/src/routes/api/**/+server.ts')` → the `api` node list
   (group by first path segment under `/api/`).

2. **API semantics — reuse `/api/manifest`.** `src/routes/api/manifest/+server.ts`
   already hand-describes the load-bearing operations (`list_parts`, `get_part`,
   `prompt_to_cad`, `bake_part`, `authoring_vocab`) with `path`, `summary`,
   `request`, `response`. `/design` should `fetch('/api/manifest')` (client-side
   — SSR is off) and use those summaries as the `blurb` for the matching `api`
   nodes, and the `workflow` array (`prompt_to_cad → graph`, `bake_part →
   geometry`, …) to seed `flow`/`calls` edges. This makes the manifest the
   single source of truth for endpoint descriptions, shared between the external
   SDK consumers and this diagram.

3. **Edges + lib/store nodes — a small curated manifest.** Navigation links,
   the bake-pipeline stages, and the proxy/read/write relationships are
   architectural facts that don't live in any one file. Keep them in ONE typed
   module, `src/routes/design/architecture.ts`, as `nodes` + `edges` arrays
   (the same place the route/api globs land), co-located so a route move and a
   diagram update sit side by side. This replaces the four ad-hoc arrays
   currently inlined in `+page.svelte`.

**Drift guard (recommended):** add a unit test
(`src/routes/design/architecture.test.ts`) that globs the real
`+page.svelte`/`+server.ts` files and asserts every route/api node in the
curated `architecture.ts` still maps to a file on disk, and warns on routes/
endpoints with no node. Cheap, runs in `bun test`, and turns "the diagram is
stale" into a red test instead of a silent lie. Mirror the spirit of the
`/api/manifest` "kept in lockstep" comment but make it enforced.

## File-level plan

```
src/routes/design/
├── +page.svelte          # keep hero + prose; replace 3 diagram sections with <ArchGraph/>
├── +page.ts              # (new) load: glob routes+api, fetch /api/manifest, build node/edge arrays
├── architecture.ts       # (new) curated nodes/edges + the glob-derived route/api nodes + types
├── architecture.test.ts  # (new) drift guard against the real route/api filesystem
├── ArchGraph.svelte      # (new) the <SvelteFlow> wrapper: nodeTypes, edgeTypes, Background/Controls/MiniMap
└── nodes/                # (new) RouteNode.svelte, ApiNode.svelte, LibNode.svelte, StoreNode.svelte
```

## Steps

1. `bun add @xyflow/svelte`; verify `bun run build` still passes with the new dep.
2. Author `architecture.ts`: types (`ArchNode`, `ArchEdge`), the curated
   lib/store nodes + edges, and the glob helpers for route/api nodes.
3. Author the four custom node components + `ArchGraph.svelte` (lazy-imports
   `SvelteFlow`, imports its CSS, wires `nodeTypes`/`edgeTypes`, hand-placed
   positions, `Background`/`Controls`/`MiniMap`, click-to-navigate on `route`/
   `api` nodes).
4. Rewire `+page.svelte`: keep hero + "What it is" prose; drop the `layers`,
   `flow`, `routes` arrays + their three sections; mount `<ArchGraph/>` in a
   full-width section with the prose kept as an adjacent legend.
5. `architecture.test.ts` drift guard; `bun test`.
6. Visual pass via `claude --chrome` on `/design` (pan/zoom, click a route node
   → lands on the live route, MiniMap, reduced-motion still disables the `flow`
   edge animation).
7. e2e: extend the existing route-loads spec to assert `/design` mounts the
   canvas (a `.svelte-flow` node renders) and that a route node's link
   resolves. Commit per Rule 7 once the step is whole.

## Risks / notes

- **Bundle**: `@xyflow/svelte` is a non-trivial dep; lazy-import it so only
  `/design` (and, if approved, the editor) pays for it.
- **Attribution**: keep svelte-flow's corner attribution on the free tier.
- **Z-down / units**: irrelevant here — this is a 2D diagram, not geometry.
- **Don't over-build layout**: ~35 nodes read best hand-placed; defer dagre.
- This page is documentation-of-architecture, so update it in the SAME commit
  as any route/endpoint reshape (Rule 14 spirit), and let the drift test catch
  the rest.
```
