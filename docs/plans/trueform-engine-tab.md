# TrueForm as an experimental parallel engine (a tab below BREP)

**Status:** SHIPPED — tab + init proof (2026-07-02, merge 3f4989e). **Not a migration.** Manifold stays the primary
kernel. Add TrueForm (Polydera) as a THIRD, opt-in engine backend — a **TRUEFORM
tab** in the graph-editor right pane, directly **below BREP** — so we can bake the
same part through Manifold / OCCT-BREP / TrueForm and compare, especially on the
cases where Manifold's v3 mesh boolean degenerates (concentric curved hollow
sweeps → sliver caps; `s_tube`, [[r_sweep_normals_and_twist]]).

## Why
- TrueForm claims **real-time incremental mesh booleans** (AABB trees, ~500K polys,
  drag-to-update) and explicit robustness to **coplanar / non-manifold / bad-winding**
  input — exactly the class of failure biting `s_tube` (two same-`originalID` sweep
  operands, tilted coplanar caps → Manifold v3 degenerate tris, #1283).
- We want DATA (does TrueForm bake `s_tube`'s concentric hollow curved sweep with a
  clean annular cap where Manifold slivers?) before ever considering a bigger role.
- Side-by-side, non-destructive: the existing Manifold + BREP paths are untouched.

## Licensing + facts (RESEARCH COMPLETE 2026-07-02 — GO for eval spike)
- **Package:** `@polydera/trueform@0.9.8` (public npm, 2026-06-28, 20 releases, ESM,
  zero runtime deps, `node>=18`). Maintained by **XLAB** (Polydera = product brand;
  commercial contact `info@polydera.com`).
- **License = DUAL.** Free **PolyForm Noncommercial 1.0.0** for evaluation / personal
  / educational → **we MAY install + evaluate now**, no blocker for the spike. A
  **paid XLAB agreement** is required to ship it in a commercial/production deploy
  (cadtrain.up.railway.app). Pricing not public. ⇒ **BLOCKED-ON-LICENSE only for
  productionizing, NOT for the spike.** Do not bundle into a prod build without terms.
- **Runtime:** browser (Emscripten ES6 module, ~500K polys real-time) AND Node.
- **⚠ Bundle: ~31 MB unpacked WASM** — heavy vs Manifold's core; a real cost for the
  client-bake path. Weigh in P0 (maybe server-only `/api/trueform/preview` first).
- **Boolean API:** `tf.mesh(faces, points)`; `tf.booleanUnion/booleanDifference/…`
  (+ async off-main-thread variants). Meshes are NDArrays over typed arrays
  (`Float32Array` points, `Uint32Array` faces), **zero-copy**, N-gon capable →
  map cleanly to `THREE.BufferGeometry`. Confirms "swap only the boolean layer."
- **Robustness claim (unbenchmarked vs Manifold):** "exact predicates + canonical
  topology, handling non-manifold flaps, inconsistent winding, **coplanar faces**,
  pipeline artifacts" — exactly our `s_tube` failure class. No published Manifold
  head-to-head → the eval matrix below IS how we get the number.
- Pin the exact version (still pre-1.0). Sources: `github.com/polydera/trueform`,
  npm `@polydera/trueform`, `trueform.polydera.com/ts/getting-started`.

## Architecture — mirror the BREP integration (the proven pattern)
BREP was added as: `backend` prop on `PrimitiveDualCanvas` → `/api/brep/preview` →
`brep-adapter.ts` (result → `THREE.BufferGeometry`) → `brep-occt.ts` executor
(maps the graph body's `r_revolve/.add/.subtract/mv/rot` onto replicad/OCCT) → a
**BREP tab** in `RightPane`. TrueForm follows the same seams:

1. **Backend enum.** `backend: 'manifold' | 'brep' | 'trueform'` (extend the existing
   union in `PrimitiveDualCanvas.svelte`).
2. **Executor** `src/lib/{server|cad}/trueform-exec.ts` — a scope that maps our
   emitted body onto TrueForm's boolean/mesh API, the way `brep-occt.ts` maps
   `.add→.fuse / .subtract→.cut`. TrueForm consumes **triangle meshes**, so the
   engine primitives (`r_sweep`, `r_revolve`, …) can build the SAME welded meshes we
   already produce (reuse `manifold-mesh.ts` output as mesh input to TrueForm) and
   let TrueForm do only the **booleans** (`.add/.subtract/.intersect`). That's the
   key: **swap only the boolean layer**, keep our mesh builders. Minimizes surface
   area + isolates the comparison to the boolean (the thing under test).
3. **Endpoint or client module.** If TrueForm runs in-browser → a client path like
   the Web Worker (preferred, matches client-side-execution direction). If Node-only
   → `/api/trueform/preview` mirroring `/api/brep/preview`. Decide after (3) above.
4. **Adapter** `src/lib/shared/trueform-adapter.ts` (+ `.test.ts`) — TrueForm result
   → `{ full, cutVC? }` `THREE.BufferGeometry`, same shape `brep-adapter.ts` returns,
   so `PrimitiveDualScene` renders it unchanged.
5. **Tab.** Add **TRUEFORM** to `RightPane.svelte`'s tab column, **below BREP**.
   Lazy: only bake TrueForm when its tab is active (like the GLB/BREP lazy tabs).
   Badge shows engine + bake ms + tri/vert + degenerate-tri count.
6. **Isolation.** Everything behind the `backend==='trueform'` branch + the adapter;
   default OFF; Manifold + BREP paths byte-identical when the tab isn't opened.

## TEST PLAN (the point of this — comparison methodology)
Bake a fixed **matrix** of parts through all three engines and DECODE the meshes
(don't eyeball — reuse the sliver/normal decoders from the r_sweep debugging):

**Matrix (rows = parts, cols = engines):**
| part | Manifold | BREP | TrueForm |
|---|---|---|---|
| `s_tube` (curved concentric hollow sweep, same-part subtract) — **the bug** | sliver caps | (no sweep path yet) | ? |
| `g_tube` (revolve concentric hollow, same-part subtract) — control, clean | clean | clean | ? |
| straight hollow sweep (vertical) — clean control | clean | n/a | ? |
| curved sweep − **different** part (g_shaft) — clean control | clean | n/a | ? |
| a big part (`g_dp_stand`) — perf/regression | baseline | baseline | ? |

**Metrics per cell (decoded):**
- **Degenerate/sliver cap tris** (near-zero-area count; the headline number — s_tube
  is ~128–192 on Manifold, target 0).
- **Watertight / manifold** (status/volume sign).
- **Cap correctness** — cap triangle area ≈ annulus area (outer − inner), no overlap.
- **Bake time** (cold + warm) vs Manifold — TrueForm's real-time claim vs our ~fast
  Manifold path; note if it's viable for client bake.
- **Vert/tri count** (bloat?).
- **Determinism** — run each ≥20× cache-busted (the `s_tube` failure is intermittent;
  see [[feedback_verify_the_right_scenario]] — capture DURING failure).

**Pass criteria for "TrueForm helps":** `s_tube` curved concentric hollow → **0
degenerate cap tris, watertight, deterministic over 20 bakes**, at a bake time that's
acceptable for the tab (need not beat Manifold). If it passes, TrueForm becomes a
documented fallback engine for coplanar-boolean-heavy parts; if not, we drop it and
lean on the Manifold fix (3.5.1 / per-instance `.asOriginal()`, [[r_sweep_normals_and_twist]]).

## Phasing
- **P0 — spike (gated on licensing).** Load TrueForm (browser or Node), run its own
  boolean demo, confirm it bakes a trivial cube−cube. No app wiring. Decide runtime.
- **P1 — executor + adapter.** `trueform-exec.ts` (booleans only, reuse our meshes) +
  `trueform-adapter.ts` → BufferGeometry. Unit-test the adapter.
- **P2 — tab.** `backend:'trueform'` + TRUEFORM tab below BREP in `RightPane`, lazy,
  badge with degenerate-tri count. Default off.
- **P3 — run the matrix.** Decode + fill the table; write results into this doc +
  `docs/FINDINGS.md`. Recommend keep / drop.
- **Rule 23:** the tab is a non-trivial UI flow → ships with a `.claude/agents/<name>.md`
  subagent spec (drive the tab via claude-in-chrome + curl `/api/*/preview`; run twice,
  identical output; summary table + GIF) BEFORE "done".

## Non-goals
- No replacing Manifold anywhere. No removing/altering the Manifold or BREP paths.
- No bundling TrueForm until licensing is confirmed (⚠ above).
- Not the fix for the current `s_tube` bug — that's the Manifold-side deep-dive
  (3.5.1 / per-instance identity). This tab is for **evaluation + a future option**.

## Related
- BREP integration (the pattern this copies): `src/lib/server/brep-occt.ts`,
  `src/lib/shared/brep-adapter.ts`, `src/routes/api/brep/`, RightPane BREP tab.
- Kernel strategy / speed: [[todo_kernel_csg_speed]], [[todo_occt_brep_backend]].
- The bug that motivated this: [[r_sweep_normals_and_twist]] + the running
  originalID-race deep-dive.
- Client-side execution direction (favor in-browser TrueForm): `docs/plans/client-side-execution.md`.

## Progress (2026-07-02 — SHIPPED)
- **tf engine tab SHIPPED** (merge `3f4989e`, commits `7ff76c0` shell / `68f09f5`
  vite worker-fix + optimizeDeps exclude + client adapter / `4738e48` main-thread
  from-scratch box render). A `tf` right-pane tab sits below BREP; `@polydera/trueform@0.9.8`
  WASM is lazy-loaded on first open and renders a from-scratch box on the MAIN thread
  (proof of init after 3 worker-init stalls → main-thread-first retry).
- **Cross-origin isolation (COOP/COEP) SHIPPED** app-wide (merge `8f205bd`; comment
  fix `2f653e2`) in `hooks.server.ts` + a vite dev middleware — unlocks
  `SharedArrayBuffer` for TrueForm's pthreads. Verified non-regressing; prod-facing invariant.
- **LEFT:** per-part geometry (only the demo box today, not real part booleans) +
  a client/server toggle; then P3 the eval matrix (does tf bake `s_tube`'s concentric
  hollow curved sweep with a clean annular cap where Manifold slivers?).
- Roadmap: `/plan` #931 (done) under the multi-engine umbrella #939.
