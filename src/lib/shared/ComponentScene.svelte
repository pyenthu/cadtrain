<script lang="ts">
  import { T } from '@threlte/core';
  import { OrbitControls, Edges } from '@threlte/extras';
  import * as THREE from 'three';
  import { scene } from '$lib/shared/scene-state.svelte';
  // TEMP warp experiment — remove with scene.warp* + warp.ts
  import { attachWarpShader, subdivideAlongZ } from '$lib/shared/warp';

  type CameraOverride = {
    position?: [number, number, number];
    up?: [number, number, number];
    zoom?: number;
  } | null;

  let {
    geo = null,
    geoVersion = 0,
    showCutaway = true,
    showEdges = true,
    cameraOverride = null,
  }: {
    /**
     * Either a single ComponentResult `{ full, cutVC, manifold }` (single
     * primitive — used by /archive/components and dedicated tool viewers)
     * OR an AuthoredResult `{ parts: [{ full, cutVC }, ...], ms }` (multi-
     * part assembly — used by /author for Opus-generated library models).
     * Detected at render time via `geo.parts`.
     */
    geo?: any;
    geoVersion?: number;
    showCutaway?: boolean;
    showEdges?: boolean;
    cameraOverride?: CameraOverride;
  } = $props();

  // Normalize to an array of meshes. Single-primitive case wraps into a
  // 1-element array so the template body has one render path.
  let meshes = $derived.by<{ full: any; cutVC: any; key: string }[]>(() => {
    if (!geo) return [];
    if (Array.isArray(geo.parts)) {
      return geo.parts.map((p: any) => ({ full: p.full, cutVC: p.cutVC, key: p.id }));
    }
    if (geo.full || geo.cutVC) {
      return [{ full: geo.full, cutVC: geo.cutVC, key: 'single' }];
    }
    return [];
  });

  // Default camera convention: camera on +Y looking at origin, UP = -Z
  // (Z-down drilling convention — well axis stays vertical on screen).
  // Perspective camera + OrbitControls: rotate to inspect, scroll to
  // dolly in/out. Distance (not an ortho `zoom`) sets apparent size.
  const DEFAULT_UP: [number, number, number] = [0, 0, -1];
  const DEFAULT_FOV = 45;

  let cameraPosition = $derived<[number, number, number]>(
    cameraOverride?.position ?? [scene.cam.x, scene.cam.y, scene.cam.z]
  );
  let cameraUp = $derived(cameraOverride?.up ?? DEFAULT_UP);
  // `zoom` on a PerspectiveCamera is a plain multiplier (default 1) —
  // honoured only when a caller passes an explicit cameraOverride.zoom
  // (the dedicated tool viewers); otherwise OrbitControls dolly handles
  // framing.
  let cameraZoom = $derived(cameraOverride?.zoom ?? 1);

  let light1Pos = $derived<[number, number, number]>([scene.l1.x, scene.l1.y, scene.l1.z]);
  let light2Pos = $derived<[number, number, number]>([scene.l2.x, scene.l2.y, scene.l2.z]);

  // OrbitControls ref + change-event sync. Without this the camera moves
  // visually when the user drags the canvas but the input boxes stay frozen
  // at the typed values — confusing. The conditional writes prevent a
  // ping-pong with the position-derived prop (setting state to a value it
  // already has would still queue a derived recompute on every orbit tick).
  let controls = $state<any>(null);
  $effect(() => {
    if (!controls) return;
    const onChange = () => {
      if (cameraOverride?.position) return;
      const cam = controls.object;
      if (!cam) return;
      if (scene.cam.x !== cam.position.x) scene.cam.x = cam.position.x;
      if (scene.cam.y !== cam.position.y) scene.cam.y = cam.position.y;
      if (scene.cam.z !== cam.position.z) scene.cam.z = cam.position.z;
    };
    controls.addEventListener('change', onChange);
    return () => controls.removeEventListener('change', onChange);
  });

  // Thick axes helper sizing: three cylinders from origin along +X / +Y / +Z.
  // Cylinder default geometry lies along +Y — for X and Z we rotate around Z
  // and X respectively. Length=3, radius=0.08 reads "thick" without dominating
  // the model. Origin sits at one end (shift by length/2 along the axis).
  const AX_LEN = 3;
  const AX_R   = 0.08;
