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

/** One serialized per-source-part mesh + its appearance (#1 unify-transparency).
 *  Mirrors `RenderPart` in render-helpers.ts / TF's `{ data, appearance }`. */
export interface SerializedRenderPart {
  geo: SerializedGeometry;
  appearance: {
    colorOuter?: string;
    colorInner?: string;
    opacity?: number;
    material?: string;
    texture?: string;
  };
}

export interface SerializedComponentResult {
  full: SerializedGeometry;
  cutVC: SerializedGeometry;
  /** OPTIONAL per-source-part meshes — present ONLY for an appearance-bearing
   *  (transparent-subpart) composite (see render-helpers `buildSourceParts`).
   *  Old consumers ignore it and render `full` as a single mesh; the scene
   *  prefers `parts` when present. */
  parts?: SerializedRenderPart[];
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

export function serializeComponentResult(r: {
  full: THREE.BufferGeometry;
  cutVC: THREE.BufferGeometry;
  /** Per-source-part meshes (#1 unify-transparency) — appearance-bearing
   *  composites only; absent otherwise. */
  parts?: { geo: THREE.BufferGeometry; appearance: SerializedRenderPart['appearance'] }[];
  /** When present (instancing applied), full/cutVC are the canonical child
   *  and these are the N per-copy 16-float column-major transforms. */
  instances?: number[][];
}): SerializedComponentResult {
  const out: SerializedComponentResult = {
    full: serializeGeometry(r.full),
    cutVC: serializeGeometry(r.cutVC),
  };
  if (r.parts && r.parts.length > 0) {
    out.parts = r.parts.map((p) => ({ geo: serializeGeometry(p.geo), appearance: p.appearance }));
  }
  if (r.instances && r.instances.length > 0) {
    out.instanced = { instances: r.instances, count: r.instances.length };
  }
  return out;
}

export function deserializeComponentResult(s: SerializedComponentResult): {
  full: THREE.BufferGeometry;
  cutVC: THREE.BufferGeometry;
  parts?: { geo: THREE.BufferGeometry; appearance: SerializedRenderPart['appearance'] }[];
  instanced?: { instances: number[][]; count: number };
} {
  const out: {
    full: THREE.BufferGeometry;
    cutVC: THREE.BufferGeometry;
    parts?: { geo: THREE.BufferGeometry; appearance: SerializedRenderPart['appearance'] }[];
    instanced?: { instances: number[][]; count: number };
  } = {
    full: deserializeGeometry(s.full),
    cutVC: deserializeGeometry(s.cutVC),
  };
  if (s.parts && Array.isArray(s.parts) && s.parts.length > 0) {
    out.parts = s.parts.map((p) => ({ geo: deserializeGeometry(p.geo), appearance: p.appearance }));
  }
  if (s.instanced && Array.isArray(s.instanced.instances) && s.instanced.instances.length > 0) {
    out.instanced = { instances: s.instanced.instances, count: s.instanced.count };
  }
  return out;
}
