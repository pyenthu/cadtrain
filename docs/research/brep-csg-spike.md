# BRep→CSG Phase-0 feasibility spike — findings (2026-07-12)

> Headless spike against the Shen et al. BRepNet BRep-to-CSG paper (see
> `brepnet-brep-to-csg.md`).
> **NOTE:** the spike's CODE (`brep-csg.ts` feature extractor + tests) was LOST to
> a premature worktree prune before it committed. This doc preserves the FINDINGS
> (the actual deliverable of a spike); the extractor is re-derivable at Phase 2a.

## Verdict
**GO for Phase 1 (feature extractor → part retrieval). NO-GO on the paper's LEARNED
pre-segmentation as a near-term item** — our parts are mostly already convex, and
the real blocker is OCCT boolean robustness (which a neural net does not fix).

## The 3 answers (measured)

1. **OCCT extracts ALL the paper's per-face features via replicad's HIGH-LEVEL API
   — no raw OCCT needed.** face type `Face.geomType` · area `measureArea` · edge
   type `Edge.geomType` · edge length `Edge.length` · coedge dir `Edge.tangentAt` ·
   adjacency `Face.edges` by `hashCode`+`isSame`. Convexity = computed signed
   dihedral, sign calibrated empirically (`welded_orientation_volume_sign`
   discipline); **3 real bugs found+fixed**: `normalAt` already returns the outward
   normal (an extra flip inverted ⅓ of edges); interior-reference must use the
   GProp centroid for planar faces (param-midpoint lands off a non-convex L-face);
   bore rims need inner-wire detection. Real parts: `g_shaft` → {plane:2, cyl:1}
   all convex, vol 3.927 ✓; `g_collar` → {plane:2, cyl:2, **cone:1**} (chamfer =
   exact cone), all rims convex.

2. **Free sub-part labels: YES.** Non-fused `makeCompound` preserves faces 1:1 →
   every composed face maps to its source sub-part (2-part compound: `{shaft:3,
   block:6}`, unmapped:0). Manifold twin = `_parts`/`originalID` +
   `render-helpers.ts::finalizeSeparateParts`. Caveat: **fused (`.add`) assemblies
   merge coplanar faces** and degrade the mapping — our list-assemblies stay
   separate, so the labels are free by construction.

3. **Cold-baseline decomposition: deterministic is enough for our parts; where it
   isn't it hits OCCT's tangential-contact wall.** (a) our real parts have **0
   concave edges → already convex**, no pre-segmentation needed; (b) planar
   half-space splitting **round-trips volume exactly** (L-prism, error 1e-16); (c)
   BUT the natural cut plane coincides with a face → **OCCT imprint/sliver
   artifacts → over-decomposition** — the exact "OpenCascade boolean failure on
   tangential contacts" the paper names, reproduced on our kernel. Blind spot:
   through-holes are genus-1 with 0 concave edges (a concave-edge baseline can't
   see bores).

## Key synthesis (matters beyond this spike)
OCCT **boolean robustness on tangential/coincident contacts** is the recurring BREP
limiter — the SAME wall behind the `s_tube`/`sweep_tube_demo` swept-boolean
failures AND the fused-solid-no-per-part-material gap. A neural pre-segmenter does
NOT fix it. The annular-section approach (2D CSG on the section, sweep once) is the
mitigation for the sweep case; a client-side parts-list BREP (emit per-part, never
fuse) is the mitigation for the material/decomposition case.

## Next (no ML needed yet)
1. Rebuild `brep-csg.ts` (per-face feature vectors + free-label harvest) when
   Phase 2a starts — **and COMMIT it early this time.**
2. **Phase 2a retrieval, no net:** aggregate face features → per-part descriptor,
   k-NN vs the BM25 baseline on `ai/rag/parts.jsonl`. Ship if it beats BM25 —
   near-term payoff (`#3`).
3. Learned auto-decomposition = NO-GO near-term; revisit only if 2a is insufficient.
