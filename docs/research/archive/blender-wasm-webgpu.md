> **ARCHIVED 2026-07-13** during the /research reorg. Decisive NO-GO: no
> in-browser WASM/WebGPU Blender port exists and a full port is infeasible
> (no f64/exact predicates in WGSL) and GPL-blocked. The one reusable idea —
> Geometry-Nodes Fields — already lives in `blender-fields-for-nodes.md`; the
> WebGPU/COOP-COEP lessons are already covered by `trueform-webgpu.md`. Kept
> for provenance, not active reference.

# In-browser Blender (WASM + WebGPU) — does it exist, and is it feasible?

**Status:** research note (2026-07-03). Research only — no code touched.
**Question:** Does an in-browser Blender port (WebAssembly and/or WebGPU) already
exist, and is porting Blender to WASM/WebGPU feasible for something like cadtrain?

Cross-links:
- `docs/research/blender-fields-for-nodes.md` — the Geometry-Nodes **Fields** study
  (the genuinely useful part of Blender for us); TODO #4b "Blender fields for nodes".
- `docs/research/trueform-webgpu.md` (sibling research note, being written in
  parallel) + TODO #44 — same COOP/COEP + WebGPU + threading themes.
- `docs/plans/trueform-engine-tab.md`, `docs/architecture/geometry-engines.md`.

---

## TL;DR

- **Does a true in-browser WASM/WebGPU Blender exist? NO.** There is no full,
  usable WebAssembly build of Blender, and there is **no WebGPU backend** in
  Blender's GPU module. What exists is (a) old proof-of-concept experiments
  ("blender inside firefox via emscripten and WASM", a 2017 YouTube demo), (b) a
  devtalk thread where a Blender core dev explains why a real build is
  impractical, and (c) **partial-module** ports — most notably **emcycles**, the
  Cycles renderer stripped down to compile to JS/WASM (CPU-only, seconds-per-tiny-
  frame). None of these is a working Blender-in-the-browser.
- **"Blender in your browser" you can actually use today = CLOUD STREAMING**
  (Vagon Streams and render farms). That is a remote GPU VM piped to your browser
  as video/RDP — **not a WASM port**. Do not confuse the two.
- **Feasibility of a real port: (d) infeasible today** for the whole app, and
  **(c) possible-but-impractical** even for large subsystems. Blockers: no WebGPU
  backend (Blender targets desktop OpenGL 3.x / Vulkan / Metal), sheer binary
  size, deep CPython/`bpy` fusion, heavy multithreading (SharedArrayBuffer +
  cross-origin isolation — the exact wall TrueForm hit), 4 GB WASM memory, and
  file/addon I/O.
- **The hard blocker for cadtrain specifically is licensing: Blender is GPLv2+/
  GPLv3.** Any *code* we lift or link becomes a GPL derivative — incompatible with
  cadtrain (not GPL). **Algorithms and design are free to learn from; source is
  not free to copy.**
