# Reimplementing the TrueForm geometry kernel in WebGPU (WGSL compute) — feasibility

**Status:** research only (no code changed). 2026-07-03.
**Question:** Could we replace `@polydera/trueform`'s pthread-WASM kernel with a
WebGPU (WGSL compute) implementation, primarily to **drop cadtrain's app-wide
cross-origin isolation** (COOP `same-origin` + COEP `require-corp`)?

## TL;DR — executive verdict

- **The COOP/COEP burden is real and worth removing.** TrueForm ships a WASM
  built *with* pthreads; `tf.init()` transfers a `SharedArrayBuffer` to its
  worker pool, and `SharedArrayBuffer` is only available when the document is
  `crossOriginIsolated`. That single requirement is why cadtrain sets COOP+COEP
  **app-wide** in three places (`src/hooks.server.ts` prod, a `vite.config.js`
  dev middleware, and a static-asset wrapper noted in `Dockerfile`), which
  **forbids any non-same-origin / non-CORP subresource** (a CDN font/script/image
  is COEP-blocked). See `src/lib/shared/trueform-api-notes.md`.

- **Full WGSL rewrite: NOT recommended as the way to drop COOP/COEP.** It is a
  large, research-frontier effort whose hardest part — TrueForm's *exact* mesh
  booleans — maps *badly* to WebGPU. The blocking fact: **WGSL has no `f64`**
  (only `f32`), and no float atomics. Shewchuk-style adaptive exact predicates
  are built on f64 error-free transformations; the one published GPU port
  (GPredicates) is **CUDA with f64**. There is no drop-in path to exact
  predicates in WGSL. This is the crux (§3).

- **Check the cheap win FIRST (option c).** If TrueForm can be **recompiled
  single-threaded** (no `-pthread` → no `SharedArrayBuffer`), the COOP/COEP
  requirement disappears with **zero WebGPU work**. TrueForm's core is C++17 +
  oneTBB; oneTBB has a serial fallback and Emscripten produces a normal
  (non-shared) `ArrayBuffer` module when built without threading flags. **This
  needs their build config / a vendor single-threaded artifact** (the npm
  package ships only compiled WASM; source is on GitHub under a *noncommercial*
  license — §5c). **This is the recommendation to pursue first.**

- **If we do want GPU parallelism**, the realistic shape is a **hybrid**:
  keep exact CSG on CPU/WASM (single-threaded, no SAB), and offload the
  embarrassingly-parallel, non-exact ops (generators, remesh, spatial queries,
  reductions) to WGSL — treating WGSL as an *accelerator for the easy 80%*, not
  a replacement for the hard 20%.

---

## 1. Motivation

