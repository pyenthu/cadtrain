# Plan — Client-side execution (server-translate / client-execute split)

> **Status:** PLAN ONLY (no `src/` changes in this commit).
> **Decision (user, 2026-06-16):** cadtrain is a **multi-user app**. Move geometry
> **execution** OFF the server and INTO the browser for BOTH kernels (Manifold +
> OCCT), while the server **keeps translating graph JSON → script**. The server
> becomes a *compiler* (graph → script — quick, pure JS, and an IP boundary worth
> keeping); the client becomes an *executor* (script → mesh, via WASM in a Web
> Worker, on the user's own horsepower).
> **PRESERVE, don't delete:** the existing server-side Manifold + OCCT/BREP
> builder is NOT thrown away. It is **relocated** into an explicit *server builder*
> module under `api/` and kept callable (batch export, headless render, low-power
> fallback, parity oracle). See §6.
> **Origin:** surfaced while debugging the "deja-vu" stale-bake bug (a fix to a
> shared dep, `g_tube`, kept re-appearing because the server mesh-cache key for
> parent parts didn't fold in dependency hashes — see §1). A *script* cache makes
> that whole bug class structurally impossible.

---

## 1. Why — what this fixes and unlocks

### The deja-vu bug (root cause, verbatim record)
`hashBakeKey` (`src/lib/server/bake-cache.ts:109`) keys a bake on **only the
part's own extracted function body + its params + render options** (confirmed:
it concatenates `body | params | sortedOpts`, never the dep bodies). It does NOT
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
- **Scales horizontally** without GPU/CPU bake workers on the backend — and
  without the server holding heavyweight WASM singletons (Manifold ~1 MB,
  OCCT ~11 MB) resident in every Node process.

### What it costs (the actual engineering)
- A **Web Worker is mandatory**, not optional — baking on the main thread freezes
  the UI (we already felt a version of this: "GLB bake blocked the mesh thread").
- **OCCT WASM is heavy** (~11 MB `replicad_single.wasm`, slow cold-init) → lazy-load
  + warm singleton + worker. Manifold WASM is small (~1 MB) and browser-proven
  (manifoldcad.org), so do it first.
- **Lose the shared server mesh-cache** → re-bake per client. Mitigate with an
  IndexedDB client cache keyed on the script hash (same key → instant reload,
  still no stale-dep problem).

---

## 2. Target architecture — compiler / executor (server builder retained)

```
┌─────────────────── SERVER (the compiler) ───────────────────┐
│  graph(JSON) + transitive meta.uses                         │
│      → composition-emit + INLINE resolved deps              │
│      → ONE self-contained script string                     │
│  cache: scripts keyed on sha256(resolved script)  (tiny)    │
│  IP boundary stays here: client gets emitted script, never  │
│  the graph→script logic.                                    │
│                                                             │
│  ── server builder (RELOCATED, still callable) ──           │
│  the existing Manifold + OCCT executor kept behind          │
│  /api/server-builder/* for: batch export · headless render  │
│  · low-power-client fallback · CI parity oracle.            │
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
keeps the hot-path cache a *text* cache. The expensive WASM compose moves to the
client. The server **executor is not deleted** — it is relocated and demoted from
"the only path" to "a supported secondary path" (§6).

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
- The graph→OCCT executor already exists server-side (`src/lib/server/brep-occt.ts`,
  session `2026-06-15`); the compile step emits the OCCT-flavored script for
  `kernel:'occt'` parts and the Manifold-flavored script otherwise. **Note:** the
  emitted client script must reference the *kernel-neutral* sandbox helpers, not
  the server's replicad-via-`createRequire` glue — see §4b on what the OCCT script
  binds to client-side.
- `supported:false` + `reason` for parts a kernel can't build (mirror the BREP
  endpoint's never-500 isolation contract).

> The compiler path retains NO WASM dependency → cheaper, simpler, faster cold
> start. WASM resides server-side only in the relocated *server builder* (§6),
> which is not on the preview hot path.

---

## 4. Client = executor (the Web Worker)

- New `src/lib/cad/bake-worker.ts` (+ a thin `bake-client.ts` main-thread API):
  - Lazy-initialises and caches the Manifold WASM module on first use; OCCT
    likewise (separately — don't pay OCCT's cold-init unless a BREP part is
    opened).
  - Receives `{ script, params, kernel, options }`, runs the script in the same
    sandbox shape the server uses today (`primitive-sandbox.ts` helpers —
    **already verified to have zero Node-only deps**, so they import cleanly into
    the client bundle), returns serialized geometry as **transferable**
    ArrayBuffers.
  - One worker, message-queued; cancellation for superseded requests (param
    drags supersede fast).
- `PrimitiveDualCanvas` swaps its `fetch('/api/primitives/preview')` for
  `bakeClient.run(...)` behind a flag (see §9). The scene/`geo` shape
  (`{ full, cutVC, instanced }`) is **unchanged** → `PrimitiveDualScene` and
  `SceneControls` need no edits.
- **IndexedDB mesh cache** keyed on `scriptHash + params + options`: hit →
  instant; miss → bake in worker, store. Per-client, survives reload. (Same key
  discipline as the script cache → no stale-dep recurrence.)

### 4a. Manifold-client feasibility — LOW risk, do first

- **Kernel:** `manifold-3d@3.4.1`. It is the same package already imported by
  `src/lib/cad/manifold-helpers.ts` via dynamic import; manifoldcad.org runs it
  in the browser today, so the in-browser path is proven upstream.
- **Bundle/perf:** WASM ≈ 1 MB; cold-init is sub-second; bakes are 1–4 ms for
  typical parts (see `bench_extrude_findings`). Negligible first-load tax.
- **Sandbox parity:** `primitive-sandbox.ts` injects 44 helpers (M, CS, cyl,
  tube, gridPatch, capFan, weldAndBuild, sketch, math-lib, …) and imports only
  browser-safe modules (`manifold-helpers`, `manifold-mesh`, `csg-2d`, `sketch`,
  `warp-spline`, `profile-presets`, `math-lib`). Running it inside the worker is a
  straight port — **no Node shims required**.
- **WASM locate:** Vite must serve `manifold.wasm` to the worker. Confirm
  `locateFile`/asset URL resolution under the worker bundle (the one real gotcha;
  trivial vs OCCT).
- **Cutaway:** the half-section `cutVC` already conceptually lives client-side;
  baking it in the worker is a direct port (§5).

### 4b. OCCT-client feasibility — MEDIUM risk, do after Manifold

- **Kernel:** `replicad@0.23.1` + `replicad-opencascadejs@0.23.0`. **replicad is a
  browser-first library** — replicad.xyz is a pure client-side app that runs OCCT
  in a Web Worker. So client-side OCCT is not speculative; it is replicad's
  *primary* deployment target. This materially de-risks the OCCT half.
- **Bundle/perf caveats (the cost):**
  - `replicad_single.wasm` ≈ **11–12 MB**. This is the headline cost. It must be
    **lazy-loaded only when a BREP/OCCT part is opened**, never in the initial
    bundle, and cached as a warm singleton in the worker.
  - **Cold init is multiple seconds** (Emscripten module instantiation + OCCT
    static data). Show a one-time "loading CAD kernel" affordance; keep the
    Manifold path unblocked while OCCT warms.
  - replicad ships variants: `replicad_single` (no exceptions, smallest/fastest)
    vs `replicad_single_with_exceptions` (larger, surfaces OCCT errors). Start
    with `single`; only switch to the exceptions build if we need OCCT failure
    messages client-side.
  - OCCT booleans are **slow vs Manifold** (`todo_kernel_csg_speed`: Manifold CSG
    is ~10–100× faster). Moving OCCT to the client trades a server CPU-bound bake
    for a client CPU-bound bake — fine for desktop, painful on weak clients →
    keep the server-builder fallback (§6) reachable for OCCT specifically.
  - **Memory:** OCCT WASM holds a large heap; long sessions baking many BREP parts
    can grow it. Reuse the singleton; consider periodic teardown for OCCT only.
- **Client load path differs from server:** server `brep-occt.ts` uses
  `createRequire` + `__dirname`/`__filename` emscripten shims to load the CJS WASM
  glue under Vite's ESM/Node pipeline. **None of that applies in the browser** —
  the worker loads replicad's browser entry and points `locateFile` at the served
  `.wasm`. The graph→OCCT *executor logic* (wrapping r_revolve/r_extrude/r_loft/
  r_cuboid → OCCT solids, `.add/.subtract/.intersect` → replicad `.fuse/.cut/
  .intersect`, recursive dep resolution) is portable; **only the WASM bootstrap and
  dep-source fetching change** (deps are inlined by the compiler, so the client
  executor doesn't fetch dep source at all — a simplification vs the server).
- **Recommendation:** ship Manifold-client to default first; gate OCCT-client
  behind the same flag and keep server OCCT as the always-available fallback for
  low-power clients and large boolean trees.

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
  `todo_cutaway_unify` cleanup (shared cut+classify module — and that shared
  module should be authored worker-importable so client and server-builder share
  one classifier).

---

## 6. Server builder — preservation & relocation (do NOT delete)

The existing server executor is an asset, not dead weight. It stays callable
under an explicit namespace and keeps four real jobs:

1. **Batch / headless export** — GLB/STEP/SVG generation for many parts (build
   scripts, RAG corpus thumbnails, CI) where you don't want a browser in the loop.
2. **Low-power / OCCT fallback** — a client that can't (mobile) or shouldn't (huge
   OCCT boolean tree) bake locally requests a server bake.
3. **Parity oracle** — the PR-level byte-compare that validates the client path
   against the server path (§9 PR3) needs the server path to remain runnable
   indefinitely, not just during migration.
4. **Future server-side features** — STEP/IGES export, FEM mesh feed, server-side
   BREP cutaway (`todo_brep_cutaway`) all want a callable kernel on the box.

### Relocation map

Consolidate today's scattered server executor into one cohesive area. Two
acceptable homes — pick **(A) route namespace** for discoverability:

- **(A) `src/routes/api/server-builder/`** — new endpoint namespace:
  - `manifold/+server.ts` ← logic from `api/primitives/preview/+server.ts` +
    `api/primitives/bake-preview/+server.ts` (GLB).
  - `occt/+server.ts` ← logic from `api/brep/preview/+server.ts`.
  - Backed by `src/lib/server/server-builder/` (the lib, option B below).
- **(B) `src/lib/server/server-builder/`** — the implementation modules:
  - `manifold-build.ts` ← `primitive-loader.ts` (sandbox build + dep resolve) +
    `manifold-bake.ts` (GLB serialization).
  - `occt-build.ts` ← `brep-occt.ts` (OCCT executor + tessellation).
  - `mesh-cache.ts` ← `bake-cache.ts`, kept ONLY for the server-builder paths
    (batch/fallback), NOT for the preview hot path. Its dep-blind key bug is
    acceptable here because batch/export callers pass an explicit, fully-resolved
    script (the compiler's inlined output) — so the key already folds in deps.

**Do it as a `git mv` + re-export shim, not a rewrite.** Leave thin
backward-compatible re-exports at the old `src/lib/server/*.ts` paths during
migration so existing imports (`finalizeManifold`, `manifoldToGeo`, `buildGlbBytes`,
`brepFromSource`) keep resolving until call sites are repointed. Engine-primitive
contract (Rule 21), `primitive-paths.ts` resolution, and the never-500 OCCT
isolation contract are all preserved verbatim — only the file locations move.

**Routing / hooks:** add `server-builder/*` paths to `VOLUME_PROXY_PATHS` review
in `hooks.server.ts` only if they should proxy to prod; the manifold/occt build
routes are stateless compute (like today's `preview`) → they should stay LOCAL
(excluded from proxy), same as `preview`/`bake-preview`/`profiles/resolve` today.
Add them to `RATE_LIMITED_PREFIXES` (currently `[]`) since a server bake is now an
opt-in expensive operation, not the default path.

**Dockerfile:** unchanged — Manifold + replicad WASM stay in `node_modules` after
`bun install --production`; the server builder still needs them. (The compiler
path doesn't, but they're co-located in the same image, which is fine.)

---

## 7. Security / IP considerations

- **The graph→script logic never leaves the server.** Clients receive only the
  *emitted, dep-inlined script* + a kernel tag. The authoring intelligence
  (`composition-emit*.ts`, the OCCT executor's method-mapping, the engine
  primitives' parametric logic) stays server-side. This is the explicit reason
  the compile step is NOT moved to the client.
- **But the emitted script IS now shipped to the browser** — a determined user can
  read the inlined dep bodies (engine + volume part source) in DevTools. This is a
  *new* exposure vs today (today only meshes cross the wire). Mitigations / accept:
  - Engine primitives (`stdlib`/`stdstale`) are the crown jewels; if any must stay
    secret, mark them `serverOnly` and force those parts down the server-builder
    path (§6) so their source never ships. Add a `compile` guard that refuses to
    inline a `serverOnly` dep and returns `kernel`-tagged `serverBake:true`.
  - Minify/strip comments from emitted scripts (cheap obfuscation, not real
    protection).
  - Treat the script as readable. The genuine moat is the *vocabulary/translator*
    and the curated part corpus, which remain server-side.
- **Sandbox safety on the client:** the worker runs server-emitted code via
  `new Function(...)`. Because the script is server-authored from a validated
  graph (not arbitrary user paste), the trust model is unchanged from today's
  server sandbox — but the executor must still bind ONLY the known helper names
  (the 44 sandbox args), never expose `fetch`, `import`, or volume tokens into the
  worker scope.
- **No secrets in the worker.** Volume tokens, `ANTHROPIC_API_KEY`, etc. must never
  be needed client-side. The compiler resolves deps server-side and inlines them,
  so the client never authenticates to the volume to bake.

---

## 8. Multi-user implications

- **Server cost decouples from user count × interactivity.** Today N users dragging
  params = N concurrent server WASM bakes contending for one box. After: the server
  serves cached scripts (KB text, trivially horizontally scalable); CPU burns on
  each user's own machine.
- **No shared mesh cache across users** — replaced by per-client IndexedDB. First
  bake of a given script costs each user once; thereafter instant. The cheap server
  *script* cache is still shared, so the compile step benefits all users.
- **Fairness / fallback:** the server-builder path (§6) is a shared resource again
  when used as a low-power fallback → it MUST be rate-limited
  (`RATE_LIMITED_PREFIXES`) so a few weak clients can't reintroduce the contention
  we just removed.
- **Determinism across clients:** Manifold and OCCT are deterministic given the same
  WASM build, so two users baking the same script get the same mesh. Pin WASM
  versions (lockfile already does) so a client on a stale cached bundle doesn't
  diverge — bust the IndexedDB cache on kernel-version change (include the kernel
  version in the cache key alongside `scriptHash`).
- **Offline/edge:** a client-side executor is a prerequisite for the parked
  WebGPU-SLM / offline-authoring leads (`todo_webgpu_slm`) — out of scope here but
  enabled.

---

## 9. Migration — phased rollout (risk-sequenced, flagged, fallback intact)

Each step ships `bun run build` green and leaves existing call sites working.

### PR1 — Server `/api/primitives/compile` (Manifold) + script cache
Pure addition. Returns the inlined Manifold script + `scriptHash`. Unit-test the
inline-resolution (a dep edit changes the hash; a layout-only edit does not). No
client change. **The deja-vu bug is gone the moment the client reads from this** —
but PR1 alone is dormant.

### PR2 — Client Manifold worker + `bake-client` + IndexedDB cache
`bake-worker.ts` runs a compiled Manifold script and returns `{ full, cutVC,
instanced }`. Adapter unit-tested. Still not wired into the canvas. Confirm the
worker resolves `manifold.wasm` (§4a locate gotcha).

### PR3 — `PrimitiveDualCanvas` reads the worker behind a flag
`localStorage('cad-client-bake') === '1'` (default OFF) → use `bakeClient`; else
the current `/api/primitives/preview` path (fallback intact). Dogfood the flag;
**byte-compare meshes against the server path on the g_\* corpus** (this is the
parity-oracle use of the soon-to-be-relocated server builder — §6 reason 3).
Browser-verify (Rule 11/12). When confident → flip the default.

### PR4 — Relocate the server executor into the *server builder* (§6)
`git mv` + re-export shims: `primitive-loader.ts`/`manifold-bake.ts` →
`src/lib/server/server-builder/`, `brep-occt.ts` → same; new
`/api/server-builder/{manifold,occt}` routes wrapping them. Old `/api/primitives/
preview` + `bake-preview` + `/api/brep/preview` become thin shims that call the
server builder (so nothing breaks) OR are pointed at the new routes. Add to
`RATE_LIMITED_PREFIXES`. **Nothing is deleted** — this is the preservation step.

### PR5 — OCCT in the client worker
Add the OCCT singleton (lazy, `replicad_single`, ~11 MB, worker-only) + the OCCT
script path to `bake-worker.ts`; point the BREP tab (now on the shared canvas after
BREP-parity) at the client OCCT backend behind the same flag. Server OCCT (now the
server builder) stays as fallback for low-power clients + large boolean trees (§4b).

### PR6 — Default-flip + demote the server path
Once client baking is default and stable, the preview hot path no longer touches
the server builder. The server builder remains callable for batch/headless/fallback
(§6). Server Node processes no longer hold Manifold/OCCT resident *for previews*,
but the packages stay installed for the server-builder routes. Do NOT remove the
WASM from the image.

> **Difference from the prior draft:** the old PR5 *deleted* the server bake +
> `bake-cache.ts`. Per the 2026-06-16 decision we **relocate and demote** instead
> (PR4 + PR6). The kernel stays on the server, just off the hot path.

---

## 10. Files (by PR)

- **PR1:** `src/routes/api/primitives/compile/+server.ts` (new);
  `src/lib/server/primitive-loader.ts` (reuse the resolver to inline deps);
  `src/lib/server/script-cache.ts` (new, mirrors `bake-cache.ts` shape but text);
  unit test.
- **PR2:** `src/lib/cad/bake-worker.ts` + `src/lib/cad/bake-client.ts` (new);
  `primitive-sandbox.ts` / `manifold-helpers.ts` / `manifold-mesh.ts` confirmed
  client-importable (already verified zero Node deps); adapter unit test.
- **PR3:** `src/lib/shared/PrimitiveDualCanvas.svelte` (flag + backend switch);
  e2e on the g_* corpus.
- **PR4:** `git mv` → `src/lib/server/server-builder/{manifold-build,occt-build,
  mesh-cache}.ts`; `src/routes/api/server-builder/{manifold,occt}/+server.ts`
  (new); re-export shims at old paths; `hooks.server.ts` (`RATE_LIMITED_PREFIXES`).
- **PR5:** `bake-worker.ts` (OCCT singleton + path, lazy `replicad_single`);
  `GraphEditorPane.svelte` (BREP tab → client OCCT, behind flag) — *after*
  BREP-parity lands.
- **PR6:** flip default flag; trim preview shims; keep server-builder + WASM.
- **Not touched:** `PrimitiveDualScene.svelte`, `SceneControls.svelte`,
  `scene-state.svelte.ts` — the `geo` shape is preserved, so the scene chrome is
  reused as-is (same win as the BREP-parity reuse decision).

---

## 11. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Main-thread freeze during bake | Worker is mandatory from PR2; never bake on main. |
| OCCT WASM cold-init + 11 MB bundle | Lazy-load OCCT only when a BREP part opens; warm singleton; `replicad_single` (no-exceptions) build; Manifold-first so the pipeline is proven before paying OCCT. |
| Weak clients (mobile) bake slowly / OOM (esp. OCCT booleans, ~10–100× slower than Manifold) | Desktop CAD tool; keep the **server-builder** fallback (§6) reachable + rate-limited; route huge/`serverOnly` parts there. |
| Emitted script leaks engine/part source | Accept readable scripts; `serverOnly` flag forces sensitive deps down the server-builder path so their source never ships (§7); minify. |
| `primitive-sandbox` Node-only deps | Already verified: zero Node imports — browser-safe. Re-confirm in CI when bundling the worker. |
| Mesh divergence client vs server | PR3 byte-compares the g_* corpus across both paths before flipping; the retained server builder IS the oracle. |
| Cross-client divergence on kernel upgrade | Pin WASM via lockfile; include kernel version in the IndexedDB cache key; bust on change. |
| Losing shared cache hurts first-load | IndexedDB client cache + the cheap shared server *script* cache; large meshes never cross the wire anyway. |
| Server-builder fallback reintroduces contention | `RATE_LIMITED_PREFIXES` on `/api/server-builder/*`; it's opt-in, not the default path. |

---

## 12. Open questions (decide before PR3 default-flip)

1. **Worker bundle size / first-bake latency target** — what cold-init budget is
   acceptable for OCCT's ~11 MB before we force the fallback instead?
2. **Cancellation policy** — debounce param drags client-side, or cancel-in-worker
   per supersede? (Affects perceived responsiveness, especially for slow OCCT.)
3. **`serverOnly` IP tier** — do any engine primitives actually need to stay secret,
   or do we accept readable emitted scripts and treat the vocabulary as the moat?
4. **Offline** — does the client executor open the WebGPU-SLM / offline-authoring
   leads (`todo_webgpu_slm`)? Out of scope here but the architecture enables it.
