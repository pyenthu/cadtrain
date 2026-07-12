// svg-camera.ts — PURE projection math for PrimitiveSvgView.
//
// Builds the ortho/persp THREE camera + the SVG's pixel size (renderW/renderH)
// from a baked part's geometry bounding box + the (already-resolved) scene view
// params. NO Svelte, NO scene-state import — every input arrives as a parameter
// so the function is deterministic + unit-testable. Z-down convention
// everywhere (up = [0, 0, -1]), mirroring PrimitiveDualScene.

import * as THREE from 'three';

export interface SvgCameraParams {
  /** ortho = straight technical elevation (default) · persp = the live 3D cam. */
  projection: 'persp' | 'ortho';
  /** Container pixel size. */
  w: number;
  h: number;
  /** View-only exaggeration [xScale, xScale, zScale] (mirrors PrimitiveDualScene). */
  sX: number;
  sZ: number;
  /** Live orbit camera position (persp only). */
  cam: { x: number; y: number; z: number };
  /** Geometry bbox centre the persp camera looks at (persp only). */
  partCenter: { x: number; y: number; z: number };
  /** Z-pan added to the persp look-at (persp only). */
  zFocus: number;
}

export interface SvgCameraResult {
  /** The projection camera, matrices already refreshed (we project by hand). */
  camera: THREE.Camera;
  /** SVG pixel size. PERSP fills the container; ORTHO renders at natural aspect. */
  renderW: number;
  renderH: number;
  /** PERSP true → svg = 100% (no scroll). ORTHO false → natural px (stage scrolls). */
  fitToContainer: boolean;
  /** Ortho half-extents + Z centre (cosmetic for persp). */
  padH: number;
  padV: number;
  czWorld: number;
}

/**
 * Build the projection camera + SVG pixel size for a geometry. The camera is
 * NOT added to a Scene — the emitter projects vertices by hand — so we refresh
 * its world + projection matrices before returning.
 */
export function buildSvgCamera(
  geo: THREE.BufferGeometry,
  p: SvgCameraParams,
): SvgCameraResult {
  const { projection, w, h, sX, sZ } = p;

  // Camera. Built FIRST so the emitter can project itself. Z-down (up=[0,0,-1]).
  // renderW/renderH = the SVG's pixel size. PERSP fills the container (fit, no
  // scroll). ORTHO renders at the part's NATURAL proportions (a long tool →
  // tall SVG) so the stage scrolls and you can read it at size.
  let camera: THREE.Camera;
  let renderW = Math.max(1, w);
  let renderH = Math.max(1, h);
  let fitToContainer = true;
  let padH = 0, padV = 0, czWorld = 0;
  if (projection === 'ortho') {
    // ORTHOGRAPHIC = a straight perpendicular technical ELEVATION. We IGNORE
    // the orbited 3D camera and look dead-on perpendicular to the Z (drilling)
    // axis at the centreline (x=0, y=0), centred on the part's Z span so the
    // whole length frames. Z runs vertically; parallel edges stay parallel.
    geo.computeBoundingBox();
    const bb = geo.boundingBox;
    const halfX = bb ? 0.5 * (bb.max.x - bb.min.x) * sX : 1;
    const halfY = bb ? 0.5 * (bb.max.y - bb.min.y) * sX : 1;
    padH = (Math.hypot(halfX, halfY) || 1) * 1.05;   // radial → horizontal
    const halfZ = bb ? 0.5 * (bb.max.z - bb.min.z) * sZ : 1;
    padV = (Math.max(halfZ, 0.001)) * 1.05;          // z half-span → vertical
    czWorld = bb ? 0.5 * (bb.min.z + bb.max.z) * sZ : 0;
    // Render at the part's true V/H aspect, width pinned to the container.
    // Cap the longest side so a very long tool doesn't produce a monster SVG.
    renderW = Math.max(1, w);
    renderH = Math.max(1, Math.round(renderW * (padV / padH)));
    const MAXPX = 8000;
    if (renderH > MAXPX) { renderH = MAXPX; renderW = Math.max(1, Math.round(MAXPX * (padH / padV))); }
    fitToContainer = false;
    camera = new THREE.OrthographicCamera(-padH, padH, padV, -padV, 0.1, 100000);
    camera.up.set(0, 0, -1);
    camera.position.set(0, 1000, czWorld); // +Y axis; ortho → distance is cosmetic
    camera.lookAt(0, 0, czWorld);
  } else {
    // PERSPECTIVE: mirror the 3D pane — fov 45, the live (orbitable) camera.
    camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100000);
    camera.up.set(0, 0, -1);
    camera.position.set(p.cam.x, p.cam.y, p.cam.z);
    camera.lookAt(
      p.partCenter.x,
      p.partCenter.y,
      p.partCenter.z + p.zFocus,
    );
  }
  // We project by hand (camera isn't added to a Scene) → refresh its matrices.
  camera.updateMatrixWorld(true);
  (camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).updateProjectionMatrix();

  return { camera, renderW, renderH, fitToContainer, padH, padV, czWorld };
}
