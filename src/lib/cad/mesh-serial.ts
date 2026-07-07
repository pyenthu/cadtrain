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
import type { PartAppearance } from '$lib/shared/part-appearance';

export interface SerializedGeometry {
  positions: number[];
  normals?: number[];
  colors?: number[];
  index?: number[];
}

export interface SerializedPartMesh {
  geo: SerializedGeometry;
  appearance?: PartAppearance;
  id?: string;
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
  /** Per-part meshes (Manifold composites + TF parity). Optional — old cache
   *  entries omit these and the scene falls back to merged `full`. */
  parts?: SerializedPartMesh[];
  cutParts?: SerializedPartMesh[];
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
    // #61 stage C — colour is 3 (RGB) or 4 (RGBA, per-subpart alpha) components.
    // Infer the stride from the vertex count so the alpha channel survives the
    // round-trip (THREE reads it as USE_COLOR_ALPHA when the material is
    // transparent). Falls back to 3 when positions are absent/empty.
    const nv = s.positions.length / 3;
    const comps = nv > 0 && s.colors.length % nv === 0 ? s.colors.length / nv : 3;
    geo.setAttribute(
      'color',
      new THREE.BufferAttribute(new Float32Array(s.colors), comps === 4 ? 4 : 3),
    );
  }
  if (s.index) {
    geo.setIndex(new THREE.BufferAttribute(new Uint32Array(s.index), 1));
  }
  if (!s.normals) geo.computeVertexNormals();
  return geo;
}

function serializePartMeshes(parts?: { geo: THREE.BufferGeometry; appearance?: PartAppearance; id?: string }[]): SerializedPartMesh[] | undefined {
  if (!parts || parts.length === 0) return undefined;
  return parts.map((p) => ({
    geo: serializeGeometry(p.geo),
    ...(p.appearance ? { appearance: p.appearance } : {}),
    ...(p.id ? { id: p.id } : {}),
  }));
}

function deserializePartMeshes(parts?: SerializedPartMesh[]): { geo: THREE.BufferGeometry; appearance?: PartAppearance; id?: string }[] | undefined {
  if (!parts || parts.length === 0) return undefined;
  return parts.map((p) => ({
    geo: deserializeGeometry(p.geo),
    ...(p.appearance ? { appearance: p.appearance } : {}),
    ...(p.id ? { id: p.id } : {}),
  }));
}

export function serializeComponentResult(r: {
  full: THREE.BufferGeometry;
  cutVC: THREE.BufferGeometry;
  /** When present (instancing applied), full/cutVC are the canonical child
   *  and these are the N per-copy 16-float column-major transforms. */
  instances?: number[][];
  parts?: { geo: THREE.BufferGeometry; appearance?: PartAppearance; id?: string }[];
  cutParts?: { geo: THREE.BufferGeometry; appearance?: PartAppearance; id?: string }[];
}): SerializedComponentResult {
  const out: SerializedComponentResult = {
    full: serializeGeometry(r.full),
    cutVC: serializeGeometry(r.cutVC),
  };
  if (r.instances && r.instances.length > 0) {
    out.instanced = { instances: r.instances, count: r.instances.length };
  }
  const parts = serializePartMeshes(r.parts);
  const cutParts = serializePartMeshes(r.cutParts);
  if (parts) out.parts = parts;
  if (cutParts) out.cutParts = cutParts;
  return out;
}

export function deserializeComponentResult(s: SerializedComponentResult): {
  full: THREE.BufferGeometry;
  cutVC: THREE.BufferGeometry;
  instanced?: { instances: number[][]; count: number };
  parts?: { geo: THREE.BufferGeometry; appearance?: PartAppearance; id?: string }[];
  cutParts?: { geo: THREE.BufferGeometry; appearance?: PartAppearance; id?: string }[];
} {
  const out: {
    full: THREE.BufferGeometry;
    cutVC: THREE.BufferGeometry;
    instanced?: { instances: number[][]; count: number };
    parts?: { geo: THREE.BufferGeometry; appearance?: PartAppearance; id?: string }[];
    cutParts?: { geo: THREE.BufferGeometry; appearance?: PartAppearance; id?: string }[];
  } = {
    full: deserializeGeometry(s.full),
    cutVC: deserializeGeometry(s.cutVC),
  };
  if (s.instanced && Array.isArray(s.instanced.instances) && s.instanced.instances.length > 0) {
    out.instanced = { instances: s.instanced.instances, count: s.instanced.count };
  }
  const parts = deserializePartMeshes(s.parts);
  const cutParts = deserializePartMeshes(s.cutParts);
  if (parts) out.parts = parts;
  if (cutParts) out.cutParts = cutParts;
  return out;
}
