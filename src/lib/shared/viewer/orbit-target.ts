// orbit-target.ts — the OrbitControls / camera look-at target for the 3D part
// viewer (PrimitiveDualScene). Pure + DOM-free so it's unit-testable.
//
// The target is PINNED to the part's VERTICAL (Z / drilling) axis — x = y = 0 —
// and follows ONLY the part's z-centre plus the axial Z-pan (`zFocus`). Keeping
// x and y at zero means the wellhead axis stays screen-centred while orbiting,
// so a tall Z-down part (a well) cannot drift off-centre.
//
// Before this, the target used the bbox y-centre (`partCenter.y`), which for a
// part whose geometry is not symmetric about the axis in Y sat OFF the axis, so
// orbiting swung the part off-centre (TODO #74). x was already forced to 0 by
// the bbox; this makes y consistent with it. Z-down convention: larger z =
// deeper; `partCenter.z` is the visual (post-view-scale) z-centre and `zFocus`
// is the axial pan the vertical slider drives — both preserved on the z axis so
// the camera-fit and the Z-pan slider keep working unchanged.

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

/**
 * The look-at target for the 3D viewer's OrbitControls.
 *
 * @param partCenter the rendered part's visual bbox centre (post-view-scale).
 *   Only its `z` is used — `x`/`y` are intentionally discarded so the target
 *   stays on the part's vertical (drilling) axis.
 * @param zFocus     the axial Z-pan (the vertical slider's `scene.zFocus`).
 * @returns `[0, 0, partCenter.z + zFocus]` — on-axis, at the panned z-centre.
 */
export function computeOrbitTarget(partCenter: Vec3Like, zFocus = 0): [number, number, number] {
  const z = (Number.isFinite(partCenter?.z) ? partCenter.z : 0) + (Number.isFinite(zFocus) ? zFocus : 0);
  return [0, 0, z];
}
