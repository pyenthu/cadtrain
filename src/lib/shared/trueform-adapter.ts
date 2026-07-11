/**
 * trueform-adapter — TrueForm mesh data → THREE.BufferGeometry.
 *
 * The TF-tab bake path ($lib/shared/trueform-client) hands back flat typed
 * arrays (`{ points: [V*3], faces: [F*3] }`). This turns them into the same
 * `{ full }` / `{ cutVC }` geometry wrapper `PrimitiveDualScene` already
 * consumes for the Manifold + BREP paths, so the shared canvas needs no
 * TrueForm-specific rendering code.
 *
 * TrueForm meshes are triangle soups (faces are always [nTri, 3]); the N-gon
 * triangulation branch is defensive — if a face array ever arrives with a
 * stride > 3 (e.g. a quad grid), each face is fan-triangulated so nothing is
 * dropped.
 *
 * SHADING — crease-aware normals (2026-07-03). TrueForm's boolean/generator
 * output is a WELDED indexed solid: the rim vertices of a bored pipe are SHARED
 * between the flat annular end-caps and the curved cylinder walls. A plain
 * `computeVertexNormals()` averages every incident face at a shared vertex, so
 * the hard cap↔wall rim smears into a rounded gradient and the flat caps pick
 * up a slope — the "bored-pipe shading problem". Instead we split normals at a
 * crease angle (default 60°, matching the Manifold live-mesh path's
 * `calculateNormals(0, 60)`): cylinder/bore walls read smooth (adjacent facets
 * are within 60°) while genuine creases — the pipe rims, box edges — stay hard.
 * This makes an exact-kernel boolean read as a solid with a clean bore once the
 * TF backend renders smooth-shaded (see PrimitiveDualCanvas `smoothShadeAuto`).
 * Output is NON-INDEXED (per-corner normals require split vertices at creases).
 * The crease-aware pass itself now lives in the shared `./crease-normals` module
 * (2026-07-12) — the SAME tolerance-weld routine the BREP adapter uses — instead
 * of a private copy here.
 */
import * as THREE from 'three';
import { creaseAwareCornerNormals, DEFAULT_CREASE_ANGLE } from './crease-normals';

// Re-export the shared normal helpers so existing `./trueform-adapter` importers
// keep resolving them (the routine physically moved to ./crease-normals).
export { creaseAwareCornerNormals, toleranceWeldMap, medianEdgeLength, edgeLengthPercentile } from './crease-normals';

export interface TfMeshInput {
  /** Flat xyz vertex coordinates, length V*3. */
  points: ArrayLike<number>;
  /** Flat vertex indices. Triangles (stride 3) by default. */
  faces: ArrayLike<number>;
  /** Vertices per face. Default 3 (triangles). > 3 → fan-triangulated. */
  faceStride?: number;
}

/** Default cross-section face colours — the historical Manifold half-section
 *  convention (`render-helpers.ts:manifoldToCutVC`): outer body RED, revealed
 *  interior / cut face GREY. Kept byte-identical so a TF cutaway reads the same
 *  as the Manifold 3D-bake cutaway. */
export const SECTION_OUTER_RGB: [number, number, number] = [0.8, 0.06, 0.06];
export const SECTION_INNER_RGB: [number, number, number] = [0.45, 0.45, 0.45];

/** One planar cut face of the cutaway box, e.g. `{ axis: 0, coord: 0 }` = the
 *  world x=0 plane. A result triangle whose THREE verts all sit on such a plane
 *  is a newly-exposed cross-section face (→ grey interior). */
export interface CutPlane {
  /** 0 = x, 1 = y, 2 = z. */
  axis: 0 | 1 | 2;
  /** Plane offset along that axis (world units). */
  coord: number;
}

/** How to colour a cut result's faces into outer skin vs revealed section. */
export interface SectionColoring {
  /** The cutter box's exposed planes — a triangle flush with any of these is a
   *  section (interior/grey) face. Mirrors Manifold's `onCutX`/`onCutY` test. */
  planes: CutPlane[];
  /** RGB (0..1) for the outer body faces. Default {@link SECTION_OUTER_RGB}. */
  outer?: [number, number, number];
  /** RGB (0..1) for the revealed section faces. Default {@link SECTION_INNER_RGB}. */
  inner?: [number, number, number];
  /** Coincidence tolerance for "vertex lies on the plane" (world units). */
  eps?: number;
}

/**
 * Per-FACE cross-section colours for a cut result — the pure face→colour split
 * (unit-tested). A triangle is a SECTION face (interior → grey) when all three
 * of its vertices lie on one of the cutter's exposed planes; otherwise it is
 * outer body skin (→ red). This is the exact geometric classifier Manifold's
 * `manifoldToCutVC` uses (`onCutX`/`onCutY`) — chosen over TrueForm's
 * `faceLabels`/`labels` because those only reference the ORIGIN face in the part
 * operand and do NOT distinctly tag the cutter-created faces (empirically the
 * boolean's `labels` region covers only a subset of the true section faces).
 *
 * `index` is the flat, already-triangulated [F*3] buffer; returns a flat [F*3]
 * RGB buffer (one colour per FACE, three floats). Expand to per-corner in the
 * geometry builder.
 */
