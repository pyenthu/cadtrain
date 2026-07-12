# Research + plan — BRepNet BRep face-embeddings for our context

> Source paper: **Shen, Cao, He, Guo, Luo, Lei, Yin — "BRepNet-based BRep-to-CSG
> conversion for complex geometry modelling in Monte Carlo particle transport
> calculation."** *Annals of Nuclear Energy* 236 (2026) 112419.
> DOI `10.1016/j.anucene.2026.112419`. Local copy:
> `~/Downloads/3D_GRAPHICS/1-s2.0-S0306454926003075-main.pdf`.
> Status: **research evaluation + staged spike plan** (2026-07-12). Not a
> committed roadmap item — a go/no-go with a cheap first rung. Sibling of
> `docs/plans/kernel-strategy.md`, TODO `#0` (AI local-first) + `#3` (LiteRT.js).

## 1. What the paper actually does

MC particle-transport codes (MCNP/OpenMC/DAGMC/NECP-MCX) need geometry as **CSG
half-spaces**. Converting a CAD **BRep** solid → CSG by *decomposition* leans hard
on the CAD kernel's Boolean ops; on complex fusion-reactor parts it (a) is slow,
(b) **fails on thin sheets / tangential contacts** — the paper names *OpenCascade*
Boolean failure explicitly — and (c) **over-decomposes**, fragmenting the model
into redundant CSG that slows particle tracking. Engineers work around this by
**manually pre-segmenting** a complex solid into a few regular sub-solids first;
that manual step is the bottleneck.

Their contribution is to **learn that pre-segmentation**:

1. Represent each solid by **per-face feature vectors** on the BRep topology
   (no tessellation): face type {plane, cylinder, cone, torus, rational NURBS} +
   area; edge type {line, circle, ellipse} + convexity {concave, convex, smooth}
   + length; coedge direction. (Their Tables 1–2.)
2. **BRepNet** backbone (Lambourne 2021 — topological message-passing over
   directed *coedges* on a winged-edge kernel) → a high-level feature per face.
3. **Metric learning** head: `L = L_triplet + λ·L_center` (Schroff 2015 triplet +
   Wen 2016 center loss), L2-normalised embeddings, cosine distance. Faces in the
   same sub-solid pull together; different sub-solids push apart. **Supervision =
   instance-level sub-solid IDs taken from existing manual pre-segmentations.**
4. Inference: **k-means** over a solid's face embeddings (K = its segment count)
   → predicted regions.
5. Build intermediate BRep sub-solids: sew each face cluster into a shell, fit
   **auxiliary analytic split surfaces** (plane/cylinder/cone) to the inter-cluster
   boundary wires, trim, close each shell → STEP sub-solid → feed an **unchanged**
   decomposition-based BRep-to-CSG converter.

**Results:** ~**5× faster** BRep-to-CSG conversion on TS/VV components; several
models convert *only* after pre-segmentation (conventional path fails outright);
fewer convex solids (more compact CSG); avoids the thin sheets that break the
kernel. Transport run on the converted geometry was ~24% faster (447.88 vs
586.77 min) at identical flux. Metric quality: TGR 88.14% at FGR 0.003.
**Stated limits:** does NOT simplify higher-order surfaces; K (region count) is
still supplied per-solid; "future work = auto-K + post-processing correction";
their dataset is confidential.

## 2. What maps to us — and what doesn't

We are **not** a Monte-Carlo code. We never need half-space CSG for neutronics,
and the CFETR dataset isn't ours. So the *application* doesn't transfer. Three
*techniques* do, in decreasing directness:

- **A · Per-face/per-part BRep embeddings for PART RETRIEVAL.** We already want a
  "find me a part like this" semantic search over the RAG corpus
  (`ai/rag/parts.jsonl`), today BM25-only (TODO `#3` candidate a). A BRepNet-style
  embedding — learned on topology, tessellation-free, rigid-invariant — is exactly
  that geometry embedder, and it's small enough (5 layers) to run **in-browser**,
  satisfying the local-first constraint (`ai_data_residency_local_first`). **Highest
  value, lowest risk.**
- **B · Learned auto-DECOMPOSITION of a complex authored solid into clean
  sub-parts.** Maps onto the composition graph: suggest how to break a gnarly
  solid (or an imported STEP) into regular sub-solids / graph nodes. Directly
  relevant to the **over-decomposition + thin-sheet** pain we hit in our OWN OCCT
  path (BREP gap `#4`: degenerate `bw_hanger` profile → OCCT reject; the sectionCut
  sliver bloat). The paper's diagnosis *corroborates* our BREP-robustness work.
- **C · BRep→graph IMPORT (speculative).** Reverse-engineer an imported STEP BRep
  into our composition graph. The paper's segment-then-convert is the front half of
  this. Lowest priority.

**Does not map:** MC transport, half-space CSG emission, the neutronics dataset.

## 3. The unlock — our supervision labels are FREE

