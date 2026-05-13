/**
 * ManifoldCAD runtime + small geometry helpers.
 *
 * Lives in its own module so per-primitive component files can import the
 * helpers without depending on (or cycling through) builder.ts. Each
 * primitive's geom() ends up reading just from here:
 *     import { cyl, tube, mv } from '$lib/cad/manifold-helpers';
 *
 * The Manifold WASM is initialised once via initManifold(); after that,
 * cyl/tube/mv/rot use the live `M` reference. Callers MUST await
 * initManifold() before invoking any geom().
 */

import Module from 'manifold-3d';

// CIRCULAR_SEGMENTS_DEFAULT — used when nothing overrides.
// CIRCULAR_SEGMENTS_COMPOSE — temporarily set by compose.ts via
//   setCircularSegmentMode for multi-part assemblies (10+ cylinders × CSG
//   union → mobile WebKit OOMs at 256).
export const CIRCULAR_SEGMENTS_DEFAULT = 256;
export const CIRCULAR_SEGMENTS_COMPOSE = 96;

let wasm: any = null;
export let M: any = null;
let currentSegments = CIRCULAR_SEGMENTS_DEFAULT;

export function setCircularSegmentMode(mode: 'default' | 'compose'): void {
  currentSegments = mode === 'compose' ? CIRCULAR_SEGMENTS_COMPOSE : CIRCULAR_SEGMENTS_DEFAULT;
  if (wasm) wasm.setCircularSegments(currentSegments);
}

export async function initManifold() {
  if (wasm) return;
  wasm = await Module();
  wasm.setup();
  M = wasm.Manifold;
  wasm.setCircularSegments(currentSegments);
}

/** @part Z-up cylinder/cone — height h, bottom radius r1, top radius r2 (defaults to r1). */
export function cyl(h: number, r1: number, r2?: number) {
  return M.cylinder(h, r1, r2 ?? r1, currentSegments);
}
/** @part Hollow Z-up tube — outerR, innerR, height. */
export function tube(outerR: number, innerR: number, h: number) {
  return cyl(h, outerR).subtract(cyl(h + 0.02, innerR));
}
/** Translate a Manifold by a vec3. NOT a physical object — transform op,
 *  so it's intentionally NOT @part-tagged and stays out of the Parts
 *  catalog. The user writes `mv(...)` calls themselves in the geom body. */
export function mv(m: any, v: [number, number, number]) { return m.translate(v); }
/** Rotate a Manifold by a vec3 of degrees (xyz). NOT a physical object —
 *  transform op, not @part-tagged. */
export function rot(m: any, v: [number, number, number]) { return m.rotate(v); }

/** Used by the cutaway view in finalizeManifold. Cached so multi-part
 *  builds don't reconstruct the same cube on every part. */
let _cachedCutBox: any = null;
export function getCutBox(): any {
  if (!_cachedCutBox && M) {
    _cachedCutBox = M.cube([20, 20, 100], false).translate([0, 0, -50]);
  }
  return _cachedCutBox;
}
