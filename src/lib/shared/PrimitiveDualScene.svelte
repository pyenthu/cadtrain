<script lang="ts">
  // ONE scene rendering BOTH the live mesh (left) and the baked GLB (right)
  // side-by-side under a single camera / single WebGL context. Replaces the
  // two stacked PrimitiveCanvas + PrimitiveGlbCanvas (was 2 contexts per tab
  // → the WebGL-context leak). Chrome (camera / lights) mirrors ComponentScene.
  import { T } from '@threlte/core';
  import { OrbitControls, Edges } from '@threlte/extras';
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
    stackAxis = 'x',
    smoothShade = false,
  }: {
    geo?: any;            // { full, cutVC } from /api/primitives/preview
    geoVersion?: number;
    glbUrl?: string | null; // blob URL of the baked GLB
    showCutaway?: boolean;  // applies to the LIVE-mesh half (GLB half follows its own cut bake)
    offset?: number;        // FALLBACK half-separation, used only before the
    // live-mesh bbox is known (sep then = 2·offset). Once geometry loads the
    // separation is auto-computed as (part Z-extent + ~12% gap).
    /** RETAINED for call-site compatibility but no longer drives layout: the
     *  scene now ALWAYS stacks the mesh + GLB one-above-the-other on the part
     *  (Z / drilling) axis, separated by the part's own extent plus a small
     *  gap, with the camera auto-fit to the combined bounding box. */
    stackAxis?: 'x' | 'z';
    smoothShade?: boolean;  // EXPERIMENT: smooth-shade the LIVE mesh (use baked
    // calculateNormals(3, 60) vertex normals instead of flatShading face-derived
    // normals). Gated per-primitive at the canvas layer (currently r_weld_extrude
    // only) so twisted prisms don't show the non-planar-quad sawtooth. See the
    // analysis in the 2026-05-28 session: cube/hex edges (>60°) stay sharp via
    // calculateNormals' vertex split; twist's <60° intra-face edges smooth.
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
  let light3Pos = $derived<[number, number, number]>([scene.l3.x, scene.l3.y, scene.l3.z]);
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

  // Z-pan: a vertical slider sets scene.zFocus; the OrbitControls target follows
  // it (target prop below), and here the CAMERA follows by the same delta so the
  // view pans along z instead of re-aiming. Delta-based so it composes with orbit
  // (orbit doesn't touch zFocus). onChange then syncs the panned camera into
  // scene.cam, keeping the position prop consistent.
  let _panZ = 0;
  $effect(() => {
    const z = scene.zFocus;
    if (!controls) return;
    const d = z - _panZ;
    if (Math.abs(d) < 1e-9) return;
    controls.object.position.z += d;
    controls.update();
    _panZ = z;
  });

  // --- bounding box of the LIVE mesh (drives stacking + camera fit) ---
  // Recomputed only when the geometry buffer changes (full/cutVC). Stable
  // identity otherwise so the downstream $derived stacking offsets + the
  // camera-fit effect don't churn every render. (See memory
  // fresh_array_props_effect_loops / canvas_height_contract.)
  let bbox = $derived.by(() => {
    const g = full ?? cutVC;
    if (!g) return null;
    g.computeBoundingBox?.();
    const bb = g.boundingBox;
    if (!bb) return null;
    return {
      ex: bb.max.x - bb.min.x,
      ey: bb.max.y - bb.min.y,
      ez: bb.max.z - bb.min.z,
      cx: 0, // x centred at scene origin
      cy: (bb.min.y + bb.max.y) / 2,
      cz: (bb.min.z + bb.max.z) / 2,
    };
  });

  // Stack the mesh + GLB on the SAME part (Z / drilling) axis, one above the
  // other, separated centre-to-centre by (part Z-extent + a small gap). The
  // gap is ~12% of the part's largest dimension (with a small floor) so the
  // two read as one-over-the-other with clear air between them rather than
  // side-by-side or overlapping. Z-down: the mesh sits toward the TOP (lower
  // z), the GLB toward the BOTTOM (higher z).
  let gap = $derived(bbox ? Math.max(0.4, 0.12 * Math.max(bbox.ex, bbox.ey, bbox.ez)) : offset);
  let sep = $derived(bbox ? bbox.ez + gap : 2 * offset); // centre-to-centre
  let meshPos = $derived<[number, number, number]>([0, 0, -sep / 2]);
  let glbPos = $derived<[number, number, number]>([0, 0, sep / 2]);

  // OrbitControls target = combined bbox centre. The two stacked copies are
  // symmetric about the part's own bbox centre (cz), so the midpoint is just
  // (0, cy, cz). Without this the target sits at world origin (the TOP of
  // every Z-down part) and the part hangs below the look-at, off-centre.
  $effect(() => {
    if (!bbox) return;
    // The whole render group is scaled [xScale, xScale, zScale] (view-only), so
    // the visual centre the OrbitControls target follows is the bbox centre
    // times that scale.
    const xs = scene.xScale, zs = scene.zScale;
    scene.partCenter = { x: bbox.cx * xs, y: bbox.cy * xs, z: bbox.cz * zs };
    // Visual Z range of the WHOLE stacked composition (mesh + GLB), in world
    // units after the view scale, so the Z-axis light strip spans both copies
    // end-to-end. Combined centre-to-centre sep = ez + gap, so the full span is
    // 2·ez + gap centred on cz; half-span = (ez + gap/2). Z-down: min = top.
    const halfSpan = (bbox.ez + gap / 2) * zs;
    const cz = bbox.cz * zs;
    scene.partZExtent = { min: cz - halfSpan, max: cz + halfSpan };
  });

  // --- Z-axis light strip (Option A — docs/plans/z-axis-light.md) ---
  // N point lights distributed evenly along the part's visual Z extent at a
  // fixed radial (+Y) offset, so a long/tall part is lit down its whole length
  // rather than from the origin-clustered fixed lights. Placed at the scene
  // ROOT (outside the view-scale group) so positions/intensity read in world
  // units. Empty (no lights) unless scene.zStripLight is on → zero overhead and
  // a byte-identical render when off.
  let zStripLights = $derived.by(() => {
    if (!scene.zStripLight) return [];
    const n = Math.max(1, Math.round(scene.zStripCount));
    const { min, max } = scene.partZExtent;
    const out: { pos: [number, number, number] }[] = [];
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      out.push({ pos: [0, scene.zStripRadius, min + (max - min) * t] });
    }
    return out;
  });
  // Falloff distance: reach across the part diameter (× view scale) from the
  // radial offset, with headroom so the lobes overlap into an even wash.
  let zStripDistance = $derived.by(() => {
    const diam = bbox ? Math.max(bbox.ex, bbox.ey) * scene.xScale : 20;
    return scene.zStripRadius * 2 + diam * 1.5;
  });
  // While the strip is on, drop the three fixed lights to a small fill so the
  // strip is the key; off → full strength (no change vs. before).
  let fillFactor = $derived(scene.zStripLight ? 0.15 : 1);

  // --- auto-fit the camera to the combined (stacked) bounding box ---
  // View axis is +Y (camera at +Y looking toward the part), up = -Z, so the
  // screen-vertical extent is the stacked Z span (2·ez + gap) and the
  // screen-horizontal extent is the X span. Frame the larger of the two
  // against the 45° vertical FOV (aspect=1 is conservative → a little extra
  // margin on wide canvases), back off past the part's own Y depth, add 15%
  // padding. Guarded by a rounded size/centre key so pure orbit or a
  // colour-only param change does NOT yank the view — it refits only when the
  // part's size or position actually changes ("recompute when the part
  // changes"). Writing scene.cam is one-way (this effect never reads it) so
  // there's no feedback loop with the OrbitControls 'change' sync above.
  const FIT_FOV_DEG = 45;
  let lastFitKey = '';
  $effect(() => {
    if (!bbox) return;
    // Fit the VISUAL extent = bbox × the view scale [xScale, xScale, zScale].
    const xs = scene.xScale, zs = scene.zScale;
    const ex = bbox.ex * xs, ey = bbox.ey * xs, ez = bbox.ez * zs;
    const cy = bbox.cy * xs, cz = bbox.cz * zs, gapV = gap * zs;
    const key = `${ex.toFixed(2)}|${ey.toFixed(2)}|${ez.toFixed(2)}|${cy.toFixed(2)}|${cz.toFixed(2)}`;
    if (key === lastFitKey) return;
    lastFitKey = key;
    const tanHalf = Math.tan((FIT_FOV_DEG * Math.PI) / 180 / 2);
    const halfZspan = ez + gapV / 2; // half of the combined stacked Z span (2·ez + gap)/2
    const halfX = ex / 2;
    const distV = halfZspan / tanHalf;          // fit the vertical (Z) span
    const distH = halfX / tanHalf;              // fit the horizontal (X) span, aspect≈1
    let dist = Math.max(distV, distH) * 1.15 + ey / 2;
    dist = Math.max(dist, 4);                   // floor so tiny parts aren't on top of the lens
    scene.cam = { x: 0, y: cy + dist, z: cz };
  });

  const AX_LEN = 2.2, AX_R = 0.06;