The paper's single most expensive prerequisite is **instance-level sub-solid IDs
from manual pre-segmentation** — a human deciding "these faces are one sub-solid."
We already have that signal for nothing: **our composition graph records which
faces originate from which sub-part** (`_parts`, the per-Call node structure, the
`finalizeSeparateParts` per-part face buckets, the `originalID`→part mapping the
render classifier already uses). Every baked assembly is a *pre-labelled* training
example — no manual pre-segmentation, no confidential dataset. That inverts the
paper's economics: the hard part is done by construction. This is the fact that
makes any of this cheap enough to try.

## 4. Staged plan (spike-first; each rung ships value + gates the next)

Disciplines applied throughout: **cold-baseline-first** (`clip_silhouette_collapse`
— a hand-crafted-feature baseline beat CLIP; the paper's own features are mostly
low-order attributes, so test them *without* a net first); **local-first** (any
runtime model runs in-browser, default-off, lazy); **headless-verify** (feature
extraction + clustering are data — vitest/Node, OCCT runs in Node; only the
in-browser inference wants a real page).

- **Phase 0 · Feasibility spike (timebox ~1–2 days).** Can replicad/OCCT hand us
  the paper's per-face features from a STEP/our baked BRep — face type
  {plane/cyl/cone/torus/NURBS} + area, edge type + convexity + length, coedge dir?
  Extract the graph's free sub-part labels for a handful of assemblies. **Deliverable:**
  a `docs/research` note: features reachable Y/N, label extraction Y/N, and a
  go/no-go. If OCCT can't expose enough face/edge classification cheaply, stop here.
- **Phase 1 · BRep feature extractor (headless).** `engines/brep` (post-E1) module:
  BRep → per-face feature vectors + per-face sub-part label (from the graph). Pure,
  unit-tested against a few known parts. Foundation for A and B both.
- **Phase 2 · Part retrieval, baseline THEN embedding (serves `#3`).**
  (a) Aggregate Phase-1 face features to a **per-part** descriptor; k-NN retrieval
  over `parts.jsonl`. Measure against the BM25 baseline on a hand-labelled "similar
  parts" set. If hand-crafted features already win, **ship that — no net.**
  (b) Only if the baseline is insufficient: train a small BRepNet+metric-learning
  embedder (triplet+center, our free labels), export ONNX, run in-browser via the
  `#3` LiteRT/ONNX runtime (default-off, COEP-safe check per the wells COEP notes).
- **Phase 3 · Learned auto-decomposition (heavier; needs training).** BRepNet face
  embeddings + clustering to *propose* a sub-solid breakdown for a complex solid,
  surfaced as suggested graph nodes / a "split this part" action. Auto-K (the
  paper's open problem) — try silhouette/eigengap on the embedding clusters instead
  of a supplied count. Verify headless: proposed segments must sew to valid solids
  (volume/genus preserved) before any UI.
- **Phase 4 · BRep→graph import (speculative, gated on Phase 3).** Imported STEP →
  segment → map each sub-solid to a composition-graph node. Only if 2–3 land well.

## 5. How we'd test it (per phase)

- **Extraction (P0/P1):** golden per-face feature vectors for 3–5 known parts;
  label round-trip (graph sub-part ↔ face bucket) asserted headless.
- **Retrieval (P2):** a small hand-labelled query→relevant set; report precision@k
  vs BM25. The bar is *beat BM25*, not "looks smart."
- **Segmentation quality (P3):** the paper's **TGR@FGR** metric (clustering-agnostic
  same-region vs different-region face-pair separability) on our held-out assemblies,
  where ground truth = the graph labels. Plus a hard constraint the paper flags:
  **over-merging is worse than over-splitting** (a merged region propagates errors),
  so tune the FGR operating point conservatively.
- **Downstream validity (P3/P4):** every proposed sub-solid must sew to a valid
  manifold (volume/genus preserved, no thin-sheet slivers) — reuse the BREP parity
  harness (`brep-coverage.test.ts`).
- **Runtime (P2b/P3):** in-browser inference latency + bundle cost vs the non-ML
  baseline it must beat; default-off; must not run on a hidden tab
  (`expensive_effects_active_tab_only`).

## 6. Recommendation

Worth a **Phase-0 spike, nothing more committed yet.** The transferable core is
BRep face-embeddings + our free graph labels; the near-term payoff is **part
retrieval (`#3`)**, not neutronics. Do the cold-baseline first — if hand-crafted
BRep features already retrieve/segment well, we get the value without training a
net. The over-decomposition/thin-sheet findings also feed straight back into our
current OCCT robustness work (`#4`, `sectionCut` slivers) independent of any ML.

Cross-refs: `docs/plans/kernel-strategy.md` · TODO `#0`/`#3`/`#39` · memories
`ai_data_residency_local_first`, `clip_silhouette_collapse`,
`todo_ai_function_mapping`, `todo_webgpu_slm`. Key paper refs to pull if we
proceed: BRepNet (Lambourne 2021), FaceNet triplet (Schroff 2015), center loss
(Wen 2016), Luo MeshCNN BRep→CSG (2022).
