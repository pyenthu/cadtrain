# Plan — SVG geometry tab (vector render of the part)

**Requested 2026-06-14.** Add **another tab** in the right pane (alongside
`3D BAKE` / `SRC` / `MD`) that shows the **SVG of the geometry** — a vector
rendering of the current part — via Three's
[`SVGRenderer`](https://threejs.org/docs/#examples/en/renderers/SVGRenderer).
Use case: crisp, scalable, documentation-ready line/fill drawings of a part
(printable, embeddable in `docs/parts/*.md`, zoomable without raster blur).

Parallel track to the Stack/Properties + Z-light work. Blast radius: the right
pane in `GraphEditorPane.svelte` (the tab strip + a new SVG view component) +
a small reuse of the existing bake mesh.

## Where the tabs live

The `3D BAKE` / `SRC` / `MD` tab strip is in `GraphEditorPane.svelte` (right
pane). A new `SVG` tab slots in next to them, rendering a new
`PrimitiveSvgView.svelte` that takes the same baked geometry the 3D pane uses.

## Two rendering routes (the real decision)

### Route 1 — built-in `three/examples/jsm/renderers/SVGRenderer.js` (user's link)
Renders the scene to **SVG `<path>`/`<polygon>` elements** (one filled polygon
per triangle), same camera/lights as the WebGL pane.
- **Pros**: tiny, no new dependency footprint beyond three's examples, mirrors
  the live scene 1:1, trivially downloadable as `.svg`.
- **Cons**:
  - **One polygon PER triangle, no hidden-line removal beyond z-sort** → at the
    viewer's **192 circular segments** a single tube is thousands of triangles;
    the SVG balloons and renders slowly. **Must bake the SVG view at a LOW
    segment count** (e.g. 24–48 via `setCircularSegmentMode`/a segment param)
    or decimate — non-negotiable for usable output.
  - Flat-shaded facets (no smooth gradients); MeshPhong → SVGRenderer maps to
    flat fills. Acceptable for a line-drawing aesthetic.
  - Overlapping coplanar faces can z-fight in the painter's-algorithm sort.

### Route 2 — `three-svg-renderer` (hidden-line vector — ARCHIVED prior art)
`archive/src/lib/cad/exporter.ts` already did this: `SVGRenderer` + `SVGMesh` +
`FillPass` + `VisibleChainPass` from the **`three-svg-renderer`** package
(different from the built-in). It produces **true hidden-line-removed vector
art** and already handles our **vertex-colour split** (red outer / grey bore via
`splitByColor`).
- **Pros**: publication-quality CAD line drawings (visible silhouette + crease
  chains, hidden lines removed), colour-by-region already solved.
- **Cons**: heavier dependency (was archived 2026-06-01), known gotchas travel
  with it (OrthographicCamera cast, FillPass + VisibleChainPass tuning), slower.

**Recommendation**: prototype with **Route 1** (built-in SVGRenderer) behind the
new tab for a fast first cut — low-segment bake + same camera — and keep
**Route 2** (revive the archived `exporter.ts`) as the "export quality" upgrade
once the tab earns its keep. Decide segment count empirically against a tube +
a collar.

## Implementation sketch (Route 1)

1. **New component** `src/lib/shared/PrimitiveSvgView.svelte`:
   - Lazy-import `SVGRenderer` (SSR is off; keep it out of the WebGL bundle).
   - Build a throwaway `THREE.Scene` with the **same camera** (`scene.cam`,
     `up=[0,0,-1]`, Z-down) + lights as `PrimitiveDualScene`, add the baked
     mesh (reuse the `manifoldToGeo` / `cutVC` BufferGeometry already produced;
     honour `scene.showCutaway` for the red/grey split).
   - `renderer.render(scene, camera)` → `renderer.domElement` is an `<svg>`;
     mount it into the tab. Re-render on camera/zScale/xScale/cutaway change.
2. **Low-segment bake**: add a segment override for the SVG path (the viewer is
   192; the SVG view wants ~32). Either a dedicated bake request param or a
   client-side decimate. Document the chosen knob.
3. **Tab wiring** in `GraphEditorPane.svelte`: add `SVG` to the tab enum + the
   strip; mount `PrimitiveSvgView` when active. Only render when the tab is
   active (mirror the active-tab-only WebGL-context discipline — don't run the
   SVGRenderer for inactive tabs).
4. **Download**: a "⤓ .svg" button that serialises `renderer.domElement.outerHTML`
   to a Blob → download (Explicit-permission: it's a local download the user
   initiates, fine). Optionally feed `docs/parts/<id>.md`.
5. **Z-down + scales**: apply the same `xScale`/`zScale` view exaggeration group
   so the SVG matches the 3D pane's framing of long thin tools.

## Test / verify
- Open the SVG tab on `dt_tube` (simple) and a collar (chamfers) → vector SVG
  renders, downloadable, readable at the low segment count.
- Toggle cutaway → red outer / grey bore split shows (Route 2) or at least the
  cut geometry (Route 1).
- Confirm the SVGRenderer does NOT run while another tab is active (perf).
- Check segment count: a tube must not produce a multi-MB SVG.

## Follow-ups (post-ship)

- **Orthographic projection toggle** (requested 2026-06-14): the SVG view
  currently uses a `PerspectiveCamera`. Add a **persp ⇄ ortho** toggle in the
  SVG-tab toolbar — orthographic is the correct projection for a dimensioned/
  technical drawing (parallel edges stay parallel, no foreshortening). Cheap:
  swap to `THREE.OrthographicCamera` (frustum from the part bbox + the
  xScale/zScale) when ortho is selected; re-render on toggle. Keep perspective
  as the other option. Lives entirely in `PrimitiveSvgView.svelte`.

## GPU rendering — verdict (explored 2026-06-14): DON'T

"Can the SVGRenderer run in pure GPU code if we pass the BufferGeometry?" —
**No, it's a category error.** SVG is a vector **DOM** format; the GPU emits
rasters/buffers, not `<path>` elements. The final path-DOM assembly is
inherently main-thread. And that DOM assembly (~10–100 ms for 100s–1000s of
`<path>`s) is the ACTUAL bottleneck — the projection+sort math the GPU could
accelerate is only ~50–100 µs, so GPU offload nets ~0 or negative:
- GPU projection + readback → the GPU→CPU readback stall (~1–5 ms) > the savings.
- Rasterize → vectorize (potrace/marching-squares) → loses true-vector crispness,
  bloated output, +500 ms; no such lib in node_modules anyway.
- Worker + OffscreenCanvas → moves the math off-thread but the DOM cost stays on
  main; IPC overhead cancels the win.
- WebGPU compute → three 0.183 has no stable WebGPU backend + browser-compat
  cliff (no Firefox); 6–12 wk for a gain the DOM cost eats.

**The real lever is triangle count, not the renderer.** Bake the SVG tab at
**32–48 circular segments** (vs the 256 default — `CIRCULAR_SEGMENTS_DEFAULT`)
→ ~8–10× faster SVG, well under the HIGH_TRI=4000 warning, with the
line-drawing aesthetic that suits a vector drawing. Keep the existing
`EdgesGeometry` silhouette/crease outlines (free, CPU-linear). True hidden-line
removal (the archived `three-svg-renderer` HLR) stays the post-ship quality
upgrade. This matches the LOD findings (`docs/plans/stack-cutaway-perf.md` /
the triangle-optimization report): segment count is the lever, THREE.LOD /
client decimation / GPU are not.

## Reconcile
Add a `/plan` lane when scoped (Rule 19). Relates to the archived
`exporter.ts` (revive via `git mv` for Route 2) and the viewer scale/light
work (shared camera + scene-state).
