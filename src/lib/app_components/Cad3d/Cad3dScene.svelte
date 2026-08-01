<script lang="ts">
  // Cad3dScene — a TRIMMED single-mesh Threlte scene for the cad3d island. A pared-down cousin of
  // shared/viewer/PrimitiveDualScene (which is 1300+ lines, dual-purpose): here we render ONE mesh
  // (the full solid, or the cutaway section when requested), a couple of lights, OrbitControls, and
  // the Z-down camera convention. NO GLB half, NO SVG/normals diagnostics, NO instancing, NO warp,
  // and — importantly — NO shared scene-state singleton (that has an "only the active pane writes"
  // rule that would ping-pong across multiple cad3d panels → effect_update_depth_exceeded). ALL
  // state here is LOCAL to the component instance.
  //
  // This module (and its three/threlte imports) is LAZY-loaded by Cad3d.svelte inside onMount, so it
  // never runs during SSR. Vertex-colour convention (baked by finalizeManifold): red (#cc2222) =
  // outer body, grey (#888888) = bore / cut face — honoured via MeshPhongMaterial `vertexColors`.
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls } from '@threlte/extras';
  import * as THREE from 'three';

  let {
    geo = null,
    cutaway = false,
    background = '#ffffff',
    autoRotate = false,
  }: {
    /** Deserialized geometry from /api/app/cad-bake → { full, cutVC, parts?, cutParts? }. */
    geo?: { full?: THREE.BufferGeometry | null; cutVC?: THREE.BufferGeometry | null } | null;
    cutaway?: boolean;
    background?: string;
    autoRotate?: boolean;
  } = $props();

  // Z-down convention (matches the CAD editor): up = -Z, camera on +Y looking at the part.
  const DEFAULT_UP: [number, number, number] = [0, 0, -1];
  const FOV = 45;

  // Pick the mesh to draw: the cutaway section when requested AND non-empty (finalizeManifold
  // auto-skips the cut on huge parts → an empty cutVC), else the full solid.
  let activeGeo = $derived.by<THREE.BufferGeometry | null>(() => {
    const full = geo?.full ?? null;
    const cut = geo?.cutVC ?? null;
    const cutPos = cut?.getAttribute?.('position') as THREE.BufferAttribute | undefined;
    const cutHasVerts = !!cutPos && cutPos.count > 0;
    if (cutaway && cutHasVerts) return cut;
    return full;
  });
  // Red-outer/grey-bore lives in the geometry's per-vertex `color` attribute when present.
  let hasVC = $derived(!!activeGeo?.getAttribute?.('color'));

  // Bounding box of the active mesh — drives the camera fit + orbit target. Stable identity
  // (recomputed only when the geometry buffer changes) so the derived camera props don't churn.
  let bbox = $derived.by(() => {
    const g = activeGeo;
    if (!g) return null;
    g.computeBoundingBox?.();
    const bb = g.boundingBox;
    if (!bb) return null;
    return {
      ex: bb.max.x - bb.min.x,
      ey: bb.max.y - bb.min.y,
      ez: bb.max.z - bb.min.z,
      cx: (bb.min.x + bb.max.x) / 2,
      cy: (bb.min.y + bb.max.y) / 2,
      cz: (bb.min.z + bb.max.z) / 2,
    };
  });

  // OrbitControls look-at: the part's bbox centre.
  let target = $derived<[number, number, number]>(bbox ? [bbox.cx, bbox.cy, bbox.cz] : [0, 0, 0]);
  // Camera sits on +Y, backed off to frame the largest bbox extent at the 45° FOV (+ padding),
  // plus the part's own Y depth. Recomputed only when the bbox changes (a new bake / part).
  let cameraPosition = $derived.by<[number, number, number]>(() => {
    if (!bbox) return [0, 8, 0];
    const maxExt = Math.max(bbox.ex, bbox.ey, bbox.ez, 0.001);
    const half = maxExt / 2;
    const dist = half / Math.tan((FOV * Math.PI) / 180 / 2) * 1.4 + bbox.ey / 2;
    return [bbox.cx, bbox.cy + Math.max(dist, 3), bbox.cz];
  });

  // On the on-demand render loop, request a frame when the geometry / background changes so a fresh
  // bake repaints without needing an orbit nudge. (autoRotate uses the always-loop, set on <Canvas>.)
  const { invalidate } = useThrelte();
  $effect(() => {
    void activeGeo;
    void background;
    invalidate();
  });
</script>

<T.PerspectiveCamera makeDefault position={cameraPosition} fov={FOV} up={DEFAULT_UP} near={0.05} far={100000}>
  <OrbitControls {target} enableDamping enableZoom enableRotate {autoRotate} autoRotateSpeed={1.6} />
</T.PerspectiveCamera>

<T.Color args={[background]} attach="background" />
<T.AmbientLight intensity={0.65} />
<T.DirectionalLight position={[50, 90, -40]} intensity={1.1} />
<T.DirectionalLight position={[-45, -70, 30]} intensity={0.45} />

{#if activeGeo}
  {#key activeGeo}
    <T.Mesh geometry={activeGeo}>
      <T.MeshPhongMaterial
        vertexColors={hasVC}
        color={hasVC ? '#ffffff' : '#cc2222'}
        specular="#666666"
        shininess={120}
        flatShading={true}
        side={THREE.DoubleSide} />
    </T.Mesh>
  {/key}
{/if}