- **Honest takeaway:** full Blender is not our path. The value is **conceptual** —
  study **Geometry Nodes / Fields** (already captured in
  `blender-fields-for-nodes.md`) and specific algorithms, and reuse the
  **WebGPU + COOP/COEP + threading** lessons that also apply to TrueForm (#44).

---

## 1. Does it already exist? (primary question)

### 1a. True in-browser WASM Blender — NO working build

- **The reference thread is** [devtalk.blender.org "Building headless blender to
  WebAssembly" (#18381)](https://devtalk.blender.org/t/building-headless-blender-to-webassembly/18381).
  The idea proposed: a *headless* Blender in WASM to offload 3D compute to the
  client. A Blender core developer (**LazyDodo**) responds with the practical
  blockers (paraphrased from the thread / search index, WebFetch was 403 — see
  "Could not confirm"): Blender's graphics stack is **reliant on desktop OpenGL
  3.x while browsers only expose OpenGL ES / WebGL**, and Emscripten build times
  are prohibitive (minutes per iteration vs seconds native), making real work
  impractical. No functional build resulted from the thread.
- **The one video demo:** ["blender inside firefox via emscripten and WASM"
  (YouTube, Sep 14 2017)](https://www.youtube.com/watch?v=IkzlNr9LtN0) — an
  early transpile experiment. A curiosity, not a maintained project, ~8 years old,
  never turned into a usable tool.
- No blender.org / projects.blender.org project, no Blender Foundation statement,
  and no GitHub repo hosts a maintained full-app WASM Blender. Searches surface
  only the two items above plus cloud-streaming products (§1c).

### 1b. Partial / module ports — a few real ones exist

- **emcycles** — [github.com/paulfitz/emcycles](https://github.com/paulfitz/emcycles):
  *"a modified version of the Cycles renderer used in Blender 3D"*, dependencies
  stripped so it compiles to JavaScript/WASM via Emscripten. ~1.6 MB JS output;
  **CPU-only**; an 80x60 first pass ≈ 7 s, 640x480 ≈ 22 s on the author's
  hardware. Experimental (~6 commits, one embedded test scene). Proves a *single
  isolated subsystem* can be Emscripten-ported, at low performance — **and it is
  GPL** (Cycles is GPL; historically Apache-2.0 standalone Cycles exists as a
  separate distribution, but this is the Blender-derived variant → GPL applies).
- **Blend4Web** ([17.04 release](https://www.blend4web.com/en/community/article/337/))
  is *not* Blender-in-WASM. It is a separate WebGL engine that **exports** Blender
  scenes to the web; it did ship an experimental WASM build of its **physics**
  (a Bullet fork). Relevant only as evidence that heavy C++ 3D subsystems compile
  to WASM — not as a Blender port.

### 1c. "Blender in your browser" that actually works = CLOUD STREAMING (not WASM)

This is the crucial distinction. The products that let you "run Blender in a
browser, no install" are **remote desktops / render farms**, streaming a real
Blender running on a cloud GPU box:

- [Vagon Streams — Blender 3D](https://vagon.io/streams/experiences/blender-3d):
  full Blender streamed from cloud GPUs to the browser as pixels.
- [RebusFarm](https://rebusfarm.net/3d-software/blender-render-farm),
  [RenderStreet](https://render.st/), various GPU-VPS guides: remote render, frames
  stream back to the browser.

None of these executes Blender *in* the browser. They ship **video + input**, not
a WASM module. Any claim of "Blender runs in your browser" should be checked for
this: if it needs a login to a cloud session, it is streaming, not a port.

### 1d. Is there a WebGPU backend in Blender? NO

Blender's GPU module supports **OpenGL** (legacy default), **Metal** (Apple), and
**Vulkan** (now feature-complete and shipping as the tracked default for non-macOS
in **Blender 4.5 LTS**). Sources:
[GPU Module Overview](https://developer.blender.org/docs/features/gpu/overview/),
[Vulkan backend docs](https://developer.blender.org/docs/features/gpu/vulkan/),
[GPU backend selection #101977](https://developer.blender.org/T101977),
[Projects Update Q2/2025](https://code.blender.org/2025/05/projects-update-q2-2025/).

- **There is no WebGPU backend and none on the public roadmap.** The
  [2025](https://www.blender.org/development/projects-to-look-forward-to-2025/) and
  [2026](https://www.blender.org/development/projects-to-look-forward-to-in-2026/)
  project lists cover Vulkan, mobile/Android, video-sequencer GPU work — **not
  browser/WebGPU**. (Could-not-confirm: no explicit "WebGPU is not planned"
  statement was found; the absence is inferred from roadmaps + backend-selection
  design, which enumerate only OpenGL/Metal/Vulkan.)
- Adding a WebGPU backend would mean a fourth `GPUBackend`/GHOST context
  implementation — plausible *engineering* (the module is designed for backend
  selection), but nobody is doing it, because Blender's target is native desktop.

---

## 2. Feasibility & blockers (ranked)

Assume the goal is a real WASM/WebGPU Blender (not streaming). Ranked hardest-first:

1. **GPU abstraction — no WebGPU backend (hard).** Blender's viewport (and EEVEE)
   assumes desktop OpenGL 3.x / Vulkan / Metal. Browsers give WebGL2 (GLES-class)
   or **WebGPU**. Blender has neither a WebGL nor a WebGPU backend, so the
   viewport can't render as-is. Emscripten's own WebGPU story is now decent —
   [`emdawnwebgpu`](https://dawn.googlesource.com/dawn/+/refs/heads/main/src/emdawnwebgpu/pkg/README.md)
   (Dawn's maintained fork of Emscripten's `webgpu.h`, shipped in Emscripten
   4.0.10+ via `--use-port=emdawnwebgpu`, replacing the deprecated `-sUSE_WEBGPU`;
   see the [Emscripten WebGPU docs](https://emscripten.org/docs/porting/multimedia_and_graphics/WebGPU-support.html)
   and [PR #24220](https://github.com/emscripten-core/emscripten/pull/24220)) — but
   the *toolchain* being ready doesn't help until **Blender itself grows a WebGPU
   backend**, which it hasn't.
2. **Threading + cross-origin isolation (hard).** Blender is heavily multithreaded
   (TBB, task scheduler, dependency-graph eval, Cycles). WASM threads = pthreads
   over **SharedArrayBuffer**, which requires **COOP/COEP cross-origin isolation**
   headers. This is the *same wall cadtrain hit with TrueForm* (#44) and the same
   SharedArrayBuffer/COOP-COEP constraint noted for client-side execution. Doable
   but invasive and deployment-constraining.
3. **CPython / `bpy` dependency (hard).** Blender embeds CPython; `bpy` is a
   **C-extension fused to Blender's core** (RNA/DNA, operators, UI). CPython does
   run in WASM — [Pyodide](https://github.com/pyodide/pyodide) proves it, with
   many C-extension packages ported. But `bpy` is not an independent package that
   could "ride" Pyodide; it only exists *inside* the Blender process. You would be
   compiling Blender+CPython together, not layering `bpy` onto Pyodide. So Pyodide
   is a proof-of-concept that *a* CPython works in WASM, **not** a shortcut to `bpy`.
4. **Sheer size (hard-ish).** Blender is a multi-million-line C/C++ codebase; a
   full build is hundreds of MB of binary + data. As a WASM download this is
   impractical for the web even with streaming compilation and code-splitting.
   Build iteration is also minutes-per-attempt (the devtalk complaint).
5. **Memory (medium).** Classic WASM is a 4 GB address space; real Blender scenes
   blow past that. **memory64** (64-bit WASM) exists but is still maturing and
   costs performance/compatibility.
6. **File I/O, addons, OS integration (medium).** Blender expects a real
   filesystem, drag-drop, external addons, OS dialogs. Emscripten's MEMFS/IDBFS
   can emulate a VFS, but the whole addon ecosystem (arbitrary Python + native)
   won't transplant.

**What is realistically portable?** Not the app. *Isolated subsystems* can be
Emscripten-compiled in principle (emcycles proves it for Cycles). Candidates one
could imagine extracting — **BMesh / mesh ops, the BVH, OpenVDB volumes, the
Geometry-Nodes evaluator, EEVEE/Cycles** — are individually large, entangled with
Blender's DNA/RNA data model and its threading, and would need the WebGPU/threading
work above. And every one of them is **GPL** (§3). So even where technically
extractable, they are not *reusable in cadtrain*.

---

## 3. Licensing — the decisive blocker for cadtrain (GPL)

Blender is **GPL** (GPLv2-or-later; parts GPLv3). Sources:
[Blender license page](https://www.blender.org/about/license/),
[GPL and the legal limits of Blender (CG Cookie)](https://cgcookie.com/posts/the-gpl-and-the-legal-limits-of-blender),
[Blender manual — About the license](https://docs.blender.org/manual/en/latest/getting_started/about/license.html).

- **Copyleft:** if you distribute anything that includes part of Blender's source
  (or links its code), the whole derivative must be **GPL** and its source made
  available. You cannot fold GPL code into a non-GPL product.
- **`bpy`/Python API is explicitly in-scope:** published Blender scripts/addons
  must themselves be GPL-compatible — the Foundation treats the Python API as an
  integral part of the GPL work.
- **Therefore for cadtrain (not GPL):** *do not* copy, vendor, link, or transpile
  Blender source (or Cycles/emcycles) into our tree. **Algorithms, math, and
  architecture are free to study and re-implement** clean-room; only the *code*
  is encumbered. This is why `blender-fields-for-nodes.md` studies the Fields
  *design* and re-implements the *concept*, rather than importing anything.

---

## 4. Verdict

- **(a) already done?** No — no usable in-browser WASM/WebGPU Blender exists.
- **(b) actively attempted?** Only at the fringes: one 2017 Firefox demo, a
  devtalk discussion that concluded "impractical", and partial-module experiments
  (emcycles). No maintained effort, no Foundation project, no WebGPU backend.
- **(c) possible-but-impractical?** This is the honest status for large *subsystems*
  — technically Emscripten-able (emcycles shows it), but slow, huge, threading/
  WebGPU-gated, and GPL-encumbered.
- **(d) infeasible today?** Yes, for the **whole application** as a browser WASM/
  WebGPU port. Multiple hard blockers compound; nobody is building it; and the
  license forbids reuse in a non-GPL product anyway.

**Bottom line: an in-browser Blender is (a) not done, (b) barely attempted,
(d) infeasible as a full port, and GPL-blocked for code reuse regardless.**

---

## 5. Relevance to cadtrain (the honest takeaway)

1. **Full Blender is not a path.** Don't plan around embedding it. The usable
   "Blender in a browser" is cloud streaming, which is a product, not a technique
   we can adopt into our client-side pipeline.
2. **Geometry Nodes / Fields is the real prize — and it's conceptual, not code.**
   Blender's **Fields** model (a wire carries a *function over a domain*, evaluated
   lazily per element; capture materializes it) maps cleanly onto cadtrain's typed
   expression outputs / `list<point>` / `r_surface(fn)` problem. That study already
   lives in `docs/research/blender-fields-for-nodes.md` (TODO #4b) — recommend the
   **field-socket + Capture/Bake** mechanic, *avoid* Blender's implicit field
   inference. Reference the [Attributes and Fields](https://code.blender.org/2021/08/attributes-and-fields/)
   design post and the [Geometry Nodes lazy-function evaluator](https://developer.blender.org/docs/handbook/design/examples/geometry_nodes/)
   as *design* sources, re-implemented clean-room (GPL).
3. **WebGPU + threading lessons echo TrueForm (#44).** The blockers here —
   WebGPU backend maturity (`emdawnwebgpu` is now the sane Emscripten path), and
   SharedArrayBuffer + **COOP/COEP cross-origin isolation** for threads — are the
   same ones the TrueForm research (`docs/research/trueform-webgpu.md`) and
   client-side execution work confront. If cadtrain ever ships a WASM+threads
   geometry kernel, the COOP/COEP header requirement is a deployment constraint to
   design for once, shared across both efforts.

---

## 6. Sources

Existence / ports:
- devtalk — Building headless blender to WebAssembly (#18381): https://devtalk.blender.org/t/building-headless-blender-to-webassembly/18381
- "blender inside firefox via emscripten and WASM" (YouTube, 2017): https://www.youtube.com/watch?v=IkzlNr9LtN0
- emcycles (Cycles → JS/WASM): https://github.com/paulfitz/emcycles
- Blend4Web 17.04 (WebGL exporter + WASM physics, NOT a Blender port): https://www.blend4web.com/en/community/article/337/

Cloud streaming (the "Blender in browser" that is NOT WASM):
- Vagon Streams — Blender 3D: https://vagon.io/streams/experiences/blender-3d
- RebusFarm: https://rebusfarm.net/3d-software/blender-render-farm
- RenderStreet: https://render.st/

Blender GPU backends (no WebGPU):
- GPU Module Overview: https://developer.blender.org/docs/features/gpu/overview/
- Vulkan backend: https://developer.blender.org/docs/features/gpu/vulkan/
- GPU backend selection #101977: https://developer.blender.org/T101977
- Projects Update Q2/2025: https://code.blender.org/2025/05/projects-update-q2-2025/
- Projects to look forward to 2025 / 2026: https://www.blender.org/development/projects-to-look-forward-to-2025/ · https://www.blender.org/development/projects-to-look-forward-to-in-2026/

Emscripten WebGPU (toolchain side):
- emdawnwebgpu (Dawn): https://dawn.googlesource.com/dawn/+/refs/heads/main/src/emdawnwebgpu/pkg/README.md
- Emscripten WebGPU support: https://emscripten.org/docs/porting/multimedia_and_graphics/WebGPU-support.html
- Deprecate -sUSE_WEBGPU (PR #24220): https://github.com/emscripten-core/emscripten/pull/24220

Python / bpy in WASM:
- Pyodide (CPython in WASM): https://github.com/pyodide/pyodide
- Pyodide WASM constraints: https://pyodide.org/en/stable/usage/wasm-constraints.html

Geometry Nodes / Fields:
- Attributes and Fields (design): https://code.blender.org/2021/08/attributes-and-fields/
- Geometry Nodes design handbook: https://developer.blender.org/docs/handbook/design/examples/geometry_nodes/

Licensing (GPL):
- Blender license: https://www.blender.org/about/license/
- GPL and the legal limits of Blender (CG Cookie): https://cgcookie.com/posts/the-gpl-and-the-legal-limits-of-blender
- Blender manual — About the license: https://docs.blender.org/manual/en/latest/getting_started/about/license.html

## 7. Could not confirm
- The devtalk thread (#18381) returned HTTP 403 to automated fetch; core-dev
  (LazyDodo) quotes are reconstructed from search-index snippets, not a full read.
  The *substance* (OpenGL-3.x-vs-GLES mismatch, build-time pain, no working build)
  is corroborated across multiple snippets and consistent with Blender's backend
  design.
- No explicit Blender Foundation statement "WebGPU is not planned" was found; the
  no-WebGPU-backend conclusion is inferred from the GPU-module backend list
  (OpenGL/Metal/Vulkan only) and the 2025/2026 roadmaps.
