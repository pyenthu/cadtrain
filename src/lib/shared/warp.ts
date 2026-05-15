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

/** Edge-split tessellation. For each triangle whose z-extent exceeds
 *  maxZSpan, split the LONGEST edge in half — yields 2 sub-triangles,
 *  not 4. That's O(log) splits per triangle for a given threshold and
 *  keeps the vertex count from exploding (a tall side-wall triangle
 *  on a 256-segment cylinder produced ~1024× the original count with
 *  midpoint-quadrant splitting, which silently overwhelmed three.js).
 *  Adds normals so MeshPhongMaterial actually shades correctly.
 *  Cached by source geometry. */
const subdivCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
export function subdivideAlongZ(geo: THREE.BufferGeometry, maxZSpan = 0.25): THREE.BufferGeometry {
  const hit = subdivCache.get(geo);
  if (hit) return hit;
  const src = geo.index ? geo.toNonIndexed() : geo;
  const posAttr = src.getAttribute('position') as THREE.BufferAttribute;
  const colAttr = src.getAttribute('color') as THREE.BufferAttribute | undefined;
  // Read via the attribute API to handle interleaved buffers safely —
  // GLTFLoader packs POSITION + COLOR into one InterleavedBuffer, so
  // .array.length is the full interleaved view, not just one attribute.
  const vc = posAttr.count;
  let positions: number[] = new Array(vc * 3);
  for (let v = 0; v < vc; v++) {
    positions[v * 3]     = posAttr.getX(v);
    positions[v * 3 + 1] = posAttr.getY(v);
    positions[v * 3 + 2] = posAttr.getZ(v);
  }
  let colors: number[] | undefined;
  if (colAttr) {
    colors = new Array(vc * 3);
    for (let v = 0; v < vc; v++) {
      colors[v * 3]     = colAttr.getX(v);
      colors[v * 3 + 1] = colAttr.getY(v);
      colors[v * 3 + 2] = colAttr.getZ(v);
    }
  }
  const MAX_VERTS = 600_000;
  for (let iter = 0; iter < 10; iter++) {
    let changed = false;
    const np: number[] = [];
    const nc: number[] | undefined = colors ? [] : undefined;
    for (let i = 0; i < positions.length; i += 9) {
      const ax = positions[i],     ay = positions[i + 1], az = positions[i + 2];
      const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
      const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
      const ext = Math.max(az, bz, cz) - Math.min(az, bz, cz);
      if (ext > maxZSpan) {
        // Pick the edge with the largest z-delta — that's the one
        // worth halving so the warp shader gets a new z-sample.
        const dab = Math.abs(bz - az);
        const dbc = Math.abs(cz - bz);
        const dca = Math.abs(az - cz);
        let p1x, p1y, p1z, p2x, p2y, p2z, p3x, p3y, p3z;
        let q1x, q1y, q1z, q2x, q2y, q2z, q3x, q3y, q3z;
        if (dab >= dbc && dab >= dca) {
          // Split edge ab. Two triangles: (a, mab, c) and (mab, b, c).
          const mx = (ax + bx) / 2, my = (ay + by) / 2, mz = (az + bz) / 2;
          p1x = ax; p1y = ay; p1z = az; p2x = mx; p2y = my; p2z = mz; p3x = cx; p3y = cy; p3z = cz;
          q1x = mx; q1y = my; q1z = mz; q2x = bx; q2y = by; q2z = bz; q3x = cx; q3y = cy; q3z = cz;
        } else if (dbc >= dca) {
          const mx = (bx + cx) / 2, my = (by + cy) / 2, mz = (bz + cz) / 2;
          p1x = ax; p1y = ay; p1z = az; p2x = bx; p2y = by; p2z = bz; p3x = mx; p3y = my; p3z = mz;
          q1x = ax; q1y = ay; q1z = az; q2x = mx; q2y = my; q2z = mz; q3x = cx; q3y = cy; q3z = cz;
        } else {
          const mx = (cx + ax) / 2, my = (cy + ay) / 2, mz = (cz + az) / 2;
          p1x = ax; p1y = ay; p1z = az; p2x = bx; p2y = by; p2z = bz; p3x = mx; p3y = my; p3z = mz;
          q1x = mx; q1y = my; q1z = mz; q2x = bx; q2y = by; q2z = bz; q3x = cx; q3y = cy; q3z = cz;
        }
        np.push(
          p1x, p1y, p1z, p2x, p2y, p2z, p3x, p3y, p3z,
          q1x, q1y, q1z, q2x, q2y, q2z, q3x, q3y, q3z,
        );
        if (nc) {
          const r = colors![i], g = colors![i + 1], b = colors![i + 2];
          for (let k = 0; k < 6; k++) nc.push(r, g, b);
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
    if (positions.length / 3 > MAX_VERTS) break; // safety bound
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3));
  if (colors) out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(colors), 3));
  // Phong shading without normals renders as black on most drivers —
  // this was the regression that made the warp "stop working".
  out.computeVertexNormals();
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
