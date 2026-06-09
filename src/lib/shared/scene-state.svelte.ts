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
