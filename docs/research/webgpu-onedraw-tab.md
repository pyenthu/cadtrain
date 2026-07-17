# WebGPU "WGPU" render tab — onedraw-webgpu spike

**Status:** research + scaffold spike only (nothing wired into the live UI). 2026-07-17.
**Question:** Could a WebGPU GPU-rasterizer (evaluating [Geolm/onedraw-webgpu](https://github.com/Geolm/onedraw-webgpu))
become a new right-pane render tab — a GPU-drawn **vector** sibling of the existing
**B·SVG** (server-side OCCT true-boundary → SVG) tab?

Deliverables shipped alongside this doc (all NEW, unwired):
- `src/lib/shared/graph-editor/WebGpuView.svelte` — a dependency-free proof-of-life
  scaffold (feature-detect → adapter/device → clear a canvas). NOT registered anywhere.
- `src/lib/shared/graph-editor/webgpu-support.ts` (+ `.test.ts`) — a pure
  `webgpuSupported()` guard, headless-tested.
- This doc. `TODO.md` carries one pointer entry.

---

## TL;DR — executive verdict

- **onedraw-webgpu is NOT a drop-in for a browser tab today.** It is a **C11 +
  WGSL** library (94% C / 5.6% WGSL) that links against a **native** WebGPU
  framework (Dawn / wgpu-native) and builds with CMake. Its README lists an
  "emscripten example" as an **upcoming** feature — i.e. there is **no WASM/browser
  build yet**. Vendoring it into cadtrain's SvelteKit app would mean compiling
  C11→WASM ourselves via Emscripten and writing a JS/TS binding layer. That is a
  real project, not a copy-paste.
- **Its model is SDF shapes, not SVG paths.** onedraw is a *signed-distance-field*
  2D renderer — it draws boxes, discs, circles, ellipses, arcs, sectors, triangles,
  oriented/textured quads, with union/subtraction/intersection and outlines, "everything
  in a single draw call." Our B·SVG data is **arbitrary Bézier/line path `d` strings**
  from OCCT HLR. Mapping OCCT outlines onto SDF primitives is lossy/awkward; onedraw is
  a better fit for *authoring* schematic shapes than for *reproducing* an OCCT silhouette.
- **License is friendly.** onedraw is **Zlib** — permissive, vendor-safe (attribution,
  no copyleft). So *if* we ever wanted it, vendoring is legally clean. That is the one
  unambiguous green light.
- **Recommendation:** treat onedraw as **reference/inspiration for the approach** (GPU
  SDF/vector rasterization in one pass), and build the WGPU tab — if we build it — on
  **raw WebGPU + our own small WGSL**, driven by the polylines the OCCT projector already
  produces. Start from the `WebGpuView.svelte` scaffold. Keep B·SVG as the always-there
  fallback. This is a **nice-to-have crispness/perf experiment, not on any critical path.**
- **Reframe the value.** WebGPU here buys **crisp, fast raster vector fills** (GPU
  anti-aliased shapes, no DOM SVG node bloat on huge boundaries). It is **NOT** 3D
  per-pixel lighting — that already exists in the MF / TF / BREP 3D **mesh** tabs, which
  shade a tessellated solid. A WGPU tab draws the same flat 2D boundary as B·SVG, just on
  the GPU.

---

## 1. What onedraw-webgpu actually is

| Aspect | Finding |
|---|---|
| Category | GPU-driven **SDF (signed distance function) 2D renderer** — "everything in a single draw call." |
| Primitives | box, blurred box, rectangle, oriented box/rectangle, triangle, triangle ring, disc, circle, ellipse, arc, sector, textured quad, oriented textured quad. |
| Ops | Shape **union · subtraction · intersection**; outline rendering. |
| Language | **C11** (94.0%) + **WGSL** shaders (5.6%). "everything in C11", "minimal dependencies." |
| Distribution | **Source drop-in** — copy `/lib`, add `onedraw.c` to your build (CMake). **No npm package.** |
| Runtime | Native: "Create your window and provide the WebGPU device and surface", "Link with WebGPU framework." Uses WebGPU **natively** (Dawn / wgpu-native class of backends). |
| Browser/WASM | **Not yet.** README lists an "emscripten example" under *upcoming features* — no shipped WASM/browser target. |
| Assets | A `fonts/` folder for **debug text** only; no CDN dependency. |
| License | **Zlib** (permissive; attribution, no copyleft). |

**Bundle size:** there is no prebuilt web bundle to measure — the artifact is C source.
A hypothetical Emscripten build of a single-draw-call SDF renderer would be **small**
(tens of KB of WASM + a thin JS glue) relative to our existing WASM (Manifold, TrueForm
~31 MB) — but that number only exists *after* we compile it, which nobody has done.

**Can it be vendored self-contained (no external CDN)?** *Legally,* yes (Zlib). *Practically,*
not as-is: there is no browser build. Vendoring = (a) fork the C11 source into the repo,
(b) add an Emscripten toolchain step to produce `onedraw.wasm` + JS glue, (c) write a TS
wrapper that hands it our `GPUDevice` and feeds it shape lists. All assets would then be
**same-origin** (the app forbids external hosts under COEP — see §4), so once compiled it
*is* self-contained. The cost is the compile+bind project, not licensing or CDN.

---

## 2. How a "WGPU" tab would slot in as a B·SVG sibling

### Data source — reuse the OCCT boundary, don't re-derive it

The B·SVG tab (`RightPane.svelte`, `brepSvg*` effect around L408–482) POSTs
`{ source, paramValues }` to **`POST /api/brep/svg`**, which runs the shared graph→OCCT
executor (`solidFromSource`) and projects the solid's true boundary via
`src/lib/engines/brep/svg/brep-to-svg.ts`. Today that projector emits an **SVG string**.

Two clean ways to feed a GPU tab from the exact same pipeline:

1. **Reuse the SVG string, parse paths on the client.** Take the returned `<svg>`, pull
   the `d` attributes, and tessellate the path outlines to polygons for the GPU. Simplest
   to wire (zero server change) but adds a client-side SVG-path parser + fill tessellator.
2. **Add a `format:'polylines'` mode to the projector (preferred).** `brep-to-svg.ts`
   already computes **projected 2D polylines** internally (`edgeAssembly` builds
   `pts2` arrays; `meshLambertAssembly` builds projected, painter-sorted, per-triangle
   polys with a shade colour) before it stringifies them to `<path>` elements. Expose a
   JSON variant — `{ viewBox, polylines: [{ pts:[[x,y]…], closed, fill? }] }` — so the
   GPU tab consumes **numbers, not a re-parsed string**. This is a small, additive change
   to the existing server module; the SVG string path stays byte-identical for B·SVG.

Either way the WGPU tab keys its fetch on `{ source, params }` with the **same
active-tab-only + content-key discipline** the B·SVG / TF / SVG effects already use, so it
never projects while hidden or refetches on unrelated re-renders.

### What the GPU actually draws

- **Filled silhouette / shaded (lambert):** the projector already emits filled/painter-
  sorted polygons. The GPU rasterizes those polygons with anti-aliased edges — the crisp,
  fast raster fill that is the whole point. (onedraw's model is SDF shapes; for arbitrary
  OCCT outlines we instead triangulate the fill polygons and draw them — a small custom
  WGSL pipeline, or onedraw's textured-quad/SDF path only if we later port it.)
- **Outline mode:** draw the boundary polylines as GPU line strips (or thin quads for
  crisp widths).

### Where the tab registers (concrete)

1. **`embed-config.ts`**
   - Add `'wgpu'` to the `RightPaneTab` union (after `'brepsvg'` in canonical order).
   - Add it to `ALL_TABS`.
   - Add it to `ENGINE_TABS.brep` (`['brep', 'brepsvg', 'wgpu']`) — it is powered by the
     **same OCCT boundary**, so it belongs to the `brep` engine and auto-hides when the
     brep engine is turned off. (Alternatively leave it engine-agnostic in `NON_ENGINE_TABS`
     if we want it available even without brep — but then it needs its OWN data source.)
   - Mirror `'wgpu'` into `RightPane.svelte`'s local `RightTab` type + the `onMount`
     localStorage restore allow-list (keep the exact-sync contract the file documents).
2. **`RightPane.svelte`**
   - A `{#if tabOn('wgpu')}` tab button beside B·SVG.
   - A `<div class="ge-glb-body" class:hidden={rightTab !== 'wgpu'}>` body that mounts a
     lazy-imported `WebGpuView` **only** when `rightTab === 'wgpu' && (active ?? true)`
     (same lazy `$state<any>(null)` + `onMount(async import)` pattern as
     `PrimitiveDualCanvas` / `PrimitiveSvgView`), passing it the fetched polylines/SVG.
   - A cache/fresh badge row mirroring `.ge-bake-meta` (reuse the `ms`/`mode` meta from
     `/api/brep/svg`).
3. **No new route.** Per Rule 2 / memory `feedback_demos_under_primitives`, this is a tab
   inside the existing editor, never a top-level route.

### Async GPU init lifecycle

Mirror the scaffold (`WebGpuView.svelte`), driven by tab visibility:

- **On tab-open** (the `{#if rightTab==='wgpu' && active}` mount): `webgpuSupported()`
  gate → `navigator.gpu.requestAdapter()` → `adapter.requestDevice()` → configure the
  canvas `'webgpu'` context with `getPreferredCanvasFormat()`.
- **On data / param change:** re-upload the polyline buffers + re-encode a render pass
  (device stays; only buffers/among draw calls change).
- **On unmount / tab-close:** `device.destroy()` and drop buffers (the scaffold's
  `onMount` teardown does exactly this). Guard every step; a null adapter/device →
  the fallback panel, never a throw.

---

## 3. WebGPU availability + graceful fallback

- **Feature-detect** synchronously with `webgpuSupported()` (presence of `navigator.gpu`).
  `true` only means "worth attempting" — `requestAdapter()` can still return `null` on a
  blocklisted or software-only GPU, so the async path must handle a null adapter/device
  and fall back too.
- **Fallback ladder:** no `navigator.gpu` **or** null adapter **or** init throws → show
  the "WebGPU unavailable" panel and point the user at **B·SVG**, which renders the same
  boundary with zero GPU. Because the WGPU tab and B·SVG share the OCCT-boundary data
  source, the fallback is genuinely equivalent output, not a degraded stand-in.
- **Browser support (as of 2026):** WebGPU ships in Chrome/Edge (desktop + Android) and
  Safari 18+ (macOS/iOS); Firefox has shipped it on Windows and is rolling out elsewhere.
  Linux Chrome may still need a flag on some stacks. So a **built-in fallback is
  mandatory**, not optional — a meaningful fraction of viewers will hit it.
- **Headless/SSR:** the editor routes are `ssr=false`, and the scaffold + guard are
  import-safe on the server (the guard returns `false` when there's no `navigator.gpu`;
  it's unit-tested headless). Nothing WebGPU runs server-side.

---

## 4. COOP/COEP interaction (a green light, for once)

The app already sets **COOP `same-origin` + COEP `require-corp` app-wide** (for TrueForm's
SharedArrayBuffer pthreads — `src/hooks.server.ts` prod, a `vite.config.js` dev
middleware). COEP `require-corp` **forbids cross-origin subresources** — no CDN scripts,
fonts, or WASM.

- **Good news:** WebGPU needs **none** of that. A `GPUBuffer` is not a `SharedArrayBuffer`;
  `navigator.gpu` works fine under cross-origin isolation. So the WGPU tab has **no
  header/CSP conflict** — the opposite of the usual COEP friction.
- **The one rule it imposes:** any onedraw WASM/JS glue (if we ever vendor + compile it) or
  any WGSL/asset the tab loads **must be same-origin** — bundled into the app, never fetched
  from a CDN. That is already how cadtrain ships all assets, so it is a constraint we
  already satisfy by default. Raw-WebGPU + inline WGSL (the recommended path) has no
  external asset at all.

---

## 5. Integration plan (phased, low-risk)

- **P0 — scaffold (this spike, DONE):** `WebGpuView.svelte` proof-of-life + the pure
  guard + test. Human verifies WebGPU comes up on a real GPU by dropping the component
  into a scratch spot. No registration.
- **P1 — data seam:** add the additive `format:'polylines'` (JSON) mode to
  `brep-to-svg.ts` + `/api/brep/svg` (§2), leaving the SVG-string path untouched.
- **P2 — real render:** a small custom WGSL pipeline that triangulates + rasterizes the
  fill polygons (and line strips for outlines) — driven entirely by the P1 polylines.
  Reuses the projector's painter-sort + per-face shade colour so "shaded" matches B·SVG.
- **P3 — register the tab:** wire `'wgpu'` through `embed-config.ts` + `RightPane.svelte`
  (§2), with the B·SVG fallback, badge row, and lazy mount. Browser-verify per Rule 11/23.
- **P4 (optional) — evaluate onedraw itself:** only if we want SDF authoring primitives
  (blur, boolean shape ops, textured quads) for the *wells schematic / diagram* surface
  rather than OCCT-outline reproduction. That is where onedraw's model actually shines —
  a separate motivation from the B·SVG-sibling framing, and the point at which the
  Emscripten-compile + Zlib-vendoring project would be justified.

---

## 6. Risks / open questions

- **onedraw has no browser build** — using it *at all* means owning an Emscripten toolchain
  step + a JS binding. High effort for a nice-to-have. The raw-WebGPU path sidesteps this
  entirely; onedraw stays "reference architecture" until/unless P4.
- **SDF vs path mismatch** — onedraw draws parametric SDF shapes; OCCT boundaries are
  arbitrary Bézier/line outlines. Reproducing a silhouette on SDF primitives is lossy. The
  custom-WGSL-triangulate path avoids this but is our code to maintain.
- **Is the payoff real?** B·SVG already renders fast for typical parts. The GPU win shows
  up on **huge/complex boundaries** (thousands of `<path>` nodes stress the DOM SVG
  renderer) and on **crisp AA fills**. Worth a measurement before P2 — is any current part
  slow enough to justify it? If not, this parks behind the WebGPU-SLM / other GPU work.
- **Fill triangulation quality** — evenodd fill rule + self-intersecting outlines need a
  robust tessellator (earcut-class, dependency-free) or we lean on the projector's already-
  triangulated `meshLambertAssembly` polys (which are triangles already — the cheapest P2).
- **Maintenance surface** — a second vector renderer alongside B·SVG can drift (see the
  client/server cutaway drift noted in `todo_cutaway_unify`). Keeping the WGPU tab a *pure
  consumer* of the projector's polylines (no independent projection math) is the guard.
- **Browser coverage** — a non-trivial fraction of viewers fall to the B·SVG fallback;
  the tab must degrade cleanly and never be the *only* boundary render.

---

## References

- onedraw-webgpu — https://github.com/Geolm/onedraw-webgpu (Zlib; C11 + WGSL; native).
- B·SVG projector — `src/lib/engines/brep/svg/brep-to-svg.ts`; endpoint
  `src/routes/api/brep/svg/+server.ts`; tab in `src/lib/shared/graph-editor/RightPane.svelte`.
- Tab registry — `src/lib/shared/graph-editor/embed-config.ts` (`RightPaneTab`, `ALL_TABS`,
  `ENGINE_TABS`).
- Sibling WebGPU research — `docs/research/trueform-webgpu.md` (WGSL kernel feasibility),
  `docs/research/webgpu-slm.md` (in-browser inference); COEP invariant in
  `src/lib/engines/trueform/CLAUDE.md` + `docs/architecture/geometry-engines.md`.
- Scaffold — `src/lib/shared/graph-editor/WebGpuView.svelte`,
  `src/lib/shared/graph-editor/webgpu-support.ts` (+ `.test.ts`).
