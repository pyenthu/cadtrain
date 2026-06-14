<script module lang="ts">
  // Module-scoped guard so RectAreaLightUniformsLib.init() (which rebuilds the
  // LTC area-light lookup textures) runs ONCE across every mounted instance of
  // this scene, not once per /primitives tab.
  let rectAreaLibInit = false;
  let rectAreaLibPending: Promise<void> | null = null;
  async function ensureRectAreaLib(): Promise<void> {
    if (rectAreaLibInit) return;
    if (!rectAreaLibPending) {
      rectAreaLibPending = import('three/examples/jsm/lights/RectAreaLightUniformsLib.js')
        .then((m) => { m.RectAreaLightUniformsLib.init(); rectAreaLibInit = true; });
    }
    return rectAreaLibPending;
  }
</script>

<script lang="ts">
  // ONE scene rendering BOTH the live mesh (left) and the baked GLB (right)
  // side-by-side under a single camera / single WebGL context. Replaces the
  // two stacked PrimitiveCanvas + PrimitiveGlbCanvas (was 2 contexts per tab
  // → the WebGL-context leak). Chrome (camera / lights) mirrors ComponentScene.
  import { T, useThrelte } from '@threlte/core';
  import { OrbitControls, Edges } from '@threlte/extras';
  import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
  import * as THREE from 'three';
  import { onMount } from 'svelte';
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
  // GPU-instancing payload (present only when the LIVE-mesh /preview detected a
  // uniform Stack/Repeat): { instances: number[][], count }. When set, `full`/
  // `cutVC` are the CANONICAL CHILD mesh and we draw a THREE.InstancedMesh of
  // the child under each transform instead of the merged N-copy mesh. Absent →
  // the existing single-Mesh path runs unchanged.
  let instanced = $derived(geo?.instanced ?? null);

  // Build the InstancedMesh imperatively (Threlte mounts it via `<T is>`).
  // - Picks the canonical CHILD geo: cutVC under cutaway, else full — so the
  //   half-section replicates per instance (cutting one child + translating ==
  //   cutting the whole stack, since the transforms are pure translations).
  // - Material via makeLitMaterial: SAME Phong/Standard + flatShading + vertex-
  //   colour rules as the single-mesh path. InstancedMesh reads the geometry's
  //   `color` attribute (shared across instances), so per-vertex red/grey (or
  //   the colour-by-source / override colours baked on the child) render on
  //   every copy — VERIFIED compatible: vertexColors is a geometry attribute,
  //   orthogonal to the per-instance instanceMatrix InstancedMesh adds. When
  //   the child has no colour attribute (legacy full mesh) makeLitMaterial uses
  //   the solid #cc2222 + vertexColors:false, matching the non-instanced full
  //   branch.
  let instMesh = $derived.by(() => {
    if (!instanced) return null;
    const childGeo: THREE.BufferGeometry | null = (showCutaway && cutVC) ? cutVC : full;
    if (!childGeo) return null;
    const useStd = scene.zRectLight;
    const hasColor = !!childGeo.getAttribute?.('color');
    const mat = makeLitMaterial(hasColor, useStd, !smoothShade);
    attachWarpShader(mat as any);
    const count = instanced.count;
    const mesh = new THREE.InstancedMesh(childGeo, mat, count);
    const m = new THREE.Matrix4();
    for (let i = 0; i < count; i++) {
      m.fromArray(instanced.instances[i]);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    return mesh;
  });
  // Dispose the previous InstancedMesh's GPU resources when it's replaced (the
  // shared child geometry is NOT disposed — the single-mesh path still uses it).
  $effect(() => {
    const m = instMesh;
    return () => { try { m?.dispose?.(); (m?.material as any)?.dispose?.(); } catch { /* already gone */ } };
  });

  // --- lit-mesh material factory (shared by the live mesh + the GLB) ---
  // When the rectangular AREA light is on the lit meshes MUST be
  // MeshStandardMaterial — RectAreaLight has no effect on MeshPhong. When off
  // we recreate the EXACT MeshPhong used before (same color / vertexColors /
  // specular / shininess / flatShading / DoubleSide) so the render is
  // unchanged. The red-outer / grey-bore vertexColors + the solid-mesh
  // `#cc2222` convention are preserved on BOTH materials.
  function makeLitMaterial(hasColor: boolean, useStd: boolean, flat: boolean): THREE.Material {
    if (useStd) {
      return new THREE.MeshStandardMaterial({
        color: hasColor ? '#ffffff' : '#cc2222', vertexColors: hasColor,
        roughness: 0.5, metalness: 0.0, flatShading: flat, side: THREE.DoubleSide,
      });
    }
    return new THREE.MeshPhongMaterial({
      color: hasColor ? '#ffffff' : '#cc2222', vertexColors: hasColor,
      specular: '#666666', shininess: 120, flatShading: flat, side: THREE.DoubleSide,
    });
  }

  // --- baked GLB (mirrors ComponentSceneGlb.dressGltfScene) ---
  let loaded = $state<THREE.Object3D | null>(null);
  // Tracks which material family the loaded GLB currently wears ('' = none yet)
  // so the reactive material effect only re-dresses on an actual change.
  let glbMatMode = '';
  // Strip normals + cache warp geos; the lit material is assigned reactively by
  // the GLB-material effect below (so it can swap Phong↔Standard on toggle).
  function dressGltfScene(root: THREE.Object3D) {
    root.traverse((obj: any) => {
      if (!obj.isMesh) return;
      const g = obj.geometry as THREE.BufferGeometry;
      if (g.attributes.normal) g.deleteAttribute('normal');
      obj.userData.warpOriginalGeo = g;
      obj.userData.warpSubdividedGeo = subdivideAlongZ(g);
    });
  }
  $effect(() => {
    const myUrl = glbUrl;
    if (!myUrl) { loaded = null; glbMatMode = ''; return; }
    const loader = new GLTFLoader();
    loader.load(myUrl, (gltf) => {
      if (myUrl !== glbUrl) return;
      dressGltfScene(gltf.scene);
      glbMatMode = '';          // force the material effect to (re)dress
      loaded = gltf.scene;
    }, undefined, () => {});
  });
  // Assign / swap the GLB mesh materials reactively. Phong when the rect light
  // is off (byte-identical to the previous dressGltfScene material), Standard
  // when on so the RectAreaLight actually shades it. GLB is always flatShading.
  $effect(() => {
    const useStd = scene.zRectLight;
    if (!loaded) return;
    const want = useStd ? 'std' : 'phong';
    if (want === glbMatMode) return;
    loaded.traverse((obj: any) => {
      if (!obj.isMesh) return;
      const hasColor = !!(obj.geometry as THREE.BufferGeometry).attributes.color;
      if (obj.material?.dispose) obj.material.dispose();
      obj.material = makeLitMaterial(hasColor, useStd, true);
      attachWarpShader(obj.material as any);
    });
    glbMatMode = want;
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
  // Directional light position: a bearing `zDirAngle` (deg) around Z in the X/Y
  // plane, z=0. Target stays the origin (default), so the direction is purely
  // in-plane → perpendicular to Z → the whole drilling length is lit evenly. The
  // magnitude (100) only sets direction; a directional light has no falloff.
  let dirPos = $derived.by<[number, number, number]>(() => {
    const a = (scene.zDirAngle || 0) * Math.PI / 180;
    return [Math.sin(a) * 100, Math.cos(a) * 100, 0];
  });
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
    let minx = bb.min.x, miny = bb.min.y, minz = bb.min.z;
    let maxx = bb.max.x, maxy = bb.max.y, maxz = bb.max.z;
    // INSTANCED: the geo is one CHILD; the whole composition is that child under
    // every (pure-translation) transform. Union the child bbox shifted by each
    // instance's translation (matrix elements [12],[13],[14]) so the camera
    // auto-fit + GLB stacking + Z-light strip frame the FULL stack, not one copy.
    if (instanced) {
      let tminx = Infinity, tminy = Infinity, tminz = Infinity;
      let tmaxx = -Infinity, tmaxy = -Infinity, tmaxz = -Infinity;
      for (const e of instanced.instances) {
        const tx = e[12], ty = e[13], tz = e[14];
        if (tx < tminx) tminx = tx; if (tx > tmaxx) tmaxx = tx;
        if (ty < tminy) tminy = ty; if (ty > tmaxy) tmaxy = ty;
        if (tz < tminz) tminz = tz; if (tz > tmaxz) tmaxz = tz;
      }
      minx = bb.min.x + tminx; maxx = bb.max.x + tmaxx;
      miny = bb.min.y + tminy; maxy = bb.max.y + tmaxy;
      minz = bb.min.z + tminz; maxz = bb.max.z + tmaxz;
    }
    return {
      ex: maxx - minx,
      ey: maxy - miny,
      ez: maxz - minz,
      cx: 0, // x centred at scene origin
      cy: (miny + maxy) / 2,
      cz: (minz + maxz) / 2,
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
  // While EITHER Z-light mode is on, drop the three fixed lights to a small
  // fill so the strip / rectangle is the key; off → full strength (no change
  // vs. before — byte-identical when both are off).
  let fillFactor = $derived(scene.zStripLight || scene.zRectLight ? 0.15 : 1);

  // --- true rectangular AREA light along Z (RectAreaLight) ---
  // A literal emissive panel whose WIDTH runs ALONG the part's Z (drilling)
  // extent and whose HEIGHT spans a few diameters across, sitting `zRectOffset`
  // off the axis (+Y) and aimed at the part. RectAreaLight only lights
  // MeshStandard/Physical, so the lit meshes swap to MeshStandardMaterial while
  // scene.zRectLight is on (see makeLitMaterial + the material branches below).
  // On Threlte's on-demand render loop, mutating the RectAreaLight object
  // directly (below) doesn't invalidate a frame — so changes wouldn't show
  // live. invalidate() requests a re-render after each update.
  const { invalidate, size } = useThrelte();
  // One-time uniforms-lib init (LTC textures the RectAreaLight needs). It's
  // async — the light renders UNLIT until init completes, and the on-demand
  // loop won't re-render on its own, so invalidate() once it's ready (this was
  // why the rect light looked dead / intensity changes did nothing on load).
  onMount(() => { ensureRectAreaLib().then(() => invalidate()); });
  let rectLight = $state<any>(null);
  $effect(() => {
    const l = rectLight;
    if (!l || !scene.zRectLight) return;
    // Touch reactive deps so the panel re-orients/-sizes as the part or dials
    // change. partZExtent is already in post-view-scale world units (the light
    // lives at the scene ROOT, outside the view-scale group, like the strip).
    const { min, max } = scene.partZExtent;
    const cz = (min + max) / 2;
    const along = scene.zRectWidth && scene.zRectWidth > 0
      ? scene.zRectWidth
      : Math.max(1, (max - min) * 1.05);   // full part Z span + ~5% headroom
    // Bearing AROUND the Z (drilling) axis: 0° = +Y (front), 90° = +X, etc.
    const ang = (scene.zRectAngle || 0) * Math.PI / 180;
    const dx = Math.sin(ang), dy = Math.cos(ang);  // unit dir in the X/Y plane
    l.position.set(scene.zRectOffset * dx, scene.zRectOffset * dy, cz);
    l.width = along;                         // WIDTH = local X → world Z (length)
    l.height = scene.zRectHeight;            // HEIGHT = local Y → world X (across)
    l.intensity = scene.zRectIntensity;
    l.color.set('#ffffff');
    // Orient: local +X → world Z (width along the drill axis), emissive face
    // (local −Z) pointing at the axis from the bearing direction (offset sign
    // flips which side, so a negative offset is the same as +180°).
    const s = Math.sign(scene.zRectOffset) || 1;
    const lx = new THREE.Vector3(0, 0, 1);   // width axis → world Z
    const lz = new THREE.Vector3(dx * s, dy * s, 0).normalize();  // outward normal
    const ly = new THREE.Vector3().crossVectors(lz, lx).normalize();
    const m = new THREE.Matrix4().makeBasis(lx, ly, lz);
    l.quaternion.setFromRotationMatrix(m);
    l.updateMatrixWorld?.(true);
    invalidate(); // request a frame so the rect-light change renders live
  });

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

  // --- orthographic frustum (when scene.cam3dOrtho) ---
  // Parallel projection: size the frustum to the scaled part bbox (larger of the
  // Z-span / X extent) + 15% padding, matched to the canvas aspect so nothing
  // stretches. Driven imperatively onto the ortho cam (updateProjectionMatrix)
  // so it's correct regardless of Threlte's camera-prop handling.
  let orthoCam = $state<any>(null);
  let orthoFrustum = $derived.by(() => {
    const w = $size?.width || 1, h = $size?.height || 1;
    const aspect = w / h;
    let halfH = 10;
    if (bbox) {
      const ex = bbox.ex * scene.xScale, ez = bbox.ez * scene.zScale;
      const halfZspan = ez + (gap * scene.zScale) / 2;
      halfH = Math.max(halfZspan, ex / 2) * 1.15 || 10;
    }
    return { l: -halfH * aspect, r: halfH * aspect, t: halfH, b: -halfH };
  });
  $effect(() => {
    const c = orthoCam;
    if (!c || !scene.cam3dOrtho) return;
    const f = orthoFrustum;
    c.left = f.l; c.right = f.r; c.top = f.t; c.bottom = f.b;
    c.updateProjectionMatrix();
    invalidate();
  });

  const AX_LEN = 2.2, AX_R = 0.06;
</script>

{#if scene.cam3dOrtho}
  <T.OrthographicCamera bind:ref={orthoCam} makeDefault position={cameraPosition} up={DEFAULT_UP} near={0.1} far={100000}>
    <OrbitControls bind:ref={controls}
      target={[scene.partCenter.x, scene.partCenter.y, scene.partCenter.z + scene.zFocus]}
      enableDamping enableZoom enableRotate enablePan />
  </T.OrthographicCamera>
{:else}
  <T.PerspectiveCamera makeDefault position={cameraPosition} fov={45} up={DEFAULT_UP}>
    <OrbitControls bind:ref={controls}
      target={[scene.partCenter.x, scene.partCenter.y, scene.partCenter.z + scene.zFocus]}
      enableDamping enableZoom enableRotate enablePan />
  </T.PerspectiveCamera>
{/if}

<!-- White scene background (user pref — easier to see the part). BOTH this
     <T.Color> AND the .pd-stage CSS in PrimitiveDualCanvas are white, so it's
     consistent whether the Color attaches (dev) or the build drops it and falls
     back to the CSS (the prior dev-white / prod-black mismatch). -->
<T.Color args={['#ffffff']} attach="background" />
<!-- Ambient fill so the side the directional light doesn't reach isn't black. -->
<T.AmbientLight intensity={0.45} />

<!-- SOLE light (user pref 2026-06-14): a DIRECTIONAL light projecting PERPENDICULAR
     to the Z (drilling) axis, so the whole length is lit evenly (parallel rays,
     no falloff). `zDirAngle` spins its bearing around Z (0°=+Y front, 90°=+X).
     Works with MeshPhong (no PBR), so colours render true. Target = origin
     (default) → direction is the in-plane bearing toward the axis. Replaced the
     point lights, the Z point-strip, and the rect area light. -->
{#if scene.zDirLight}
  <T.DirectionalLight position={dirPos} intensity={scene.zDirIntensity} />
{/if}

<!-- VIEW-ONLY scale: X/Y = diameter exaggeration (xScale), Z = depth
     compression (zScale). Wraps BOTH stacked renders + their offsets so the
     whole composition scales together; the geometry on disk + the bake stay
     true. The camera auto-fit + OrbitControls target above account for it. -->
<T.Group scale={[scene.xScale, scene.xScale, scene.zScale]}>
<!-- TOP — live mesh, stacked on the part (Z) axis. -->
<T.Group position={meshPos}>
  {#key geoVersion + (showCutaway ? '_cut' : '_full') + (scene.warpEnabled ? '_w' : '') + (scene.zRectLight ? '_r' : '')}
    {#if instMesh}
      <!-- GPU-instanced Stack/Repeat: ONE child mesh drawn under N transforms.
           Material (Phong/Standard + flatShading + vertexColors) + the child's
           red/grey (or override / colour-by-source) colours come baked into
           instMesh above. showEdges is skipped in instanced mode. -->
      <T is={instMesh} />
    {:else if showCutaway && cutVC}
      {@const cg = scene.warpEnabled ? subdivideAlongZ(cutVC) : cutVC}
      <T.Mesh geometry={cg}>
        {#if scene.zRectLight}
          <T.MeshStandardMaterial vertexColors roughness={0.5} metalness={0} flatShading={!smoothShade} side={THREE.DoubleSide} oncreate={(mat) => attachWarpShader(mat)} />
        {:else}
          <T.MeshPhongMaterial vertexColors specular="#666666" shininess={120} flatShading={!smoothShade} side={THREE.DoubleSide} oncreate={(mat) => attachWarpShader(mat)} />
        {/if}
        {#if scene.showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T.Mesh>
    {:else if full}
      {@const hasVC = !!full?.getAttribute?.('color')}
      {@const fg = scene.warpEnabled ? subdivideAlongZ(full) : full}
      <T.Mesh geometry={fg}>
        {#if scene.zRectLight}
          {#if hasVC}
            <T.MeshStandardMaterial vertexColors roughness={0.5} metalness={0} flatShading={!smoothShade} side={THREE.DoubleSide} oncreate={(mat) => attachWarpShader(mat)} />
          {:else}
            <T.MeshStandardMaterial color="#cc2222" roughness={0.5} metalness={0} flatShading={!smoothShade} side={THREE.DoubleSide} oncreate={(mat) => attachWarpShader(mat)} />
          {/if}
        {:else if hasVC}
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
