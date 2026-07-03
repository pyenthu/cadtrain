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
 */
export function tfMeshToGeo(data: TfMeshInput, creaseAngleDeg = DEFAULT_CREASE_ANGLE): THREE.BufferGeometry {
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
  return g;
}
