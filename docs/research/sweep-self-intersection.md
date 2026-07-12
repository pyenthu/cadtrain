# Preventing sweep self-intersection — theory, literature, and where it hooks into our kernels

> **Visual explainer (interactive diagrams):**
> **[Preventing Sweep Self-Intersection →](https://claude.ai/code/artifact/c8e4460e-0c01-4479-8bbe-d55145359206)**
> The fold geometry is *computed* from the real offset curves, so the overlap you see is the actual overlap — not a hand-drawn sketch. This note is the text record; the link is the pictures.

**Date:** 2026-07-12 · **Trigger:** the BREP flicker on `/graph-editor` (a z-fighting shimmer around curvature) turned out to be a *self-intersecting sweep* — a non-manifold solid, not a shading bug. This is the deep dive into how to stop building the fold in the first place.

---

## The failure (why it flickers)

On the inside of a bend, the tube wall passes through itself. Every edge on the fold gets **more than two incident faces** — the surface is no longer a valid solid boundary. That is exactly why it z-fights: two coincident triangles at the same depth, no way to order them. No `polygonOffset` / depth-bias fixes an *invalid solid*; it only quiets the symptom. The overlap is in the geometry, not the tessellation or the frame — a section wider than the local bend radius **must** overlap in space.

## The exact condition (the local fold)

Sweep a planar section `p(φ)=(a,b)` along spine `C(s)` with a section frame `{T,U,V}`:
`S = C(s) + a·U(s) + b·V(s)`. With a rotation-minimizing frame (no twist), the along-path derivative collapses to one scalar factor:

```
∂ₛS = (1 − κ·η) · T,      η = p·N̂  (a section point's reach toward the concave side)
```

The surface is a regular immersion — no fold — exactly while that factor is positive. Let `h(s) = maxᵩ η` be the section's **inward reach** toward the principal normal. Then:

```
κ(s)·h(s) < 1     ⇔     h(s) < 1/κ(s) = R(s)
```

- At `κη = 1` a section point sits **on the center of curvature** — the map is singular (a cusp).
- Past it, the Jacobian goes negative: orientation flips, the wall inverts.
- The **outer** wall never folds (there `η < 0`, factor > 1 — it only stretches). **Folding is exclusively an inner-of-the-bend event.**
- For a circular tube of radius ρ this is the classic `ρ < R_min`, and it's identical to the offset-curve law `κ = −1/d`.

## Reach — the number that unifies local and global

Federer's **reach** of a curve is the largest tube radius for which every nearby point has a unique closest point on the spine (the distance from the spine to its own medial axis). A tube is fully self-intersection-free **iff its radius is below the reach**, and reach factors cleanly into the two distinct failures:

```
reach = min( 1/κ_max          ,   ½·d_bottleneck )
             └ local curvature      └ global self-approach
```

So the pipe-surface rule `r < 1/κ_max`, the offset "2r > distance" rule, and the sweep min-distance-pair test are **the same theorem seen three ways**. A purely local rule can only guarantee an *immersion*; the global bottleneck term is why a distance check is also needed. Maekawa's canonical pipe example makes the split concrete: for one curvy spine, local self-intersection first appears at `r = 0.0320`, global at `r = 0.0418` — distinct thresholds, distinct machinery, local always biting first.

## The rail-major construction (per-vertex splines + clamp)

An alternative build — turn the sweep inside out: **each section vertex traces its own longitudinal spline**, and the surface is the loft *across* those rails. Those rails are exactly the **offset curves** of the spine (vertex `k` at constant `(aₖ,bₖ)` traces `C(s)+aₖU(s)+bₖV(s)`). Parameterize each rail `t∈[0,1]`; the ring at `t` is one point per rail.

- **What the shared `0→1` grid is — and isn't.** It's correct bookkeeping and the natural scaffold, but it's a *parameterization*. Self-intersection is a property of the *image*, not the parameter: a folded tube can have a perfectly bijective `(t,φ)` grid and still pass through itself. Decimation-by-curvature buys **smoothness** (adaptive axial density — the `√(8ε/κ)` sagitta rule we already use in `warp-spline.ts`), *not* fold-freedom.
- **The clamp is a per-cell test.** At each `t`, an inner rail folds where `(1−κη)` flips sign — the rail-point stops advancing and reverses along the tangent. Floor those points at `η → (1−ε)/κ` and no rail inverts. This is the **anisotropic miter**: pinch only the inner rails that would fold, keep the OD exact. It's the parametric-preserving cousin of distance-map trimming — you keep the `(s,φ)` surface instead of dropping to a mesh.

## Prevention menu (ranked)

Ranked by robustness × determinism × fit for a constant-or-tapered CAD pipe. The winner is a composite: RMF + the immersion guard, then **fair the spine** (raise the bend radius) rather than deform the pipe — with a global check and the distance-map as a last resort.

| # | Technique | Kind | Det? | Cost | Fails when |
|---|-----------|------|------|------|-----------|
| 1 | **RMF (double-reflection)** — kill spurious twist folds (prereq) | prevent | yes | O(n) | Doesn't touch genuine folds; needs C¹ spine |
| 2 | **Immersion guard** — the `κh<1` / `1−κη` test | detect→gate | yes | O(n) | Under-sampling hides κ spikes; local only |
| 3 | **Fair the spine** — clothoid / κ-capped G² to raise R_min (section stays exact) | prevent | yes | O(n) | Changes the path; corners need fillets |
| 4 | **Variable-section clamp** — pinch the inner reach (the rail clamp) | prevent | yes | O(n) | Deforms section — loses constant OD/ID |
| 5 | **Global clearance** — BVH: no two far sections within 2r | detect→prevent | yes | O(n log n) | Window tuning; non-local, no differential fix |
| 6 | **Reach / MAT cap** — r < reach (the complete criterion) | prevent | theory | high | Medial axis unstable + costly at runtime |
| 7 | **Distance-map envelope** — Minkowski outer boundary | reconstruct | yes | high | Loses parametric section (mesh out) |
| 8 | Offset SSI-trace trimming — cut the swallowtail | repair | ~ | high | Seed solves + swallowtails near cusps |
| 9 | Boolean self-union (status quo) | repair | yes | med | Destroys parametrization; fuses distinct parts |

## The guarded sweep (recipe)

1. **Frame** — RMF, double-reflection (Wang–Jüttler, 4th-order). Removes frame-induced folds; well-defined through inflections.
2. **Measure** — κ(s) from C′,C″; principal-normal angle θ(s) in the RMF (accumulates −τ, so torsion rotates the fold direction around a non-circular section).
3. **Guard · local** — inner reach `h = h_dir(θ)`; require `κ·h ≤ 1−ε`; required radius `R_req = h/(1−ε)`.
4. **Prevent** — where it fails: *preferred* raise the local bend radius to `R_req` (clothoid / κ-capped G² fairing), re-run 1–3 (monotone convergence, section stays exact); *fallback* clamp the inner rails and flag the deformation.
5. **Guard · global** — BVH over section-swept AABBs; for parameter-distant pairs test `dist(Cᵢ,Cⱼ) ≥ hᵢ+hⱼ+ε`. No differential fix — reject / reduce / re-route.
6. **Emit** — only after both guards pass, loft `S(t,φ)`. Guaranteed immersion (local) + embedding (global) to sample resolution.

## Where it hooks into our kernels

All three engines already **share one rotation-minimizing frame** (`sweepFrames`, in `src/lib/engines/manifold/manifold-mesh.ts`, imported by TF + BREP). The gap is purely that **no engine evaluates curvature in the sweep** — only tangents. There's prior art to build on: a 2D section-only self-intersection test (`sectionSelfIntersects`) and a post-build genus check that already flags `"bend radius < section radius"` (`warp-spline.ts` `warpValidity`) — but nothing does the pre-build curvature guard.

| Engine | Section frame | κ source | Hook |
|--------|---------------|----------|------|
| **Manifold** (primary) | RMF `sweepFrames` | sampled (`planAxialStations`) | `manifold-mesh.ts` (sweep place-loop) |
| **TrueForm** | RMF (same code) | sampled | `engines/trueform/graph-to-tf.ts` (`sweep_section`) |
| **BREP** (OCCT) | torsion-min `MakePipeShell` | **exact*** (`BRepLProp`) | `engines/brep/brep-occt.ts` (`sweepOcct`) |

\* BREP is the only kernel that can query **exact** κ from OCCT — but its spine is a polyline today, so it would need a real curve first. Everywhere else, κ is the same sampled model as the curvature-adaptive-subdivision plan.

**Recommendation — one pure module, `src/lib/graph/sweep-guard.ts`**, in the CAD-domain layer (same pattern as `survey-to-xyz.ts`, already injected into every kernel sandbox). WASM-free, unit-testable, called *pre-build* by all three:

```
sweepFeasibility(path, frames, section)
  → { ok, minBendRadius, inwardReach, action: 'ok'|'scale'|'reject', scale }
```

Companion plan: `docs/plans/curvature-adaptive-warp-subdivision.md` (one κ model across the three engines).

## Literature (primary sources)

**Pipe / canal surfaces** — Maekawa, Patrikalakis, Sakkalis & Yu (1998), *Analysis of pipe surfaces*, CAGD 15 (the `r<1/κ_max` rule + global tangency systems); Patrikalakis & Maekawa, *Shape Interrogation for CAD/Manufacturing* (MIT hyperbook §11.6).

**Offset self-intersection** — Farouki & Neff (1990), *Analytic properties of plane offset curves*, CAGD 7 (`κ=−1/d`); Seong, Elber & Kim (2006), *Trimming local & global self-intersections via distance maps*, CAD 38; Pekerman, Elber & Kim (2008), *Binormal-line elimination*, CAD 40.

**Sweeps & detection** — Wang & Wang (2002), *Generalized-cylinder self-intersection avoidance*, CAGD 19 *(abstract-only, unverified)*; He, Wang & Zhao (2025), *Detection from spine geometric features*, CAD; Abdel-Malek/Blackmore et al., swept-volume foundations *(abstract-only)*.

**Frames** — Wang, Jüttler, Zheng & Liu (2008), *Computation of rotation-minimizing frames / double reflection*, ACM TOG 27 (4th-order); Bishop (1975), parallel-transport frame; Jüttler (1998), robust RMF for CAD sweeps, CAD 30.

**Reach / medial axis** — Federer (1959), *Curvature measures* (the reach), TAMS 93; Aamari et al. (2019), `reach = min(1/κ_max, ½·bottleneck)`, EJS 13.

**Fairing** — Farin / Sapidis, energy fairing (∫κ²) to raise min radius of curvature; clothoid / Euler-spiral bounded-curvature transitions (road/rail).
