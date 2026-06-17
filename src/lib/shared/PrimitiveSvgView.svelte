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
   * The component exposes nothing else. The camera is read from the shared
   * `scene` store (scene-state.svelte.ts, READ-ONLY here): camera position from
   * `scene.cam`, look-at from `scene.partCenter` (+ `scene.zFocus`), the
   * view-only `scene.xScale` / `scene.zScale` exaggeration group, and
   * `scene.showCutaway` to pick `cutVC` vs `full`. Z-down convention: up =
   * [0, 0, -1], mirroring PrimitiveDualScene.
   *
   * SHADING — we do NOT use SVGRenderer's lighting (it clamp-and-multiplies and
   * washes rounded parts out). Instead we bake an ARTIFICIAL per-face shade into
   * vertex colours (axial Lambert key + fresnel-style silhouette falloff) and
   * render FLAT (MeshBasicMaterial). `smooth`/`cel` toolbar toggle picks a
   * gradient vs a 4-band toon ramp.
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
    res = 'coarse',
    onSetRes = undefined,
    busy = false,
  }: {
    meshJson?: SerializedComponentResult | null;
    name?: string;
    active?: boolean;
    /** Bake resolution shown in the toolbar toggle. 'coarse' = 32-segment bake
     *  (default, fast/light), 'high' = full 256. The actual bake (segments) is
     *  driven by the parent via onSetRes — this component only renders the
     *  toggle + the mesh it's handed. */
    res?: 'coarse' | 'high';
    onSetRes?: (v: 'coarse' | 'high') => void;
    /** Parent is re-baking at a new resolution → show a hint. */
    busy?: boolean;
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
  // The per-render non-indexed, shaded geometry copy (disposed on the next
  // render / teardown — toNonIndexed() always allocates a fresh buffer).
  let lastShadedGeo: THREE.BufferGeometry | null = null;

  // ortho (default) vs persp projection — persisted so the choice sticks across
  // tab/part switches. Ortho is the technical-drawing projection (no foreshorten),
  // which is what an SVG export usually wants.
  let projection = $state<'persp' | 'ortho'>('ortho');
  $effect(() => {
    try {
      const p = localStorage.getItem('ge-svg-projection');
      if (p === 'persp' || p === 'ortho') projection = p;
    } catch { /* localStorage blocked — fine */ }
  });
  function setProjection(p: 'persp' | 'ortho') {
    projection = p;
    try { localStorage.setItem('ge-svg-projection', p); } catch { /* ignore */ }
  }

  // Cel / toon toggle — quantizes the artificial shade into 4 bands for a
  // technical-illustration look (off = smooth gradient). Persisted like the
  // projection so the choice sticks across tab/part switches.
  let cel = $state(false);
  $effect(() => {
    try {
      if (localStorage.getItem('ge-svg-cel') === '1') cel = true;
    } catch { /* localStorage blocked — fine */ }
  });
  function setCel(v: boolean) {
    cel = v;
    try { localStorage.setItem('ge-svg-cel', v ? '1' : '0'); } catch { /* ignore */ }
  }

  // Adjustable artificial-shader dials (the slider IS the product). `light` =
  // ambient floor (how bright the shadow side is; higher → flatter). `rim` =
  // silhouette floor (lower → the edge crushes darker / reads rounder). Both
  // span their term to 1.0 so a fully-lit face stays at full base colour.
  let svgLight = $state(0.32);
  let svgRim   = $state(0.5);
  $effect(() => {
    try {
      const l = Number(localStorage.getItem('ge-svg-light'));
      const r = Number(localStorage.getItem('ge-svg-rim'));
      if (Number.isFinite(l) && l > 0) svgLight = l;
      if (Number.isFinite(r) && r > 0) svgRim = r;
    } catch { /* ignore */ }
  });
  function setSvgLight(v: number) { svgLight = v; try { localStorage.setItem('ge-svg-light', String(v)); } catch { /* ignore */ } }
  function setSvgRim(v: number)   { svgRim = v;   try { localStorage.setItem('ge-svg-rim', String(v)); } catch { /* ignore */ } }

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
    if (lastShadedGeo) { lastShadedGeo.dispose(); lastShadedGeo = null; }
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

    const threeScene = new THREE.Scene();
    threeScene.background = new THREE.Color('#ffffff');

    // View-only scale group [xScale, xScale, zScale] — mirrors PrimitiveDualScene
    // so the SVG frames long thin tools the same way the 3D pane does.
    const group = new THREE.Group();
    group.scale.set(scene.xScale, scene.xScale, scene.zScale);

    // Camera. Built FIRST: the artificial shader (below) needs the view
    // direction. Z-down convention (up = [0,0,-1]) in both modes.
    // renderW/renderH = the SVG's pixel size. PERSP fills the container (fit, no
    // scroll). ORTHO renders at the part's NATURAL proportions (a long tool →
    // tall SVG) so the stage scrolls and you can read it at size.
    let camera: THREE.Camera;
    let renderW = Math.max(1, w);
    let renderH = Math.max(1, h);
    let fitToContainer = true;
    if (projection === 'ortho') {
      // ORTHOGRAPHIC = a straight perpendicular technical ELEVATION. We IGNORE
      // the orbited 3D camera and look dead-on perpendicular to the Z (drilling)
      // axis at the centreline (x=0, y=0), centred on the part's Z span so the
      // whole length frames. Z runs vertically; parallel edges stay parallel.
      geo.computeBoundingBox();
      const bb = geo.boundingBox;
      const halfX = bb ? 0.5 * (bb.max.x - bb.min.x) * scene.xScale : 1;
      const halfY = bb ? 0.5 * (bb.max.y - bb.min.y) * scene.xScale : 1;
      const padH = (Math.hypot(halfX, halfY) || 1) * 1.05;   // radial → horizontal
      const halfZ = bb ? 0.5 * (bb.max.z - bb.min.z) * scene.zScale : 1;
      const padV = (Math.max(halfZ, 0.001)) * 1.05;          // z half-span → vertical
      const czWorld = bb ? 0.5 * (bb.min.z + bb.max.z) * scene.zScale : 0;
      // Render at the part's true V/H aspect, width pinned to the container.
      // Cap the longest side so a very long tool doesn't produce a monster SVG.
      renderW = Math.max(1, w);
      renderH = Math.max(1, Math.round(renderW * (padV / padH)));
      const MAXPX = 8000;
      if (renderH > MAXPX) { renderH = MAXPX; renderW = Math.max(1, Math.round(MAXPX * (padH / padV))); }
      fitToContainer = false;
      camera = new THREE.OrthographicCamera(-padH, padH, padV, -padV, 0.1, 100000);
      camera.up.set(0, 0, -1);
      camera.position.set(0, 1000, czWorld); // +Y axis; ortho → distance is cosmetic
      camera.lookAt(0, 0, czWorld);
    } else {
      // PERSPECTIVE: mirror the 3D pane — fov 45, the live (orbitable) camera.
      camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 100000);
      camera.up.set(0, 0, -1);
      camera.position.set(scene.cam.x, scene.cam.y, scene.cam.z);
      camera.lookAt(
        scene.partCenter.x,
        scene.partCenter.y,
        scene.partCenter.z + scene.zFocus,
      );
    }

    // ── Artificial per-face shader ───────────────────────────────────────
    // We DON'T let SVGRenderer light the mesh (its clamp-and-multiply model
    // washes rounded parts out). Instead we bake our OWN shade into per-face
    // colours and render them FLAT (MeshBasicMaterial, no lights in the scene):
    // an axial Lambert key + a fresnel-style silhouette falloff so a revolved
    // tool reads as ROUND. The colours ARE the shading. Non-indexed first → each
    // triangle owns its 3 verts, so a face can carry one flat colour.
    const viewDir = (camera as THREE.Camera).getWorldDirection(new THREE.Vector3()); // points INTO the scene
    const shadedGeo = geo.toNonIndexed();
    const pos = shadedGeo.getAttribute('position') as THREE.BufferAttribute;
    // cutVC carries per-vertex red-outer / grey-bore colours; preserve them and
    // just multiply by shade. No colour attribute → the solid-mesh red.
    const srcCol = shadedGeo.getAttribute('color') as THREE.BufferAttribute | undefined;
    const nFaces = Math.floor(pos.count / 3);
    const colArr = new Float32Array(pos.count * 3);
    // Fixed key light. Z-down: -z is "up"; +y points toward the (default) viewer
    // so dead-on faces read bright and the silhouette falls away.
    const L = new THREE.Vector3(0.35, 0.55, -0.75).normalize();
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nrm = new THREE.Vector3();
    const DEF = [0.8, 0.133, 0.133] as const; // #cc2222 solid-mesh red
    for (let f = 0; f < nFaces; f++) {
      const i0 = 3 * f, i1 = i0 + 1, i2 = i0 + 2;
      va.fromBufferAttribute(pos, i0);
      vb.fromBufferAttribute(pos, i1);
      vc.fromBufferAttribute(pos, i2);
      // Face normal = (b−a) × (c−a), normalized.
      nrm.copy(e1.copy(vb).sub(va)).cross(e2.copy(vc).sub(va)).normalize();
      // DoubleSide: flip the normal toward the camera so back-faces shade right.
      if (nrm.dot(viewDir) > 0) nrm.negate();
      const ndl = Math.max(0, nrm.dot(L));
      const lambert = svgLight + (1 - svgLight) * ndl;          // ambient floor (dial) + key
      const facing = Math.abs(nrm.dot(viewDir));                // 1 = facing camera, 0 = silhouette
      const rim = svgRim + (1 - svgRim) * Math.pow(facing, 1.5); // silhouette floor (dial) → reads ROUND
      let shade = Math.min(1, lambert * rim);
      if (cel) shade = Math.max(0.35, Math.round(shade * 3) / 3); // 4-band toon, 0.35 floor
      // Base colour for THIS face = vertex a's colour, shaded + clamped.
      const br = srcCol ? srcCol.getX(i0) : DEF[0];
      const bg = srcCol ? srcCol.getY(i0) : DEF[1];
      const bl = srcCol ? srcCol.getZ(i0) : DEF[2];
      const r = Math.min(1, br * shade), g = Math.min(1, bg * shade), b = Math.min(1, bl * shade);
      colArr[i0 * 3] = r; colArr[i0 * 3 + 1] = g; colArr[i0 * 3 + 2] = b;
      colArr[i1 * 3] = r; colArr[i1 * 3 + 1] = g; colArr[i1 * 3 + 2] = b;
      colArr[i2 * 3] = r; colArr[i2 * 3 + 1] = g; colArr[i2 * 3 + 2] = b;
    }
    shadedGeo.setAttribute('color', new THREE.BufferAttribute(colArr, 3));

    // Flat: the baked vertex colours ARE the shading, so no lighting model.
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(shadedGeo, mat));

    // Edge outline — black crease/silhouette lines at a 20° threshold, matching
    // the 3D pane's <Edges thresholdAngle={20}>. SVGRenderer strokes
    // LineSegments as <path>s in correct painter's-algorithm depth order, so the
    // drawing reads as outlined shapes instead of a borderless colour mass.
    // Built from the original `geo` (indexed → crisp crease detection). Gated on
    // scene.showEdges. No HLR — all creases draw, fine for a technical drawing.
    let edgeLines: THREE.LineSegments | null = null;
    let edgeGeo: THREE.EdgesGeometry | null = null;
    if (scene.showEdges) {
      edgeGeo = new THREE.EdgesGeometry(geo, 20);
      edgeLines = new THREE.LineSegments(
        edgeGeo,
        new THREE.LineBasicMaterial({ color: 0x000000 }),
      );
      group.add(edgeLines);
    }
    threeScene.add(group);

    if (!renderer) {
      renderer = new Ctor();
      renderer.setQuality('high');
    }
    renderer.setClearColor('#ffffff');
    renderer.setSize(renderW, renderH);
    renderer.render(threeScene, camera);

    // Mount / refresh the produced <svg>. SVGRenderer reuses its domElement and
    // clears it each render (autoClear), so we only (re)attach if detached.
    if (container && renderer.domElement.parentNode !== container) {
      container.replaceChildren(renderer.domElement);
    }
    const el = renderer.domElement as SVGElement;
    el.style.display = 'block';
    if (fitToContainer) {
      // PERSP: fill the stage, no scroll.
      el.style.width = '100%';
      el.style.height = '100%';
    } else {
      // ORTHO: natural pixel size → overflows the stage → scrollbar.
      el.style.width = `${renderW}px`;
      el.style.height = `${renderH}px`;
      el.style.margin = '0 auto';
    }

    // Dispose the previous frame's material + shaded geometry now the new one
    // is drawn (toNonIndexed() + the baked colour buffer allocate every render).
    if (lastMat && lastMat !== mat) lastMat.dispose();
    lastMat = mat;
    if (lastShadedGeo && lastShadedGeo !== shadedGeo) lastShadedGeo.dispose();
    lastShadedGeo = shadedGeo;
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
    void projection;
    void cel;
    void svgLight; void svgRim;

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
      <span class="svg-tris">{triCount.toLocaleString()} tris{busy ? ' · re-baking…' : ''}</span>
    {/if}
    <!-- Resolution toggle — coarse (32-seg, default, fast) vs high (full 256).
         Drives the parent's bake via onSetRes. -->
    {#if onSetRes}
      <div class="svg-proj" role="group" aria-label="Resolution">
        <button class="svg-proj-btn" class:on={res === 'coarse'}
          title="Coarse — 32-segment bake (fast, light; the right choice for a vector drawing)"
          onclick={() => onSetRes?.('coarse')}>coarse</button>
        <button class="svg-proj-btn" class:on={res === 'high'}
          title="High — full 256-segment bake (smoother circles, heavier SVG)"
          onclick={() => onSetRes?.('high')}>high</button>
      </div>
    {/if}
    <!-- Projection toggle — ortho (default, technical drawing) vs persp. -->
    <div class="svg-proj" role="group" aria-label="Projection">
      <button class="svg-proj-btn" class:on={projection === 'persp'}
        title="Perspective projection" onclick={() => setProjection('persp')}>persp</button>
      <button class="svg-proj-btn" class:on={projection === 'ortho'}
        title="Orthographic projection — parallel edges, no foreshortening (technical drawing)"
        onclick={() => setProjection('ortho')}>ortho</button>
    </div>
    <!-- Shading toggle — smooth gradient (default) vs 4-band cel/toon. -->
    <div class="svg-proj" role="group" aria-label="Shading">
      <button class="svg-proj-btn" class:on={!cel}
        title="Smooth artificial shading (axial Lambert + silhouette falloff)"
        onclick={() => setCel(false)}>smooth</button>
      <button class="svg-proj-btn" class:on={cel}
        title="Cel / toon — quantize the shade into 4 bands (technical illustration)"
        onclick={() => setCel(true)}>cel</button>
    </div>
    <!-- Shader dials — drag to taste. light = shadow-side brightness (higher =
         flatter), rim = silhouette darkening (lower = crushes darker / rounder). -->
    <div class="svg-dials" title="Shading: light = shadow brightness · rim = silhouette falloff">
      <label class="svg-dial"><span>light</span>
        <input type="range" min="0.1" max="0.6" step="0.02" value={svgLight}
          oninput={(e) => setSvgLight(Number((e.currentTarget as HTMLInputElement).value))} /></label>
      <label class="svg-dial"><span>rim</span>
        <input type="range" min="0.2" max="1" step="0.02" value={svgRim}
          oninput={(e) => setSvgRim(Number((e.currentTarget as HTMLInputElement).value))} /></label>
    </div>
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
  .svg-proj {
    margin-left: auto;
    display: inline-flex;
    border: 1px solid #bbb;
    border-radius: 4px;
    overflow: hidden;
  }
  .svg-proj-btn {
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
    border: 0;
    background: #fafafa;
    color: #555;
    cursor: pointer;
  }
  .svg-proj-btn + .svg-proj-btn { border-left: 1px solid #ddd; }
  .svg-proj-btn:hover { background: #f0f0f0; }
  .svg-proj-btn.on { background: #0369a1; color: #fff; }
  .svg-dials { display: inline-flex; align-items: center; gap: 8px; }
  .svg-dial { display: inline-flex; align-items: center; gap: 3px; font: 600 10px Arial; color: #57534e; }
  .svg-dial input[type="range"] { width: 56px; accent-color: #0369a1; }
  .svg-dl {
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
    overflow: auto;        /* scroll when the SVG (ortho, natural size) overflows */
    background: #ffffff;
  }
  .svg-canvas {
    /* Fills the stage for perspective (svg = 100%); grows with the svg's
       natural pixel size for ortho so the stage scrolls. */
    position: relative;
    width: 100%;
    min-height: 100%;
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
