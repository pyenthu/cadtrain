# SVG Projection — Performance, Smoothness & Transparency

Plan for the SVG tab of the CAD editor's right pane (`PrimitiveSvgView`).
Analysis + phased design. No code changed by this document.

Author context: the SVG emit path is a PURE, custom per-triangle Gouraud
projector (deliberately not three's `SVGRenderer`). This plan keeps that
purity (headless-testable) while making it faster, smoother, and
transparency-aware.

---

## 1. Current architecture (data flow + where the work happens)

### 1.1 Prop / geometry flow

```
RightPane.svelte ($effect, rightTab==='svg')          src/lib/shared/graph-editor/RightPane.svelte:285
  └─ POST /api/primitives/preview  { source, params, cutaway:true, colorOuter/Inner, segments }   :309–325
        server: analyzeParts(source) → PartColorLUT      src/routes/api/primitives/preview/+server.ts:317–320
                finalizeManifold(...)  → { full, cutVC, parts[], cutParts[] }   render-helpers.ts:153
                serializeComponentResult(r)               +server.ts:341
        returns { full, cutVC, parts?, cutParts? }        +server.ts:356–361 / 369–376
  └─ svgMeshJson = { full: data.full, cutVC: data.cutVC }   RightPane.svelte:328   ← DROPS parts/cutParts
  └─ <PrimitiveSvgView meshJson={svgMeshJson} active={rightTab==='svg'} … />   RightPane.svelte:536
```

`PrimitiveSvgView.svelte`:
- `geos = deserializeComponentResult(meshJson)` → `{ full, cutVC }` THREE.BufferGeometry pair (`:107`).
- Render `$effect` (`:281–305`) tracks `active`, `geos`, `size`, and the
  scene view deps: `scene.cam.{x,y,z}`, `scene.partCenter`, `scene.zFocus`,
  `scene.xScale/zScale`, `scene.showCutaway`, `scene.showEdges`,
  `projection`, `lightAngle`. ANY change re-runs `renderToSvg`.
- `renderToSvg` (`:219–276`) picks `cutVC` when `scene.showCutaway` else
  `full` (`:227`), builds the camera via `buildSvgCamera`, then calls
  `emitSvg(...)` and mounts the returned `<svg>` with `replaceChildren` (`:273`).

### 1.2 The emit (all main-thread, per render)

`emitSvg` (`src/lib/shared/svg-emit.ts:81`) does, every call:
1. **Per-vertex projection + Lambert shade** over all `vCount` verts
   (`:137–163`): `p.project(camera)` per vertex, two-sided normal flip,
   `AMBIENT + KEY·max(0,n·L) + FILL·max(0,n·V)`.
2. **Triangle index rebuild** into `Int32Array a/b/c` (`:166–170`).
3. **Reduction** — `triangleKeepMask` (svg-reduce.ts): back-face cull
   (closed solid only, `backfaceCull:!useCut` RightPane:262) + degenerate
   drop (`:178–187`).
4. **Phong refinement + emit** (`:304–415`): per kept face compute a
   subdivision level `K` from normal spread (`TARGET=0.05`) capped by
   on-screen edge length (`SUBDIV_PX=10`) and `EMIT_BUDGET=16000`; sample a
   K×K barycentric grid, re-`project` each sub-vertex, renormalise the
   interpolated normal, shade, and push each sub-triangle as a 2-stop
   `userSpaceOnUse` `<linearGradient>` (or flat fill) with its mean NDC z.
5. **Global painter's sort** of every (sub-)triangle by z, then append all
   polys + their gradient defs to the `<svg>` (`:419–423`).
6. **Edge outline** — rebuilds a fresh `new THREE.EdgesGeometry(geo, 20)`
   EVERY render and projects each segment (`:429–452`), gated on `showEdges`.

Camera build (`svg-camera.ts:47`): ortho = dead-on Z elevation at natural
aspect (renderH grows with the part, capped 8000px, stage scrolls); persp =
the live orbit camera. Matrices refreshed by hand (`:97–99`).

### 1.3 Colour / section / transparency today

- **Colour**: solid mesh → default red `DEF_R/G/B` unless a per-vertex
  `color` attr exists; cutaway `cutVC` carries per-vertex red-outer /
  grey-bore colours baked server-side. `mute()` (`svg-emit.ts:95`) desat+dims
  toward the 3D MeshPhong tone.
- **Section/cutaway**: handled by picking `cutVC` vs `full` and disabling
  back-face cull for the open mesh.
- **Transparency**: NONE. Every polygon is fully opaque; there is no
  `fill-opacity`, no per-part alpha, no draw-order-for-blend. `parts[]` /
  `cutParts[]` (which carry `PartAppearance.opacity`) are **discarded at
  RightPane.svelte:328** before they ever reach the view.

---

## 2. Problems (concrete + evidenced)

### P1 — Everything re-projects on every interaction (efficiency)
The render `$effect` (`PrimitiveSvgView.svelte:281`) re-runs the FULL
`emitSvg` when `lightAngle` (`:292`) or `scene.cam` (`:287`) changes.
Lighting is a per-vertex `n·L` that does NOT depend on projection, yet
dragging the light dial re-projects every vertex, re-subdivides every curved
face, re-sorts thousands of polys, rebuilds `EdgesGeometry`, and rebuilds the
entire `<svg>` DOM via `replaceChildren`. Orbiting in persp does a full
re-emit per pointer move. This is the dominant interactive cost.

### P2 — Fill count explosion / no caching
Cost is proportional to emitted polygon count. Phong refinement multiplies
faces up to K×K (K≤6 → 36×) with an `EMIT_BUDGET` of 16000 (`:291`) — a huge
SVG DOM, sorted with `Array.sort` on 16k objects each frame, each poly + a
`<linearGradient>` with 2 `<stop>`s created via `createElementNS`. Above
`HIGH_TRI=4000` (`PrimitiveSvgView.svelte:80`) it silently degrades to flat
per-face fill (a visible quality cliff). There is no memoization: identical
(geometry, camera, scale) inputs recompute from scratch.

### P3 — EdgesGeometry rebuilt every render
`new THREE.EdgesGeometry(geo, 20)` (`svg-emit.ts:429`) is O(tris) topology
work recomputed on every re-emit including pure light-dial moves, then
disposed (`:442`). It depends only on geometry, never on camera or light.

### P4 — Faceted / mesh-of-triangles look (smoothness)
- The outline draws EVERY 20° crease as raw projected segments — a mesh of
  triangle chords on curved surfaces, no silhouette/outline consolidation,
  no HLR, stroke-width 1 hairline.
- Curved silhouettes are polygonal (32-seg coarse bake → visibly faceted
  outer contour); Phong only smooths SHADING, not the SILHOUETTE edge.
- Fills are per-triangle gradients; the "flat fill above 4000 tris" fallback
  bands hard. No `shape-rendering`/AA hinting on strokes.

### P5 — Transparency ignored (the headline gap)
A subpart with `appearance.opacity < 1` renders fully opaque. The 3D pane
already does per-part alpha (`PrimitiveDualScene.svelte` `applyOpacity`
`:157–171`, mixed-alpha 2-group split `:316–351`, `effOpacity =
partOpacity × scene.xrayOpacity` `:146–151`). The server ALREADY emits and
serializes `parts[]`/`cutParts[]` with `PartAppearance`
(`+server.ts:359–360,375–376`; `mesh-serial.ts:25,46–47,107`), but RightPane
throws them away (`:328`) and the SVG path never receives per-part
appearance. So the SVG diverges from the 3D bake for any transparent casing /
open-hole part.

---

## 3. Proposed design (phased, each independently shippable + verifiable)

Guiding principle: keep `svg-emit` / `svg-camera` / `svg-reduce` PURE
(no Svelte, no module state) so each phase lands with headless vitest
coverage before any browser check. The Svelte shell owns lifecycle only.

### Phase 0 — Split projection from shading (cheap, high-impact) — HEADLESS
**Goal: kill P1/P3 for light-dial + re-shade without touching perf-risky code.**

Refactor `emitSvg` into two pure stages behind the same entry point:
- `projectGeometry(geo, camera, renderW, renderH, {sX,sZ, backfaceCull})`
  → a plain **ProjectedScene** POJO: `Float32Array` screen `sx/sy/sz`,
  per-vertex local normal, triangle `a/b/c`, keep-mask, and the projected
  edge-segment list. Depends ONLY on geometry + camera + scale.
- `shadeAndEmit(projected, {lightAngle, AMBIENT/KEY/FILL, colours, …})`
  → the `<svg>` (subdivision, gradient emit, sort, outline paint).

In the shell, memoize `projected` keyed by
`geoRef + projection + camera-signature + sX + sZ + renderW/H` (see 3.5).
Then a **light-dial drag re-runs only `shadeAndEmit`** — no re-projection,
no EdgesGeometry rebuild (the projected edge list is cached with the scene).
Cache the `EdgesGeometry` result inside `projectGeometry`.

Test: unit-test `projectGeometry` determinism (same inputs → identical
typed arrays) and that `shadeAndEmit` output changes with `lightAngle` but
`projected` does not. Pure — runs in node vitest like `svg-reduce.test.ts`.

### Phase 1 — Silhouette-only outline + AA strokes (smoothness) — HEADLESS core
**Goal: fix P4 outline; clean contour instead of a triangle mesh.**

Replace the "project every 20° crease" outline with a proper
**silhouette + hard-crease extractor** (pure function in a new
`svg-silhouette.ts`):
- Build an edge→adjacent-face-normal map ONCE per geometry (cache with the
  projection). An edge is a **silhouette** when its two adjacent faces have
  opposite sign of `faceN·V` (one front, one back) — view-dependent, so
  recompute cheaply from the cached adjacency + current V. Include
  **hard creases** (dihedral angle > threshold, matching the existing 20°)
  which are view-independent.
- Emit silhouette + crease edges as a single `<path>` with
  `stroke-linejoin:round`, `stroke-linecap:round`, `vector-effect:
  non-scaling-stroke`, and `shape-rendering:geometricPrecision` for AA.
- Chain contiguous segments into polylines so joins are clean (removes the
  hairline-gap faceted look). Optional Catmull-Rom / quadratic smoothing of
  silhouette chains on curved runs to hide the 32-seg chords ("curve-aware
  silhouette") — gated by a flag so it stays exact for hard edges.

Test: adjacency + silhouette classification are pure typed-array in/out —
unit-test on the `unitCube()` fixture already in `svg-reduce.test.ts`
(a cube viewed down +X → exactly 4 silhouette edges; a 32-seg cylinder →
2 silhouette runs of N segments). Chain-building tested on synthetic edge
sets. Browser check only for stroke AA appearance.

### Phase 2 — Per-part transparency (the headline) — HEADLESS emit, browser verify
**Goal: fix P5; mirror the 3D bake's per-part opacity in the SVG.**

Data plumbing (shell only, no new server work — the data already exists):
1. **Stop dropping parts.** RightPane.svelte:328 →
   `svgMeshJson = { full, cutVC, parts: data.parts, cutParts: data.cutParts }`.
   `SerializedComponentResult` already carries them (`mesh-serial.ts:46–47`);
   `deserializeComponentResult` already rehydrates
   (`mesh-serial.ts:107–111`) into `PartMesh[]` with `appearance`.
2. `PrimitiveSvgView` prop type widens `meshJson` to the full
   `SerializedComponentResult`; `geos` gains `parts?/cutParts?`.

Emit (pure, in `svg-emit`): add an OPTIONAL per-part path mirroring
`PrimitiveDualScene`:
- Pick the part array by section state: `showCutaway ? cutParts : parts`.
  When absent (no active LUT / instanced-only entries) fall back to the
  existing merged `full`/`cutVC` path — byte-identical to today.
- **Effective opacity** per part = `appearance.opacity ?? 1` ×
  `scene.xrayOpacity ?? 1` — the SAME formula as
  `PrimitiveDualScene.svelte:146–151`, so the SVG tracks the x-ray slider too.
- Colour: use `PartAppearance.colorOuter/colorInner` as the base
  (`buildSourceParts` full mode has no vertex colour — appearance carries it;
  cut mode carries grey section vertex colour), routed through the same
  `mute()` tone-match.
- **Draw order + blend**: extend `appendTri`'s draw record with an
  `alpha` field. When `alpha < 1`, set `fill-opacity` on the polygon (and
  keep the gradient for shading). Emit ALL opaque parts first, then paint
  transparent parts back-to-front AFTER — i.e. a two-bucket painter's sort:
  opaque bucket (globally z-sorted) painted first, transparent bucket
  (globally z-sorted) painted on top with `fill-opacity`. This is the SVG
  analogue of the 3D `depthWrite:false` + renderOrder split
  (`PrimitiveDualScene.svelte:301,367–384`): opaque occludes, transparent
  blends over what's behind — so a transparent casing shows the tubing
  through it.
- Silhouette/crease outline (Phase 1) drawn per opaque part on top; for a
  transparent part, draw its BACK silhouette faintly too (optional) so the
  see-through shell reads as a shell, not a flat tint.

Test (headless): with a two-part fixture (opaque inner cube + `opacity:0.4`
outer shell), assert the emitted `<svg>` has (a) the inner part's polys
present and NOT fully occluded, (b) the outer part's polys carry
`fill-opacity="0.4"`, (c) opaque polys precede transparent polys in document
order. All assertable on the returned SVG DOM string without a browser.
Browser check: visual see-through + matches the 3D pane at the same
`xrayOpacity`.

### Phase 3 — Move emit to a worker + cache in the bake (efficiency at scale) — HEADLESS core
**Goal: fix P2 for heavy parts; get emit off the main thread.**

- The heavy `projectGeometry` + `shadeAndEmit` are already pure and
  transferable-array friendly. Follow the existing worker pattern
  (`bake-worker-core.ts` + `bake-worker.ts` + `bake-client.ts`;
  `tf-worker-core.ts`/`tf-worker.ts`). A `svg-emit-core.ts` (pure, no DOM)
  produces a **serializable draw list** (points, colours, gradient stops,
  z, alpha, edge paths) — NOT SVGElements (workers have no DOM). The shell
  builds the actual `<svg>` DOM from that list on the main thread (fast; DOM
  build is the cheap part, the math is the expensive part).
  - Requires refactoring `emitSvg` so the geometry math returns data, and a
    thin main-thread `buildSvgDom(drawList)` creates elements. This also
    makes the WHOLE pipeline headless-unit-testable (currently it needs
    `document.createElementNS`, so it can't run in the bare node env — see
    that `svg-emit` has no test today, only `svg-reduce`).
- **Cache key**: `hash(geoBytes) + projection + cameraSig + sX + sZ +
  renderW/H`. Shading (light) is a fast main-thread pass on the cached
  draw list (Phase 0 already separates it). Optionally cache the draw list
  keyed by geometry in the bake response so a tab revisit is instant.
- Debounce persp-orbit re-emit (rAF-coalesce `scene.cam` writes) so a drag
  doesn't queue N worker jobs.

### Phase 4 — Silhouette-only projection / decimation (optional, big meshes)
For `flatFill`-tier meshes (P2 cliff), instead of degrading to flat fills:
project **silhouette + crease edges only** for the linework and a
**coarse merged per-part fill** (convex-ish outline fill per part from the
silhouette loop) — a true "technical drawing" that is O(silhouette) not
O(tris). Also merge coplanar faces before emit (union adjacent triangles
sharing a plane) to cut fill count on flat regions. Both pure, both
headless-testable. This is the long-tail lever; ship only if Phase 0–3
leave heavy parts slow.

---

## 4. Risks / trade-offs

- **Silhouette extraction cost vs quality (Phase 1/4).** Edge-adjacency
  build is O(tris) with hashing; cache it with the projection. Silhouette
  classification is view-dependent (recompute per camera) but O(edges) and
  far cheaper than the current per-render EdgesGeometry rebuild. Curve
  smoothing of silhouette chains can round genuine sharp corners — gate it
  to runs whose adjacent-face dihedral stays below the crease threshold.
- **Worker serialization (Phase 3).** Transfer typed arrays (positions,
  normals, draw list) as transferables to avoid structured-clone copies.
  The draw list must be plain numbers/strings (no SVGElements) — hence the
  `svg-emit-core` (data) vs `buildSvgDom` (DOM) split. Extra complexity; only
  worth it for parts that are actually slow (gate by tri count).
- **SVG file size (transparency + gradients).** `fill-opacity` per poly is
  cheap, but transparent parts still emit full gradient fills. The
  `EMIT_BUDGET`/`HIGH_TRI` guards must apply per-part so a transparent shell
  doesn't blow the budget. Download size grows with alpha layers — acceptable
  for the rare-use SVG export.
- **Gradient-id collision (known gotcha `svg_gradient_id_collision`).**
  `url(#id)` resolves DOCUMENT-WIDE; `/primitives` mounts N views at once.
  The current per-mount `idPrefix` (`svgUid`, `PrimitiveSvgView.svelte:122`;
  documented in `svg-emit.ts:17–24`) MUST be preserved through any refactor
  — the worker/core path has to thread `idPrefix` into every generated
  gradient id, and any new `<clipPath>`/`<mask>` ids (if used for
  transparency) need the SAME per-mount prefix or two coexisting panes
  collide → flat/wrong shading during a tab switch.
- **Two-bucket transparency ordering is approximate.** SVG has no z-buffer;
  painter's order within the transparent bucket can still mis-blend deeply
  interpenetrating transparent shells. Matches the 3D pane's own
  `depthWrite:false` approximation, so parity is maintained — good enough.
- **Ortho renderH cap (8000px, svg-camera.ts:79).** Unchanged; note that
  silhouette linework at that size must keep `non-scaling-stroke` or it
  hairlines away.

## 5. Test strategy

Headless (node vitest, no browser — the model to follow is
`svg-reduce.test.ts`):
- `svg-reduce.ts` back-face cull + degenerate drop (exists).
- **NEW** `projectGeometry` purity/determinism (Phase 0).
- **NEW** `svg-silhouette` adjacency + silhouette/crease classification on
  the `unitCube()` + a synthetic cylinder fixture (Phase 1).
- **NEW** `svg-emit-core` draw-list generation (Phase 3 refactor makes the
  emit DOM-free → finally unit-testable): assert triangle→gradient stop
  colours, painter z-order, and the opaque-before-transparent ordering +
  `fill-opacity` on transparent-part polys (Phase 2). This is the phase-2
  transparency contract, fully headless on the draw list.
- Gradient-id prefixing: assert every generated id starts with the passed
  `idPrefix` (regression guard for `svg_gradient_id_collision`).

Browser (playwright / manual, `/primitives` SVG tab):
- Light-dial drag no longer re-projects (Phase 0 — check no jank / DOM churn).
- Silhouette outline looks clean + AA (Phase 1).
- A transparent-casing part renders see-through and MATCHES the 3D bake at
  the same `scene.xrayOpacity` (Phase 2) — side-by-side with the 3D pane.
- Multi-tab mount: switch tabs fast, confirm no flat-shading flash (id
  collision guard).

## 6. Suggested landing order
Phase 0 (projection/shading split + light-dial cache) → Phase 2
(transparency: 1-line RightPane fix + per-part emit) → Phase 1 (silhouette
outline) → Phase 3 (worker + DOM-free core) → Phase 4 (silhouette-only /
decimation for heavy meshes). Phases 0 and 2 are the highest value-to-effort:
0 removes the per-interaction re-projection, 2 closes the headline
transparency gap using data the server already ships.

---

### Critical files for implementation
- src/lib/shared/svg-emit.ts
- src/lib/shared/PrimitiveSvgView.svelte
- src/lib/shared/graph-editor/RightPane.svelte
- src/lib/graph/mesh-serial.ts
- src/lib/shared/PrimitiveDualScene.svelte
