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

/** Build a THREE.BufferGeometry (indexed, with computed normals) from TF data. */
export function tfMeshToGeo(data: TfMeshInput): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  const positions = data.points instanceof Float32Array ? data.points : Float32Array.from(data.points as any);
  g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  const index = triangulateFaces(data.faces, data.faceStride ?? 3);
  if (index.length > 0) g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeVertexNormals();
  return g;
}
