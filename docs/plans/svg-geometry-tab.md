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

## Reconcile
Add a `/plan` lane when scoped (Rule 19). Relates to the archived
`exporter.ts` (revive via `git mv` for Route 2) and the viewer scale/light
work (shared camera + scene-state).