**Headline — drop app-wide cross-origin isolation.** `@polydera/trueform@0.9.8`
is compiled **with Emscripten pthreads** (installed `dist/` glue: `pthread`/
`PThread` ~110 refs, `wasmMemory shared:true`, `SharedArrayBuffer`; `native.d.ts`
documents a pthread `workerUrl`). Post-Spectre, `SharedArrayBuffer` requires
**cross-origin isolation** — the document must send COOP `same-origin` **+** COEP
`require-corp` to make `self.crossOriginIsolated === true`. cadtrain therefore
sets both on **every** response (`applyCrossOriginIsolation` in `hooks.server.ts`;
the dev vite plugin; the `Dockerfile` static wrapper). The cost: **COEP
`require-corp` blocks every cross-origin subresource without a CORP/CORS opt-in**
— no CDN fonts/scripts/images/analytics without extra plumbing. **WebGPU needs
none of this** (a `GPUBuffer` isn't a SAB), so *any* route that drops TrueForm's
SAB dependency — WGSL rewrite **or** single-threaded recompile — lets us delete
the headers. That deployment simplification is the real prize; WebGPU is only one
way to reach it (§5).

**Secondary:** GPU parallelism (thousands of lanes vs oneTBB's 16 threads, for
the embarrassingly-parallel ops); one shader language (WGSL) across
Metal/Vulkan/D3D12, no 29.4 MB WASM download.

**Downsides of WebGPU:** browser support broad-but-not-universal as of Nov 2025
(Chrome/Edge/Firefox/Safari 26; mobile+Linux fragmented) → still need a WASM
fallback = **two kernels**; **no exact arithmetic** (§3, the decisive one); GPU
compute is far harder to debug + non-deterministic across GPUs — dangerous for a
kernel whose selling point is *exactness*; a WGSL port derived from TrueForm is a
"new work" under PolyForm Noncommercial (§5c).

## 2. Per-capability GPU-fit

TrueForm's op surface (from `dist/manual.d.ts` + `trueform-api-notes.md`),
rated for how well each maps to WebGPU compute.

| Category | Ops | GPU fit | Why |
|---|---|---|---|
| **Generators** | `boxMesh` `sphereMesh` `cylinderMesh` `planeMesh` `tubeMesh` `triangulate` | 🟢 **Easy** | Per-vertex/per-face formulas, fixed output size known up front. One thread per vertex writes position; one per face writes indices. `tubeMesh` (RMF frames along a polyline) is a prefix-computed frame array then a parallel grid — trivially parallel. |
| **Booleans / arrangements** | `booleanUnion/Intersection/Difference` `meshArrangements` `polygonArrangements` `isobands` `embedded*IntersectionCurves` | 🔴 **Hard (frontier)** | Needs (a) **robust/exact** intersection predicates (§3), (b) all-pairs triangle intersection → spatial acceleration (BVH), (c) constrained retriangulation of cut faces (CDT), (d) arrangement/cell classification by sorting facets around non-manifold edges, and (e) **dynamic, data-dependent output sizes** (unknown # of intersection points/triangles) — awkward on GPU where buffers are pre-sized. This is the research frontier; see §3–4. |
| **Intersection / self-int curves** | `intersectionCurves` `selfIntersectionCurves` `isocontours` | 🟠 **Medium-hard** | The all-pairs / self-pairs triangle test parallelizes with a BVH, but each hit needs a robust segment-of-intersection construction and the same dynamic-output-size problem. Isocontours (scalar field → level set) is the easiest of the three (per-edge marching, bounded output). |
| **Topology predicates** | `isClosed` `isManifold` `eulerCharacteristic` `boundaryEdges` `nonManifoldEdges` `boundaryPaths` `connectedComponents` `consistentlyOriented` `cdt` `kRings` | 🟠 **Medium** | Mostly **reductions + edge/vertex classification** (parallel counts of edge incidence, V−E+F). `connectedComponents` = parallel union-find (a known GPU pattern). `boundaryPaths` (edge chains → loops, Hierholzer) is inherently sequential-ish → CPU or hybrid. `cdt` = constrained Delaunay → shares the arrangement/robustness problem (hard). |
| **Measurement / analysis** | `area` `volume`/`signedVolume` `*EdgeLength` `principalCurvatures/Directions` `shapeIndex` `laplacian/taubinSmoothed` `sharpEdges` registration (`fitIcp/Rigid/Obb`, `chamferError`) | 🟢🟠 **Easy–Medium** | `area`/`volume`/edge stats = per-face compute + a **parallel reduction** (classic GPU). Curvature = per-vertex k-ring quadric fit (TrueForm already does this in parallel on CPU) → parallel, needs neighbor gather. Laplacian/Taubin smoothing = sparse mat-vec, parallel. ICP registration = nearest-neighbor (BVH) + a small SVD per iteration → the NN part is GPU-friendly, the SVD is tiny/CPU. |
| **Remesh** | `decimated` `isotropicRemeshed` `simplified` | 🟠 **Medium** | Edge-collapse decimation is topology mutation with priority ordering — hard to fully parallelize, but TrueForm's own approach is *"parallel partitioned collapse"* (independent-set graph coloring), which is GPU-portable. Isotropic remeshing (split/collapse/flip/tangential relaxation) parallelizes per-phase. Subdivision (if added) is 🟢 easy. |
| **Spatial queries** | `distance/distance2` `closestPoint(Pair)` `neighborSearch` `intersects` `rayCast` | 🟠 **Medium** | **BVH on GPU** is well-trodden (WebRTX does BVH build on host + stackless traversal in WGSL). Batched queries (N rays/points vs a mesh) are the ideal GPU workload. Caveat: WGSL has no recursion → traversal must be an explicit-stack loop; build is usually done on CPU then flattened to a buffer. |
| **IO** | `readStl/Obj` `writeStl/Obj` | ⚪ **N/A** | Parsing/serialization stays on CPU (JS/WASM); trivial. |
| **NDArray core** | `take` `booleanIndex` reductions `math` | 🟢 **Easy–Medium** | Elementwise math and reductions are the canonical GPU compute workload (cf. WgPy, a WebGPU NumPy-like lib). Stream compaction (`booleanIndex`) has standard GPU prefix-sum implementations. |

**Summary:** the *volume* of TrueForm's API is GPU-friendly (generators,
measures, queries, smoothing, NDArray math). The *value* that makes TrueForm
special — **exact, canonical-topology booleans/arrangements** — is exactly the
part that fights the GPU.

---

## 3. The robustness problem (the crux)

TrueForm's headline is **exact** booleans: its benchmarks compare against CGAL's
exact kernels and libigl's EPECK (GMP/MPFR) and against MeshLib's "int32 exact +
SoS" (Simulation of Simplicity). Exactness is achieved with **exact geometric
predicates** (orientation / in-sphere sign tests that are *always correct*, never
flipped by floating-point round-off) plus exact or canonical construction of
intersection points. Get a predicate sign wrong and the arrangement becomes
topologically inconsistent → cracks, non-manifold edges, wrong cell
classification. This is precisely the failure the exact kernel exists to prevent.

**Why the GPU makes this hard:**

1. **WGSL has no `f64`.** WGSL's only floating scalar is `f32` (f16 is a proposed
   extension; f64 is not on the roadmap). Shewchuk's fast robust predicates are
   built on **f64 error-free transformations** (TwoSum / TwoProduct / adaptive
   expansions) that rely on IEEE round-to-nearest **double** arithmetic. The one
   published GPU predicate library, **GPredicates** (IEEE TVCG 2019), is a **CUDA
   port that uses f64** and splits work into a fast-filter kernel + an exact
   kernel with on-the-fly compaction for the few threads that need it. **None of
   that transfers to WGSL**, which lacks f64 entirely.

