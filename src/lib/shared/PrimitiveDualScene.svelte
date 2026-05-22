<script lang="ts">
  // ONE scene rendering BOTH the live mesh (left) and the baked GLB (right)
  // side-by-side under a single camera / single WebGL context. Replaces the
  // two stacked PrimitiveCanvas + PrimitiveGlbCanvas (was 2 contexts per tab
  // → the WebGL-context leak). Chrome (camera / lights) mirrors ComponentScene.
  import { T } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
  import * as THREE from 'three';
  import { scene } from '$lib/shared/scene-state.svelte';
  // TEMP warp experiment — mirror ComponentScene/ComponentSceneGlb so the
  // warp toggle works in the combined canvas too (was dropped in the rewrite).
  import { attachWarpShader, subdivideAlongZ } from '$lib/shared/warp';

  let {
    geo = null,
    geoVersion = 0,
    glbUrl = null,
    showCutaway = false,
    offset = 4.5,
  }: {
    geo?: any;            // { full, cutVC } from /api/primitives/preview
    geoVersion?: number;
    glbUrl?: string | null; // blob URL of the baked GLB
    showCutaway?: boolean;  // applies to the LIVE-mesh half (GLB half follows its own cut bake)
    offset?: number;        // half-separation along X
  } = $props();

  let full = $derived(geo?.full ?? null);
  let cutVC = $derived(geo?.cutVC ?? null);

  // --- baked GLB (mirrors ComponentSceneGlb.dressGltfScene) ---
  let loaded = $state<THREE.Object3D | null>(null);
  function dressGltfScene(root: THREE.Object3D) {
    root.traverse((obj: any) => {
      if (!obj.isMesh) return;
      if (obj.material?.dispose) obj.material.dispose();
      const g = obj.geometry as THREE.BufferGeometry;
      if (g.attributes.normal) g.deleteAttribute('normal');
      const hasColor = !!g.attributes.color;
      obj.material = new THREE.MeshPhongMaterial({
        color: hasColor ? '#ffffff' : '#cc2222', vertexColors: hasColor,
        specular: '#666666', shininess: 120, flatShading: true, side: THREE.DoubleSide,
      });
      attachWarpShader(obj.material);
      obj.userData.warpOriginalGeo = g;
      obj.userData.warpSubdividedGeo = subdivideAlongZ(g);
    });
  }
  $effect(() => {
    const myUrl = glbUrl;
    if (!myUrl) { loaded = null; return; }
    const loader = new GLTFLoader();
    loader.load(myUrl, (gltf) => { if (myUrl !== glbUrl) return; dressGltfScene(gltf.scene); loaded = gltf.scene; }, undefined, () => {});
  });
  // TEMP warp experiment — swap GLB geometry to the subdivided variant on toggle.
  $effect(() => {
    const active = scene.warpEnabled;
    if (!loaded) return;
    loaded.traverse((obj: any) => {
      if (!obj.isMesh || !obj.userData.warpOriginalGeo) return;
      obj.geometry = active ? obj.userData.warpSubdividedGeo : obj.userData.warpOriginalGeo;
    });
  });

  // --- shared camera / lights (mirror ComponentScene) ---
  const DEFAULT_UP: [number, number, number] = [0, 0, -1];
  let cameraPosition = $derived<[number, number, number]>([scene.cam.x, scene.cam.y, scene.cam.z]);
  let light1Pos = $derived<[number, number, number]>([scene.l1.x, scene.l1.y, scene.l1.z]);
  let light2Pos = $derived<[number, number, number]>([scene.l2.x, scene.l2.y, scene.l2.z]);
  let controls = $state<any>(null);
  $effect(() => {
    if (!controls) return;
    const onChange = () => {
      const cam = controls.object; if (!cam) return;
      if (scene.cam.x !== cam.position.x) scene.cam.x = cam.position.x;
      if (scene.cam.y !== cam.position.y) scene.cam.y = cam.position.y;
      if (scene.cam.z !== cam.position.z) scene.cam.z = cam.position.z;
    };
    controls.addEventListener('change', onChange);
    return () => controls.removeEventListener('change', onChange);
  });

  const AX_LEN = 2.2, AX_R = 0.06;
</script>

<T.PerspectiveCamera makeDefault position={cameraPosition} fov={45} up={DEFAULT_UP}>
  <OrbitControls bind:ref={controls} target={[0, 0, 0]} enableDamping enableZoom enableRotate enablePan />
</T.PerspectiveCamera>

<T.Color args={['#ffffff']} attach="background" />
<T.AmbientLight intensity={0.3} />
<T.PointLight position={light1Pos} intensity={scene.l1.i} distance={50} />
<T.PointLight position={light2Pos} intensity={scene.l2.i} distance={50} />

<!-- LEFT — live mesh (zScale already baked server-side, so no scale.z here) -->
<T.Group position={[-offset, 0, 0]}>
  {#key geoVersion + (showCutaway ? '_cut' : '_full') + (scene.warpEnabled ? '_w' : '')}
    {#if showCutaway && cutVC}
      {@const cg = scene.warpEnabled ? subdivideAlongZ(cutVC) : cutVC}
      <T.Mesh geometry={cg}>
        <T.MeshPhongMaterial vertexColors specular="#666666" shininess={120} flatShading side={THREE.DoubleSide} oncreate={(mat) => attachWarpShader(mat)} />
      </T.Mesh>
    {:else if full}
      {@const hasVC = !!full?.getAttribute?.('color')}
      {@const fg = scene.warpEnabled ? subdivideAlongZ(full) : full}
      <T.Mesh geometry={fg}>
        {#if hasVC}
          <T.MeshPhongMaterial vertexColors specular="#666666" shininess={120} flatShading side={THREE.DoubleSide} oncreate={(mat) => attachWarpShader(mat)} />
        {:else}
          <T.MeshPhongMaterial color="#cc2222" specular="#666666" shininess={120} flatShading side={THREE.DoubleSide} oncreate={(mat) => attachWarpShader(mat)} />
        {/if}
      </T.Mesh>
    {/if}
  {/key}
  <T.Mesh position={[AX_LEN/2,0,0]} rotation={[0,0,-Math.PI/2]}><T.CylinderGeometry args={[AX_R,AX_R,AX_LEN,12]} /><T.MeshBasicMaterial color="#ff3030" /></T.Mesh>
  <T.Mesh position={[0,AX_LEN/2,0]}><T.CylinderGeometry args={[AX_R,AX_R,AX_LEN,12]} /><T.MeshBasicMaterial color="#30c030" /></T.Mesh>
  <T.Mesh position={[0,0,AX_LEN/2]} rotation={[Math.PI/2,0,0]}><T.CylinderGeometry args={[AX_R,AX_R,AX_LEN,12]} /><T.MeshBasicMaterial color="#3060ff" /></T.Mesh>
</T.Group>

<!-- RIGHT — baked GLB (scaled along Z to match the SceneControls zScale, like ComponentSceneGlb) -->
{#if loaded}
  <T.Group position={[offset, 0, 0]} scale.z={scene.zScale}>
    <T is={loaded} />
  </T.Group>
{/if}
