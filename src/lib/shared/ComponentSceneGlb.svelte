<script lang="ts">
  import { T } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
  import * as THREE from 'three';
  import { scene } from '$lib/shared/scene-state.svelte';
  // TEMP warp experiment — remove with scene.warp* + warp.ts
  import { attachWarpShader, subdivideAlongZ } from '$lib/shared/warp';

  // Mirrors ComponentScene.svelte's camera / light / axis chrome, but the
  // rendered body is a static GLB loaded from a URL. Used by the /primitives
  // stage's GLB sub-tab — visualizes the baked mesh that bakeGlb() writes
  // to static/components/<id>.glb on save, NOT the live ManifoldCAD geom.
  // Useful for confirming the GLB on disk matches the live render, and for
  // demos that should be driven off the baked artifact.
  let { url = null }: { url?: string | null } = $props();

  let loaded = $state<THREE.Object3D | null>(null);
  let loadError = $state<string | null>(null);
  let loading = $state(false);

  // GLTFLoader applies a default material; we override every mesh with
  // a flat-shaded MeshPhongMaterial so the GLB visually matches the
  // live Render tab.
  //
  // - `flatShading: true` derives one normal per face in the shader —
  //   matches the faceted look of ManifoldCAD output and avoids the
  //   streaky highlights smooth normals produce on hard edges.
  // - If the GLB carries vertex colors (the post-2026-05-15 bake encodes
  //   the red-outer / grey-bore classification from manifoldToCutVC into
  //   COLOR_0), we set vertexColors: true and leave the material colour
  //   white so the per-vertex values pass through unchanged. Older
  //   colourless bakes fall through to the plain project red.
  function dressGltfScene(root: THREE.Object3D) {
    root.traverse((obj: any) => {
      if (!obj.isMesh) return;
      if (obj.material && (obj.material as any).dispose) (obj.material as any).dispose();
      const g = obj.geometry as THREE.BufferGeometry;
      if (g.attributes.normal) g.deleteAttribute('normal');
      const hasColor = !!g.attributes.color;
      obj.material = new THREE.MeshPhongMaterial({
        color: hasColor ? '#ffffff' : '#cc2222',
        vertexColors: hasColor,
        specular: '#666666',
        shininess: 120,
        flatShading: true,
        side: THREE.DoubleSide,
      });
      // TEMP warp experiment — pre-subdivide so the shader has enough
      // z-samples to bend the mesh. Stash both original + subdivided so
      // the warp-toggle effect can swap without re-loading the GLB.
      attachWarpShader(obj.material);
      obj.userData.warpOriginalGeo = g;
      obj.userData.warpSubdividedGeo = subdivideAlongZ(g);
    });
  }

  // TEMP warp experiment — swap mesh.geometry to the subdivided variant
  // when warp turns on, back to the original when it turns off.
  $effect(() => {
    const active = scene.warpAmp > 0;
    if (!loaded) return;
    loaded.traverse((obj: any) => {
      if (!obj.isMesh || !obj.userData.warpOriginalGeo) return;
      obj.geometry = active ? obj.userData.warpSubdividedGeo : obj.userData.warpOriginalGeo;
    });
  });

  // Reload on every URL change. Aborts in-flight loads by ignoring stale
  // resolves via the captured `myUrl` token. If the .cut.glb variant 404s
  // (e.g., older component baked before cut-GLB landed), fall back to the
  // full .glb so the user still gets *something* when cutaway is toggled
  // on — the alternative is an unsightly error chip.
  $effect(() => {
    const myUrl = url;
    if (!myUrl) { loaded = null; loadError = null; loading = false; return; }
    loading = true;
    loadError = null;
    const loader = new GLTFLoader();
    const tryLoad = (u: string, allowFallback: boolean) => {
      loader.load(
        u,
        (gltf) => {
          if (myUrl !== url) return;
          dressGltfScene(gltf.scene);
          loaded = gltf.scene;
          loading = false;
        },
        undefined,
        (err: any) => {
          if (myUrl !== url) return;
          if (allowFallback && u.endsWith('.cut.glb')) {
            tryLoad(u.replace(/\.cut\.glb$/, '.glb'), false);
            return;
          }
          loadError = err?.message ?? String(err);
          loading = false;
        },
      );
    };
    tryLoad(myUrl, true);
  });

  // Same defaults as ComponentScene: perspective on +Y, up = -Z (Z-down).
  const DEFAULT_UP: [number, number, number] = [0, 0, -1];
  const DEFAULT_FOV = 45;
  let cameraPosition = $derived<[number, number, number]>([scene.cam.x, scene.cam.y, scene.cam.z]);
  let light1Pos = $derived<[number, number, number]>([scene.l1.x, scene.l1.y, scene.l1.z]);
  let light2Pos = $derived<[number, number, number]>([scene.l2.x, scene.l2.y, scene.l2.z]);

  let controls = $state<any>(null);
  $effect(() => {
    if (!controls) return;
    const onChange = () => {
      const cam = controls.object;
      if (!cam) return;
      if (scene.cam.x !== cam.position.x) scene.cam.x = cam.position.x;
      if (scene.cam.y !== cam.position.y) scene.cam.y = cam.position.y;
      if (scene.cam.z !== cam.position.z) scene.cam.z = cam.position.z;
    };
    controls.addEventListener('change', onChange);
    return () => controls.removeEventListener('change', onChange);
  });

  const AX_LEN = 3;
  const AX_R   = 0.08;
</script>

<T.PerspectiveCamera makeDefault position={cameraPosition} fov={DEFAULT_FOV} up={DEFAULT_UP}>
  <OrbitControls bind:ref={controls} enableDamping enableZoom enableRotate enablePan />
</T.PerspectiveCamera>

<T.Color args={['#ffffff']} attach="background" />
<T.AmbientLight intensity={0.3} />
<T.PointLight position={light1Pos} intensity={scene.l1.i} distance={50} />
<T.PointLight position={light2Pos} intensity={scene.l2.i} distance={50} />

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

{#if loaded}
  <!-- Apply the shared Z-scale to the loaded GLB at render time.
       The live Render rebuilds geometry with setRenderZScale baked in;
       a static GLB can't do that, so we mirror the same compression
       visually by scaling the loaded Object3D along Z. The Z-down
       convention means this still squashes the well-axis length. -->
  <T is={loaded} scale.z={scene.zScale} />
{/if}
