# Plan — geometry kernel strategy: Manifold ⚡CSG vs OCCT ✅curves (and a hybrid)

> Research + decision plan. Spawned 2026-06-14 from the g_star/replicad
> smoothness thread. Sibling of memory `todo_occt_brep_backend` (can we run
> OCCT server-side) — this doc is the *performance tradeoff + hybrid
> architecture* angle. Outcome wanted: a clear go/no-go + shape for any
> second-kernel work.

## The core tension (to confirm with real numbers)

Our two candidate kernels sit at **opposite ends of one tradeoff**:

| | CSG / boolean | Curve representation | Tessellation |
|---|---|---|---|
| **Manifold** (current) | ⚡ very fast, robust, **always manifold** | ❌ none — triangle mesh | baked at build |
| **OCCT** (replicad's) | 🐢 slow, occasionally fragile | ✅ exact **BREP/NURBS** | adaptive, at view/export |

**Claim to verify (stated from established knowledge, NOT yet benchmarked here):**
Manifold does CSG **~10–100× faster** than OCCT's `BRepAlgoAPI`. Evidence to
gather:
- OpenSCAD's Manifold backend vs its old CGAL backend (published speedups).
- The Manifold paper / repo benchmarks vs CGAL/OCCT.
- A **first-party micro-benchmark**: same N-part union + subtract chain (e.g.
  a g_dp_stand-scale assembly) in Manifold (we have it) vs `opencascade.js`.
  Record wall-clock + failure rate.

Why it matters: **adding OCCT for curves would cost us the fast CSG** that makes
our bake cache + instancing + stack assembly cheap. We can't just "switch."

## Three architectures to evaluate

1. **Stay pure Manifold (status quo).** Smoothness = Tier-1 dense sampling
   (`r_loft`, cosine profiles, high `divs`/`segments`). Fast CSG kept. No exact
   curves, smoothness is a triangle budget. *Cheapest; current path.*
2. **Add OCCT as a parallel kernel.** A part is EITHER Manifold or OCCT; the
   resolver/graph picks; booleans don't cross kernels. Big WASM payload, slow
   OCCT booleans, but real BREP for the parts that need it. (See
   `todo_occt_brep_backend` for the server-side-WASM feasibility questions.)
3. **Hybrid: OCCT authors curves → tessellate → Manifold does booleans.**
   Use OCCT only to *generate* smooth curve geometry (filleted profiles, lofts,
   shells), immediately mesh it, then hand the mesh to Manifold for all
   CSG/assembly. Gets smooth inputs + fast booleans. Cost: a meshing handoff +
   you lose BREP exactness the moment you tessellate (fillets-on-final-solid
   would still be mesh-only). This is roughly how several pipelines split it.

## Decision questions

- How many real downhole parts actually NEED exact curves vs look fine at
  Tier-1 sampling? (If few, architecture 1 + `r_loft` wins.)
- Does `opencascade.js` fit the Railway/adapter-node Docker image (size,
  cold-start, memory)?
- For the hybrid, where's the kernel boundary in the graph editor — a per-node
  "OCCT op" set that emits mesh, consumed by Manifold nodes?
- Benchmark: at what assembly complexity does OCCT booleans become unusable
  (the data that makes the hybrid case)?

## Research steps

1. Gather published Manifold-vs-CGAL/OCCT CSG benchmarks → numbers in this doc.
2. Stand up a throwaway `opencascade.js`-in-Node spike: build replicad's
   wavy-vase server-side, time it, get its real triangle count (answers the
   open "how many tris does the vase have" question for real).
3. Micro-benchmark: identical boolean chain, Manifold vs OCCT, wall-clock +
   robustness.
4. Recommend an architecture (1/2/3) with the data.

## Meanwhile (shipped, no kernel change)

`r_loft` (`src/lib/graph/stdlib/r_loft.ts`, 2026-06-14) — welded scale-along-Z
loft (barrel/waist/flare/ogive/scurve + twist) covers the "radius varies
smoothly along length" class inside Manifold. Demo part: `g_barrel`.

Cross-refs: `docs/research/cad_authoring_patterns.md` (Tier classification),
`docs/plans/wavy-star.md`, memory `todo_occt_brep_backend`,
`bench_extrude_findings`.
