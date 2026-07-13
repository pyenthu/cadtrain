<script module lang="ts">
  /** One plotted spline's diagnostic overlay (TODO #24). `curve` = the dense
   *  resampled polyline (from resampleSpline — the SAME curve the bake uses),
   *  `points` = the control points (spheres). VIEW-ONLY. */
  export type SplineOverlay = {
    id: string;
    color: string;
    curve: [number, number, number][];
    points: [number, number, number][];
    closed?: boolean;
  };

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
  import { VertexNormalsHelper } from 'three/examples/jsm/helpers/VertexNormalsHelper.js';
  import * as THREE from 'three';
  import { onMount } from 'svelte';
  import { scene } from '$lib/shared/viewer/scene-state.svelte';
  import { computeOrbitTarget } from '$lib/shared/viewer/orbit-target';
  // TEMP warp experiment — mirror ComponentScene/ComponentSceneGlb so the
  // warp toggle works in the combined canvas too (was dropped in the rewrite).
  import { attachWarpShader, subdivideAlongZ } from '$lib/shared/viewer/warp';
  import { getMaterialTexture } from '$lib/shared/viewer/material-textures';
  import { materialPreset } from '$lib/shared/viewer/material-preset';
  import { partitionTrianglesByAlpha } from '$lib/shared/viewer/vertex-alpha-partition';

  let {
    geo = null,
    geoVersion = 0,
    // Only the PRIMARY canvas (the main 3D-bake pane) may auto-normalize the
    // SHARED scene.xScale/zScale. Secondary canvases (GLB / BREP), which mount
    // ALONGSIDE the 3D-bake canvas, must pass false — otherwise two scenes with
    // different bboxes both write the shared scale to different targets and
    // ping-pong → effect_update_depth_exceeded (frozen renderer). 2026-07-02.
    autoScaleOwner = true,
    glbUrl = null,
    showCutaway = false,
    offset = 4.5,
    overlays = [],
    smoothShade = false,
    opacity = 1,
    texture = undefined,
    colorOuter = undefined,
    colorInner = undefined,
    material = undefined,
  }: {
    geo?: any;            // { full, cutVC } from /api/primitives/preview
    geoVersion?: number;
    glbUrl?: string | null; // blob URL of the baked GLB
    showCutaway?: boolean;  // applies to the LIVE-mesh half (GLB half follows its own cut bake)
    offset?: number;        // FALLBACK half-separation, used only before the
    // live-mesh bbox is known (sep then = 2·offset). Once geometry loads the
    // separation is auto-computed as (part Z-extent + ~12% gap).
    /** Per-spline DIAGNOSTIC overlays (TODO #24) — each plotted spline's resolved
     *  curve + control points, drawn as a coloured tube + spheres INSIDE the
     *  live-mesh group so they align with (and scale with) the baked geometry.
     *  VIEW-ONLY; empty ⇒ nothing drawn, zero cost. */
    overlays?: SplineOverlay[];
    /** Part-level render OPACITY (0–1, VIEW-ONLY). <1 renders the whole part
     *  semi-transparent (transparent + depthWrite off) so nested strings show
     *  through the outer casing. Multiplied by the scene-level x-ray slider
     *  (`scene.xrayOpacity`) into `effOpacity` below. 1 × 1 = opaque, byte-
     *  identical to the pre-opacity render. */
    opacity?: number;
    /** Part-level named material TEXTURE (G-MAT2, VIEW-ONLY). Resolved to a
     *  shared procedural THREE.Texture via getMaterialTexture and set as the
     *  material `.map` on the live mesh, the baked GLB, and the GPU-instanced
     *  path. It TINTS with the per-vertex colour-by-source and composes with
     *  opacity. undefined / unknown name ⇒ no map ⇒ identical to today. This is
     *  a PER-PART property: a composed assembly is one vertex-coloured mesh
     *  with no per-subpart UVs, so the single map covers the whole part. */
    texture?: string;
    /** Part-level OUTER-skin colour (the SAME value the Manifold bake bakes into
     *  its vertex-colour attribute). Used ONLY for a `full` mesh that carries NO
     *  vertex-colour attribute — the TF single-mesh path (`tfMeshToGeo` emits
     *  position+normal only). The Manifold/BREP `full` already carries baked
     *  vertex colours (hasVC → unchanged). undefined ⇒ the historical `#cc2222`
     *  default, so pre-TF call-sites render byte-identically. */
    colorOuter?: string;
    /** Part-level INNER/cut colour — retained for call-site parity with the
     *  Manifold path; the single `full` solid has no revealed interior, so it is
     *  the cutVC (section) path that consumes inner. Not read in the full arm. */
    colorInner?: string;
    /** Part-level MATL PBR PRESET ('none'|'steel'|'aluminum'|'titanium'|'brass',
     *  VIEW-ONLY). Resolved via `materialPreset` to metalness/roughness (on the
     *  MeshStandardMaterial arms) + a metallic tint colour (used ONLY on the
     *  non-vertex-coloured fallback arm, i.e. the TF single mesh; a baked-VC or
     *  explicit-colorOuter mesh ignores the tint). undefined / 'none' ⇒ the
     *  neutral { metalness:0, roughness:0.5 } → byte-identical to the pre-preset
     *  material, so Manifold/BREP call-sites that pass nothing are unchanged. */
    material?: string;
    smoothShade?: boolean;  // EXPERIMENT: smooth-shade the LIVE mesh (use baked
    // calculateNormals(3, 60) vertex normals instead of flatShading face-derived
    // normals). Gated per-primitive at the canvas layer (currently r_weld_extrude
    // only) so twisted prisms don't show the non-planar-quad sawtooth. See the
    // analysis in the 2026-05-28 session: cube/hex edges (>60°) stay sharp via
    // calculateNormals' vertex split; twist's <60° intra-face edges smooth.
  } = $props();

  let full = $derived(geo?.full ?? null);
  let cutVC = $derived(geo?.cutVC ?? null);
  // PER-PART textured meshes (TF per-part texture, #3): [{ geo, appearance }].
  // Present only on the TF per-part-mesh path (cutaway off); renders each part
  // with its own colour/texture/opacity material. Absent → single-mesh path.
  let parts = $derived(geo?.parts ?? null);
  // PER-PART CUT meshes (TF v2): [{ geo, appearance }], present only on the TF
  // cutaway path for an appearance-bearing recipe. Each part's cut mesh carries
  // vertex colours — OUTER skin = the part's material tint, revealed interior =
  // grey section — so the CUT view shows per-part material AND still reads as a
  // cross-section. Rendered (cutaway ON) in preference to the merged grey/red
  // `cutVC`; absent → the merged section renders as before.
  let cutParts = $derived(geo?.cutParts ?? null);
  // GPU-instancing payload (present only when the LIVE-mesh /preview detected a
  // uniform Stack/Repeat): { instances: number[][], count }. When set, `full`/
  // `cutVC` are the CANONICAL CHILD mesh and we draw a THREE.InstancedMesh of
  // the child under each transform instead of the merged N-copy mesh. Absent →
  // the existing single-Mesh path runs unchanged.
  let instanced = $derived(geo?.instanced ?? null);

  // Effective render opacity = the part's own opacity × the scene x-ray slider,
  // clamped to (0.02, 1]. 1×1 = 1 → the material stays fully opaque + byte-
  // identical to the pre-opacity render. Read by makeLitMaterial (instanced +
  // GLB) and by the in-place material effects for the single live mesh.
  let effOpacity = $derived(
    Math.max(0.02, Math.min(1, (Number.isFinite(opacity) ? (opacity as number) : 1) * (scene.xrayOpacity ?? 1))),
  );
  // Part-level MATL PBR preset → { metalness, roughness, color? }. undefined /
  // 'none' resolves to the neutral { metalness:0, roughness:0.5 } so an
  // un-preset part renders byte-identically to before this was threaded in.
  let matPBR = $derived(materialPreset(material));
  // Apply an opacity onto a THREE material IN PLACE: <1 → transparent + no
  // depth-write (so overlapping transparent shells blend instead of z-fighting
  // / occluding); =1 → the opaque defaults (transparent:false, depthWrite:true).
  // `vertexAlpha` (stage C) forces transparency even when the whole-part `op`
  // is 1: the mesh's colour attribute is RGBA (itemSize 4) and carries a <1
  // alpha on some subpart (e.g. an open hole in a well). THREE only multiplies
  // that per-vertex alpha (USE_COLOR_ALPHA) when the material is transparent,
  // so a single opaque part with a transparent subpart still needs it on.
  function applyOpacity(mat: any, op: number, vertexAlpha = false) {
    if (!mat) return;
    const t = op < 1 || vertexAlpha;
    if (mat.transparent !== t) mat.transparent = t;
    if (mat.opacity !== op) mat.opacity = op;
    const dw = !t;
    if (mat.depthWrite !== dw) mat.depthWrite = dw;
    mat.needsUpdate = true;
  }

  // True when the ACTIVE live-mesh geometry carries a 4-component (RGBA) colour
  // attribute — i.e. the colour-by-source bake baked a per-subpart alpha in. The
  // material must then be transparent so the alpha channel is honoured.
  let hasVertexAlpha = $derived.by(() => {
    const g = (showCutaway && cutVC) ? cutVC : full;
    const c = g?.getAttribute?.('color');
    return !!c && (c as any).itemSize === 4;
  });

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
    const colAttr = childGeo.getAttribute?.('color');
    const hasColor = !!colAttr;
    const childVertexAlpha = !!colAttr && (colAttr as any).itemSize === 4;
    // MIXED-alpha child → 2-group split so the opaque subparts stay solid (same
    // fix as the single mesh). InstancedMesh honours geometry groups + a material
    // array (each instance draws both groups), so per-instance the opaque tris
    // write depth and only the transparent tris blend. Non-mixed → single material
    // (unchanged). The transparent group's material carries the per-vertex alpha.
    const flat = !smoothShade;
    const split = childVertexAlpha ? buildAlphaSplitGeometry(childGeo) : null;
    const drawGeo = split ? split.geo : childGeo;
    const mat = split
      ? [makeLitMaterial(true, useStd, flat, effOpacity, false, texture),
         makeLitMaterial(true, useStd, flat, effOpacity, true, texture)]
      : makeLitMaterial(hasColor, useStd, flat, effOpacity, childVertexAlpha, texture);
    // (Warp is now baked into childGeo server-side — no render-time shader.)
    const count = instanced.count;
    const mesh = new THREE.InstancedMesh(drawGeo, mat, count);
    if (split) mesh.userData.ownSplitGeo = true; // disposer frees its index-only geo
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
    return () => {
      try {
        m?.dispose?.();
        const mat = m?.material as any;
        if (Array.isArray(mat)) mat.forEach((x) => x?.dispose?.()); else mat?.dispose?.();
        // Free the index-only split geometry we allocated (its attributes are
        // shared with the child geo, so detach them first — disposeSplitGeometry).
        if (m?.userData?.ownSplitGeo) disposeSplitGeometry(m.geometry as THREE.BufferGeometry);
      } catch { /* already gone */ }
    };
  });
  // Black wire border for the INSTANCED path. A Threlte <Edges> is per-geometry
  // and can't ride an InstancedMesh's per-instance matrices, so a Stack/Repeat
  // (e.g. g_dp_stand) rendered instanced lost the showEdges overlay the
  // single-mesh path gets. Rebuild it as a Group of LineSegments — one per
  // instance, all SHARING one EdgesGeometry + material — placed at the same
  // instance transforms. Matches <Edges thresholdAngle={20} color="black">.
  let instEdges = $derived.by(() => {
    if (!instanced || !instMesh || !scene.showEdges) return null;
    const childGeo: THREE.BufferGeometry | null = (showCutaway && cutVC) ? cutVC : full;
    if (!childGeo) return null;
    // childGeo is now the genuinely-warped Manifold mesh (baked server-side), so
    // EdgesGeometry traces the bulged edges for free — no subdivide / shader hack
    // needed. (This was the whole point of moving warp into Manifold space: the
    // old render-time shader displaced edge ENDPOINTS but the GPU still drew a
    // straight line between them, so the wire border stayed straight.)
    const eg = new THREE.EdgesGeometry(childGeo, 20);
    const mat = new THREE.LineBasicMaterial({ color: 0x000000 });
    const group = new THREE.Group();
    const m = new THREE.Matrix4();
    for (let i = 0; i < instanced.count; i++) {
      const ls = new THREE.LineSegments(eg, mat);
      m.fromArray(instanced.instances[i]);
      ls.applyMatrix4(m);
      group.add(ls);
    }
    return group;
  });
  // Dispose the shared EdgesGeometry + material when the overlay is replaced.
  $effect(() => {
    const g = instEdges;
    return () => {
      try {
        let disposed = false;
        g?.traverse?.((o: any) => {
          if (!disposed) { o.geometry?.dispose?.(); o.material?.dispose?.(); disposed = true; }
        });
      } catch { /* already gone */ }
    };
  });

  // --- lit-mesh material factory (shared by the live mesh + the GLB) ---
  // When the rectangular AREA light is on the lit meshes MUST be
  // MeshStandardMaterial — RectAreaLight has no effect on MeshPhong. When off
  // we recreate the EXACT MeshPhong used before (same color / vertexColors /
  // specular / shininess / flatShading / DoubleSide) so the render is
  // unchanged. The red-outer / grey-bore vertexColors + the solid-mesh
  // `#cc2222` convention are preserved on BOTH materials.
  // `op` (0–1) = the effective opacity. <1 → transparent + depthWrite:false so
  // overlapping transparent shells (e.g. casing over tubing) blend instead of
  // z-fighting / occluding. =1 → THREE's opaque defaults (transparent:false,
  // depthWrite:true) → byte-identical to the pre-opacity material.
  // `textureName` (G-MAT2) resolves to a shared procedural map set as `.map`.
  // Undefined / unknown ⇒ no map (byte-identical to the pre-texture material).
  // The map TINTS with vertexColors (colour-by-source) and rides the same
  // transparent/opacity rules.
  function makeLitMaterial(hasColor: boolean, useStd: boolean, flat: boolean, op = 1, vertexAlpha = false, textureName?: string): THREE.Material {
    const t = op < 1 || vertexAlpha;
    const alpha = t ? { transparent: true, opacity: op, depthWrite: false } : {};
    const map = getMaterialTexture(textureName);
    const tex = map ? { map } : {};
    if (useStd) {
      return new THREE.MeshStandardMaterial({
        color: hasColor ? '#ffffff' : '#cc2222', vertexColors: hasColor,
        roughness: 0.5, metalness: 0.0, flatShading: flat, side: THREE.DoubleSide, ...tex, ...alpha,
      });
    }
    return new THREE.MeshPhongMaterial({
      color: hasColor ? '#ffffff' : '#cc2222', vertexColors: hasColor,
      specular: '#666666', shininess: 120, flatShading: flat, side: THREE.DoubleSide, ...tex, ...alpha,
    });
  }

  // --- mixed-alpha 2-group split (opaque-subparts-render-solid fix) ---
  // A composed assembly (e.g. a well) bakes ONE vertex-coloured mesh whose RGBA
  // colour attribute carries a per-triangle alpha. If the WHOLE mesh wears one
  // transparent + depthWrite:false material, the OPAQUE subparts (casing/cement/
  // tubing, alpha ≈ 1) also stop writing depth → they render see-through. Split
  // the geometry into two draw groups by per-triangle alpha (opaque first, then
  // transparent) so group 0 gets a solid depth-writing material and only group 1
  // blends. Returns null unless the mesh has an RGBA colour attr with BOTH opaque
  // and transparent triangles (the "mixed" case) — a fully-opaque or fully-
  // transparent RGBA mesh keeps its single-material path (byte-identical to
  // today). Shares the source geometry's attribute buffers (only a new index +
  // groups are allocated); the caller must NOT geo.dispose() this without first
  // detaching the shared attributes (see the splitMesh disposer).
  function buildAlphaSplitGeometry(
    g: THREE.BufferGeometry | null,
  ): { geo: THREE.BufferGeometry; opaqueCount: number; transparentCount: number } | null {
    const colAttr = g?.getAttribute?.('color') as THREE.BufferAttribute | undefined;
    if (!g || !colAttr || colAttr.itemSize !== 4) return null;
    const idx = g.getIndex();
    const part = partitionTrianglesByAlpha(
      colAttr.array as ArrayLike<number>,
      idx ? (idx.array as ArrayLike<number>) : null,
      colAttr.count,
    );
    if (!part.mixed) return null;
    const split = new THREE.BufferGeometry();
    // Share the source attribute buffers (no vertex-data copy). Only the index
    // buffer below is newly allocated.
    split.setAttribute('position', g.getAttribute('position'));
    split.setAttribute('color', colAttr);
    const nrm = g.getAttribute('normal'); if (nrm) split.setAttribute('normal', nrm);
    const uv = g.getAttribute('uv'); if (uv) split.setAttribute('uv', uv);
    split.setIndex(new THREE.BufferAttribute(part.order, 1));
    split.addGroup(0, part.opaqueCount, 0);                       // materialIndex 0 = opaque
    split.addGroup(part.opaqueCount, part.transparentCount, 1);   // materialIndex 1 = transparent
    return { geo: split, opaqueCount: part.opaqueCount, transparentCount: part.transparentCount };
  }

  // Detach the SHARED attribute buffers from a split geometry, then dispose it,
  // so only the index buffer WE allocated is freed (disposing the geometry with
  // its shared attributes still attached would free buffers the source geo — and
  // the bbox / edges / normals-helper paths — still need).
  function disposeSplitGeometry(geo: THREE.BufferGeometry | undefined | null) {
    if (!geo) return;
    try {
      for (const name of ['position', 'color', 'normal', 'uv']) geo.deleteAttribute(name);
      geo.dispose();
    } catch { /* already gone */ }
  }

  // The single-live-mesh MIXED-alpha case: a self-contained THREE.Mesh with a
  // 2-group geometry + [opaqueMat, transparentMat] material array. THREE draws
  // group 0 (opaque, depthWrite on) before group 1 (transparent) → the opaque
  // subparts occlude correctly + render solid, while the transparent subpart
  // (e.g. an open hole) still blends and shows the strings inside. null when the
  // mesh isn't mixed → the declarative single-material arm renders (unchanged).
  // Skipped for the instanced path (instMesh builds its own split below).
  // Mirrors the instMesh imperative pattern. Base opacity 1; the effOpacity
  // (x-ray) is applied IN PLACE by the effect below so an x-ray drag doesn't
  // rebuild the whole mesh.
  let splitMesh = $derived.by(() => {
    if (instanced) return null;
    const g: THREE.BufferGeometry | null = (showCutaway && cutVC) ? cutVC : full;
    const built = buildAlphaSplitGeometry(g);
    if (!built) return null;
    const useStd = scene.zRectLight;
    const flat = !smoothShade;
    const opaqueMat = makeLitMaterial(true, useStd, flat, 1, false, texture); // group 0: solid + depthWrite
    const transMat = makeLitMaterial(true, useStd, flat, 1, true, texture);   // group 1: blend, depthWrite off
    return new THREE.Mesh(built.geo, [opaqueMat, transMat]);
  });
  // Dispose the split mesh's materials + (index-only) geometry when it's replaced.
  $effect(() => {
    const m = splitMesh;
    return () => {
      try {
        (m?.material as THREE.Material[] | undefined)?.forEach((mat) => mat?.dispose?.());
        disposeSplitGeometry(m?.geometry as THREE.BufferGeometry);
      } catch { /* already gone */ }
    };
  });
  // Apply effOpacity (part × x-ray) + wireframe IN PLACE to the split mesh's two
  // materials — group 0 honours the x-ray but ignores per-vertex alpha (its tris
  // are all ≈1), group 1 always blends on the per-vertex alpha. Avoids rebuilding
  // the mesh on every slider tick (mirrors the instanced-path wireframe effect).
  $effect(() => {
    const m = splitMesh;
    const op = effOpacity;        // tracked — part opacity × scene x-ray
    const wire = scene.wireframe; // tracked
    const mats = m?.material as THREE.Material[] | undefined;
    if (!mats) return;
    applyOpacity(mats[0], op, false);
    applyOpacity(mats[1], op, true);
    for (const mat of mats) { (mat as any).wireframe = wire; mat.needsUpdate = true; }
    invalidate();
  });
  // Point the live-mesh ref (drives the vertex-normals diagnostic) at the split
  // mesh when it's active — the declarative <T.Mesh bind:ref> arm isn't mounted
  // in the mixed-alpha case, so bind:ref never sets it.
  $effect(() => {
    if (splitMesh) liveMeshRef = splitMesh;
  });

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
      // MIXED per-subpart alpha → 2-group split so the opaque subparts stay solid
      // (same fix as the live mesh). GLB geometry is owned by the loaded scene, so
      // the split geo becomes the "no-warp" base geometry + we flag the mesh for
      // the 2-material array in the material effect. CAVEAT: the TEMP warp toggle
      // swaps to subdivideAlongZ(g) (the UNsplit original) → the split is lost
      // while warp is ON; acceptable for that experimental view.
      const split = buildAlphaSplitGeometry(g);
      const baseGeo = split ? split.geo : g;
      obj.userData.warpOriginalGeo = baseGeo;
      obj.userData.warpSubdividedGeo = subdivideAlongZ(g);
      obj.userData.alphaSplit = !!split;
      if (split) obj.geometry = baseGeo;
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
    const texName = texture; // tracked — re-dress the GLB when the material texture changes
    if (!loaded) return;
    const want = (useStd ? 'std' : 'phong') + '|' + (texName ?? '');
    if (want === glbMatMode) return;
    loaded.traverse((obj: any) => {
      if (!obj.isMesh) return;
      const hasColor = !!(obj.geometry as THREE.BufferGeometry).attributes.color;
      const prev = obj.material as any;
      if (Array.isArray(prev)) prev.forEach((m) => m?.dispose?.()); else prev?.dispose?.();
      if (obj.userData.alphaSplit) {
        // 2-group split: [opaque (solid + depthWrite), transparent (blend)].
        const mats = [makeLitMaterial(true, useStd, true, effOpacity, false, texName),
                      makeLitMaterial(true, useStd, true, effOpacity, true, texName)];
        mats.forEach((m) => attachWarpShader(m as any));
        obj.material = mats;
      } else {
        obj.material = makeLitMaterial(hasColor, useStd, true, effOpacity, false, texName);
        attachWarpShader(obj.material as any);
      }
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
  // OrbitControls / camera look-at target — PINNED to the part's vertical (Z /
  // drilling) axis (x=y=0) at the part's z-centre plus the axial Z-pan, via the
  // pure `computeOrbitTarget`. Keeping it on-axis stops a tall Z-down part (a
  // well) drifting off-centre while orbiting; it used `partCenter.y` (the bbox
  // y-centre), which for a part not symmetric about the axis in Y sat OFF the
  // axis (TODO #74). Memoised so it changes only when partCenter / zFocus do —
  // a fresh array per render would churn the OrbitControls prop.
  let orbitTarget = $derived<[number, number, number]>(computeOrbitTarget(scene.partCenter, scene.zFocus));
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

  // --- spline diagnostic overlays (TODO #24) ---------------------------------
  // Build ONE THREE.Group per plotted spline (a coloured tube along its resolved
  // curve + a sphere at each control point). They render INSIDE the live-mesh
  // group (same view-scale + meshPos transform) so they align with + scale with
  // the baked geometry. Radius sizes from the part bbox so the tubes read at any
  // scale; a fixed fallback before geometry loads. Empty overlays ⇒ no objects.
  let overlayObjs = $derived.by<THREE.Object3D[]>(() => {
    if (!overlays || overlays.length === 0) return [];
    const maxDim = bbox ? Math.max(bbox.ex, bbox.ey, bbox.ez) : 8;
    const tubeR = Math.max(0.03, maxDim * 0.008);
    const sphR = tubeR * 3;
    const out: THREE.Object3D[] = [];
    for (const ov of overlays) {
      const grp = new THREE.Group();
      const col = new THREE.Color(ov.color || '#7c3aed');
      const curve = (ov.curve ?? []).filter((p) => Array.isArray(p) && p.length >= 3);
      if (curve.length >= 2) {
        const cps = curve.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
        // Dense points already trace the true (resampleSpline) curve; a
        // CatmullRomCurve3 through them gives a smooth tube to sweep.
        const path = new THREE.CatmullRomCurve3(cps, !!ov.closed, 'centripetal');
        const tg = new THREE.TubeGeometry(path, Math.max(24, curve.length), tubeR, 8, !!ov.closed);
        const tm = new THREE.MeshBasicMaterial({ color: col });
        grp.add(new THREE.Mesh(tg, tm));
      }
      const pts = (ov.points ?? []).filter((p) => Array.isArray(p) && p.length >= 3);
      if (pts.length > 0) {
        // Share ONE sphere geometry + material across this overlay's handles.
        const sg = new THREE.SphereGeometry(sphR, 12, 12);
        const sm = new THREE.MeshBasicMaterial({ color: col });
        for (const p of pts) {
          const m = new THREE.Mesh(sg, sm);
          m.position.set(p[0], p[1], p[2]);
          grp.add(m);
        }
      }
      out.push(grp);
    }
    return out;
  });
  // Free the overlay GPU resources when the set is rebuilt / the scene unmounts.
  $effect(() => {
    const objs = overlayObjs;
    invalidate(); // request a frame so a toggle shows without an orbit nudge
    return () => {
      for (const g of objs) {
        g.traverse((o: any) => { o.geometry?.dispose?.(); o.material?.dispose?.(); });
      }
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

  // Combined visual bbox centre of the stacked mesh+GLB, in post-view-scale
  // world units. The two copies are symmetric about the part's own bbox centre
  // (cz), so the midpoint is (0, cy, cz). Consumed by the SVG projection
  // (svg-camera) as the look-at AND (via z only) by the 3D OrbitControls target
  // — `computeOrbitTarget` takes ONLY partCenter.z, pinning the 3D look-at to
  // the vertical axis (x=y=0) so a tall Z-down part stays centred while orbiting
  // (TODO #74). Without a z-centre the target would sit at world origin (the TOP
  // of every Z-down part) and the part would hang below the look-at.
  $effect(() => {
    if (!bbox) return;
    // The whole render group is scaled [xScale, xScale, zScale] (view-only), so
    // the visual centre the look-at follows is the bbox centre times that scale.
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

  // --- Default-scale-on-load (aspect normalization) ---------------------------
  // Pick xScale/zScale so the displayed aspect ratio reads thick + long-enough-
  // but-not-too-long. Uses the TRUE bbox dims (ex/ey/ez are pre-view-scale).
  // L = ez (length), D = max(ex,ey) (≈ diameter). AR = L/D. Correct only the
  // extremes into a band, splitting the fix evenly between shortening (zScale)
  // and fattening (xScale): zScale·/·xScale = k, so displayed AR = AR·k.
  // "Balanced": HI=6, LO=1.2, a=0.5. View-only — never touches the bake.
  function autoScale(ex: number, ey: number, ez: number): { x: number; z: number } {
    const L = ez, D = Math.max(ex, ey);
    if (!(L > 0 && D > 0)) return { x: 1, z: 1 };
    const AR = L / D, HI = 6, LO = 1.2, a = 0.5;
    const k = AR > HI ? HI / AR : AR < LO ? LO / AR : 1;
    const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
    return { z: clamp(Math.pow(k, a), 0.2, 2), x: clamp(Math.pow(k, a - 1), 0.5, 3) };
  }
  // Applies whenever scaleAuto is on and a bbox exists. Reads bbox + scaleAuto
  // only (NOT xScale/zScale), so writing the scales can't loop. A manual slider
  // drag clears scaleAuto (PrimitiveDualCanvas), so the user's value then sticks.
  $effect(() => {
    if (!autoScaleOwner || !scene.scaleAuto || !bbox) return;
    const { x, z } = autoScale(bbox.ex, bbox.ey, bbox.ez);
    if (scene.xScale !== x) scene.xScale = x;
    if (scene.zScale !== z) scene.zScale = z;
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
  const { invalidate, size, renderer } = useThrelte();

  // Tone-mapping EXPOSURE — Threlte applies AgX tone mapping at exposure 1.0 by
  // default, which reads dim (esp. on long/deviated parts). Drive it from the
  // Brightness knob (scene.exposure) so parts lift globally, with no re-bake.
  $effect(() => {
    if (!renderer) return;
    (renderer as any).toneMappingExposure = scene.exposure;
    invalidate();
  });

  // Live-mesh material ref — the ◐ Auto/Smooth/Flat toggle flips flatShading IN
  // PLACE (no mesh remount / no re-bake). flatShading is a shader-recompile prop,
  // so we also set needsUpdate + invalidate a frame. Only one material is active
  // at a time, so they all bind to the same ref.
  let liveMat: any = null;
  $effect(() => {
    const flat = !smoothShade;         // tracked
    const wire = scene.wireframe;      // tracked — VIEW-ONLY wireframe diagnostic
    const op = effOpacity;             // tracked — part opacity × scene x-ray
    const va = hasVertexAlpha;         // tracked — RGBA per-subpart alpha present
    const texName = texture;           // tracked — named material texture (G-MAT2)
    void geoVersion;                   // tracked — re-apply after a re-bake remounts liveMat fresh
    if (liveMat) {
      liveMat.flatShading = flat; liveMat.wireframe = wire; applyOpacity(liveMat, op, va);
      // Set/clear the procedural material map IN PLACE (the inline template
      // material has no `map`; an undefined/unknown name clears it).
      const map = getMaterialTexture(texName) ?? null;
      if (liveMat.map !== map) { liveMat.map = map; liveMat.needsUpdate = true; }
      invalidate();
    }
  });
  // Fade the baked GLB meshes to match `effOpacity` IN PLACE — the GLB material
  // effect above only re-dresses on a Phong↔Standard family swap, so an opacity-
  // only change (x-ray slider / part opacity) would otherwise not reach it.
  $effect(() => {
    const op = effOpacity; // tracked
    if (!loaded) return;
    loaded.traverse((obj: any) => {
      if (!obj.isMesh) return;
      if (Array.isArray(obj.material)) {
        applyOpacity(obj.material[0], op, false); // opaque group
        applyOpacity(obj.material[1], op, true);  // transparent group (per-vertex alpha)
      } else {
        applyOpacity(obj.material, op);
      }
    });
    invalidate();
  });
  // Wireframe for the GPU-INSTANCED path: instMesh's material comes from
  // makeLitMaterial (not the liveMat ref), so drive its `wireframe` flag here so
  // the toggle covers uniform Stack/Repeat parts too. In place → no rebuild.
  $effect(() => {
    const m = instMesh;
    const wire = scene.wireframe; // tracked
    const mat = m?.material as any;
    if (!mat) return;
    const list = Array.isArray(mat) ? mat : [mat]; // mixed-alpha child → 2-material array
    for (const x of list) { x.wireframe = wire; x.needsUpdate = true; }
    invalidate();
  });
  // --- vertex-normals diagnostic (VIEW-ONLY) ---
  // A THREE.VertexNormalsHelper drawn on the live mesh so the user can SEE each
  // vertex normal's direction/length — the definitive normals/lighting check.
  // The helper bakes the mesh's WORLD matrix into itself and draws in world
  // space, so it's mounted at the SCENE ROOT (outside the view-scale group) and
  // aligns because it inherits the mesh's world transform (which already
  // includes that group's [xScale,xScale,zScale] + meshPos). Skipped for the
  // GPU-instanced path (the helper can't ride per-instance matrices). Lazy:
  // nothing is built while the toggle is off.
  let liveMeshRef = $state<any>(null);
  let normalsHelper = $state<any>(null);
  $effect(() => {
    const show = scene.showNormals;      // tracked
    const mesh = liveMeshRef;            // tracked (remounts on geoVersion re-key)
    const _v = geoVersion;               // rebuild when the geometry buffer changes
    void _v;
    if (!show || !mesh || instanced) { normalsHelper = null; return; }
    // Normal line length ~4% of the part's largest dim so it reads at any scale.
    const len = bbox ? Math.max(0.05, Math.max(bbox.ex, bbox.ey, bbox.ez) * 0.04) : 0.3;
    let h: any = null;
    try {
      mesh.updateWorldMatrix(true, false);
      h = new VertexNormalsHelper(mesh, len, 0x2266ff);
    } catch { h = null; }
    normalsHelper = h;
    invalidate();
    return () => { try { h?.dispose?.(); } catch { /* already gone */ } };
  });
  // Keep the helper aligned as the VIEW scale / Z-pan change (the mesh's world
  // matrix shifts but the helper's baked-in matrix doesn't auto-follow).
  $effect(() => {
    const h = normalsHelper;
    scene.xScale; scene.zScale; scene.zFocus; // tracked deps
    if (h && liveMeshRef) {
      try { liveMeshRef.updateWorldMatrix(true, false); h.update(); invalidate(); } catch { /* transient */ }
    }
  });

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
  // How much LENGTH to show initially, as a multiple of the diameter, before
  // the user scrolls the rest with the Z-pan slider. Keeps the dia prominent on
  // long thin tools instead of shrinking the whole length into the frame.
  const ORTHO_LEN_DIAMETERS = 3;
  let orthoFrustum = $derived.by(() => {
    const w = $size?.width || 1, h = $size?.height || 1;
    const aspect = w / h;
    let halfH = 10;
    if (bbox) {
      const ex = bbox.ex * scene.xScale, ez = bbox.ez * scene.zScale;
      const halfZspan = ez + (gap * scene.zScale) / 2;   // half of the full part length
      const radius = (ex / 2) || 1;
      // Bias the zoom to the BREADTH (diameter): the lower bound fits the dia to
      // the width (so it reads big), and we only frame ~ORTHO_LEN_DIAMETERS of
      // length (or the whole part if it's shorter) instead of the full length.
      const breadthFit = radius / aspect;                            // dia fills the width
      // Fit-vertical (#11): frame the FULL length; else the ~3-diameter window.
      const lenWindowHalf = scene.fitLength ? halfZspan : Math.min(halfZspan, radius * ORTHO_LEN_DIAMETERS);
      halfH = Math.max(breadthFit, lenWindowHalf) * 1.15 || 10;
    }
    return { l: -halfH * aspect, r: halfH * aspect, t: halfH, b: -halfH };
  });
  // Auto-fit (#11): when a part loads that's MUCH longer than the default
  // window (length > 2× what 3 diameters would show), enable fit-vertical once
  // so it isn't cut off at load (bug #10). Keyed on the bbox so it re-evaluates
  // per part; only flips ON (never fights a user who turns it back off).
  let lastAutoFitKey = '';
  $effect(() => {
    if (!bbox) return;
    const ez = bbox.ez * scene.zScale;
    const ex = bbox.ex * scene.xScale;
    const halfZspan = ez + (gap * scene.zScale) / 2;
    const radius = (ex / 2) || 1;
    const key = `${bbox.ez.toFixed(2)}:${bbox.ex.toFixed(2)}`;
    if (key === lastAutoFitKey) return;     // same geometry — don't re-trigger
    lastAutoFitKey = key;
    if (halfZspan > radius * ORTHO_LEN_DIAMETERS * 2) scene.fitLength = true;
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
    <!-- Constrained turntable (TODO #74): target on the vertical (Z) axis;
         azimuth spins freely AROUND Z, polar TILTS around the screen-horizontal
         axis (clamped just shy of the poles so the part can't flip / tumble).
         PAN is OFF — the axial Z-pan slider (scene.zFocus, folded into the
         target) is the controlled vertical pan, and free pan is exactly what
         dragged the look-at off-axis. Zoom stays on. -->
    <OrbitControls bind:ref={controls}
      target={orbitTarget}
      enableDamping enableZoom enableRotate enablePan={false}
      minPolarAngle={0.0001} maxPolarAngle={Math.PI - 0.0001} />
  </T.OrthographicCamera>
{:else}
  <T.PerspectiveCamera makeDefault position={cameraPosition} fov={45} up={DEFAULT_UP}>
    <!-- Constrained turntable (TODO #74): target on the vertical (Z) axis;
         azimuth spins freely AROUND Z, polar TILTS around the screen-horizontal
         axis (clamped just shy of the poles so the part can't flip / tumble).
         PAN is OFF — the axial Z-pan slider (scene.zFocus, folded into the
         target) is the controlled vertical pan, and free pan is exactly what
         dragged the look-at off-axis. Zoom stays on. -->
    <OrbitControls bind:ref={controls}
      target={orbitTarget}
      enableDamping enableZoom enableRotate enablePan={false}
      minPolarAngle={0.0001} maxPolarAngle={Math.PI - 0.0001} />
  </T.PerspectiveCamera>
{/if}

<!-- White scene background (user pref — easier to see the part). BOTH this
     <T.Color> AND the .pd-stage CSS in PrimitiveDualCanvas are white, so it's
     consistent whether the Color attaches (dev) or the build drops it and falls
     back to the CSS (the prior dev-white / prod-black mismatch). -->
<T.Color args={['#ffffff']} attach="background" />
<!-- Ambient fill so the side the directional light doesn't reach isn't black. -->
<T.AmbientLight intensity={scene.ambientIntensity} />

<!-- SOLE light (user pref 2026-06-14): a DIRECTIONAL light projecting PERPENDICULAR
     to the Z (drilling) axis, so the whole length is lit evenly (parallel rays,
     no falloff). `zDirAngle` spins its bearing around Z (0°=+Y front, 90°=+X).
     Works with MeshPhong (no PBR), so colours render true. Target = origin
     (default) → direction is the in-plane bearing toward the axis. Replaced the
     point lights, the Z point-strip, and the rect area light. -->
{#if scene.zDirLight}
  <T.DirectionalLight position={dirPos} intensity={scene.zDirIntensity} />
{/if}

<!-- VIEW-ONLY scale: X and Y = uniform radial diameter exaggeration (xScale on
     BOTH axes, so radially-symmetric parts stay round), Z = depth compression
     (zScale). Wraps BOTH stacked renders + their offsets so the whole
     composition scales together; the geometry on disk + the bake stay true.
     The camera auto-fit + OrbitControls target above account for it. -->
<T.Group scale={[scene.xScale, scene.xScale, scene.zScale]}>
<!-- TOP — live mesh, stacked on the part (Z) axis. -->
<T.Group position={meshPos}>
  {#key geoVersion + (showCutaway ? '_cut' : '_full') + (scene.zRectLight ? '_r' : '')}
    {#if parts && parts.length && !(showCutaway && cutVC)}
      <!-- PER-PART textured meshes (TF per-part texture, #3): each part is its
           OWN mesh with its OWN material — colour · texture map · opacity — so a
           multi-part assembly can show a different texture PER sub-part (which the
           single vertex-coloured mesh can't). FULL VIEW only: `parts` now rides on
           `geo` regardless of cutaway (so material shows however the toggle got
           there), so the cut view must yield to the merged grey/red `cutVC` section
           below (per-part material ON the cut section is out of scope, v1). -->
      {#each parts as p, i (i)}
        {#if p.geo}
          {@const a = p.appearance ?? {}}
          {@const rawOp = (typeof a.opacity === 'number' && a.opacity > 0 && a.opacity < 1) ? a.opacity : 1}
          {@const pOp = Math.max(0.02, Math.min(1, rawOp * (scene.xrayOpacity ?? 1)))}
          {@const pTrans = pOp < 1 || rawOp < 1}
          {@const aPBR = materialPreset(a.material)}
          <!-- renderOrder: OPAQUE parts (pOp>=1) render FIRST (0) so they write
               depth + occlude the background; TRANSPARENT parts (pOp<1) render
               AFTER (1) with depthWrite off but depthTest ON, so they blend over
               the opaque geometry behind them instead of showing the background
               through the overlap (TODO #37). -->
          <T.Mesh geometry={p.geo} renderOrder={pTrans ? 1 : 0}>
            {#if scene.zRectLight}
              <T.MeshStandardMaterial color={a.colorOuter ?? aPBR.color ?? '#cc2222'} map={getMaterialTexture(a.texture)} roughness={aPBR.roughness} metalness={aPBR.metalness} flatShading={!smoothShade} wireframe={scene.wireframe} side={THREE.DoubleSide} transparent={pTrans} opacity={pOp} depthWrite={!pTrans} depthTest={true} />
            {:else}
              <T.MeshPhongMaterial color={a.colorOuter ?? aPBR.color ?? '#cc2222'} map={getMaterialTexture(a.texture)} specular="#666666" shininess={120} flatShading={!smoothShade} wireframe={scene.wireframe} side={THREE.DoubleSide} transparent={pTrans} opacity={pOp} depthWrite={!pTrans} depthTest={true} />
            {/if}
            {#if scene.showEdges}<Edges thresholdAngle={20} color="black" />{/if}
          </T.Mesh>
        {/if}
      {/each}
    {:else if showCutaway && cutParts && cutParts.length}
      <!-- PER-PART CUT meshes (TF v2): the CUT view, per-part. Each part is its
           OWN cut mesh with vertex colours baked by the adapter — OUTER skin in the
           part's material tint, revealed interior GREY — so the cross-section shows
           per-part material (steel metallic on the skin) while still reading as a
           section. Per-part metalness/roughness come from materialPreset; the grey
           interior rides the same vertex-colour attribute so it stays a section. -->
      {#each cutParts as p, i (i)}
        {#if p.geo}
          {@const a = p.appearance ?? {}}
          {@const rawOp = (typeof a.opacity === 'number' && a.opacity > 0 && a.opacity < 1) ? a.opacity : 1}
          {@const pOp = Math.max(0.02, Math.min(1, rawOp * (scene.xrayOpacity ?? 1)))}
          {@const pTrans = pOp < 1 || rawOp < 1}
          {@const aPBR = materialPreset(a.material)}
          <!-- renderOrder: OPAQUE cut parts render FIRST (0, depth-writing) so they
               occlude the background; TRANSPARENT cut parts render AFTER (1) with
               depthWrite off but depthTest ON so they blend over the section behind
               them rather than showing the background at the overlap (TODO #37). -->
          <T.Mesh geometry={p.geo} renderOrder={pTrans ? 1 : 0}>
            {#if scene.zRectLight}
              <T.MeshStandardMaterial vertexColors roughness={aPBR.roughness} metalness={aPBR.metalness} flatShading={!smoothShade} wireframe={scene.wireframe} side={THREE.DoubleSide} transparent={pTrans} opacity={pOp} depthWrite={!pTrans} depthTest={true} />
            {:else}
              <T.MeshPhongMaterial vertexColors specular="#666666" shininess={120} flatShading={!smoothShade} wireframe={scene.wireframe} side={THREE.DoubleSide} transparent={pTrans} opacity={pOp} depthWrite={!pTrans} depthTest={true} />
            {/if}
            {#if scene.showEdges}<Edges thresholdAngle={20} color="black" />{/if}
          </T.Mesh>
        {/if}
      {/each}
    {:else if instMesh}
      <!-- GPU-instanced Stack/Repeat: ONE child mesh drawn under N transforms.
           Material (Phong/Standard + flatShading + vertexColors) + the child's
           red/grey (or override / colour-by-source) colours come baked into
           instMesh above. showEdges rides along as instEdges (a Group of
           per-instance LineSegments) since <Edges> can't follow instanceMatrix. -->
      <T is={instMesh} />
      {#if instEdges}<T is={instEdges} />{/if}
    {:else if splitMesh}
      <!-- MIXED per-subpart alpha: a self-contained 2-group / 2-material mesh so
           the OPAQUE subparts write depth + render solid while only the
           transparent subpart (e.g. an open hole) blends. Materials + opacity /
           wireframe are driven by the splitMesh derived + its effects above. -->
      <T is={splitMesh}>
        {#if scene.showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T>
    {:else if showCutaway && cutVC}
      <!-- Geometry is pre-warped server-side; no subdivide / warp shader. -->
      <T.Mesh geometry={cutVC} bind:ref={liveMeshRef}>
        {#if scene.zRectLight}
          <T.MeshStandardMaterial vertexColors roughness={matPBR.roughness} metalness={matPBR.metalness} flatShading={!smoothShade} bind:ref={liveMat} side={THREE.DoubleSide} />
        {:else}
          <T.MeshPhongMaterial vertexColors specular="#666666" shininess={120} flatShading={!smoothShade} bind:ref={liveMat} side={THREE.DoubleSide} />
        {/if}
        {#if scene.showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T.Mesh>
    {:else if full}
      {@const hasVC = !!full?.getAttribute?.('color')}
      <!-- Geometry is pre-warped server-side; no subdivide / warp shader. -->
      <T.Mesh geometry={full} bind:ref={liveMeshRef}>
        {#if scene.zRectLight}
          {#if hasVC}
            <T.MeshStandardMaterial vertexColors roughness={matPBR.roughness} metalness={matPBR.metalness} flatShading={!smoothShade} bind:ref={liveMat} side={THREE.DoubleSide} />
          {:else}
            <T.MeshStandardMaterial color={colorOuter ?? matPBR.color ?? '#cc2222'} map={getMaterialTexture(texture)} roughness={matPBR.roughness} metalness={matPBR.metalness} flatShading={!smoothShade} bind:ref={liveMat} side={THREE.DoubleSide} />
          {/if}
        {:else if hasVC}
          <T.MeshPhongMaterial vertexColors specular="#666666" shininess={120} flatShading={!smoothShade} bind:ref={liveMat} side={THREE.DoubleSide} />
        {:else}
          <T.MeshPhongMaterial color={colorOuter ?? matPBR.color ?? '#cc2222'} map={getMaterialTexture(texture)} specular="#666666" shininess={120} flatShading={!smoothShade} bind:ref={liveMat} side={THREE.DoubleSide} />
        {/if}
        {#if scene.showEdges}<Edges thresholdAngle={20} color="black" />{/if}
      </T.Mesh>
    {/if}
  {/key}
  <T.Mesh position={[AX_LEN/2,0,0]} rotation={[0,0,-Math.PI/2]}><T.CylinderGeometry args={[AX_R,AX_R,AX_LEN,12]} /><T.MeshBasicMaterial color="#ff3030" /></T.Mesh>
  <T.Mesh position={[0,AX_LEN/2,0]}><T.CylinderGeometry args={[AX_R,AX_R,AX_LEN,12]} /><T.MeshBasicMaterial color="#30c030" /></T.Mesh>
  <T.Mesh position={[0,0,AX_LEN/2]} rotation={[Math.PI/2,0,0]}><T.CylinderGeometry args={[AX_R,AX_R,AX_LEN,12]} /><T.MeshBasicMaterial color="#3060ff" /></T.Mesh>
  <!-- Spline diagnostic overlays (TODO #24) — sit in the LIVE-mesh group so they
       align with (+ scale with) the baked geometry. VIEW-ONLY. -->
  {#each overlayObjs as ov (ov.uuid)}
    <T is={ov} />
  {/each}
</T.Group>

<!-- BOTTOM — baked GLB, stacked below the mesh on the part (Z) axis. The view
     scale is applied by the parent group. -->
{#if loaded}
  <T.Group position={glbPos}>
    <T is={loaded} />
  </T.Group>
{/if}
</T.Group><!-- /view-scale group -->

<!-- Vertex-normals diagnostic (VIEW-ONLY). Mounted at the scene ROOT: the helper
     bakes the live mesh's WORLD matrix (which already includes the view-scale
     group + meshPos) into itself, so it aligns without inheriting that group's
     transform a second time. Nothing renders when the toggle is off. -->
{#if normalsHelper}
  <T is={normalsHelper} />
{/if}

<!-- Title + description are now DOM overlays in PrimitiveDualCanvas (.pd-stage),
     not a Threlte <HTML> overlay — the latter's wrapper rendered with
     pointer-events:auto at z-index 8 and swallowed clicks on the ⬇ GLB button. -->
