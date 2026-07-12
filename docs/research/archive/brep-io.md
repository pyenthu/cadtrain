> **ARCHIVED 2026-07-13** during the /research reorg. Self-contained no-go:
> evaluates adopting brep.io (a browser-based BREP viewer) and finds it adds
> no capability we don't already have via the server-side OCCT BREP tab, and
> a client-side WASM kernel conflicts with the SSR-off architecture. No later
> doc depends on this one; kept for provenance, not active reference.

# Feasibility note — brep.io experimentation (item #15)

> 2026-06-16. Short read-only assessment. Question: would brep.io / brep-based
> web tooling add anything here, given we ALREADY run server-side OCCT BREP?

## What we already have

- **A working server-side OCCT BREP path** — `src/lib/server/brep-occt.ts`
  (opencascade.js in Node), `/api/brep/preview`, the BREP tab in
  `RightPane.svelte`, and `brep-adapter.ts` mapping the response (positions +
  index + OCCT exact-surface normals; coloured half-section for cutaway) into
  the same geometry wrapper `PrimitiveDualScene` consumes. Per
  `session_handoff_2026-06-15_brep`: a full graph→OCCT executor, 19/19 parts
  baking via revolve/extrude/loft/CSG/composed.
- **A decided kernel strategy** — `docs/plans/kernel-strategy.md` frames
  Manifold (fast CSG, mesh-only) vs OCCT (slow CSG, exact BREP) and three
  architectures (stay Manifold / parallel OCCT / hybrid OCCT-authors-curves →
  Manifold-booleans). We are NOT short of a BREP kernel.

## What "brep.io" is (verify — no internet this pass)

`brep.io` presents as a browser-based BREP/parametric CAD viewer/editor
(WebGL + a BREP kernel, likely OCCT/opencascade.js compiled to WASM, in the
same family as replicad, CascadeStudio, and OpenCascade.js demos). Its value
proposition is **client-side exact-surface modeling + tessellation in the
browser**. Treat the specifics as unconfirmed until checked.

## Does it add anything for us?

Mostly **no** — it would be a *different packaging of the kernel we already
run*, not a new capability:

- The exact-surface / NURBS / adaptive-tessellation benefit is **already
  delivered** by our server-side OCCT path. brep.io wouldn't give us a surface
  representation we lack.
- Moving BREP **client-side** (its main differentiator) conflicts with our
  architecture: SSR-off + we deliberately keep heavy geometry server-side
  (bake cache, proxied volume, Railway adapter-node). A second in-browser WASM
  kernel = large payload + cold-start cost (the exact concern flagged in
  `kernel-strategy.md` and `todo_occt_brep_backend`).
- Our render contract is vertex-coloured Manifold/OCCT meshes into Threlte;
  adopting another tool's viewer would mean re-plumbing, for no geometry gain.

## Where a (tiny, time-boxed) spike *could* pay off

Only as a **reference / idea source**, not a dependency:

- **UX patterns for exact-edge display** (HLR silhouette lines, BREP edge
  highlighting, measurement) — if brep.io does edge/measurement UI well, crib
  the interaction model for our BREP tab + the parked SVG/HLR route
  (`docs/research` SVG note).
- **Kernel-boundary ideas for the hybrid** (OCCT authors curves → mesh →
  Manifold booleans) — if it shows a clean per-op kernel split, that informs
  `kernel-strategy.md` architecture #3.

## Recommendation

**No spike now.** We already have the BREP capability server-side; brep.io's
client-side angle fights our SSR-off/server-bake architecture and adds a second
WASM kernel we explicitly want to avoid. Park it as a **UX/interaction
reference** to revisit only if (a) we pursue client-side execution
(`docs/plans/client-side-execution.md`) — then re-evaluate it alongside
replicad/CascadeStudio as a browser-kernel option — or (b) we build out BREP
edge/measurement UI and want prior art. If revisited, time-box to a half-day
read of its source/licensing; do not take a runtime dependency.

Cross-refs: `docs/plans/kernel-strategy.md`, `docs/plans/brep-tab-parity.md`,
`docs/plans/client-side-execution.md`, `src/lib/server/brep-occt.ts`,
`src/lib/shared/brep-adapter.ts`, memories `session_handoff_2026-06-15_brep`,
`todo_occt_brep_backend`.
