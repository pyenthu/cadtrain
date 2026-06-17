# Smooth surfaces + BREP fidelity — sequential plan

> Spawned from the 2026-06-17 shading/BREP session. Three surface kernels are now
> in play and the question "why isn't it smooth / faithful?" keeps recurring.
> This sequences the work; each phase is independently shippable.

## Context — the three kernels

| Kernel | Surface | Booleans | In cadtrain |
|---|---|---|---|
| **Manifold** | mesh, FACETED by `segments` | fast, mesh CSG | the live bake (`/preview`, client worker) |
| **OCCT / BREP** | EXACT (true curves) | exact, **done in OCCT space** (`fuse`/`cut`/`intersect`), meshed only at the end | the BREP tab (`brep-occt.ts`) |
| **NURBS** | mathematically SMOOTH, GPU-evaluated | n/a (display surface) | NOT in cadtrain — **SVTC dgeo uses it** |

### Findings that drive this plan
- **BREP revolve is exact → ignores `segments`.** A part designed as a faceted
  prism (`segments=4`) renders ROUND in BREP (`solid.revolve()` is the exact
  surface of revolution). Confirmed live on g_shaft.
- **BREP CSG is OCCT-exact**, not Manifold — tessellation happens after all the
  booleans. (So a BREP→Manifold conversion today would only buy display speed,
  not change the exact booleans.)
- **SVTC dgeo gets smooth layers via NURBS** (`~/code/SVTC/src/lib/apps/dgeo/nurbs/`):
  `railsToNURBS.ts` (rails → ctrl pts/knots, degree 3) + a GPU evaluator
  (`nurbsEval.glsl.ts` per-fragment basis, `NurbsEvaluatorChain` =
  WebGPU→WebGL-GPGPU→CPU). Smooth surface × dense GPU sampling = no facets, no
  normal hacks. See [[svtc_repo]].
- **Manifold smooth shading over-rounds faceted parts** — the parked "crease-aware"
  problem (blanket `computeVertexNormals` has no crease angle).

## Sequence

### Phase 1 — Faceted BREP revolve (small, targeted) ← START HERE
Make BREP honor `segments` so `4 → square prism`, matching Manifold.
- `brep-occt.ts`: a `facetedRevolve(profile, N)` that lofts regular **N-gon**
  sections — `drawPolysides(r_i, N).sketchOnPlane('XY', z_i)` at each off-axis
  profile point, `sk0.loftWith([rest], { ruled: true })` (ruled = flat faces).
- Wire `segments` into the executor `r_revolve(a, b)` (b/`a.segments`) + the
  standalone `revolveBrep` (via `opts.segments`). Faceted when `3 ≤ seg ≤ ~48`,
  else exact `.revolve()` (round, cheaper).
- Verify `p.segments=4` → square in the BREP tab; high seg still round + fast.

### Phase 2 — NURBS smooth-surface spike (borrow SVTC)
Study SVTC's NURBS pipeline and decide where it earns its place in cadtrain.
- Read `railsToNURBS.ts`, `nurbsEval.glsl.ts`, `NurbsEvaluatorChain.svelte.ts`,
  `nurbsWebGpu.ts`/`nurbsGpgpu.ts`/`nurbsCpu.ts`.
- **Highest-value target: the `/wells` 3D layer/horizon surfaces** — SVTC already
  proves NURBS there; we can adopt it for smooth well/formation surfaces
  (cross-link [[well_schematic_3d_first]], `docs/plans/well-schematic.md`).
- Optional stretch: smooth CAD surfaces-of-revolution via NURBS (a smooth path
  alongside Manifold's faceted one) — only if Phase 3 says it's worth it.
- Output: a `docs/plans/nurbs-surfaces.md` + a wells integration note.

### Phase 3 — BREP→Manifold hybrid + BREP.io ideas (research spike)
The kernel-strategy decision: keep CSG exact in OCCT (slow), or tessellate
BREP→Manifold and do booleans in Manifold (fast, approximate)?
- We already half-do BREP→Manifold (`target.mesh()` → `new Manifold(new Mesh)`).
- Study `mmiscool/BREP.io` (a JS BREP kernel that uses **manifold-3d for its
  booleans**) — half-edge BREP structure, tessellation, the BREP↔Manifold handoff.
- Decide: hybrid (OCCT authors curves → Manifold booleans) vs exact-OCCT.
- Output: update `docs/plans/kernel-strategy.md` ([[todo_kernel_csg_speed]],
  [[todo_occt_brep_backend]]).

### Phase 4 — Crease-aware Manifold normals (the parked shading fix)
Smooth mode must keep SHARP edges sharp + smooth only curves (serrated/faceted
parts must not over-round) — like BREP's per-face OCCT normals.
- Get Manifold `calculateNormals(3, crease)` to actually produce normals (it
  returns all-zero on welded meshes → today we fall back to blanket
  `computeVertexNormals`, which has no crease awareness). OR compute crease-aware
  normals ourselves (split vertices where the dihedral angle > crease).
- Reuses the BREP crease-awareness finding (OCCT duplicates edge verts + per-face
  normals — verified 84/84 divergent on a cylinder rim).

## Order rationale
P1 is a quick fidelity win. P2 (NURBS) is the highest-leverage *smoothness* idea
and directly helps `/wells`. P3 decides the kernel direction (affects how much we
invest in OCCT vs Manifold vs NURBS). P4 is the contained shading polish, best
done once P3 clarifies whether Manifold stays the primary display kernel.
