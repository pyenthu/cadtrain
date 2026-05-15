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

import type * as THREE from 'three';
import { scene } from './scene-state.svelte';

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
