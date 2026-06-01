# FEM / Geometry-Kernel Research for cadtrain

*Background research compiled 2026-06-01. Two parallel agent investigations + user reframes.*

---

## 🔁 User reframes (2026-06-01 evening) — change the picture

Three pushbacks on the "off the table" verdicts below:

1. **"It does not have to be closed source"** — cadtrain itself is open-source-able. GPL contagion is NOT a blocker. Anything GPL'd is back ON the table. CalculiX (GPL v2+), PrePoMax (GPL), Z88 (GPL), TetGen (AGPL), Gmsh (GPL) all become candidates.

2. **"Take the [CalculiX] code and build it for WASM… piece by piece"** — instead of porting CalculiX wholesale (Fortran-to-WASM = months), port the MINIMUM subset needed for each Stage. Start with linear-static, no contact, single material. Iterate.

3. **"The PrePoMax git is available"** — the GUI's source ([prepomax.fs.um.si](https://prepomax.fs.um.si/) hosts links to its GitLab; mirrors exist) can be MINED for the `.inp` builder logic + the `.frd` parser. Don't ship PrePoMax; STUDY its translation from geometry to deck.

### Updated stance — what's actually on/off the table

| Option | Pre-reframe verdict | Post-reframe verdict |
|---|---|---|
| **CalculiX WASM (incremental subset port)** | Off (GPL + no port + Fortran friction) | **ON** — multi-month engineering project, ships incremental value at each subset port. |
| **PrePoMax source patterns** | Off (Windows-only desktop) | **ON for STUDY** — borrow `.inp` deck builder + `.frd` parser logic. |
| **TetGen, Gmsh, Z88 (GPL)** | Off (license) | **ON** with open-source decision. |
| **FreeCAD / OCCT for geometry kernel** | Server-side STEP converter (best) | Unchanged — license already permissive. |
| **In-browser FEA** as the GOAL | Confirmed objective | Confirmed objective; the path to it now includes a CalculiX subset port as a real option. |

The Stage-1 closed-form widget (a) does NOT depend on any of this and (b) ships value in days, so it stays the immediate first move regardless of which long-term path the user picks for Stage 3-4.

### Dual-track recommendation (open-source confirmed)

With GPL unblocked, there are now TWO complementary paths — and you can run both at once:

**Track A — Server-side `ccx` for real engineering RESULTS now (1-2 weeks)**
- Mature CalculiX solver. Real von Mises stress on real meshes. Real material plasticity. Real contact.
- Subprocess from a SvelteKit endpoint. Pre-built `ccx` binary in the Docker image.
- Mesh: pipe through TetGen or Netgen as a sidecar (GPL, now fine).
- Result viz: parse `.frd` → render in Threlte.
- Validates the engineering use cases (drill pipe burst, packer seal squeeze) on REAL geometry. Builds the analysis-tab UX without waiting for WASM porting.

**Track B — Incremental WASM port for the in-browser GOAL (months, piecewise)**
- The user's stated objective. Track A doesn't replace it; it BUYS TIME by shipping engineering value while Track B builds.
- Subset-at-a-time port: start with the linear-static path (no Fortran sparse solver dependency — use Eigen-WASM CG instead). Each subset ports independently.
- PrePoMax source becomes a reference for `.inp` builder + `.frd` parser TypeScript ports.
- Bundle weight grows incrementally: each subset is a lazy-loaded module behind the /fem tab.

The Stage-1 closed-form widget (in flight, separate agent) is the SHARED foundation for both tracks — same UI scaffolding, same result-display pipeline, same mesh-coloring code.

---

## TL;DR — Objective vs candidates

**The objective**: run FEA (stress / deflection / contact) on cadtrain's parametric CAD parts **in the browser** (client-side WASM), incrementally, no server-side solver. The user has prior experience compiling libraries to WASM via Emscripten and wants to follow the same pattern.

### Summary comparison

