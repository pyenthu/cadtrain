/**
 * Adapter: `/api/brep/preview` response → the `{ full } | { cutVC }` geometry
 * wrapper that `PrimitiveDualScene` already consumes (the same shape
 * `deserializeComponentResult` produces for the Manifold path).
 *
 * The BREP endpoint returns an adaptively-tessellated mesh with OCCT
 * exact-surface normals:
 *   - no-cut: `positions` (+ `index`, + `normals`)            → a SOLID mesh
 *   - cut:    `positions` + per-vertex `colors` (+ `normals`) → a half-section
 *
 * The scene renders `showCutaway && cutVC ? cutVC : full`, so we route the
 * coloured half-section into `cutVC` and the plain solid into `full`. The
 * decision keys on the presence of a per-vertex colour attribute (a cut bake
 * always carries colours; a solid bake never does).
 */
import * as THREE from 'three';

export interface BrepPreviewResponse {
  supported?: boolean;
  positions?: number[];
  index?: number[];
  normals?: number[];
  colors?: number[];
  cut?: boolean;
  reason?: string;
  meta?: { tris?: number; verts?: number; ms?: number; tolerance?: number };
}

/** Build a THREE.BufferGeometry from a (supported) BREP preview response. */
export function brepGeometryFromResponse(data: BrepPreviewResponse): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = data.positions ?? [];
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (data.index && data.index.length > 0) {
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(data.index), 1));
  }
  // Per-vertex colours present (and well-formed) → carry them onto the geometry.
  const hasColor = Array.isArray(data.colors) && data.colors.length === positions.length && positions.length > 0;
  if (hasColor) {
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.colors as number[]), 3));
  }
  if (data.normals && data.normals.length === positions.length) {
    geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(data.normals), 3));
  } else {
    geo.computeVertexNormals();
  }
  return geo;
}

/**
 * Map a supported BREP response to the scene `geo` wrapper. A coloured
 * half-section becomes `{ cutVC }`; a plain solid becomes `{ full }`.
 */
export function brepResponseToGeo(
  data: BrepPreviewResponse,
): { full?: THREE.BufferGeometry; cutVC?: THREE.BufferGeometry } {
  const g = brepGeometryFromResponse(data);
  const isCut = !!g.getAttribute('color');
  return isCut ? { cutVC: g } : { full: g };
}
