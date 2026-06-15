# Plan — Client-side execution (compiler/executor split)

> **Status:** PLAN ONLY (no `src/` changes in this commit).
> **Decision (user, 2026-06-16):** cadtrain is a **multi-user app**. Move geometry
> baking OFF the server and INTO the browser for BOTH kernels (Manifold + OCCT).
> The server becomes a *compiler* (graph → script); the client becomes an
> *executor* (script → mesh, via WASM in a Web Worker).
> **Origin:** surfaced while debugging the "deja-vu" stale-bake bug (a fix to a
> shared dep, `g_tube`, kept re-appearing because the server mesh-cache key for
> parent parts didn't fold in dependency hashes — see §1). Client-side execution
> with a *script* cache makes that whole bug class structurally impossible.

---

## 1. Why — what this fixes and unlocks

### The deja-vu bug (root cause, verbatim record)
`hashBakeKey` (`src/lib/server/bake-cache.ts:109`) keys a bake on **only the
part's own extracted function body + its params + render options**. It does NOT
hash the bodies of its `meta.uses` dependencies. A composed part
(`g_dp_joint`, `g_dp_stand`) bakes the *entire resolved tree* into one cached
mesh under its own key. So fixing a shared child (`g_tube`) changes the child's
key but NOT the parent's — the parent keeps serving yesterday's mesh, with the
buggy child baked in. Manually clearing `cache/<part>/` "fixes" it until the
next dep edit. This is a recurring trap inherent to a mesh-cache that isn't
dependency-aware.

### How the redesign removes it
If the server caches **scripts** (text) instead of **meshes**, the cache key is
the *emitted, dep-inlined script* — which literally contains the resolved
dependency code. Any dep fix changes the script → changes the key → no stale
artifact, ever. The bug becomes impossible by construction.

### The multi-user wins (the real driver)
- **Server cost stops scaling with bake load.** Today every param drag can
  trigger a server-side WASM bake. Client-side, each user spends their own CPU;
  the server only compiles (pure JS, cheap, cacheable).
- **Bandwidth.** Today the server ships large meshes over the wire (e.g.
  `g_dp_stand` ≈ 22 MB). Client-side ships a few-KB script and bakes locally.
- **Scales horizontally** without GPU/CPU bake workers on the backend.

### What it costs (the actual engineering)
- A **Web Worker is mandatory**, not optional — baking on the main thread freezes
  the UI (we already felt a version of this: "GLB bake blocked the mesh thread").
- **OCCT WASM is heavy** (several MB, slow cold-init) → lazy-load + warm
  singleton + worker. Manifold WASM is small (~1 MB) and browser-proven
  (manifoldcad.org), so do it first.
- **Lose the shared server mesh-cache** → re-bake per client. Mitigate with an
  IndexedDB client cache keyed on the script hash (same key → instant reload,
  still no stale-dep problem).

---

## 2. Target architecture — compiler / executor

```
┌─────────────────── SERVER (the compiler) ───────────────────┐
│  graph(JSON) + transitive meta.uses                         │
│      → composition-emit + INLINE resolved deps              │
│      → ONE self-contained script string                     │
│  cache: scripts keyed on sha256(resolved script)  (tiny)    │
│  IP boundary stays here: client gets emitted script, never  │
│  the graph→script logic.                                    │
└──────────────────────────────┬──────────────────────────────┘
                               │  GET script (+ kernel tag)
                               ▼
┌─────────────────── CLIENT (the executor) ───────────────────┐
│  Web Worker holds warm Manifold + OCCT singletons           │
│      → run script → produce geometry                        │
│      → postMessage transferable ArrayBuffers to main thread │
│  Threlte renders { full | cutVC | instanced }               │
│  IndexedDB mesh cache keyed on script hash (optional, fast) │
└──────────────────────────────────────────────────────────────┘
```

**Boundary rationale:** the server already does the graph→script translation
(`composition-emit*.ts`); keeping it server-side preserves the "protection"
the user wants (clients receive a runnable script, not the authoring logic) and
keeps the cache a *text* cache. The expensive WASM compose moves to the client.

---

## 3. Server = compiler

- New/extended endpoint: `/api/primitives/compile?name=<id>` →
  `{ script, scriptHash, kernel: 'manifold' | 'occt', supported, reason? }`.
  - Resolves `meta.uses` recursively (reuse `usesOf` + the resolver logic in
    `primitive-loader.ts`), **inlines** each dep's emitted body so the returned
    script is self-contained (no client-side dep fetching → one round-trip).
  - `scriptHash = sha256(script)` — the cache key. Because deps are inlined,
    a dep edit changes the script → changes the hash. **No dependency-aware
    key gymnastics needed; it's free.**
- **Script cache** (replaces the mesh bake-cache for the preview path): store
  `{ script }` under `cache/scripts/<id>/<scriptHash>.js` (text, KB-scale).
  Atomic writes (Rule 4).
- The graph→OCCT executor already exists server-side (the BREP work, session
  `2026-06-15`); the compile step emits the OCCT-flavored script for
  `kernel:'occt'` parts and the Manifold-flavored script otherwise.
- `supported:false` + `reason` for parts a kernel can't build (mirror the BREP
  endpoint's isolation contract — never 500).

> Server retains NO WASM dependency for the preview path → cheaper, simpler,
> faster cold start.

---

## 4. Client = executor (the Web Worker)

- New `src/lib/cad/bake-worker.ts` (+ a thin `bake-client.ts` main-thread API):
  - Lazy-initialises and caches the Manifold WASM module on first use; OCCT
    likewise (separately — don't pay OCCT's cold-init unless a BREP part is
    opened).
  - Receives `{ script, params, kernel, options }`, runs the script in the same
    sandbox shape the server uses today (`primitive-sandbox.ts` helpers must be
    importable client-side — audit for any Node-only deps), returns serialized
    geometry as **transferable** ArrayBuffers.
  - One worker, message-queued; cancellation for superseded requests (param
    drags supersede fast).
- `PrimitiveDualCanvas` swaps its `fetch('/api/primitives/preview')` for
  `bakeClient.run(...)` behind a flag (see §6). The scene/`geo` shape
  (`{ full, cutVC, instanced }`) is **unchanged** → `PrimitiveDualScene` and
  `SceneControls` need no edits.
- **IndexedDB mesh cache** keyed on `scriptHash + params + options`: hit →
  instant; miss → bake in worker, store. Per-client, survives reload. (Same key
  discipline as the script cache → no stale-dep recurrence.)

---

## 5. Cutaway / cut semantics

- **Manifold:** client already conceptually owns the half-section (`cutVC`);
  baking it in the worker is a straight port. Keep the >15k-tri auto-skip +
  lazy `Load` affordance (now a client decision, no server round-trip).
- **OCCT:** today `cut:true` re-bakes a server-side coloured half-section. In
  the worker, the OCCT `.cut()` + face-group split runs client-side instead —
  the `scene.showCutaway` checkbox drives a worker re-run rather than a fetch.
- Net: **one checkbox drives both kernels**; only the cost model differs (each
  is now a local worker re-run, not a server bake). Folds naturally into the
  `todo_cutaway_unify` cleanup (shared cut+classify module).

---

## 6. Migration — risk-sequenced, behind a flag, server-bake fallback

Each step ships `bun run build` green and leaves existing call sites working.

### PR1 — Server `/api/primitives/compile` (Manifold) + script cache
Pure addition. Returns the inlined Manifold script + `scriptHash`. Unit-test
the inline-resolution (a dep edit changes the hash; a layout-only edit does
not). No client change. **The deja-vu bug is gone the moment the client reads
from this** — but PR1 alone is dormant.

### PR2 — Client Manifold worker + `bake-client` + IndexedDB cache
`bake-worker.ts` runs a compiled Manifold script and returns `{ full, cutVC,
instanced }`. Adapter unit-tested. Still not wired into the canvas.

### PR3 — `PrimitiveDualCanvas` reads the worker behind a flag
`localStorage('cad-client-bake') === '1'` (default OFF) → use `bakeClient`;
else the current `/api/primitives/preview` path (fallback intact). Dogfood the
flag; compare meshes byte-for-byte against the server path on the g_* corpus.
Browser-verify (Rule 11/12). When confident → flip the default.

### PR4 — OCCT in the worker
Add the OCCT singleton + the OCCT script path to the worker; point the BREP tab
(now on the shared canvas after the BREP-parity work) at the client OCCT
backend behind the same flag. Server OCCT endpoint stays as fallback.

### PR5 — Retire the server mesh bake-cache for the preview path
Once client baking is the default and stable, delete the server-side
`/preview` WASM bake + `bake-cache.ts` mesh cache (keep `/api/cache/*` for the
script cache stats). Server no longer loads Manifold/OCCT for previews.

---

## 7. Files (by PR)

- **PR1:** `src/routes/api/primitives/compile/+server.ts` (new);
  `src/lib/server/primitive-loader.ts` (reuse the resolver to inline deps);
  `src/lib/server/script-cache.ts` (new, mirrors `bake-cache.ts` shape but
  text); unit test.
- **PR2:** `src/lib/cad/bake-worker.ts` + `src/lib/cad/bake-client.ts` (new);
  audit `primitive-sandbox.ts` / `manifold-helpers.ts` / `manifold-mesh.ts`
  for client-importability; adapter unit test.
- **PR3:** `src/lib/shared/PrimitiveDualCanvas.svelte` (flag + backend switch);
  e2e on the g_* corpus.
- **PR4:** `bake-worker.ts` (OCCT singleton + path); `GraphEditorPane.svelte`
  (BREP tab → client OCCT, behind flag) — *after* BREP-parity lands.
- **PR5:** remove server preview-bake + mesh `bake-cache.ts`; trim Dockerfile
  if any WASM copy becomes dead.
- **Not touched:** `PrimitiveDualScene.svelte`, `SceneControls.svelte`,
  `scene-state.svelte.ts` — the `geo` shape is preserved, so the scene chrome
  is reused as-is (same win as the BREP-parity reuse decision).

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Main-thread freeze during bake | Worker is mandatory from PR2; never bake on main. |
| OCCT WASM cold-init cost | Lazy-load OCCT only when a BREP part opens; warm singleton; Manifold-first so the pipeline is proven before paying OCCT. |
| Weak clients (mobile) bake slowly / OOM | Desktop CAD tool; keep server-bake fallback flag for low-power clients if needed. |
| `primitive-sandbox` has Node-only deps | Audit in PR2; the bake logic is plain JS + WASM, but verify no `fs`/`path`/Node globals leak into the client bundle. |
| Mesh divergence client vs server | PR3 byte-compares the g_* corpus across both paths before flipping the default. |
| Losing shared cache hurts first-load | IndexedDB client cache + the cheap server script cache; large meshes never cross the wire anyway. |

---

## 9. Open questions (decide before PR3 default-flip)

1. **Worker bundle size** — Manifold + OCCT WASM lazily loaded; acceptable
   first-bake latency target?
2. **Cancellation policy** — debounce param drags client-side, or cancel-in-
   worker per supersede? (Affects perceived responsiveness.)
3. **Offline** — does a client-side executor open the door to the parked
   WebGPU-SLM / offline-authoring leads (`todo_webgpu_slm`)? Out of scope here
   but the architecture enables it.
