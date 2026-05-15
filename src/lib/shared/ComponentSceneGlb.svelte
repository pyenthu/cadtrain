<script lang="ts">
  import { T } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
  import * as THREE from 'three';
  import { scene } from '$lib/shared/scene-state.svelte';

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

  // The bake writes ONLY positions to the GLB (see manifold-bake.ts) —
  // no normals, no colors, no material. Override every mesh with the
  // project's red MeshPhongMaterial.
  //
  // `flatShading: true` is critical: ManifoldCAD outputs a faceted mesh
  // (hard edges between triangles), and `computeVertexNormals()` would
  // smear them by averaging — producing the streaky highlights + blurred
  // edges the user observed. Flat shading derives one normal per face
  // in the fragment shader, which both removes the need to compute /
  // store normals AND gives proper faceted look on a primitive that's
  // already tessellated for it.
  //
  // Specular shininess is dialled WAY down vs the live Render tab (300)
  // because flat shading + a strong specular highlight on a bare-position
  // mesh produces giant white blotches across each face. The live render
  // gets away with shininess=300 because it has proper smoothed-then-cut
  // normals from finalizeManifold; the GLB doesn't.
  function dressGltfScene(root: THREE.Object3D) {
    root.traverse((obj: any) => {
      if (!obj.isMesh) return;
      // Dispose the auto-created default material to avoid the leak.
      if (obj.material && (obj.material as any).dispose) (obj.material as any).dispose();
      // Discard any auto-computed smooth normals — flat shading derives
      // per-face normals from positions, which is what we want.
      const g = obj.geometry as THREE.BufferGeometry;
      if (g.attributes.normal) g.deleteAttribute('normal');
      obj.material = new THREE.MeshPhongMaterial({
        color: '#cc2222',
        specular: '#222222',
        shininess: 30,
        flatShading: true,
        side: THREE.DoubleSide,
      });
    });
  }

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
  <T is={loaded} />
{/if}