</script>

<T.PerspectiveCamera makeDefault position={cameraPosition} fov={DEFAULT_FOV} zoom={cameraZoom} up={cameraUp}>
  <OrbitControls bind:ref={controls} enableDamping enableZoom enableRotate enablePan />
</T.PerspectiveCamera>

<T.Color args={['#ffffff']} attach="background" />
<T.AmbientLight intensity={0.3} />
<T.PointLight position={light1Pos} intensity={scene.l1.i} distance={50} />
<T.PointLight position={light2Pos} intensity={scene.l2.i} distance={50} />

<!-- Thick axes helper. MeshBasicMaterial so the colours stay flat / unaffected
     by point-light shading (axes shouldn't darken when L1/L2 swing around). -->
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

{#if meshes.length > 0}
  {#key geoVersion + (showCutaway ? '_cut' : '_full')}
    {#each meshes as m (m.key)}
      <!-- TEMP warp experiment: when warp is enabled, swap to a
           z-subdivided geometry so the vertex shader has enough samples
           along Z to actually curve. WeakMap-cached so a single
           subdivision per source geo, regardless of slider drags. -->
      {@const cutGeo  = scene.warpEnabled ? subdivideAlongZ(m.cutVC) : m.cutVC}
      {@const fullGeo = scene.warpEnabled ? subdivideAlongZ(m.full)  : m.full}
      {#if showCutaway}
        <T.Mesh geometry={cutGeo}>
          <T.MeshPhongMaterial
            vertexColors specular="#666666" shininess={120} flatShading side={THREE.DoubleSide}
            oncreate={(mat) => attachWarpShader(mat)}
          />
          <!-- Skip Edges overlay for multi-part assemblies: 10 EdgesGeometry
               passes (one per mesh) tank mobile interaction frame rate. The
               edges look messy on assemblies anyway since each part's outline
               doesn't connect to its neighbour. Kept for single primitives.

               flatShading: true derives one normal per face in the shader
               via dFdx/dFdy on position — matches the GLB Scene's faceted
               look (see ComponentSceneGlb.svelte:dressGltfScene) and avoids
               the dull/uniform appearance that smoothed Manifold-baked
               vertex normals produce on flat-walled primitives (cube +
               sphere-subtract reported flat in NORMAL mode 2026-05-20). -->
          {#if showEdges && meshes.length === 1}<Edges thresholdAngle={20} color="black" />{/if}
        </T.Mesh>
      {:else}
        <!-- Full (non-cutaway) mesh. When the geometry carries a baked
             per-vertex `color` attribute (primitive declared meta.material —
             manifoldToGeo bakes material.outer), render with `vertexColors`
             so the live full pane matches the cutaway pane + the GLB pane.
             When no color attribute is present (the 26 bundle primitives /
             library parts with no material), keep the legacy hardcoded
             red so those renders stay byte-identical. -->
        {@const hasVC = !!fullGeo?.getAttribute?.('color')}
        <T.Mesh geometry={fullGeo}>
          {#if hasVC}
            <T.MeshPhongMaterial
              vertexColors specular="#666666" shininess={120} flatShading side={THREE.DoubleSide}
              oncreate={(mat) => attachWarpShader(mat)}
            />
          {:else}
            <T.MeshPhongMaterial
              color="#cc2222" specular="#666666" shininess={120} flatShading side={THREE.DoubleSide}
              oncreate={(mat) => attachWarpShader(mat)}
            />
          {/if}
          {#if showEdges && meshes.length === 1}<Edges thresholdAngle={20} color="black" />{/if}
        </T.Mesh>
      {/if}
    {/each}
  {/key}
{/if}
