# BREP on the client — OCCT/replicad WASM in the browser

**Status:** planning (2026-07-02). User directive: **"I want the BREP to run on the
client side with wasm."** Today BREP bakes on the SERVER (`/api/brep/preview` → OCCT
via replicad in Node). Move it into the browser (Web Worker) so geometry stays LOCAL
(data-residency constraint, memory `ai_data_residency_local_first`) and it matches the
client-side-execution direction (`docs/plans/client-side-execution.md`).

## Feasibility — YES
`replicad` is **opencascade.js** (OCCT compiled to WASM) and runs in the browser (that's
replicad's primary target). So the OCCT executor logic in `src/lib/server/brep-occt.ts`
(which maps the graph body's `r_revolve/r_sweep/.add/.subtract/mv/rot` onto replicad ops)
is mostly kernel-agnostic JS — it can run in a browser Web Worker with replicad loaded
there. The Manifold client bake (`bake-worker.ts`/`bake-client.ts`, `scene.clientBake`)
is the exact pattern to mirror.

## Approach (mirror the Manifold client-bake)
1. **Load OCCT/replicad WASM in a Web Worker** — lazy, only when the BREP tab first opens
   (opencascade.js is large, ~several MB; keep it out of the default bundle, like the
   planned tf WASM). A dedicated `brep-worker.ts` (or extend the bake worker with a BREP
   mode).
2. **Port the executor** — move/share `brep-occt.ts`'s executor so it runs in the worker
   (it currently lives under `src/lib/server/`; the OCCT-mapping logic should run
   client-side unchanged once replicad is initialized in the worker). Inject
   `resampleSpline` etc. as today.
3. **Bake path** — the BREP tab bakes via the worker instead of POSTing to
   `/api/brep/preview`. Keep the server endpoint as a fallback (a ⚡client/☁server BREP
   toggle mirroring the Manifold one; default CLIENT per the directive).
4. **Adapter unchanged** — `brep-adapter.ts` (OCCT tessellation → `THREE.BufferGeometry`)
   is kernel-side-agnostic; reuse it.
5. **Display-mesh weld** — the OCCT tessellation has per-face T-junctions (non-manifold
   edges; the ~1.8e9 bogus count bug). Fold in the non-manifold-cleanup result (agent
   a6e449e) — position-weld + Manifold.merge the OCCT mesh so it reads watertight + the
   count is correct. Applies to both server + client BREP.

## Caveats
- **Bundle size:** opencascade.js WASM is large — MUST lazy-load on first BREP-tab open;
  never in the default bundle.
- **Speed:** OCCT is ~40-100× slower than Manifold (exact kernel) — same on the client;
  ~1s bakes. Cache like the Manifold client bake (IndexedDB, scriptHash + kernel version).
- **SSR off** already (WASM can't SSR) — fine.

## Related BREP TODOs (log — from 2026-07-02)
- **Color parts in BREP** (user): the BREP tab renders monochrome; respect the per-part
  colorOuter/colorInner + the #86 subpart colors (the PROPERTIES color table exists but
  BREP ignores it). Route OCCT faceGroups → vertex colors like the Manifold path.
- **Smooth BREP** (user): apply crease-aware smooth normals to the OCCT tessellation like
  the Manifold `creaseAwareCornerNormals` fix, so BREP surfaces read smooth (they carry
  exact-surface normals — surface them; the cut faces stay faceted).
- **Bogus count bug**: the BREP badge shows a garbage ~1.8e9 tri/vert count on the sweep
  BREP (T-junction display mesh / an unsigned-overflow misread) — fix in `brep-adapter.ts`
  / the count path (tie to the non-manifold weld, agent a6e449e).

## Related
- Server BREP r_sweep shipped (`brep-occt.ts`, commit 5daf667; memory `r_sweep_normals_and_twist`).
- Client-side-execution pattern: `docs/plans/client-side-execution.md`, `bake-worker.ts`.
- Non-manifold cleanup exploration (agent a6e449e) — the display-mesh weld.