export function sectionFaceColors(
  points: ArrayLike<number>,
  index: ArrayLike<number>,
  section: SectionColoring,
): Float32Array {
  const nt = (index.length / 3) | 0;
  const out = new Float32Array(nt * 3);
  const outer = section.outer ?? SECTION_OUTER_RGB;
  const inner = section.inner ?? SECTION_INNER_RGB;
  const eps = section.eps ?? 1e-2;
  const planes = section.planes;
  for (let t = 0; t < nt; t++) {
    const a = index[t * 3], b = index[t * 3 + 1], c = index[t * 3 + 2];
    let onSection = false;
    for (let p = 0; p < planes.length; p++) {
      const ax = planes[p].axis, co = planes[p].coord;
      if (
        Math.abs(points[a * 3 + ax] - co) < eps &&
        Math.abs(points[b * 3 + ax] - co) < eps &&
        Math.abs(points[c * 3 + ax] - co) < eps
      ) { onSection = true; break; }
    }
    const rgb = onSection ? inner : outer;
    out[t * 3] = rgb[0]; out[t * 3 + 1] = rgb[1]; out[t * 3 + 2] = rgb[2];
  }
  return out;
}

/** Convert an sRGB hex string (e.g. `'#8a929c'`) to a linear-space RGB triple
 *  (0..1) suitable for a THREE vertex-`color` attribute — matches how a
 *  `MeshStandardMaterial.color` set from the same hex is converted, so a per-part
 *  cut mesh's vertex-coloured OUTER skin reads the SAME tint as the full-view
 *  per-part material arm (`color={aPBR.color}`). Used for the v2 per-part cutaway
 *  (outer skin = the part's material colour, interior section = grey). */
export function hexToRgb01(hex: string): [number, number, number] {
  const c = new THREE.Color(hex);
  return [c.r, c.g, c.b];
}

/**
 * Fan-triangulate an index buffer whose faces have `stride` vertices each into
 * a flat triangle index array. stride === 3 is returned as-is (already tris).
 */
export function triangulateFaces(faces: ArrayLike<number>, stride = 3): Uint32Array {
  if (stride <= 3) return faces instanceof Uint32Array ? faces : Uint32Array.from(faces as any);
  const nFaces = Math.floor(faces.length / stride);
  const out: number[] = [];
  for (let f = 0; f < nFaces; f++) {
    const base = f * stride;
    const v0 = faces[base];
    for (let k = 1; k < stride - 1; k++) {
      out.push(v0, faces[base + k], faces[base + k + 1]);
    }
  }
  return Uint32Array.from(out);
}

/**
 * Build a THREE.BufferGeometry from TrueForm data with crease-aware normals.
 * Non-indexed (split at creases) so a bored pipe reads as a smooth-walled solid
 * with a clean bore + sharp rims. `creaseAngleDeg` tunes the sharp/smooth split.
 *
 * When `section` is supplied (the TF cutaway path), a per-vertex `color`
 * attribute is emitted — outer body faces RED, revealed cross-section faces
 * GREY — so the result renders through the SAME `cutVC` / `vertexColors` branch
 * as the Manifold + BREP half-sections (`PrimitiveDualScene`). Absent `section`,
 * output is unchanged (position + normal only) → the plain solid path.
 */
export function tfMeshToGeo(data: TfMeshInput, creaseAngleDeg = DEFAULT_CREASE_ANGLE, section?: SectionColoring): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const positions = data.points instanceof Float32Array ? data.points : Float32Array.from(data.points as any);
  const index = triangulateFaces(data.faces, data.faceStride ?? 3);
  if (index.length === 0) {
    // No faces (point cloud / empty) — nothing to shade; keep the raw points.
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return g;
  }
  // Expand to a NON-INDEXED position buffer that matches the per-corner normals.
  const nCorner = index.length; // nt * 3
  const outPos = new Float32Array(nCorner * 3);
  for (let i = 0; i < nCorner; i++) {
    const v = index[i];
    outPos[i * 3] = positions[v * 3];
    outPos[i * 3 + 1] = positions[v * 3 + 1];
    outPos[i * 3 + 2] = positions[v * 3 + 2];
  }
  const normals = creaseAwareCornerNormals(positions, index, creaseAngleDeg);
  g.setAttribute('position', new THREE.BufferAttribute(outPos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  if (section) {
    // Per-face RGB (outer/section) → scatter to the 3 corners of each triangle.
    const faceCols = sectionFaceColors(positions, index, section);
    const outCol = new Float32Array(nCorner * 3);
    const nt = (index.length / 3) | 0;
    for (let t = 0; t < nt; t++) {
      const r = faceCols[t * 3], gr = faceCols[t * 3 + 1], b = faceCols[t * 3 + 2];
      for (let k = 0; k < 3; k++) {
        const o = (t * 3 + k) * 3;
        outCol[o] = r; outCol[o + 1] = gr; outCol[o + 2] = b;
      }
    }
    g.setAttribute('color', new THREE.BufferAttribute(outCol, 3));
  }
  return g;
}
