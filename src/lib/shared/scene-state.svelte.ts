// Shared scene state for the camera and the two point lights.
//
// ComponentScene reads from these to drive its Threlte primitives;
// SceneControls writes to these from a regular HTML overlay anchored to the
// canvas pane corner. The indirection (vs. local state inside ComponentScene)
// lets the controls live OUTSIDE <Canvas> so they can be properly
// corner-anchored — projecting the panel at world origin via <HTML> lands it
// on top of the model, which is what we're fixing here.

export const scene = $state({
  cam: { x: 0,  y:  30, z:  4 },
  l1:  { x: 10, y: 10,  z:  0, i: 500 },
  l2:  { x: -40, y: 20, z:  0, i: 500 },
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
  warpAmp: 0,       // 0 = off; magnitude in geom units
  warpFreq: 1,      // cycles per unit Z
  warpAxis: 'x' as 'x' | 'y',
});
