<script lang="ts">
  import { T } from '@threlte/core';
  import { OrbitControls, Edges } from '@threlte/extras';
  import * as THREE from 'three';

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
    geo?: any;
    geoVersion?: number;
    showCutaway?: boolean;
    showEdges?: boolean;
    cameraOverride?: CameraOverride;
  } = $props();

  // Defaults match the project convention (CLAUDE.md): Z-down, side view at +X.
  const DEFAULT_POSITION: [number, number, number] = [6, 0, 0];
  const DEFAULT_UP: [number, number, number] = [0, 0, -1];
  const DEFAULT_ZOOM = 130;

  // Auto-fit zoom: when no override given, derive it from the geometry's
  // bounding box so multi-part assemblies (packers, sliding sleeves — 6"+
  // tall) don't overflow the viewport at the single-primitive default zoom.
  // Heuristic: zoom = ~600 / max(extent), capped to the single-primitive
  // default at the upper end.
  function autoZoomFromGeo(g: any, fallback: number): number {
    if (!g?.cutVC && !g?.full) return fallback;
    const mesh = g.cutVC ?? g.full;
    if (!mesh.boundingBox) mesh.computeBoundingBox?.();
    const bb = mesh.boundingBox;
    if (!bb) return fallback;
    const sx = bb.max.x - bb.min.x;
    const sy = bb.max.y - bb.min.y;
    const sz = bb.max.z - bb.min.z;
    const maxExtent = Math.max(sx, sy, sz);
    if (!isFinite(maxExtent) || maxExtent <= 0) return fallback;
    const fitted = 600 / maxExtent;
    return Math.min(fitted, fallback);
  }

  let cameraPosition = $derived(cameraOverride?.position ?? DEFAULT_POSITION);
  let cameraUp = $derived(cameraOverride?.up ?? DEFAULT_UP);
  let cameraZoom = $derived(cameraOverride?.zoom ?? autoZoomFromGeo(geo, DEFAULT_ZOOM));
</script>

<T.OrthographicCamera makeDefault position={cameraPosition} zoom={cameraZoom} up={cameraUp}>
  <OrbitControls enableDamping />
</T.OrthographicCamera>

<T.Color args={['#ffffff']} attach="background" />
<T.AmbientLight intensity={0.3} />
<T.PointLight position={[1, -4, -2]} intensity={200} distance={50} />
<T.PointLight position={[12, 8, 0]} intensity={120} distance={50} />

{#if geo}
  {#key geoVersion + showCutaway}
    {#if showCutaway}
      <T.Mesh geometry={geo.cutVC}>
        <T.MeshPhongMaterial vertexColors specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
        {#if showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T.Mesh>
    {:else}
      <T.Mesh geometry={geo.full}>
        <T.MeshPhongMaterial color="#cc2222" specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
        {#if showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T.Mesh>
    {/if}
  {/key}
{/if}