2. **No float atomics.** WGSL atomics are `i32`/`u32` only — float accumulation
   must be quantized to fixed point. Fine for reductions, but it underlines that
   the GPU wants **integer** math, which points at the one viable exact route:

3. **Options for exactness on GPU (all costly):**
   - **(i) Fixed-point / integer coordinates + integer predicates.** Snap inputs
     to a bounded integer grid; orientation/in-sphere then reduce to integer
     determinants. Exact **if** you carry enough bits — a 3D orientation
     determinant of ~21-bit integer coords needs ~64-bit intermediates, and
     in-sphere needs far more, so you must implement **multi-word integer
     arithmetic (i32/u32 limbs)** in WGSL by hand. Doable, but slow and
     laborious, and snapping changes the geometry (loses TrueForm's exact
     *constructions*).
   - **(ii) f32-expansion adaptive predicates.** Re-derive Shewchuk's expansions
     in f32 (TwoProduct needs an FMA or Dekker split; WGSL exposes `fma`). The
     bit budget in f32 (24-bit mantissa) is small, so expansions get long fast
     and the "adaptive" branch (§ GPredicates) causes heavy warp divergence.
     Largely unexplored; high risk.
   - **(iii) Snap-rounding / plane-based exact rationals** (as in Cherchi et al.
     "Interactive and Robust Mesh Booleans", and "Exact predicates, exact
     constructions and combinatorics for mesh CSG", arXiv 2405.12949): represent
     intersection points implicitly (as the intersection of exact input planes)
     and evaluate predicates on the *rationals*, deferring/avoiding explicit
     coordinates. Elegant and robust on CPU; the arbitrary-precision rational
     arithmetic is even worse to port to a lane-parallel f32 GPU.
   - **(iv) Keep predicates on the CPU (hybrid).** Run the parallel *filtering*
     (BVH broad-phase, candidate triangle pairs) on GPU, but evaluate the
     **sign-critical exact predicates and the arrangement combinatorics on the
     CPU** (WASM). This is the pragmatic middle path and matches how GPredicates
     itself works internally (fast filter → exact fallback), just split across
     the PCIe/JS boundary instead of two kernels.

**Verdict:** a *fully* GPU-resident exact boolean in WGSL is a genuine research
project, not an engineering task — and even the CPU research literature treats
robust booleans as hard. The exact core should stay on the CPU.

---

## 4. Prior art / survey

**GPU exact predicates** — **GPredicates** (IEEE TVCG 2019, ieee 8692354): CUDA,
f64, fast-check + exact-check kernels; the closest to "Shewchuk on the GPU" and it
needs exactly what WGSL lacks. Foundations: Shewchuk CMU-CS-96-140
(cs.cmu.edu/~quake/robust.html); `libigl/libigl-predicates` (CPU); Bartels
arXiv:2208.00497 (the float-filter half).

**Robust CPU mesh booleans (shows the difficulty)** — Cherchi arXiv:2205.14151;
"Exact predicates, exact constructions and combinatorics for mesh CSG"
arXiv:2405.12949 (Weiler model, implicit intersection points, CDT + symbolic
perturbation); "Adaptive Mesh Booleans" arXiv:1605.01760.

**GPU that sidesteps exactness / arrangements** — `bigmat18/cuda-mesh-voxelization`
(voxel-SDF CSG, lossy, not TrueForm-equivalent); `ashwin/gDel3D` (fastest GPU 3D
Delaunay, CUDA+f64); "3D Constrained Delaunay Refinement on GPU" arXiv:1903.03406.
All CUDA/f64 — not WGSL-portable.

**WebGPU compute infra (the friendly 80%)** — **WebRTX** (BVH built on host,
flattened, **stackless WGSL traversal** — no recursion; the model for porting
spatial queries/rayCast); `gnikoloff/webgpu-raytracer` (explicit-stack BVH);
**WgPy** (WebGPU NumPy, arXiv:2503.00279 — precedent for a WGSL NDArray/reduction
layer).

**No kernel to reuse** — **Manifold** (cadtrain's primary) parallelizes via Thrust
with CUDA/OpenMP/**serial** backends; the browser build is the *serial* one (GPU
story is native CUDA, not WebGPU; reported GPU speedup only ~2×). There is **no
production WebGPU/WGSL exact-boolean kernel** to adopt.

**WGSL limits shaping all of the above:** f32 only, atomics i32/u32 only, no
recursion (w3.org/TR/WGSL). WebGPU shipped across major browsers by Nov 2025;
mobile/Linux fragmented.

## 5. Recommended path (ranked)

### (c) FIRST: recompile TrueForm single-threaded to drop COOP/COEP — the cheap win

If the **only** goal is deleting app-wide cross-origin isolation, a WebGPU rewrite
is the wrong tool. A **single-threaded WASM build** removes the `SharedArrayBuffer`
dependency, and with it the COOP/COEP requirement — **no WebGPU work at all**.

- Emscripten built **without** threading flags produces a normal (non-shared)
  `ArrayBuffer` heap → no `SharedArrayBuffer` → `crossOriginIsolated` no longer
  required. oneTBB has a serial fallback (and Manifold-style libraries expose a
  "serial backend"), so TrueForm's C++ should build without oneTBB threading.
- **What it costs:** the CPU parallelism (the 6×–233× benchmark speedups are
  "16 threads"). Single-threaded booleans on ~1M-triangle inputs get materially
  slower. For cadtrain's downhole-part meshes (thousands–tens-of-thousands of
  triangles, not 1M) this is very likely acceptable — measure on real parts.
- **Blockers to verify:**
  1. **We don't control the build.** The npm package ships only compiled WASM
     (`dist/`). The C++ source is public on GitHub (`polydera/trueform`,
     C++17 header-only + oneTBB, Emscripten), so a single-threaded build is
     *technically* reproducible — but needs their `build.mjs` / Emscripten
     config, or simplest of all, **ask Polydera for a single-threaded artifact**
     (or a build flag). Flag this as the first outreach.
  2. **`async.*`** currently dispatches to the pthread pool. A single-threaded
     build must either run sync on the main thread, or move the whole module into
     **one plain Web Worker** and `postMessage` **copied** (transferable, not
     shared) buffers — which does *not* need COEP. Confirm the async surface still
     works.
  3. **License.** Recompiling from source for cadtrain's (noncommercial) use is
     permitted by PolyForm Noncommercial's "Changes and New Works" grant *as long
     as cadtrain's use stays noncommercial* — see §5c.

  **→ Action: spike option (c) before any WebGPU investment.** It plausibly
  achieves the headline goal in days, not months.

### (a) SECOND (if we want GPU speed): hybrid — CPU exact core + WGSL accelerators

Keep exact CSG/arrangements/predicates on CPU (single-threaded WASM, per (c),
so COOP/COEP is already gone), and add a **WGSL compute module** for the
parallel-friendly, non-exact ops where cadtrain actually feels latency:

- Phase H1: WGSL **generators** (`box/sphere/cylinder/plane/tube`, `triangulate`)
  and **measures** (`area/volume/edgeLength`, reductions) — low risk, self-contained,
  no robustness concerns. Validate against TrueForm's WASM output.
- Phase H2: WGSL **spatial queries** — GPU BVH (build on CPU, flatten to buffer,
  stackless WGSL traversal à la WebRTX) for batched `rayCast`/`distance`/
  `neighborSearch`. High value for any picking / sampling workloads.
- Phase H3: WGSL **smoothing / curvature / decimation** (sparse mat-vec, k-ring
  quadrics, partitioned collapse) — medium risk.
- **Never** move exact booleans to WGSL. At most, offload the BVH **broad-phase**
  candidate-pair filtering to GPU and keep predicate signs + arrangement
  combinatorics on CPU (§3 option iv).

This gives GPU speedups on the easy 80% while preserving exactness, and it can
be incremental (each op independently swappable/benchmarked against WASM).

### (b) LAST: full WGSL rewrite of the whole kernel — not recommended

High effort, high risk, and it **does not de-risk the one thing that matters**
(exactness). WGSL's lack of f64 makes robust predicates a research project (§3),
we'd lose exact constructions, we'd still need a WASM fallback for
non-WebGPU/mobile browsers (two kernels), and debugging a non-deterministic
GPU exact kernel is a poor trade. Pursue only if in-browser GPU-resident exact
CSG becomes a strategic product requirement — and even then, start from the
hybrid and let it grow.

### 5c. License / derivation implications (applies to all paths)

TrueForm is **PolyForm Noncommercial 1.0.0** (dual-licensed; commercial requires a
paid XLAB agreement). Relevant clauses:
- **Changes and New Works License** grants the right to make changes and new works
  based on the software **for any permitted (noncommercial) purpose.** So a
  cadtrain-internal single-threaded recompile (c) or a WGSL port *derived from*
  TrueForm (b) is licensed **only while cadtrain's use is noncommercial.** If
  cadtrain ever commercializes, both a redistributed single-threaded WASM and a
  derived WGSL kernel need a commercial license.
- **Notices** clause: redistribution must carry the license text / `Required
  Notice:` lines.
- A **clean-room** WGSL reimplementation from the *public papers* (Shewchuk,
  Cherchi, gDel3D, etc.) rather than TrueForm's source would avoid being a
  "new work based on the software" — worth keeping in mind if commercial use is
  ever on the table.

---

## 6. Effort + risk

| Path | Effort | Risk | Achieves COOP/COEP drop? | GPU speedup? |
|---|---|---|---|---|
| **(c) single-threaded recompile** | **S** (days, mostly a build spike + vendor ask) | **Low** (perf regression on huge meshes; build-access dependency) | **Yes** | No |
| **(a) hybrid (c + WGSL accelerators)** | **M** (weeks per phase, incremental) | **Medium** (WebGPU fallback needed; per-op validation) | **Yes** (via the (c) baseline) | Yes, on the easy 80% |
| **(b) full WGSL rewrite** | **XL** (months+, research) | **High** (exactness in f32; non-determinism; two kernels) | Yes | Yes, but exactness at risk |

**Phased plan if we proceed**

1. **Spike (c).** Obtain/produce a single-threaded TrueForm WASM (ask Polydera or
   build from GitHub source without `-pthread`/oneTBB threading). Wire it behind
   the existing tf tab. Confirm `async.*` works without SAB. Benchmark on real
   cadtrain parts.
2. **If (c) passes:** delete app-wide COOP/COEP (`hooks.server.ts`,
   `vite.config.js`, the `Dockerfile`/`server.js` wrapper), audit that no other
   code depends on `crossOriginIsolated`, and ship. **COOP/COEP goal met.**
3. **Optional GPU (a):** stand up a minimal WGSL compute harness + NDArray/reduction
   layer; port generators + measures (H1); validate byte-for-byte-ish against
   WASM; then queries (H2), then smoothing/remesh (H3). Keep exact booleans on CPU.
4. **Do not** attempt full-kernel WGSL (b) without a strategic mandate for
   in-browser GPU exact CSG.

---

## Appendix — ground-truth sources consulted

- Installed package: `node_modules/@polydera/trueform/{package.json, README.md,
  LICENSE, LICENSE.noncommercial, dist/manual.d.ts, dist/native.d.ts,
  dist/trueform_wasm.js}` (v0.9.8; 29.4 MB WASM; pthread/SAB glue confirmed).
- Repo: https://github.com/polydera/trueform (C++17 header-only, oneTBB, exact
  predicates, Emscripten; PolyForm Noncommercial 1.0.0).
- cadtrain: `src/lib/shared/trueform-api-notes.md`, `src/lib/shared/trueform-client.ts`,
  `src/hooks.server.ts` (`applyCrossOriginIsolation`), `vite.config.js`
  (`crossOriginIsolation` plugin), `Dockerfile`, `src/routes/design/architecture.ts`.
- Web sources cited inline in §3–§4 (predicates, mesh booleans, GPU Delaunay,
  WebGPU compute infra, WGSL limits, browser support). Where a claim is
  extrapolated (e.g. single-threaded oneTBB fallback specifics, exact f32-expansion
  feasibility), it is flagged as needing a spike.
