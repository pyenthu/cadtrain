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

  // Defaults match the project convention (CLAUDE.md): Z-down, side view at +X.
  const DEFAULT_POSITION: [number, number, number] = [6, 0, 0];
  const DEFAULT_UP: [number, number, number] = [0, 0, -1];
  const DEFAULT_ZOOM = 130;

  // Auto-fit zoom: derive from the union of all part bounding boxes so a
  // multi-part assembly (packer = 6" tall) gets zoomed out to fit, while
  // a single primitive stays at the default crisp zoom.
  function autoZoomFromMeshes(arr: { full: any; cutVC: any }[], fallback: number): number {
    if (arr.length === 0) return fallback;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (const m of arr) {
      const g = m.cutVC ?? m.full;
      if (!g) continue;
      if (!g.boundingBox) g.computeBoundingBox?.();
      const bb = g.boundingBox;
      if (!bb) continue;
      if (bb.min.x < minX) minX = bb.min.x; if (bb.max.x > maxX) maxX = bb.max.x;
      if (bb.min.y < minY) minY = bb.min.y; if (bb.max.y > maxY) maxY = bb.max.y;
      if (bb.min.z < minZ) minZ = bb.min.z; if (bb.max.z > maxZ) maxZ = bb.max.z;
    }
    const maxExtent = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
    if (!isFinite(maxExtent) || maxExtent <= 0) return fallback;
    return Math.min(600 / maxExtent, fallback);
  }

  let cameraPosition = $derived(cameraOverride?.position ?? DEFAULT_POSITION);
  let cameraUp = $derived(cameraOverride?.up ?? DEFAULT_UP);
  let cameraZoom = $derived(cameraOverride?.zoom ?? autoZoomFromMeshes(meshes, DEFAULT_ZOOM));
</script>

<T.OrthographicCamera makeDefault position={cameraPosition} zoom={cameraZoom} up={cameraUp}>
  <OrbitControls enableDamping />
</T.OrthographicCamera>

<T.Color args={['#ffffff']} attach="background" />
<T.AmbientLight intensity={0.3} />
<T.PointLight position={[1, -4, -2]} intensity={200} distance={50} />
<T.PointLight position={[12, 8, 0]} intensity={120} distance={50} />

{#if meshes.length > 0}
  {#key geoVersion + (showCutaway ? '_cut' : '_full')}
    {#each meshes as m (m.key)}
      {#if showCutaway}
        <T.Mesh geometry={m.cutVC}>
          <T.MeshPhongMaterial vertexColors specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
          <!-- Skip Edges overlay for multi-part assemblies: 10 EdgesGeometry
               passes (one per mesh) tank mobile interaction frame rate. The
               edges look messy on assemblies anyway since each part's outline
               doesn't connect to its neighbour. Kept for single primitives. -->
          {#if showEdges && meshes.length === 1}<Edges thresholdAngle={20} color="black" />{/if}
        </T.Mesh>
      {:else}
        <T.Mesh geometry={m.full}>
          <T.MeshPhongMaterial color="#cc2222" specular="#ffffff" shininess={300} side={THREE.DoubleSide} />
          {#if showEdges && meshes.length === 1}<Edges thresholdAngle={20} color="black" />{/if}
        </T.Mesh>
      {/if}
    {/each}
  {/key}
{/if}
