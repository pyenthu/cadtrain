<script lang="ts">
  /*
    TensionScene — Threlte scene rendered inside the tension viewer.

    Loads the primitive's GLB, repaints every vertex with the supplied
    von-Mises color, then scales the mesh along Z by `zStretch`
    (= 1 + ε·amplificationScale). Mirrors the camera/light defaults of
    `$lib/shared/ComponentSceneGlb.svelte` so the framing matches the
    rest of the app (Z-down, +Y camera).

    Why a sibling component instead of reusing ComponentSceneGlb?
      - we need to bake the σ_vm color into the vertex color attribute
        (the shared component wires up the warp shader + draws hardcoded
        materials; doing both would mean piping a color prop through it
        and adding edge cases).
      - we want z-stretch on the OBJECT3D ITSELF (sceneGlb hangs off
        scene.zScale which is a global UI control; the tension viewer
        controls deformation locally).
  */
  import { T } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
  import * as THREE from 'three';

  let {
    url = null,
    zStretch = 1,
    color = { r: 0.13, g: 0.67, b: 0.27 },     // default green
  }: {
    url?: string | null;
    zStretch?: number;
    color?: { r: number; g: number; b: number };
  } = $props();

  let loaded = $state<THREE.Object3D | null>(null);
  let loadError = $state<string | null>(null);

  // Apply per-vertex stress color to every mesh under the loaded root.
  // We replace any baked vertex colors (the bake might set a part-color
  // LUT from `analyzeParts` — for the tension test we want uniform
  // stress color, so wipe it). The material has `vertexColors: true`
  // so the shader pulls from the attribute we just wrote.
  function dressGltfScene(root: THREE.Object3D, c: { r: number; g: number; b: number }) {
    root.traverse((obj: any) => {
      if (!obj.isMesh) return;
      if (obj.material && (obj.material as any).dispose) (obj.material as any).dispose();
      const g = obj.geometry as THREE.BufferGeometry;
      if (g.attributes.normal) g.deleteAttribute('normal');
      // Build / overwrite the per-vertex color attribute (R, G, B floats).
      const nVerts = g.attributes.position.count;
      const colorArr = new Float32Array(nVerts * 3);
      for (let i = 0; i < nVerts; i++) {
        colorArr[i * 3 + 0] = c.r;
        colorArr[i * 3 + 1] = c.g;
        colorArr[i * 3 + 2] = c.b;
      }
      g.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
      obj.material = new THREE.MeshPhongMaterial({
        color: '#ffffff',
        vertexColors: true,
        specular: '#666666',
        shininess: 120,
        flatShading: true,
        side: THREE.DoubleSide,
      });
    });
  }

  // Re-paint when color changes (no need to re-load GLB).
  function repaint(root: THREE.Object3D | null, c: { r: number; g: number; b: number }) {
    if (!root) return;
    root.traverse((obj: any) => {
      if (!obj.isMesh) return;
      const g = obj.geometry as THREE.BufferGeometry;
      const ca = g.attributes.color as THREE.BufferAttribute | undefined;
      if (!ca) return;
      const n = ca.count;
      for (let i = 0; i < n; i++) {
        ca.setXYZ(i, c.r, c.g, c.b);
      }
      ca.needsUpdate = true;
    });
  }

  $effect(() => {
    const myUrl = url;
    if (!myUrl) { loaded = null; loadError = null; return; }
    loadError = null;
    const loader = new GLTFLoader();
    loader.load(
      myUrl,
      (gltf) => {
        if (myUrl !== url) return;
        dressGltfScene(gltf.scene, color);
        loaded = gltf.scene;
      },
      undefined,
      (err: any) => {
        if (myUrl !== url) return;
        loadError = err?.message ?? String(err);
      },
    );
  });

  // Repaint when σ color changes; no GLB reload.
  $effect(() => { repaint(loaded, color); });

  // Camera defaults — same convention as ComponentSceneGlb / ComponentScene.
  // Camera on +Y looking at origin; UP = -Z (Z-down drilling convention,
  // so a tall shaft stays vertical on screen, top at viewer top).
  const DEFAULT_UP: [number, number, number] = [0, 0, -1];
  const DEFAULT_FOV = 45;
  // Frame the typical 30" shaft at ~40 units back along +Y.
  let cameraPosition: [number, number, number] = [0, 60, 0];

  const AX_LEN = 3;
  const AX_R   = 0.08;
</script>

<T.PerspectiveCamera makeDefault position={cameraPosition} fov={DEFAULT_FOV} up={DEFAULT_UP}>
  <OrbitControls enableDamping enableZoom enableRotate enablePan target={[0, 0, 15]} />
</T.PerspectiveCamera>

<T.Color args={['#1a1a1a']} attach="background" />
<T.AmbientLight intensity={0.4} />
<T.PointLight position={[30, 30, 30]} intensity={0.8} distance={200} />
<T.PointLight position={[-30, -30, -30]} intensity={0.4} distance={200} />

<!-- Thick axes helper (red X, green Y, blue Z). MeshBasicMaterial so
     the axes stay flat / unaffected by lights. Smaller than the model. -->
<T.Mesh position={[AX_LEN / 2, 0, 0]} rotation={[0, 0, -Math.PI / 2]}>
  <T.CylinderGeometry args={[AX_R, AX_R, AX_LEN, 16]} />
  <T.MeshBasicMaterial color="#ff3030" />
</T.Mesh>
<T.Mesh position={[0, AX_LEN / 2, 0]}>
  <T.CylinderGeometry args={[AX_R, AX_R, AX_LEN, 16]} />
  <T.MeshBasicMaterial color="#30c030" />
</T.Mesh>
<T.Mesh position={[0, 0, AX_LEN / 2]} rotation={[Math.PI / 2, 0, 0]}>
  <T.CylinderGeometry args={[AX_R, AX_R, AX_LEN, 16]} />
  <T.MeshBasicMaterial color="#3060ff" />
</T.Mesh>

<!-- Force arrows: thick red arrows at top (z=0) and bottom (z=L) of the
     part pulling AWAY in opposite directions. They scale a tiny bit with
     F so the visual matches the slider, but stay clamped so they don't
     drown out the part. Approximation: anchor at the GLB bounds isn't
     trivial without measuring; we anchor at z=0 + z=20 instead, both
     pointing along the part's local +z / -z. The visual is symbolic. -->

{#if loaded}
  <!-- Apply z-stretch by scaling the loaded Object3D along Z. This is
       the cheapest possible "show me the deformation" — the engine
       already returned ε * length; we let the user crank the amplifier. -->
  <T is={loaded} scale.z={zStretch} />
{/if}
