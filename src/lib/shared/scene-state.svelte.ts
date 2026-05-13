// Shared scene state for the camera and the two point lights.
//
// ComponentScene reads from these to drive its Threlte primitives;
// SceneControls writes to these from a regular HTML overlay anchored to the
// canvas pane corner. The indirection (vs. local state inside ComponentScene)
// lets the controls live OUTSIDE <Canvas> so they can be properly
// corner-anchored — projecting the panel at world origin via <HTML> lands it
// on top of the model, which is what we're fixing here.

export const scene = $state({
  cam: { x: 0,  y:  5,  z:  0 },
  l1:  { x: 10, y: 10,  z:  0, i: 500 },
  l2:  { x: -40, y: 20, z:  0, i: 500 },
});
