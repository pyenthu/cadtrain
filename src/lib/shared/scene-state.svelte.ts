// Shared scene state for the camera and the two point lights.
//
// ComponentScene reads from these to drive its Threlte primitives;
// SceneControls writes to these from a regular HTML overlay anchored to the
// canvas pane corner. The indirection (vs. local state inside ComponentScene)
// lets the controls live OUTSIDE <Canvas> so they can be properly
// corner-anchored — projecting the panel at world origin via <HTML> lands it
// on top of the model, which is what we're fixing here.

export const scene = $state({
  // Camera default position. Z-down drilling convention (up = [0,0,-1]).
  // Pulled to (0, 50, 0) — y=50 backs off enough for typical 9-15 in
  // shoe/joint/collar exemplars to fit with padding; z=0 keeps the view
  // axis perpendicular to the part's length. The OrbitControls target
  // auto-centers on the geometry bbox (see scene.partCenter) so the
  // camera doesn't need to bias for the part's vertical midpoint.
  cam: { x: 0,  y:  50, z:  0 },
  /** Auto-computed centre of the current geometry's bounding box, in
   *  world units. Written by PrimitiveDualScene's geometry effect; the
   *  OrbitControls target follows it so the part stays centred in the
   *  viewport regardless of its Z extent. Reset to origin when no geom. */
  partCenter: { x: 0, y: 0, z: 0 },
  /** Camera/look-at pan along the Z (drilling) axis — a vertical slider in the
   *  scene scrolls a tall assembly without changing the view angle. Both the
   *  camera and its target shift by this Z amount (a pure pan). */
  zFocus: 0,
  l1:  { x: 10,  y: 10,  z:  0,   i: 500 },
  l2:  { x: -40, y: 20,  z:  0,   i: 500 },
  /** Fill light from the previously-dark quadrant (below origin, pointing
   *  inward / up). Half-intensity (250 ≈ 0.5 × the others) keeps it as fill
   *  not key. */
  l3:  { x: 10,  y: -30, z: -20, i: 250 },
  /** Render-time Z compression. 1.0 = geom as authored; smaller values
   *  squash long primitives so they stay recognisable against their
   *  OD/wall in the viewport. Read by builder.finalizeManifold via
   *  the setRenderZScale getter. UI lives in the SceneControls gear. */
  zScale: 1.0,
  /** Render-time X (diameter / radial) exaggeration — VIEW ONLY. >1 fattens the
   *  diameter so a long thin tool's bore/wall detail stays readable when zScale
   *  compresses the length; <1 thins it. Applied (with zScale) as a scene-level
   *  scale on the whole render group in PrimitiveDualScene; the part on disk +
   *  the bake stay TRUE scale. The camera auto-fit accounts for both. */
  xScale: 1.0,
  /** Z-axis ("rectangular") light strip — VIEW ONLY. Distributes
   *  `zStripCount` point lights evenly along the part's Z (drilling) extent
   *  at a fixed radial offset (`zStripRadius`), so long thin tools / tall
   *  stacks are lit evenly down their whole length instead of falling off at
   *  the far end. When on, the three fixed lights (l1/l2/l3) dim to a small
   *  fill. Option A from docs/plans/z-axis-light.md (Phong-compatible — no
   *  material swap). Master OFF by default → lighting is identical to the
   *  prior 3-point setup. */
  zStripLight: false,
  /** Number of point lights spanning the part's Z extent. */
  zStripCount: 5,
  /** Per-light intensity for the strip. */
  zStripIntensity: 300,
  /** Radial offset (world units, +Y) of the strip from the part axis. */
  zStripRadius: 30,
  /** Auto-computed visual Z range of the rendered (stacked) part, in world
   *  units after the view scale. Written by PrimitiveDualScene's geometry
   *  effect alongside partCenter; the strip lights span [min, max]. */
  partZExtent: { min: 0, max: 0 },
  /** True rectangular AREA light along Z — VIEW ONLY. Independent of
   *  `zStripLight` (the point-light strip): this is a literal
   *  `THREE.RectAreaLight` whose long (width) dimension runs ALONG the part's
   *  Z (drilling) extent, emitting an even soft wash at the whole length of a
   *  tall stack. RectAreaLight only affects MeshStandard/Physical materials,
   *  so while this is ON the lit meshes render as MeshStandardMaterial instead
   *  of MeshPhong; OFF → the MeshPhong path is byte-identical to before.
   *  Option B from docs/plans/z-axis-light.md. The SOLE light now (user pref
   *  2026-06-14): the L1/L2/L3 point lights + the Z point-strip were removed, so
   *  this is always on (no off toggle) and the lit meshes are always
   *  MeshStandardMaterial. The $effect that sizes/positions it calls
   *  invalidate() so changes render live on the on-demand loop. */
  zRectLight: true,
  /** RectAreaLight intensity (luminance-ish units — NOT point-light candela).
   *  Higher now that it's the sole directional source (was 4 as a fill). */
  zRectIntensity: 9,
  /** Rectangle WIDTH = the dimension running ALONG Z (the part's length). 0 =
   *  auto-derive from `partZExtent` (full part span + ~5% headroom). */
  zRectWidth: 0,
  /** Rectangle HEIGHT = the dimension ACROSS the part (a few diameters wide so
   *  the wash wraps the whole circumference). World units after view scale. */
  zRectHeight: 40,
  /** Radial offset (world units, +Y) of the rectangle off the part axis — how
   *  far the emissive panel sits away from the part. */
  zRectOffset: 30,
  /** Cutaway toggle — when true, the cross-sectioned `cutVC` geometry
   *  renders (per-vertex RGB: red outer / grey bore). When false, the
   *  solid `full` mesh renders in flat red. UI in SceneControls. */
  showCutaway: true,
  /** Black edge overlay on the mesh, drawn at a 20° threshold. UI in
   *  SceneControls. */
  showEdges: true,
  // TEMP warp experiment — remove with attachWarpShader plumbing
  warpEnabled: false, // master on/off — false keeps shader uniform at 0
  warpAmp: 0.3,       // magnitude in geom units when enabled
  warpFreq: 1.5,      // cycles per unit Z
  warpAxis: 'x' as 'x' | 'y',
});
