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
 * Output is NON-INDEXED (per-corner normals require split vertices at creases),
 * exactly like `render-helpers.ts:creaseAwareCornerNormals`, whose pure routine
 * this mirrors — duplicated (not imported) to keep the lean, worker-transferable
 * TF adapter free of the Manifold render-pipeline import graph.
 */
import * as THREE from 'three';

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

/** Default crease angle (deg) — matches the Manifold live-mesh path (60°). */
const DEFAULT_CREASE_ANGLE = 60;

/**
 * Crease-aware per-corner normals for a welded indexed triangle mesh.
 *
 * `pos` is the welded [V*3] position buffer, `tri` the flat [F*3] index buffer.
 * Returns a NON-INDEXED [F*9] normal buffer (one normal per triangle corner) to
 * pair with a non-indexed position buffer. Adjacency is by WELDED POSITION (not
 * raw index) so coincident-but-distinct seam indices still share a smooth band;
 * a corner only averages incident faces within `creaseDeg` of its own face, so
 * sharp edges (pipe rims, box corners) stay hard. Mirrors the canonical
 * `render-helpers.ts:creaseAwareCornerNormals` (pure math, no THREE/Manifold).
 */
function creaseAwareCornerNormals(pos: ArrayLike<number>, tri: ArrayLike<number>, creaseDeg: number): Float32Array {
  const nt = (tri.length / 3) | 0;
  const nv = (pos.length / 3) | 0;
  // Per-face area-weighted normal (raw cross, |·| = 2·area) + its unit direction.
  const faceN = new Float32Array(nt * 3);
  const faceU = new Float32Array(nt * 3);
  for (let t = 0; t < nt; t++) {
    const a = tri[t * 3], b = tri[t * 3 + 1], c = tri[t * 3 + 2];
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2];
    const bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2];
    const cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
    const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    faceN[t * 3] = nx; faceN[t * 3 + 1] = ny; faceN[t * 3 + 2] = nz;
    const l = Math.hypot(nx, ny, nz) || 1;
    faceU[t * 3] = nx / l; faceU[t * 3 + 1] = ny / l; faceU[t * 3 + 2] = nz / l;
  }
  // Weld corners by quantised position so a smooth band averages across its
  // facets even when the boolean left coincident-but-distinct seam indices.
  const weldOf = new Int32Array(nv);
  const weldMap = new Map<string, number>();
  const q = (x: number) => Math.round(x * 1e4);
  for (let i = 0; i < nv; i++) {
    const key = `${q(pos[i * 3])},${q(pos[i * 3 + 1])},${q(pos[i * 3 + 2])}`;
    let rep = weldMap.get(key);
    if (rep === undefined) { rep = i; weldMap.set(key, i); }
    weldOf[i] = rep;
  }
  const inc: number[][] = new Array(nv);
  for (let t = 0; t < nt; t++) {
    for (let k = 0; k < 3; k++) {
      const rep = weldOf[tri[t * 3 + k]];
      (inc[rep] ?? (inc[rep] = [])).push(t);
    }
  }
  const cosThresh = Math.cos((creaseDeg * Math.PI) / 180);
  const out = new Float32Array(nt * 9);
  for (let t = 0; t < nt; t++) {
    const ux = faceU[t * 3], uy = faceU[t * 3 + 1], uz = faceU[t * 3 + 2];
    for (let k = 0; k < 3; k++) {
      const v = tri[t * 3 + k];
      let sx = 0, sy = 0, sz = 0;
      const list = inc[weldOf[v]];
      for (let j = 0; j < list.length; j++) {
        const t2 = list[j];
        // Include a neighbour face only when it's within the crease angle of
        // THIS face (always include self). Area weight comes from faceN's mag.
        const dot = ux * faceU[t2 * 3] + uy * faceU[t2 * 3 + 1] + uz * faceU[t2 * 3 + 2];
        if (t2 === t || dot >= cosThresh) { sx += faceN[t2 * 3]; sy += faceN[t2 * 3 + 1]; sz += faceN[t2 * 3 + 2]; }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      const o = t * 9 + k * 3;
      out[o] = sx / l; out[o + 1] = sy / l; out[o + 2] = sz / l;
    }
  }
  return out;
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
