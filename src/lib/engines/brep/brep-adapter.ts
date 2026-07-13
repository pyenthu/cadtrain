/**
 * Adapter: `/api/brep/preview` response → the `{ full } | { cutVC }` geometry
 * wrapper that `PrimitiveDualScene` already consumes (the same shape
 * `deserializeComponentResult` produces for the Manifold path).
 *
 * The BREP endpoint returns an adaptively-tessellated OCCT mesh:
 *   - no-cut: `positions` (+ `index`, + `normals`)            → a SOLID mesh
 *   - cut:    `positions` + per-vertex `colors` (+ `normals`) → a half-section
 *
 * SHADING — crease-aware normals (E5, 2026-07-12). OCCT tessellates a surface of
 * revolution as one CONICAL face per profile segment and DUPLICATES the ring
 * verts across each segment boundary, each carrying its own per-face normal — so
 * a revolved/curved B-rep renders FACETED (every curved-wall ring position holds
 * multiple distinct normals; measured 378/378 faceted on an ogive wall). The
 * Manifold + TrueForm paths avoid this by running their triangles through a
 * crease-aware corner-normal pass (weld adjacency by POSITION, average across
 * smooth dihedrals, KEEP the split above the crease angle). This adapter now
 * routes the OCCT triangle set through the SAME shared pass
 * (`./crease-normals:creaseAwareCornerNormals`, the tolerance-weld variant TF
 * uses) so BREP shades at PARITY with MF/TF: revolve walls go smooth, chamfers /
 * rims stay hard. Output is NON-INDEXED (per-corner normals need split verts at
 * creases), exactly like the TF adapter. OCCT's own `normals` are intentionally
 * ignored. This is a RENDER-normal change only — the upstream OCCT mesh
 * (positions + triangle indices) is untouched.
 *
 * The scene renders `showCutaway && cutVC ? cutVC : full`, so we route the
 * coloured half-section into `cutVC` and the plain solid into `full`. The
 * decision keys on the presence of a per-vertex colour attribute (a cut bake
 * always carries colours; a solid bake never does).
 */
import * as THREE from 'three';
import { creaseAwareCornerNormals, DEFAULT_CREASE_ANGLE } from '$lib/engines/trueform/crease-normals';

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

/** Build a THREE.BufferGeometry from a (supported) BREP preview response, with
 *  crease-aware smooth normals (see the module header). NON-INDEXED so creases
 *  split cleanly; per-vertex colours (cut half-sections) are expanded to match. */
export function brepGeometryFromResponse(data: BrepPreviewResponse): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const positions = data.positions ?? [];
  if (positions.length === 0) {
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(0), 3));
    return geo;
  }
  const srcPos = new Float32Array(positions);
  const nVerts = (srcPos.length / 3) | 0;
  // Per-vertex colours present (and well-formed) → carry them through.
  const hasColor = Array.isArray(data.colors) && data.colors.length === positions.length;

  // Triangle connectivity over `positions`: the solid path is INDEXED
  // (`data.index`); the cut path is already NON-INDEXED (identity index). Both
  // feed the crease-aware pass, which needs adjacency to weld + split by dihedral.
  const hasIndex = Array.isArray(data.index) && data.index.length > 0;
  const idx = hasIndex
    ? Uint32Array.from(data.index as number[])
    : identityIndex(nVerts);

  // Defensive: no usable triangle set (empty / non-triangular) → fall back to the
  // old indexed + computeVertexNormals path so a malformed response never throws.
  if (idx.length === 0 || idx.length % 3 !== 0) {
    geo.setAttribute('position', new THREE.BufferAttribute(srcPos, 3));
    if (hasIndex) geo.setIndex(new THREE.BufferAttribute(idx, 1));
    if (hasColor) geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(data.colors as number[]), 3));
    geo.computeVertexNormals();
    return geo;
  }

  // Crease-aware per-corner normals (tolerance-weld variant, shared with TF) →
  // NON-INDEXED, so expand positions (and colours) to one vertex per corner.
  const normals = creaseAwareCornerNormals(srcPos, idx, DEFAULT_CREASE_ANGLE); // [nt*9]
  const nCorner = idx.length; // nt * 3
  const outPos = new Float32Array(nCorner * 3);
  for (let i = 0; i < nCorner; i++) {
    const v = idx[i];
    outPos[i * 3] = srcPos[v * 3];
    outPos[i * 3 + 1] = srcPos[v * 3 + 1];
    outPos[i * 3 + 2] = srcPos[v * 3 + 2];
  }
  geo.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (hasColor) {
    const srcCol = new Float32Array(data.colors as number[]);
    const outCol = new Float32Array(nCorner * 3);
    for (let i = 0; i < nCorner; i++) {
      const v = idx[i];
      outCol[i * 3] = srcCol[v * 3];
      outCol[i * 3 + 1] = srcCol[v * 3 + 1];
      outCol[i * 3 + 2] = srcCol[v * 3 + 2];
    }
    geo.setAttribute('color', new THREE.BufferAttribute(outCol, 3));
  }
  return geo;
}

/** Identity triangle index [0, 1, 2, …, n-1] for an already-non-indexed mesh. */
function identityIndex(nVerts: number): Uint32Array {
  const idx = new Uint32Array(nVerts);
  for (let i = 0; i < nVerts; i++) idx[i] = i;
  return idx;
}

/**
 * Map a supported BREP response to the scene `geo` wrapper. A coloured
 * half-section becomes `{ cutVC }`; a plain solid becomes `{ full }`.
 *
 * Routes on the EXPLICIT `data.cut` flag, NOT colour presence: an UNCUT
 * multi-part solid now carries per-part color-by-source colours (#86 BREP), and
 * keying on colours alone would mis-route that coloured full mesh into `cutVC`
 * (shown only under the cross-section toggle). `meshBrepSolid`/`meshBrepParts`
 * always set `cut`, so this is exact; the colour-presence fallback covers any
 * legacy response without a `cut` field.
 */
export function brepResponseToGeo(
  data: BrepPreviewResponse,
): { full?: THREE.BufferGeometry; cutVC?: THREE.BufferGeometry } {
  const g = brepGeometryFromResponse(data);
  const isCut = data.cut === true || (data.cut === undefined && !!g.getAttribute('color'));
  return isCut ? { cutVC: g } : { full: g };
}