</script>

<T.PerspectiveCamera makeDefault position={cameraPosition} fov={45} up={DEFAULT_UP}>
  <OrbitControls bind:ref={controls}
    target={[scene.partCenter.x, scene.partCenter.y, scene.partCenter.z + scene.zFocus]}
    enableDamping enableZoom enableRotate enablePan />
</T.PerspectiveCamera>

<!-- White scene background (user pref — easier to see the part). BOTH this
     <T.Color> AND the .pd-stage CSS in PrimitiveDualCanvas are white, so it's
     consistent whether the Color attaches (dev) or the build drops it and falls
     back to the CSS (the prior dev-white / prod-black mismatch). -->
<T.Color args={['#ffffff']} attach="background" />
<T.AmbientLight intensity={0.3} />
<T.PointLight position={light1Pos} intensity={scene.l1.i * fillFactor} distance={50} />
<T.PointLight position={light2Pos} intensity={scene.l2.i * fillFactor} distance={50} />
<!-- Fill light from below to lift the previously-shaded quadrant. -->
<T.PointLight position={light3Pos} intensity={scene.l3.i * fillFactor} distance={50} />

<!-- Z-axis light strip: N point lights running down the part's Z (drilling)
     extent, Phong-compatible. Rendered only while scene.zStripLight is on so
     the off-state render is unchanged. -->
{#each zStripLights as L, i (i)}
  <T.PointLight position={L.pos} intensity={scene.zStripIntensity} distance={zStripDistance} />
{/each}

<!-- VIEW-ONLY scale: X/Y = diameter exaggeration (xScale), Z = depth
     compression (zScale). Wraps BOTH stacked renders + their offsets so the
     whole composition scales together; the geometry on disk + the bake stay
     true. The camera auto-fit + OrbitControls target above account for it. -->
<T.Group scale={[scene.xScale, scene.xScale, scene.zScale]}>
<!-- TOP — live mesh, stacked on the part (Z) axis. -->
<T.Group position={meshPos}>
  {#key geoVersion + (showCutaway ? '_cut' : '_full') + (scene.warpEnabled ? '_w' : '')}
    {#if showCutaway && cutVC}
      {@const cg = scene.warpEnabled ? subdivideAlongZ(cutVC) : cutVC}
      <T.Mesh geometry={cg}>
        <T.MeshPhongMaterial vertexColors specular="#666666" shininess={120} flatShading={!smoothShade} side={THREE.DoubleSide} oncreate={(mat) => attachWarpShader(mat)} />
        {#if scene.showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T.Mesh>
    {:else if full}
      {@const hasVC = !!full?.getAttribute?.('color')}
      {@const fg = scene.warpEnabled ? subdivideAlongZ(full) : full}
      <T.Mesh geometry={fg}>
        {#if hasVC}
          <T.MeshPhongMaterial vertexColors specular="#666666" shininess={120} flatShading={!smoothShade} side={THREE.DoubleSide} oncreate={(mat) => attachWarpShader(mat)} />
        {:else}
          <T.MeshPhongMaterial color="#cc2222" specular="#666666" shininess={120} flatShading={!smoothShade} side={THREE.DoubleSide} oncreate={(mat) => attachWarpShader(mat)} />
        {/if}
        {#if scene.showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T.Mesh>
    {/if}
  {/key}
  <T.Mesh position={[AX_LEN/2,0,0]} rotation={[0,0,-Math.PI/2]}><T.CylinderGeometry args={[AX_R,AX_R,AX_LEN,12]} /><T.MeshBasicMaterial color="#ff3030" /></T.Mesh>
  <T.Mesh position={[0,AX_LEN/2,0]}><T.CylinderGeometry args={[AX_R,AX_R,AX_LEN,12]} /><T.MeshBasicMaterial color="#30c030" /></T.Mesh>
  <T.Mesh position={[0,0,AX_LEN/2]} rotation={[Math.PI/2,0,0]}><T.CylinderGeometry args={[AX_R,AX_R,AX_LEN,12]} /><T.MeshBasicMaterial color="#3060ff" /></T.Mesh>
</T.Group>

<!-- BOTTOM — baked GLB, stacked below the mesh on the part (Z) axis. The view
     scale is applied by the parent group. -->
{#if loaded}
  <T.Group position={glbPos}>
    <T is={loaded} />
  </T.Group>
{/if}
</T.Group><!-- /view-scale group -->

<!-- Title + description are now DOM overlays in PrimitiveDualCanvas (.pd-stage),
     not a Threlte <HTML> overlay — the latter's wrapper rendered with
     pointer-events:auto at z-index 8 and swallowed clicks on the ⬇ GLB button. -->