| Option | What it gives | Fits the objective? | Verdict |
|---|---|---|---|
| **FreeCAD / OCCT via opencascade.js (WASM)** | B-Rep kernel, fillet/chamfer, STEP I/O — **but no FEA**. | ⚠️ Partial — solves the kernel-features gap, not FEA. | Defer; useful for STEP/fillet later, not for FEM. |
| **PrePoMax (Windows GUI)** | Mature FEA GUI wrapping CalculiX. | ❌ Windows-only, desktop-only. | Off-table as infrastructure. |
| **CalculiX `ccx` server-side subprocess** | Mature FEA solver, broad capability. | ❌ Server-side, doesn't fit "in-browser". | Off-table per the user constraint. |
| **CalculiX WASM build (in browser)** | Hypothetical: same solver client-side. | ❌ GPL blocks closed-source shipping + no WASM port exists; Fortran-to-WASM via flang-wasm is months of effort that yields an unshippable binary. | **OFF the table.** |
| **FEAScript** (pure JS, MIT) | 1D/2D heat, Stokes, Newton-Raphson | ✅ License + browser-ready. ❌ **No solid-mechanics/elasticity module yet** as of mid-2026. | Track upstream; useful only after they add elasticity. |
| **Eigen-WASM + custom solver** (MPL2) | Sparse CG building blocks (`lscg-solver` ships ready), assemble FEA on top. | ✅ License + browser-ready. Hand-roll the FEA layer. | Foundation for Stage 2/3. |
| **scikit-fem via Pyodide** (BSD) | Real FEA in browser today. | ⚠️ Pulls ~10MB Pyodide runtime + NumPy/SciPy on top of Manifold's 3MB. Cold-start regression. | Demo-able but bundle-prohibitive. |
| **fTetWild WASM** (MPL2) | Tet meshing from STL. | ✅ License OK. ❌ No WASM port yet — you compile it. | Foundation for Stage 3 (months of build work). |
| **Closed-form analytical** (no solver, no mesh) | Drill-pipe section stress, API 5C3/7-2 checks. | ✅ Matches objective + 2-3 day delivery. | **THE STAGE-1 WIN.** Recommended now. |

### Recommended path (confirmed by browser-FEA agent)

| Stage | Effort | Bundle | Max DOF | Enables |
|---|---|---|---|---|
| **1. Closed-form analytical** (2-3 days) | low | 0 (pure JS) | n/a | Drill-pipe stress widget: axial + torsion + bending + burst; von Mises color overlay. Reuses existing OD/ID/wall params. Direct API 5C3 / 7-2 design check engineers run by hand today. Builds Stress-tab UI scaffolding. |
| **2. Pure-JS 1D beam + 2D plane stress** (1-2 weeks) | low-medium | ~50 KB hand-rolled | <10k DOF | Cantilevers, simply-supported sections, didactic. Validates the FEA pipeline end-to-end. |
| **3. Eigen-WASM CG + fTetWild WASM** (1-2 months) | high — fTetWild WASM build is the long pole | 2-5 MB | ~100k DOF | Real 3D linear elasticity on actual primitives; deflection plots; stress concentration at thread roots. |
| **4. Contact / nonlinear** (3-6 months custom) | very high — no shippable open-source shortcut exists (CalculiX GPL blocks the obvious one) | 5-10 MB | ~50k DOF | Pin-box thread engagement, makeup torque preview, packer seal squeeze. |

Each stage is independently demoable; Stage 1 ships value in ≤ a week.

### The Stage-1 win (concrete, this-week)

Add a **Stress tab** to drill-pipe primitives (`dp_pin`, `dp_box`, `dp_joint`):
- User dials axial load (F), torque (T), bending moment (M)
- Widget computes per-section formulas:
  - Axial: `σ_a = F/A` where `A = π(OD² − ID²)/4`
  - Torsion: `τ = T·OD / (2·J)` where `J = π(OD⁴ − ID⁴)/32`
  - Bending: `σ_b = M·OD / (2·I)`
  - Von Mises: `σ_vm = √(σ² + 3τ²)` where `σ = σ_a + σ_b`
- Colors the existing 3D mesh by per-section σ_vm (uniform along length, viridis LUT)
- Reports max σ_vm vs material yield (G105 = 105 ksi, S135 = 135 ksi)

Zero meshing, zero solver, zero new deps. Reuses already-parameterized OD/ID/wall. Builds the Stress-tab UI scaffolding that Stages 2-4 reuse later.

---

# Part 1 — FreeCAD / OCCT (geometry kernel research)

## A) Capability gap vs Manifold

Manifold is a guaranteed-manifold **mesh** boolean kernel. OCCT is a full **B-Rep** kernel. OCCT offers, natively, things cadtrain currently fakes or skips:

