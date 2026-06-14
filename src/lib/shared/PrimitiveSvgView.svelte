<script lang="ts">
  /**
   * PrimitiveSvgView — render a baked part's geometry as a scalable, vector
   * <svg> using three's built-in SVGRenderer (one filled polygon per triangle,
   * painter's-algorithm z-sort, flat fills). Self-contained "Route 1" of
   * docs/plans/svg-geometry-tab.md — a crisp, documentation-ready line/fill
   * drawing of the current part that downloads as a `.svg`.
   *
   * PROP CONTRACT
   * -------------
   *   meshJson : SerializedComponentResult | null
   *       The mesh-JSON `{ full, cutVC }` pair that `mesh-serial`'s
   *       `deserializeComponentResult` consumes (positions + optional
   *       normals/colors, indexed or not). PREFERRED input — decouples this
   *       view from the bake (no re-baking here). `cutVC` carries the per-vertex
   *       red-outer / grey-bore cutaway colours; `full` is the solid mesh.
   *       Pass `null` (or an empty pair) and the view shows a graceful
   *       placeholder.
   *   name : string
   *       Title shown in the toolbar + the download filename (`${name}.svg`).
   *   active : boolean
   *       Only run the SVGRenderer when true (mirrors the active-tab-only WebGL
   *       discipline). When false the renderer is torn down and the <svg>
   *       detached — nothing renders, no leak.
   *
   * The component exposes nothing else. Camera + lights are read from the shared
   * `scene` store (scene-state.svelte.ts, READ-ONLY here): camera position from
   * `scene.cam`, look-at from `scene.partCenter` (+ `scene.zFocus`), the
   * view-only `scene.xScale` / `scene.zScale` exaggeration group, and
   * `scene.showCutaway` to pick `cutVC` vs `full`. Z-down convention: up =
   * [0, 0, -1], mirroring PrimitiveDualScene.
   */
  import * as THREE from 'three';
  import { scene } from '$lib/shared/scene-state.svelte';
  import {
    deserializeComponentResult,
    type SerializedComponentResult,
  } from '$lib/cad/mesh-serial';

  let {
    meshJson = null,
    name = 'part',
    active = false,
  }: {
    meshJson?: SerializedComponentResult | null;
    name?: string;
    active?: boolean;
  } = $props();

  // One filled polygon PER triangle with no hidden-line removal — above this
  // the SVG balloons (the live viewer bakes circles at 192 segments). We render
  // anyway but surface an inline warning so the author can re-bake coarser.
  const HIGH_TRI = 4000;

  // Lazy/cached SVGRenderer constructor — kept OUT of the WebGL bundle and off
  // the SSR path (module-scope so it's shared across instances, loaded once).
  let SVGRendererCtor: any = null;
  async function loadSVGRenderer() {
    if (!SVGRendererCtor) {
      const mod = await import('three/examples/jsm/renderers/SVGRenderer.js');
      SVGRendererCtor = mod.SVGRenderer;
    }
    return SVGRendererCtor;
  }

  // --- rehydrate mesh-JSON → THREE.BufferGeometry pair (only when it changes) ---
  let geos = $derived.by(() =>
    meshJson ? deserializeComponentResult(meshJson) : null,
  );
  function vertCount(g: THREE.BufferGeometry | undefined): number {
    return (g?.getAttribute('position') as THREE.BufferAttribute | undefined)?.count ?? 0;
  }
  let hasGeo = $derived(
    !!geos && (vertCount(geos.full) > 0 || vertCount(geos.cutVC) > 0),
  );

  // --- DOM + renderer handles (non-reactive; live across re-renders) ---
  let container = $state<HTMLDivElement | null>(null);
  let renderer: any = null;
  let lastMat: THREE.Material | null = null;

  let size = $state({ w: 0, h: 0 });
  let hasRendered = $state(false);
  let warnHighPoly = $state(false);
  let triCount = $state(0);
  let errorMsg = $state<string | null>(null);

  // Observe the stage so the SVG re-renders crisp at the container's size.
  $effect(() => {
    if (!container) return;
    const measure = () => {
      const w = Math.max(0, Math.floor(container!.clientWidth));
      const h = Math.max(0, Math.floor(container!.clientHeight));
      if (w !== size.w || h !== size.h) size = { w, h };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(container);
    return () => ro.disconnect();
  });

  function teardown() {
    if (lastMat) { lastMat.dispose(); lastMat = null; }
    if (container) container.replaceChildren();
    renderer = null;
    hasRendered = false;
  }

  function renderToSvg(
    Ctor: any,
    pair: { full: THREE.BufferGeometry; cutVC: THREE.BufferGeometry },
    w: number,
    h: number,
  ) {
    errorMsg = null;

    // Pick cutaway (red outer / grey bore) when toggled + present, else solid.
    const useCut = scene.showCutaway && vertCount(pair.cutVC) > 0;
    const geo = useCut
      ? pair.cutVC
      : vertCount(pair.full) > 0
        ? pair.full
        : null;
    if (!geo) { errorMsg = 'No geometry to render'; return; }

    // Triangle count → perf guard.
    const tris = geo.index
      ? geo.index.count / 3
      : vertCount(geo) / 3;
    triCount = Math.round(tris);
    warnHighPoly = tris > HIGH_TRI;

    // SVGRenderer does flat per-face fills. MeshPhongMaterial maps to flat
    // diffuse lighting; vertex colours (cutVC) multiply the white base so the
    // red/grey split survives. The solid mesh renders flat red (#cc2222),
    // matching PrimitiveDualScene's full-mesh convention.
    const hasVC = !!geo.getAttribute('color');
    const mat = new THREE.MeshPhongMaterial({
      color: hasVC ? '#ffffff' : '#cc2222',
      vertexColors: hasVC,
      flatShading: true,
      side: THREE.DoubleSide,
      shininess: 0,
      specular: '#000000',
    });

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color('#ffffff');

    // View-only scale group [xScale, xScale, zScale] — mirrors PrimitiveDualScene
    // so the SVG frames long thin tools the same way the 3D pane does.
    const group = new THREE.Group();
    group.scale.set(scene.xScale, scene.xScale, scene.zScale);
    group.add(new THREE.Mesh(geo, mat));
    threeScene.add(group);

    // Lights — same directions as PrimitiveDualScene's l1/l2/l3, but as
    // DirectionalLights at SVGRenderer-appropriate intensities (its lighting
    // model multiplies raw intensity, so the scene's WebGL 500s would blow out;
    // these give a readable flat-shaded drawing).
    threeScene.add(new THREE.AmbientLight(0xffffff, 0.45));
    const addDir = (p: { x: number; y: number; z: number }, i: number) => {
      const d = new THREE.DirectionalLight(0xffffff, i);
      d.position.set(p.x, p.y, p.z);
      threeScene.add(d);
    };
    addDir(scene.l1, 0.55);
    addDir(scene.l2, 0.4);
    addDir(scene.l3, 0.25);

    // Camera — mirror PrimitiveDualScene: fov 45, position from scene.cam,
    // up = [0,0,-1] (Z-down), look at partCenter (+ zFocus pan along Z).
    const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100000);
    camera.up.set(0, 0, -1);
    camera.position.set(scene.cam.x, scene.cam.y, scene.cam.z);
    camera.lookAt(
      scene.partCenter.x,
      scene.partCenter.y,
      scene.partCenter.z + scene.zFocus,
    );

    if (!renderer) {
      renderer = new Ctor();
      renderer.setQuality('high');
    }
    renderer.setClearColor('#ffffff');
    renderer.setSize(w, h);
    renderer.render(threeScene, camera);

    // Mount / refresh the produced <svg>. SVGRenderer reuses its domElement and
    // clears it each render (autoClear), so we only (re)attach if detached.
    if (container && renderer.domElement.parentNode !== container) {
      container.replaceChildren(renderer.domElement);
      const el = renderer.domElement as SVGElement;
      el.style.width = '100%';
      el.style.height = '100%';
      el.style.display = 'block';
    }

    // Dispose the previous frame's material now that the new one is drawn.
    if (lastMat && lastMat !== mat) lastMat.dispose();
    lastMat = mat;
    hasRendered = true;
  }

  // Render whenever active + geometry present, re-firing on camera / partCenter /
  // cutaway / view-scale / size changes. Inactive → tear down (no SVGRenderer
  // running for a hidden tab).
  $effect(() => {
    // Track reactive deps explicitly so the effect re-runs on each.
    const isActive = active;
    const pair = geos;
    const w = size.w, h = size.h;
    // camera / view deps
    void scene.cam.x; void scene.cam.y; void scene.cam.z;
    void scene.partCenter.x; void scene.partCenter.y; void scene.partCenter.z;
    void scene.zFocus; void scene.xScale; void scene.zScale;
    void scene.showCutaway;

    if (!isActive) { teardown(); return; }
    if (!container || !pair || w === 0 || h === 0) return;
    if (vertCount(pair.full) === 0 && vertCount(pair.cutVC) === 0) {
      errorMsg = null;
      return;
    }

    let cancelled = false;
    (async () => {
      const Ctor = await loadSVGRenderer();
      if (cancelled || !active) return;
      try {
        renderToSvg(Ctor, pair, w, h);
      } catch (e) {
        errorMsg = e instanceof Error ? e.message : String(e);
      }
    })();
    return () => { cancelled = true; };
  });

  // Dispose rehydrated geometry when this view's mesh-JSON goes away / unmount.
  $effect(() => {
    const pair = geos;
    return () => {
      pair?.full?.dispose?.();
      pair?.cutVC?.dispose?.();
    };
  });

  function downloadSvg() {
    if (!renderer?.domElement) return;
    let xml = (renderer.domElement as SVGElement).outerHTML;
    if (!xml.includes('xmlns=')) {
      xml = xml.replace('<svg ', '<svg xmlns="http://www.w3.org/2000/svg" ');
    }
    const blob = new Blob(
      ['<?xml version="1.0" encoding="UTF-8"?>\n', xml],
      { type: 'image/svg+xml;charset=utf-8' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${(name || 'part').replace(/[^\w.-]+/g, '_')}.svg`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }
</script>

<div class="svg-view">
  <div class="svg-toolbar">
    <span class="svg-title" title={name}>{name || 'part'}</span>
    {#if hasRendered && triCount > 0}
      <span class="svg-tris">{triCount.toLocaleString()} tris</span>
    {/if}
    <button class="svg-dl" onclick={downloadSvg} disabled={!hasRendered}>
      ⤓ .svg
    </button>
  </div>

  {#if warnHighPoly}
    <div class="svg-warn">
      high-poly — SVG may be heavy; bake at a lower segment count for a cleaner
      drawing
    </div>
  {/if}

  <div class="svg-stage">
    <!-- Dedicated container the SVGRenderer owns (replaceChildren) — no Svelte
         children inside it, so overlays live as siblings. -->
    <div class="svg-canvas" bind:this={container}></div>

    {#if active && !hasGeo}
      <div class="svg-overlay">No geometry to render</div>
    {:else if errorMsg}
      <div class="svg-overlay">SVG render failed: {errorMsg}</div>
    {/if}
  </div>
</div>

<style>
  .svg-view {
    display: flex;
    flex-direction: column;
    width: 100%;
    height: 100%;
    min-height: 0;
    background: #ffffff;
  }
  .svg-toolbar {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0.6rem;
    border-bottom: 1px solid #e3e3e3;
    flex: 0 0 auto;
  }
  .svg-title {
    font-weight: 600;
    font-size: 0.85rem;
    color: #222;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .svg-tris {
    font-size: 0.7rem;
    color: #888;
    white-space: nowrap;
  }
  .svg-dl {
    margin-left: auto;
    font-size: 0.78rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid #bbb;
    border-radius: 4px;
    background: #fafafa;
    cursor: pointer;
  }
  .svg-dl:disabled {
    opacity: 0.45;
    cursor: default;
  }
  .svg-dl:not(:disabled):hover {
    background: #f0f0f0;
  }
  .svg-warn {
    flex: 0 0 auto;
    padding: 0.3rem 0.6rem;
    font-size: 0.72rem;
    color: #8a5a00;
    background: #fff4d6;
    border-bottom: 1px solid #f0e0b0;
  }
  .svg-stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
    background: #ffffff;
  }
  .svg-canvas {
    position: absolute;
    inset: 0;
  }
  .svg-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    color: #999;
    font-size: 0.85rem;
    pointer-events: none;
  }
</style>
