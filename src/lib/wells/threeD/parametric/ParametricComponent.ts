/**
 * Parametric tool-comp library interface (PORTED from SVTC
 * `src/lib/apps/wson/threeD/parametric/ParametricComponent.ts`).
 *
 * Each parametric builder is a pure function from named parameters to a
 * watertight `manifold-3d` Manifold (built with primitives like
 * `Manifold.cylinder` so manifold-validity is guaranteed by construction — see
 * `../manifoldCut.ts` for why we never start from THREE meshes).
 *
 * This is the INTERFACE cadtrain's future `g_*` volume parts will implement to
 * plug into the well schematic (registry `./index.ts`). Phase-1 ships a single
 * concrete builder (Baker permanent packer) as the worked example; the shape is
 * general so adding tubing-joint upsets, R-landing nipples, mule-shoes etc. is
 * a one-file-per-builder addition.
 */
import * as THREE from 'three';

/** A typed parameter spec used by builders to advertise their inputs. The
 *  eventual UI consumes this to render a properties inspector. */
export interface ParamSpec {
  /** Stable key — used when persisting customised values back onto a
   *  `wson.completions[i].params` object. */
  key: string;
  /** Human-readable label (no HTML). */
  label: string;
  /** Inclusive range; `step` controls slider granularity. Units are the
   *  engineering unit appropriate to the dimension (inches for diameters). */
  min: number;
  max: number;
  step: number;
  default: number;
  /** Free text for tooltips. */
  description?: string;
}

/** A fully-built component, returned by `build()`. Geometry is in the local
 *  frame: body axis = +Z, centred on origin (a length-L component spans
 *  z ∈ [-L/2, +L/2]). The caller positions + warps it onto the wellbore. */
export interface ParametricResult {
  /** Watertight THREE.BufferGeometry. */
  geometry: THREE.BufferGeometry;
  /** Bounding box in the local frame (used to size the marker auto-scale). */
  bbox: THREE.Box3;
  /** True if the geometry is a manifold solid. */
  isManifold: boolean;
  /** Author notes about the build. */
  notes?: string;
}

/** A parametric builder. */
export interface ParametricComponent {
  /** Stable identifier. Should match the comp catalogue so lookup is
   *  deterministic. */
  id: string;
  /** Human-readable name (used by the inspector UI). */
  name: string;
  /** The `tool_comp` code(s) this builder handles. A code maps to exactly one
   *  builder, but a builder can claim multiple codes. */
  toolCompCodes: string[];
  /** Parameter spec. The inspector renders these in declaration order. */
  params: ParamSpec[];
  /** Build the geometry. `params` carries values for every key in `params[]`;
   *  missing keys fall back to `default`. */
  build: (params: Record<string, number>) => Promise<ParametricResult>;
}

/** Convert a manifold-3d Manifold to a THREE.BufferGeometry. Used by every
 *  builder so they don't repeat the boilerplate. Computes vertex normals;
 *  positions are flat-shaded (no per-triangle vertex colors — see
 *  `../manifoldCut.ts` if you need that for half-section rendering). */
export function manifoldToBufferGeometry(manifold: any): THREE.BufferGeometry {
  const mesh = manifold.getMesh();
  const vp = mesh.vertProperties;
  const tri = mesh.triVerts;
  const np = mesh.numProp;
  const nt = tri.length / 3;
  const out = new Float32Array(nt * 9);
  for (let i = 0; i < nt; i++) {
    const a = tri[i * 3], b = tri[i * 3 + 1], c = tri[i * 3 + 2];
    out[i * 9 + 0] = vp[a * np];     out[i * 9 + 1] = vp[a * np + 1]; out[i * 9 + 2] = vp[a * np + 2];
    out[i * 9 + 3] = vp[b * np];     out[i * 9 + 4] = vp[b * np + 1]; out[i * 9 + 5] = vp[b * np + 2];
    out[i * 9 + 6] = vp[c * np];     out[i * 9 + 7] = vp[c * np + 1]; out[i * 9 + 8] = vp[c * np + 2];
  }
  const geom = new THREE.BufferGeometry();
  geom.setAttribute('position', new THREE.BufferAttribute(out, 3));
  geom.computeVertexNormals();
  geom.computeBoundingBox();
  return geom;
}
