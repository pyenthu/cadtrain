// TEMP warp experiment — entire file slated for removal.
//
// Stamps an onBeforeCompile hook on a MeshPhongMaterial that injects a
// sinusoidal Z-axis displacement into the vertex shader. Driven by the
// three `warp*` fields on the shared scene state — multiple attached
// materials share the same uniform values, so the gear-popup sliders
// move all of them in sync.
//
// Normals aren't recomputed for the warped position (cheap, but lighting
// reads "as if unwarped"). Acceptable for a temporary visual demo.

import * as THREE from 'three';
import { scene } from './scene-state.svelte';

/** Iteratively split every triangle whose z-extent exceeds `maxZSpan`
 *  into 4 sub-triangles (midpoint split). The warp shader displaces
 *  vertices, so without enough z-samples a tall cylinder's side wall
 *  (2 z-levels) just tilts linearly instead of curving — this gives
 *  the shader real intermediate vertices to bend through.
 *
 *  Cached by source geometry uuid to avoid re-paying the cost. Result
 *  is non-indexed so per-face colours survive. */
const subdivCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
export function subdivideAlongZ(geo: THREE.BufferGeometry, maxZSpan = 0.2): THREE.BufferGeometry {
  const hit = subdivCache.get(geo);
  if (hit) return hit;
  const src = geo.index ? geo.toNonIndexed() : geo;
  const posAttr = src.getAttribute('position') as THREE.BufferAttribute;
  const colAttr = src.getAttribute('color') as THREE.BufferAttribute | undefined;
  let positions: number[] = Array.from(posAttr.array);
  let colors: number[] | undefined = colAttr ? Array.from(colAttr.array) : undefined;
  for (let iter = 0; iter < 6; iter++) {
    let changed = false;
    const np: number[] = [];
    const nc: number[] | undefined = colors ? [] : undefined;
    for (let i = 0; i < positions.length; i += 9) {
      const az = positions[i + 2], bz = positions[i + 5], cz = positions[i + 8];
      const ext = Math.max(az, bz, cz) - Math.min(az, bz, cz);
      if (ext > maxZSpan) {
        const ax = positions[i],     ay = positions[i + 1];
        const bx = positions[i + 3], by = positions[i + 4];
        const cx = positions[i + 6], cy = positions[i + 7];
        const mabx = (ax + bx) / 2, maby = (ay + by) / 2, mabz = (az + bz) / 2;
        const mbcx = (bx + cx) / 2, mbcy = (by + cy) / 2, mbcz = (bz + cz) / 2;
        const macx = (ax + cx) / 2, macy = (ay + cy) / 2, macz = (az + cz) / 2;
        np.push(
          ax,  ay,  az,  mabx, maby, mabz, macx, macy, macz,
          mabx, maby, mabz, bx,  by,  bz,  mbcx, mbcy, mbcz,
          macx, macy, macz, mbcx, mbcy, mbcz, cx,  cy,  cz,
          mabx, maby, mabz, mbcx, mbcy, mbcz, macx, macy, macz,
        );
        if (nc) {
          const r = colors![i], g = colors![i + 1], b = colors![i + 2];
          for (let k = 0; k < 12; k++) nc.push(r, g, b);
        }
        changed = true;
      } else {
        for (let k = 0; k < 9; k++) np.push(positions[i + k]);
        if (nc) for (let k = 0; k < 9; k++) nc.push(colors![i + k]);
      }
    }
    positions = np;
    colors = nc;
    if (!changed) break;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (colors) out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  subdivCache.set(geo, out);
  return out;
}

// Track every shader we've patched so the slider $effect below can
// rewrite uniforms on each one when scene.warp* changes.
const patchedShaders = new Set<any>();

export function attachWarpShader(material: THREE.MeshPhongMaterial): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWarpAmp  = { value: scene.warpAmp };
    shader.uniforms.uWarpFreq = { value: scene.warpFreq };
    // Axis encoded as 0 = x, 1 = y; the shader picks the displacement
    // component via a mix() so we don't branch per-vertex.
    shader.uniforms.uWarpAxis = { value: scene.warpAxis === 'y' ? 1 : 0 };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uWarpAmp;
         uniform float uWarpFreq;
         uniform float uWarpAxis;`,
      )
      .replace(
        '#include <project_vertex>',
        `float warpDisp = uWarpAmp * sin(transformed.z * uWarpFreq);
         transformed.x += warpDisp * (1.0 - uWarpAxis);
         transformed.y += warpDisp * uWarpAxis;
         #include <project_vertex>`,
      );
    patchedShaders.add(shader);
  };
  // Future material edits should re-compile — onBeforeCompile only
  // fires on the first program build otherwise.
  material.needsUpdate = true;
}

// Drive every attached shader's uniforms from the shared scene state.
// Runs once at module load — Svelte tracks the reads via the $effect
// system, but since this is a plain .ts file we use a manual subscription
// pattern: poll the shader uniforms on the THREE render loop. Actually
// simpler — write a tiny rAF loop that copies values; cheap and
// correct, and naturally tears down when the page unloads.
if (typeof window !== 'undefined') {
  const tick = () => {
    const axis = scene.warpAxis === 'y' ? 1 : 0;
    for (const shader of patchedShaders) {
      if (shader.uniforms.uWarpAmp)  shader.uniforms.uWarpAmp.value  = scene.warpAmp;
      if (shader.uniforms.uWarpFreq) shader.uniforms.uWarpFreq.value = scene.warpFreq;
      if (shader.uniforms.uWarpAxis) shader.uniforms.uWarpAxis.value = axis;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}
