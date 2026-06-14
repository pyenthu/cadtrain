/**
 * Isomorphic serialize / deserialize for a `ComponentResult`'s renderable
 * geometries. Used by the server-render path: the `/api/components/geom`
 * endpoint runs ManifoldCAD in Node, `finalizeManifold`s to `{ full, cutVC }`
 * THREE.BufferGeometry pair, serializes them to plain JSON here, and the
 * client rehydrates them back into the exact `{ full, cutVC }` shape
 * `ComponentScene.svelte` already consumes.
 *
 * Plain mesh-JSON rather than GLB on purpose — GLB would drop `cutVC`'s
 * per-vertex cutaway coloring (red outer / grey bore). The geometries are
 * non-indexed (see `manifoldToGeo` / `manifoldToCutVC` in builder.ts), so we
 * only ever carry `position` + optional `normal` + optional `color`.
 */

import * as THREE from 'three';

export interface SerializedGeometry {
  positions: number[];
  normals?: number[];
  colors?: number[];
  index?: number[];
}

export interface SerializedComponentResult {
  full: SerializedGeometry;
  cutVC: SerializedGeometry;
  /** OPTIONAL GPU-instancing payload (versioned/optional — old consumers
   *  ignore it and render `full`/`cutVC` as a single mesh). When present,
   *  `full`/`cutVC` are the CANONICAL CHILD mesh (serialized ONCE) and
   *  `instanced.instances` is the list of N rigid 4×4 transforms (each a
   *  16-float column-major array, THREE.Matrix4 order). The renderer draws a
   *  THREE.InstancedMesh of the child under each matrix. */
  instanced?: {
    instances: number[][];
    count: number;
  };
}

function serializeGeometry(geo: THREE.BufferGeometry): SerializedGeometry {
  const pos = geo.getAttribute('position');
  // Empty BufferGeometry has no position attribute — finalizeManifold uses
  // this for the auto-skipped cutaway (big repeated structures). Serialize
  // as an empty positions array so the consumer can render nothing safely.
  if (!pos) return { positions: [] };
  const out: SerializedGeometry = {
    positions: Array.from(pos.array as ArrayLike<number>),
  };
  const nrm = geo.getAttribute('normal');
  if (nrm) out.normals = Array.from(nrm.array as ArrayLike<number>);
  const col = geo.getAttribute('color');
  if (col) out.colors = Array.from(col.array as ArrayLike<number>);
  if (geo.index) out.index = Array.from(geo.index.array as ArrayLike<number>);
  return out;
}

function deserializeGeometry(s: SerializedGeometry): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute(
    'position',
    new THREE.BufferAttribute(new Float32Array(s.positions), 3),
  );
  if (s.normals) {
    geo.setAttribute(
      'normal',
      new THREE.BufferAttribute(new Float32Array(s.normals), 3),
    );
  }
  if (s.colors) {
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(s.colors), 3),
    );
  }
  if (s.index) {
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(s.index), 1));
  }
  if (!s.normals) geo.computeVertexNormals();
  return geo;
}

export function serializeComponentResult(r: {
  full: THREE.BufferGeometry;
  cutVC: THREE.BufferGeometry;
  /** When present (instancing applied), full/cutVC are the canonical child
   *  and these are the N per-copy 16-float column-major transforms. */
  instances?: number[][];
}): SerializedComponentResult {
  const out: SerializedComponentResult = {
    full: serializeGeometry(r.full),
    cutVC: serializeGeometry(r.cutVC),
  };
  if (r.instances && r.instances.length > 0) {
    out.instanced = { instances: r.instances, count: r.instances.length };
  }
  return out;
}

export function deserializeComponentResult(s: SerializedComponentResult): {
  full: THREE.BufferGeometry;
  cutVC: THREE.BufferGeometry;
  instanced?: { instances: number[][]; count: number };
} {
  const out: {
    full: THREE.BufferGeometry;
    cutVC: THREE.BufferGeometry;
    instanced?: { instances: number[][]; count: number };
  } = {
    full: deserializeGeometry(s.full),
    cutVC: deserializeGeometry(s.cutVC),
  };
  if (s.instanced && Array.isArray(s.instanced.instances) && s.instanced.instances.length > 0) {
    out.instanced = { instances: s.instanced.instances, count: s.instanced.count };
  }
  return out;
}
