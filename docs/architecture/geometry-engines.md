# Geometry engines — the multi-engine matrix

cadtrain bakes the same composition graph through **three geometry kernels**.
Each is surfaced as a right-pane tab in the CAD editor
(`src/lib/shared/graph-editor/RightPane.svelte` — tabs `bake` / `glb`, `brep`, `tf`),
and several run on both sides of a **client ⇄ server split**. This doc is the
map of which engine runs where and why.

See also: the `/design` route (Tree + C4 tabs) now carries the `TrueForm (tf)`
kernel node, the `cross-origin isolation` node, and the engine-matrix edges;
root `CLAUDE.md` "Client-side execution" for the compile/execute contract.

## The matrix

| Engine | Kernel | Client | Server | Strengths / notes |
|---|---|:-:|:-:|---|
| **Manifold** | ManifoldCAD WASM (mesh CSG) | ✓ | ✓ | The primary engine. Fast mesh booleans + the welded-mesh toolkit. No true curves (everything is faceted). Client bake runs in a Web Worker; server bake is `/api/primitives/preview`. |
| **BREP / OCCT** | OpenCascade (exact B-rep) | — | ✓ | Exact kernel — true curves, clean annular sweep caps. ~40–100× slower than Manifold. Server-only today (`/api/brep/preview`, graph → OCCT); a client-side OCCT build is a TODO. |
| **TrueForm (tf)** | `@polydera/trueform` WASM (exact-mesh) | ✓ | — | New this session. Runs client-side (main thread, `trueform-client.ts`). Renders a from-scratch box today (proves the kernel initializes); client **and** server are the eventual goal. Needs cross-origin isolation (below). |

"Primary" = the default bake path; the other two are alternate views on the same
graph, opened per-tab.

## Compile → execute (the client/server split)

Geometry **execution** is decoupled from **compilation**:

- **Server = the COMPILER.** `/api/primitives/compile` resolves a part + its
  `meta.uses` deps and inlines them into one self-contained Manifold script,
  returning that script plus a `scriptHash`.
- **Client = the EXECUTOR.** A browser Web Worker
  (`src/lib/graph/bake-worker.ts` + `bake-client.ts`) runs the compiled script and
  bakes the mesh. Toggle: the 💻/☁ button in the graph-editor left rail
  (or `localStorage.cad-client-bake`) → `scene.clientBake`. The bake pane shows a
  `⚡client` / `☁server` badge. This kills the stale-bake ("déjà-vu") bug
  structurally, because the hash pins exactly what was executed.

```
                         ┌──────────────────────── server ────────────────────────┐
   composition graph ──► /api/primitives/compile ──► dep-inlined script + scriptHash
                         └──────────────────────────────┬──────────────────────────┘
                                                         │  (script travels to the browser)
                         ┌──────────────────────── client ▼──────────────────────┐
                         │  bake-worker (Web Worker) ──► Manifold WASM ──► mesh    │
                         └─────────────────────────────────────────────────────────┘

   Per-engine bake routing:
     Manifold  ─ client (worker)  ── or ── server (/api/primitives/preview)   [toggle]
     BREP      ─ server only       (/api/brep/preview, graph → OCCT)          [TODO: client]
     TrueForm  ─ client only       (trueform-client.ts, main thread)          [goal: + server]
```

## Cross-origin isolation (COOP / COEP) — app-wide invariant

TrueForm's WASM is built **with pthreads**: `tf.init()` pre-creates a worker pool
and transfers the WASM memory (a `SharedArrayBuffer`) to each worker. That
transfer throws `DataCloneError` unless the document is **cross-origin isolated**
(`self.crossOriginIsolated === true`). There is no single-threaded fallback in
this build, and running on the main thread does **not** avoid it.

To flip `crossOriginIsolated` on, **every response** now carries:

```
Cross-Origin-Opener-Policy:   same-origin
Cross-Origin-Embedder-Policy: require-corp
```

set in two places for prod/dev parity:

- **prod** — `src/hooks.server.ts` (`applyCrossOriginIsolation`), on every response.
- **dev/preview** — a vite middleware (`crossOriginIsolation()` in `vite.config.js`)
  that runs before the SvelteKit handler (plain `server.headers` do not reach
  SvelteKit's SSR page responses).

**Why:** it is the only way to give TrueForm's pthread pool a `SharedArrayBuffer`.

**What it forbids:** under `COEP: require-corp` every subresource must be
**same-origin or explicitly CORP/CORS-opted-in**. cadtrain serves its assets
same-origin and proxies its API under `/api/*`, so nothing broke (verified:
Manifold / BREP / TF tabs + `/` + `/vocab` all load clean under isolation). This
is a **prod-facing invariant future code must respect** — any new cross-origin
CDN resource (font, script, image) will be COEP-blocked unless it sends the right
CORP/CORS headers. Audit before adding a third-party embed.
