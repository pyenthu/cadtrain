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
  /** Fit-vertical (#11): when true, the ortho camera frames the WHOLE part
   *  length instead of the ~3-diameter window (which leaves long parts only
   *  partly visible until you scroll the Z-pan — bug #10). Toggled by the ⇕ Fit
   *  button in SceneControls; auto-enabled at part load when the part is much
   *  longer than the default window. */
  fitLength: false,
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
  zRectLight: false,
  /** Z-axis DIRECTIONAL light (2026-06-14). Parallel rays perpendicular to the
   *  Z (drilling) axis → the whole length lit evenly, no falloff; `zDirAngle`
   *  spins the bearing around Z. Works with MeshPhong (no PBR/strange colours,
   *  no LTC init). An OPTION (toggle) — default ON. */
  /** 3D-canvas camera projection — false = perspective (default), true =
   *  orthographic (parallel, no foreshortening; good for inspecting a part).
   *  VIEW ONLY; OrbitControls works with both. DEFAULT orthographic (user pref). */
  cam3dOrtho: true,
  zDirLight: true,
  zDirIntensity: 1,
  /** Bearing (deg) of the directional light around Z: 0°=+Y (front, camera
   *  side), 90°=+X, 180°=behind. Light shines FROM this bearing toward the axis.
   *  −45° is the user-confirmed "perfect" default. */
  zDirAngle: -45,
  /** RectAreaLight intensity (luminance-ish units — NOT point-light candela).
   *  Higher now that it's the sole directional source (was 4 as a fill). */
  zRectIntensity: 2,
  /** Rectangle WIDTH = the dimension running ALONG Z (the part's length). 0 =
   *  auto-derive from `partZExtent` (full part span + ~5% headroom). */
  zRectWidth: 0,
  /** Rectangle HEIGHT = the dimension ACROSS the part (a few diameters wide so
   *  the wash wraps the whole circumference). World units after view scale. */
  zRectHeight: 40,
  /** Radial offset (world units, +Y) of the rectangle off the part axis — how
   *  far the emissive panel sits away from the part. */
  zRectOffset: 200,
  /** Bearing (degrees) of the rect light AROUND the part's Z (drilling) axis.
   *  0° = +Y (the default front, same side as the camera), 90° = +X, 180° = −Y
   *  (behind), etc. Spins the panel's position + facing around the axis. */
  zRectAngle: 0,
  /** Cutaway toggle — when true, the cross-sectioned `cutVC` geometry
   *  renders (per-vertex RGB: red outer / grey bore). When false, the
   *  solid `full` mesh renders in flat red. UI in SceneControls. */
  showCutaway: true,
  /** Black edge overlay on the mesh, drawn at a 20° threshold. UI in
   *  SceneControls. */
  showEdges: true,
  // Warp is now baked into the Manifold geometry server-side (so the black
  // wire EDGES follow the bulge too — see builder.finalizeManifold). These
  // fields drive the SceneControls UI + the /preview request body.
  warpEnabled: false, // master on/off
  warpAmp: 0.3,       // magnitude in geom units when enabled
  warpFreq: 1.5,      // cycles per unit Z
  warpAxis: 'x' as 'x' | 'y',
  /** Bumped by SceneControls on a warp COMMIT — the master toggle, an axis
   *  change, or an amp/freq `change` event (Enter / blur / step), NOT per
   *  keystroke or drag tick. PrimitiveDualCanvas keys its re-bake $effect on
   *  this so the (~hundreds-of-ms) Manifold re-bake fires only on commit, while
   *  the live `warp*` values still update the input fields continuously. */
  warpBakeNonce: 0,
  /** Smooth-shading override — RENDER-TIME (free, no re-bake). Drives the live
   *  material's `flatShading` flag in PrimitiveDualScene via PrimitiveDualCanvas.
   *  - 'auto' (default): keep the existing per-part heuristic (curved engines +
   *    twisted extrudes + BREP smooth; cubes/hex/everything else flat). This is
   *    the hard-won default — flat faces read dull when smooth-shaded (the
   *    8297314 regression), so we DON'T smooth everything by default.
   *  - 'smooth': force smooth (flatShading:false) for the open part.
   *  - 'flat': force flat (flatShading:true) for the open part. */
  smoothShade: 'auto' as 'auto' | 'smooth' | 'flat',
  /** Crease angle (minSharpAngle, deg) for the BAKED per-vertex normals
   *  (Manifold.calculateNormals). BUILD-TIME — changing it re-bakes (it changes
   *  the vertex split), so it's threaded into the /preview request body + the
   *  bake-cache key. Default 60 (the historical hardcoded value): edges above 60°
   *  (cube corners, cylinder caps) stay hard; below it shade smooth. Lower it to
   *  keep designed shallow chamfers hard; raise it to smooth a coarse mesh more. */
  creaseAngle: 60,
});