1. **Fillet / chamfer on edges** — `BRepFilletAPI_MakeFillet` / `MakeChamfer` on arbitrary B-Rep edges. Manifold has *no* fillet/chamfer; community discussion notes "a chamfer function still needs to be built." [OCCT docs](https://dev.opencascade.org/doc/refman/html/class_b_rep_fillet_a_p_i___make_chamfer.html)
2. **STEP / IGES / BREP I/O** — exact B-Rep import/export. Manifold's roadmap lists only glTF/3MF; STEP is the lingua franca of oilfield CAD — every Halliburton/Baker drawing arrives as STEP.
3. **Loft / sweep through wires** — `BRepOffsetAPI_ThruSections`, pipe-along-spline. [OCCT modeling algos](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html)
4. **Cylindrical thread generation** — OCCT has the "bottle thread" tutorial pattern (true helical swept profile on a cylinder), more rigorous than cadtrain's `r_threads` `helix_band` weld.
5. **Exact NURBS surfaces + 2D constrained sketcher** — cadtrain has no sketch solver; OCCT has `Geom_BSpline*` surfaces and FreeCAD ships a 2D constraint solver on top.

## B) Integration paths (effort → value)

| Rank | Path | Effort | Value |
|---|---|---|---|
| **1 — best ratio** | **STEP/IGES bridge via FreeCAD CLI as converter** (server-side, ad-hoc) | LOW (Docker image + `freecadcmd` subprocess; STEP → STL → Manifold) | HIGH — unblocks customer-supplied STEP files, no kernel commitment |
| **2** | **opencascade.js (WASM)** for client-side fillet/chamfer/STEP | MEDIUM-HIGH — last tagged release **v1.1.1 Sept 2020** ([npm](https://www.npmjs.com/package/opencascade.js)), v2 in beta; full build ~50–70 MiB binaries, ~13 MB gzipped prod; custom builds shrink it; OCCT 7.6.2 underlying | HIGH if shipped, but bundle bloat is severe vs Manifold's ~3 MB WASM |
| **3** | **Server-side FreeCAD Python subprocess** for parametric ops | MEDIUM — Docker layer +~500 MB; latency ~100ms–1s per op; **violates Rule 1** ("Never add Python to the runtime") | MEDIUM — powerful but breaks the stack invariant |
| **4** | **Borrow design patterns only** (sketch-constraint solver UX, tree node taxonomy) | LOW | LOW-MEDIUM — useful for `/primitives` UX inspiration |

## C) Licensing

- **OCCT**: LGPL 2.1 **+ static-linking exception** since v6.7.0 (2013). Explicitly permits distributing closed-source apps linked to OCCT, provided OCCT use is credited and customers can debug/modify their copy. ([OCCT licensing](https://dev.opencascade.org/resources/licensing))
- **opencascade.js**: LGPL-2.1 ([GitHub](https://github.com/donalffons/opencascade.js)). The OCCT linking exception flows through.
- **FreeCAD**: LGPL 2.1+ (the *app*; only matters if you ship FreeCAD binaries — a CLI subprocess invocation does not link).
- **Verdict**: Compatible with a closed-source SvelteKit app. The WASM bundle becomes a "system library" under LGPL; you must (a) credit OCCT, (b) let users relink/replace the WASM. Standard `node_modules` dist satisfies both.

## D) FreeCAD MVP recommendation

**Build path 1 first: a server-side `/api/cad/step` endpoint that shells out to `freecadcmd` (or `OCCT` directly via opencascade.js in a Bun worker) to convert STEP ⇄ mesh, nothing else.**

Reasoning: oilfield customers will hand cadtrain STEP files for matching/training way before they ask for in-browser fillets; the converter unblocks the RAG identification pipeline (PNG → component) on real vendor geometry without committing to a second kernel in the live edit loop. Defer opencascade.js until a concrete fillet/chamfer user story lands.

## E) FreeCAD risks

- **opencascade.js staleness** — main repo's last tagged release was Sept 2020; v2 beta on npm but unfinished. Production dependence is a bet on community momentum, not a vendor. Replicad reports "performance walls and API challenges."
- **Bundle weight** — even a custom OCCT WASM build dwarfs Manifold; loading it on `/primitives` would regress current sub-second cold start. Must be lazy-loaded behind a feature flag.
- **Rule 1 conflict for path 3** — adding Python/FreeCAD to the Dockerfile contradicts the documented "no Python in the runtime" invariant and the ~250 MB image budget; needs explicit user approval before pursuing.

### FreeCAD sources

- [freecad.org](https://www.freecad.org/) · [ocjs.org](https://ocjs.org/) · [opencascade.js GitHub](https://github.com/donalffons/opencascade.js) · [OCCT licensing](https://dev.opencascade.org/resources/licensing) · [BRepFilletAPI docs](https://dev.opencascade.org/doc/refman/html/class_b_rep_fillet_a_p_i___make_chamfer.html) · [OCCT modeling algos](https://dev.opencascade.org/doc/overview/html/occt_user_guides__modeling_algos.html) · [replicad docs](https://replicad.xyz/docs/use-as-a-library/) · [npm opencascade.js](https://www.npmjs.com/package/opencascade.js)

---

# Part 2 — PrePoMax + CalculiX (FEA — server-side framing)

> **Note**: This part assumes server-side `ccx` subprocess. The user's actual objective is BROWSER-WASM FEA. Read this for capability reference; the recommendation in C.1 does not align with the objective. Part 3 (in flight) will produce the browser-WASM-native recommendation.

## A) What they are

- **CalculiX** ([calculix.de](http://www.calculix.de/)): open-source FEA package (GPL v2+, C+Fortran). Solver `ccx` (CrunchiX) is a **headless CLI binary** consuming **Abaqus `.inp`** decks; postprocessor `cgx` writes `.frd`. Runs on **Linux, Windows, Irix**; Mac via build-from-source. Docker images exist: [`parallelworks/calculix`](https://hub.docker.com/r/parallelworks/calculix), [`calculix/ccx-containerd`](https://github.com/calculix/ccx-containerd). Capabilities: linear & nonlinear static, dynamic, **modal**, **thermal**, **contact (mortar + node-to-surface)**, **plasticity / viscoplasticity / hyperelasticity**, gasket elements ([ov_calcu.htm](http://www.dhondt.de/ov_calcu.htm)).
- **PrePoMax** ([prepomax.fs.um.si](https://prepomax.fs.um.si/)): open-source **GUI** pre/post-processor wrapping CalculiX. Built on Open Cascade + Netgen/Gmsh. Imports STEP / IGES / BREP / STL / mesh; emits `.inp`; reads `.frd`. **Windows-only** — downloads page lists `.exe` only and ships the `calculix_2.20_4win.zip` solver bundle ([downloads](https://prepomax.fs.um.si/downloads/)). v2.4.0 shipped Oct 2025, v2.4.2 preview Nov 2025.

## B) Fit for downhole tools

1. **Drill pipe joint stress** (torque + tension + makeup preload at the pin/box thread): CalculiX nonlinear static + surface-to-surface contact + steel plasticity (G105, S135) is a textbook fit. Threads import cleanly from cadtrain's `r_threads`-built geometry.
2. **Packer burst / element extrusion** (10k psi @ 350 °F): needs hyperelastic + thermal-mechanical coupled steps with self-contact between rubber element and casing wall — CalculiX supports all three (Mooney-Rivlin, Ogden, gasket elements). Hard but doable.
3. **Tubing hanger fatigue / spool stack seal seat**: linear static + cyclic load module; contact + bolt preload via `*PRE-TENSION SECTION`. Well within CalculiX scope.

Materials and elements are sufficient; the limiting factor is **input-deck authoring**, not solver capability.

## C) Server-side integration paths (does not match the in-browser objective)

1. **Server-side `ccx` subprocess (this agent's recommendation)**. Manifold mesh → tetra/hex meshing (Netgen via WASM or a meshing sidecar) → emit `.inp` → spawn `ccx job.inp` from a SvelteKit endpoint → parse `.frd` → render colored stress field in Threlte. Docker layer cost ≈ 50–80 MB (static `ccx` + SPOOLES). Solve time for a packer model: seconds to minutes. **Does not violate the no-Python rule** — `ccx` is pure C+Fortran. `.frd` parsing in TypeScript is straightforward (ASCII, ~200 LOC; pattern off [`ccx2paraview`](https://github.com/calculix/ccx2paraview) / [`meshio` PR #1365](https://github.com/nschloe/meshio/pull/1365)).
2. **PrePoMax as desktop companion**. Cadtrain stays geometry-only and exports STEP; users open in PrePoMax. Zero engineering, zero leverage — defeats the "ship validated designs" goal.
3. **Borrow `.frd` purely for viz patterns**. Use the format as the result-file schema even for non-CalculiX backends — cheap insurance for future solver swaps (Code_Aster, FEniCS).

**USER OVERRIDE**: server-side is off the table. The follow-up `browser_fea` agent is investigating WASM-native options that ARE compatible with the in-browser objective.

## D) Risks (specific to server-side path; included for completeness)

- **PrePoMax is Windows-only** — confirmed via download page. Rules out embedding PrePoMax server-side; only the CLI `ccx` is server-portable. PrePoMax can serve as a *user-side* desktop fallback for users with complex models, not infrastructure.
- **`.inp` learning curve is real.** Abaqus deck syntax is verbose and full of footguns (node/element numbering, surface definitions, `*STEP`/`*END STEP` bracketing, contact pair conventions). Mitigation: ship a **typed `.inp` builder** in `src/lib/cad/fea/` with one analysis-type template per use case; never expose raw deck editing in v1. Budget 2–3 days of deck tuning per new analysis class.
- **Bun/Docker + `ccx` integration.** Three real frictions: (a) static-linked `ccx` binary is ~30 MB and needs SPOOLES/ARPACK — use prebuilt from [`parallelworks/calculix`](https://hub.docker.com/r/parallelworks/calculix) rather than compile in-image; (b) solves are CPU-bound and can hang Bun's event loop — run via `child_process.spawn` with a worker pool + per-job timeout; (c) Railway's container has finite RAM/CPU — gate solve size (node count cap) and consider a queue before exposing publicly.

## E) Licensing

- **CalculiX** is **GPL v2+** — that's a problem for closed-source distribution. Three options:
  1. Distribute the `ccx` binary unmodified, never link it into the SvelteKit app code. Subprocess call boundary keeps GPL contagion at bay (industry practice; equivalent to shelling out to `gcc`).
  2. Pay for a commercial Abaqus license (orders of magnitude more expensive).
  3. Switch to a permissively-licensed solver — most options have weaker capabilities.

Option 1 is the standard workaround. For browser-WASM the picture changes — bundling a GPL solver into the front-end likely triggers GPL contagion for the SvelteKit code. The browser-FEA agent is investigating MIT/BSD/Apache alternatives.

---

# Part 3 — Browser-WASM FEA (delivered)

## A) Existing WASM-FEA libraries (state of art, mid-2026)

**CalculiX (ccx)** — C + Fortran, **GPL v2+** → **OFF the table** for closed-source SvelteKit. Even ignoring licensing, no public WASM port exists. Blockers: ccx is heavily Fortran (SPOOLES/PARDISO/ARPACK linkage); Emscripten has no Fortran frontend. The [r-wasm/flang-wasm](https://github.com/r-wasm/flang-wasm) project (see also [Fortran lang discourse](https://fortran-lang.discourse.group/t/llvm-flang-emscripten-compiler/2152)) is the only credible path: LLVM Flang patched for emscripten, BLAS/LAPACK builds proven (Hackaday 2024-04). Realistic effort = months, and the GPL result still can't be shipped.

**MFEM** (LLNL, BSD) — [github.com/mfem/mfem](https://github.com/mfem/mfem). License is fine. No WASM port; only PyMFEM + GLVis JS visualizer exist. Heavy MPI/Hypre assumptions → significant porting.

**deal.II** (LGPL 2.1) — [github.com/dealii/dealii](https://github.com/dealii/dealii). LGPL acceptable. No WASM port found. Massive C++ template surface → unrealistic.

**Z88** (Z88OS, GPL) — [github.com/LSCAD/Z88OS](https://github.com/LSCAD/Z88OS). GPL → **off the table**. No browser port.

**scikit-fem** (BSD) — [github.com/kinnala/scikit-fem](https://github.com/kinnala/scikit-fem). Pyodide-ready: ships `solver_iter_cg` (pure-Python CG) specifically for Pyodide. Reasonable license, but pulls ~10MB Pyodide runtime + NumPy/SciPy. Best "real FEA in browser today" if you can swallow Pyodide.

**PolyFEM** (MIT) — [github.com/polyfem/polyfem](https://github.com/polyfem/polyfem). License clean. No WASM port published. Heavy CGAL/libigl/Eigen dependency stack.

**Eigen** (MPL2, OK for closed-source) — best foundation for custom WASM FEA:
- [BertrandBev/eigen-js](https://github.com/BertrandBev/eigen-js) (MPL2)
- [TtheBC01/Eigen-wasm](https://github.com/TtheBC01/Eigen-wasm)
- [donghaoren/lscg-solver](https://github.com/donghaoren/lscg-solver) — sparse CG already WASM-ready
- [Ricky Reusser proof-of-concept](https://observablehq.com/@rreusser/eigen)

**Pure JS FEA**:
- **FEAScript** [github.com/FEAScript/FEAScript-core](https://github.com/FEAScript/FEAScript-core) (MIT) — actively developed 2025–26. Has 1D/2D heat, Stokes, front propagation, Newton-Raphson, frontal/Jacobi/LU solvers, WebGPU experimental, gmsh `.msh` import. **No solid-mechanics/elasticity module yet** as of mid-2026.
- [lge88/js-fea](https://github.com/lge88/js-fea) — old, MIT, basic.
- [jax-fem](https://github.com/deepmodeling/jax-fem) — Python/JAX, not browser-deployable.

## B) Mesh generation in browser

**TetGen** — AGPL → **off the table** for closed source (this is the killer; tetgen is everywhere in Python wrappers but you can't ship it in your bundle).

**fTetWild / TetWild** [github.com/wildmeshing/fTetWild](https://github.com/wildmeshing/fTetWild) — **MPL2** (clean license). No WASM port published, but the codebase is pure C++ + libigl + Eigen and is the most realistic emscripten target. `pytetwild` shows the API is small.

**Gmsh** — GPL → **off the table**. No `gmsh.js` exists despite the name floating around.

**CGAL** — partially LGPL, partially GPL (and the parts you'd want for meshing — 3D mesh generation — are **GPL**). Ports exist ([CGALWebAssembly](https://github.com/ademola-lou/CGALWebAssembly), [arrangement-2d-js](https://github.com/LokiResearch/arrangement-2d-js)) but boolean operations hang the browser due to WASM rounding-mode limitations ([emscripten issue #21580](https://github.com/emscripten-core/emscripten/issues/21580)). Skip.

**Practical path**: Manifold surface mesh → STL → **fTetWild WASM** (you compile it) → tet mesh → assemble in JS/Eigen-WASM → solve via lscg-solver CG.

## C) License summary

- **MIT/BSD/Apache/MPL2 (OK to ship)**: FEAScript, Eigen, fTetWild, MFEM, PolyFEM, scikit-fem
- **LGPL** (OK with dynamic linking — generally fine for WASM): deal.II
- **GPL/AGPL (BLOCKED)**: CalculiX, Gmsh, TetGen, Z88, parts of CGAL

The license boundary is more brutal than the code boundary — three of the most mature WASM-portable FEA codebases (CalculiX, Z88, TetGen) are GPL and unusable for a closed-source SvelteKit app.

## D) Risks

- **Bundle weight**: Eigen-WASM minimum ~500KB; fTetWild realistic 2–4MB; LLVM Flang runtime 10MB+. Cadtrain's existing Manifold WASM is already ~3MB. Lazy-load FEA only when user opens Stress tab.
- **Fortran-to-WASM friction**: `r-wasm/flang-wasm` works but is fragile; OpenBLAS/LAPACK have been built (Hackaday 2024) but the toolchain is not turnkey. CalculiX would also need SPOOLES/ARPACK ported. Budget months, not weeks — and the GPL output is unshippable in a closed-source SvelteKit app anyway. **Skip the Fortran route.**
- **Bun/Vite/SAB integration**: pthreads-enabled WASM requires `Cross-Origin-Opener-Policy: same-origin` + `Cross-Origin-Embedder-Policy: require-corp` headers. SvelteKit `adapter-node` can set these in `hooks.server.ts`, but it breaks third-party iframes (e.g. embedded YouTube/PDF previews). Without SAB → single-threaded WASM, ~4× slower on solves. Plan headers from day 1.

## Sources

- [FEAScript](https://github.com/FEAScript/FEAScript-core) · [scikit-fem (Pyodide-aware)](https://github.com/kinnala/scikit-fem) · [fTetWild](https://github.com/wildmeshing/fTetWild)
- [Eigen-js](https://github.com/BertrandBev/eigen-js) · [Eigen-wasm](https://github.com/TtheBC01/Eigen-wasm) · [lscg-solver](https://github.com/donghaoren/lscg-solver) · [Observable Eigen PoC](https://observablehq.com/@rreusser/eigen)
- [PolyFEM](https://github.com/polyfem/polyfem) · [MFEM](https://github.com/mfem/mfem) · [deal.II](https://github.com/dealii/dealii)
- [CalculiX (GPL)](https://en.wikipedia.org/wiki/Calculix) · [Z88OS](https://github.com/LSCAD/Z88OS)
- [flang-wasm](https://github.com/r-wasm/flang-wasm) · [Fortran on WASM (G. Stagg)](https://gws.phd/posts/fortran_wasm/)
- [CGAL boolean WASM hang](https://github.com/emscripten-core/emscripten/issues/21580) · [CGALWebAssembly](https://github.com/ademola-lou/CGALWebAssembly)
- [Emscripten pthreads](https://emscripten.org/docs/porting/pthreads.html)
- [Peterson NASA report on thread stress concentration](https://ntrs.nasa.gov/api/citations/19800016160/downloads/19800016160.pdf)

---

# Part 4 — FEniCS / DOLFINx evaluation

*Subagent report 2026-06-01. Post-reframe (LGPL acceptable).*

## A) What FEniCS / DOLFINx are

**FEniCS** is an open-source FEA framework built around the **Unified Form Language (UFL)** — a Python DSL for declaring variational forms ("write the math, not the assembly loop"). Forms are JIT-compiled to C kernels by **FFCx** + **Basix** (element library).

**DOLFINx** ([github.com/FEniCS/dolfinx](https://github.com/FEniCS/dolfinx)) is the *current* runtime — C++ core (~58% of repo) + Python bindings (~40%) via nanobind. Replaces legacy DOLFIN. C++20, modular, faster JIT, MPI-native from day one.

**Solver stack**: PETSc (linear/nonlinear, default), SLEPc (eigenvalue), optional SuperLU_DIST.

**Runtime requirements**: C++20 compiler, **MPI-3 (REQUIRED, not optional)**, HDF5-with-MPI, Boost, pugixml, spdlog, ParMETIS/KaHIP/PT-SCOTCH for partitioning. Linux/macOS first-class; Windows via WSL only.

**License**: **LGPL-3.0-or-later** — fully usable under cadtrain's now-open-source stance.

## B) Solid mechanics capability

- **Linear elastic**: first-class.
- **Hyperelastic** (Mooney-Rivlin, Ogden, Neo-Hookean, Yeoh): native via UFL — write the strain energy, autodiff gives you the residual + tangent. **Excellent for packer rubber.** Tutorial: [jsdokken.com/dolfinx-tutorial/chapter2/hyperelasticity.html](https://jsdokken.com/dolfinx-tutorial/chapter2/hyperelasticity.html).
- **Plasticity** (J2, Drucker-Prager): NOT built-in; requires `dolfinx-external-operator` ([a-latyshev.github.io/dolfinx-external-operator](https://a-latyshev.github.io/dolfinx-external-operator/)) or `fenics-constitutive` ([github.com/BAMresearch/fenics-constitutive](https://github.com/BAMresearch/fenics-constitutive)). Bolt-on but mature.
- **Contact**: weakest area. `dolfinx_contact` is less battle-tested than CalculiX's node-to-segment. For thread engagement / makeup torque, CalculiX is more proven.
- **Elements**: tet (Lagrange any order), hex, prism. No native solid-shell.

**Comparable to CalculiX?** Hyperelastic: BETTER. Plasticity: roughly equal (once external operator is wired). Contact: CalculiX is more mature.

## C) Browser-WASM viability

- **No known DOLFINx WASM port.** Core blocker: **MPI is REQUIRED** — there is no MPI in WASM (no fork, no sockets in single-threaded Wasm). You'd have to gut DOLFINx down to a serial subset before Emscripten could touch it.
- **PETSc in WASM**: also non-trivial; PETSc assumes MPI ranks.
- **Pyodide path**: Pyodide ships NumPy/SciPy but **no FEniCS package**. Porting DOLFINx to Pyodide means porting PETSc + MPI shims + Basix + FFCx C kernels — far harder than scikit-fem-via-Pyodide.
- **UFL as a JS DSL**: most interesting borrow-able idea. UFL is pure Python that emits an IR; reimplementing UFL in TypeScript (form expressions → IR → JS/WASM kernels) is a real architectural option, ~weeks. But you'd be writing your own FEA on top — UFL itself doesn't carry the solver.
- **Bundle estimate IF DOLFINx WASM were achievable**: 15-30 MB. Worse than the 5-10 MB CalculiX subset estimate.

## D) Integration paths ranked

1. **Server-side DOLFINx subprocess** — moderate effort. Docker layer: `ghcr.io/fenics/dolfinx/dolfinx:stable` (**~2 GB image**, vs ~80 MB for a CalculiX binary). SvelteKit endpoint shells out to `python` with a UFL form template + the cadtrain mesh. **vs server-side `ccx`**: CalculiX is leaner (small binary, simple `.inp` → `.frd`), DOLFINx is more flexible (UFL = you can change the math) but heavier runtime.
2. **DOLFINx WASM port**: **years, not months.** MPI removal alone is a fork. Not realistic.
3. **FEniCS via Pyodide**: blocked. Skip.
4. **Borrow UFL's variational form abstraction** for custom JS FEA: **the genuinely interesting idea**. A TS implementation of UFL (`a*u*v*dx + ...`) emitting kernels that an Eigen-WASM CG solves. Synergizes with the existing Stage 2-3 plan.

## E) MVP recommendation

**FEniCS/DOLFINx is roughly equivalent to CalculiX for cadtrain's needs but strictly heavier to deploy** (LGPL OK, MPI mandatory, 2 GB Docker image, no WASM path) — recommend sticking with the Track A `ccx` server-side plan, **but steal the UFL DSL pattern for Stage 3** (`linear-elastic-3d.ts`) where a JS variational-form layer over Eigen-WASM CG would be more elegant than a hand-coded assembly loop.

## F) Risks

- **Python in the production runtime** (against Rule 1): 2 GB Docker image, MPI on Railway, slower cold starts vs a single static `ccx` binary.
- **UFL learning curve**: drill engineers think in stress/strain tables, not `Inner(sigma(u), eps(v))*dx`. CalculiX `.inp` decks are closer to vendor mental models.
- **Maintenance burden**: DOLFINx releases ~quarterly with breaking Python API changes. CalculiX `.inp` is essentially frozen Abaqus-compatible — far stabler.

### FEniCS sources

- [github.com/FEniCS/dolfinx](https://github.com/FEniCS/dolfinx)
- [docs.fenicsproject.org/dolfinx/main/python/installation.html](https://docs.fenicsproject.org/dolfinx/main/python/installation.html)
- [jsdokken.com/dolfinx-tutorial/chapter2/hyperelasticity.html](https://jsdokken.com/dolfinx-tutorial/chapter2/hyperelasticity.html)
- [bleyerj.github.io/comet-fenicsx](https://bleyerj.github.io/comet-fenicsx/intro/linear_elasticity/linear_elasticity.html)
- [a-latyshev.github.io/dolfinx-external-operator](https://a-latyshev.github.io/dolfinx-external-operator/)
- [github.com/BAMresearch/fenics-constitutive](https://github.com/BAMresearch/fenics-constitutive)

*(Parts 5 — DOLFINx tutorial deep-dive, 6 — Elmer FEM, and the consolidated comparison matrix will be appended as their agents complete.)*

---

# Part 5 — DOLFINx tutorial deep-dive (jsdokken)

*Subagent report 2026-06-01.*

## A) Workflow stages (linear elasticity "hello world")

1. **Mesh** — native: `mesh.create_box(MPI.COMM_WORLD, ..., cell_type=mesh.CellType.hexahedron)`. No STL/STEP path; complex geometry routes through gmsh (see C).
2. **Function space** — `V = fem.functionspace(domain, ("Lagrange", 1, (domain.geometry.dim,)))`.
3. **Variational form (UFL)** — see snippet D.
4. **BCs** — `locate_entities_boundary` + `locate_dofs_topological` + `fem.dirichletbc(u_D, dofs, V)`.
5. **Solver** — `LinearProblem(a, L, bcs=[bc], petsc_options={"ksp_type":"preonly","pc_type":"lu"}); uh = problem.solve()`.
6. **Post-processing** — pyvista in-process AND `io.XDMFFile("deformation.xdmf","w").write_function(uh)` for ParaView.

**Line count for hello-world linear elasticity**: ~50 LOC of real code; ~80 with visualization.

## B) Linear elasticity coverage

Yes — dedicated chapter `chapter2/linearelasticity_code.html`. Output = **XDMF** + **pyvista**. Von Mises computed inline: project `sqrt(3/2·s:s)` into `("DG",0)` via `fem.Expression`. No 100k-DOF benchmark in the tutorial.

## C) Mesh import for Manifold output

The tutorial shows gmsh OCC kernel CAD construction + read-back:

```python
from dolfinx.io import gmsh as gmshio
mesh_data = gmshio.read_from_msh("mesh.msh", MPI.COMM_WORLD, gdim=2)
```

Supported: **`.msh` (gmsh)**, **XDMF + HDF5**, meshio as converter. **STL is NOT shown; STEP only indirectly via gmsh's OCC.** For cadtrain's Manifold output, the realistic hand-off: Manifold → `.stl` → `gmsh.merge("part.stl")` → `gmsh.model.mesh.classifySurfaces` + `generate(3)` → `.msh` → `gmshio.read_from_msh`.

## D) UFL snippets

**Linear elasticity** (verbatim from `linearelasticity_code`):

```python
def epsilon(u): return ufl.sym(ufl.grad(u))
def sigma(u):   return lambda_*ufl.nabla_div(u)*ufl.Identity(len(u)) + 2*mu*epsilon(u)
u = ufl.TrialFunction(V); v = ufl.TestFunction(V)
a = ufl.inner(sigma(u), epsilon(v)) * ufl.dx
L = ufl.dot(f, v) * ufl.dx + ufl.dot(T, v) * ds
```

**Contact**: NOT covered in tutorial. Closest is `chapter2/hyperelasticity` (large-deformation Neo-Hookean, no contact). Contact is a `dolfinx_contact` add-on, off-tutorial.

UFL is a pure symbolic algebra DSL (~10k LOC Python); a JS port is **non-trivial but bounded** — the symbolic part is portable, but UFL feeds into FFCx which generates C code compiled by CFFI/JIT. **That JIT step is the real porting barrier, not UFL itself.**

## E) WASM/Pyodide hostility (concrete imports)

Imports from the elasticity example: `mpi4py.MPI`, `dolfinx.fem.petsc.LinearProblem`, `pyvista`, `gmsh`.

- **`mpi4py` + `petsc4py`** — compile against system MPI + PETSc (C/Fortran, BLAS/LAPACK, often with MUMPS/SuperLU). PETSc has experimental WASM but no production story; MUMPS/SuperLU are Fortran. **Hostile.** `LinearProblem` is the PETSc wrapper — there's no pure-Python solver fallback in the tutorial path.
- **`gmsh`** — C++ + OCC (OpenCASCADE, very heavy C++). **Hostile** for WASM; CadQuery's OCP wheels are ~80MB.
- **FFCx JIT** — invokes CFFI + a C compiler at runtime. **Hostile** in browser.
- **`pyvista`/VTK** — VTK has WASM builds (vtk.js) but pyvista's full Python API doesn't run in Pyodide cleanly.
- `ufl`, `basix`, `numpy` — portable.

Realistic path: **server-side DOLFINx in Docker**, stream XDMF/glTF results to the browser. WASM port is a multi-quarter effort.

## F) Bottom line

The tutorial assumes a graduate-FEA reader who already speaks UFL, weak forms, PETSc options, and gmsh OCC scripting — **wrong audience for cadtrain's engineers**. It's an excellent reference for *us* to build a server-side stress-check endpoint on top of, but the UI we expose must hide every line shown above behind primitive-aware presets.

*(Part 6 — Elmer FEM, and the consolidated comparison matrix to come.)*
