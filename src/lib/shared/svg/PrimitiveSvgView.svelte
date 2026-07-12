<script lang="ts">
  /**
   * PrimitiveSvgView — render a baked part's geometry as a scalable, vector
   * <svg> using a CUSTOM per-triangle GOURAUD emitter. Self-contained "Route 1"
   * of docs/plans/svg-geometry-tab.md — a crisp, documentation-ready drawing of
   * the current part that downloads as a `.svg`.
   *
   * PROP CONTRACT
   * -------------
   *   meshJson : SerializedComponentResult | null
   *       The mesh-JSON `{ full, cutVC }` pair that `mesh-serial`'s
   *       `deserializeComponentResult` consumes (positions + per-vertex
   *       normals/colors, non-indexed). PREFERRED input — decouples this view
   *       from the bake (no re-baking here). `cutVC` carries the per-vertex
   *       red-outer / grey-bore cutaway colours; `full` is the solid mesh.
   *       Pass `null` (or an empty pair) and the view shows a graceful
   *       placeholder.
   *   name : string
   *       Title shown in the toolbar + the download filename (`${name}.svg`).
   *   active : boolean
   *       Only render when true (mirrors the active-tab-only WebGL discipline).
   *       When false the <svg> is detached — nothing renders, no leak.
   *
   * The component exposes nothing else. The camera is read from the shared
   * `scene` store (scene-state.svelte.ts, READ-ONLY here): camera position from
   * `scene.cam`, look-at from `scene.partCenter` (+ `scene.zFocus`), the
   * view-only `scene.xScale` / `scene.zScale` exaggeration, and
   * `scene.showCutaway` to pick `cutVC` vs `full`. Z-down convention: up =
   * [0, 0, -1], mirroring PrimitiveDualScene.
   *
   * SHADING — GOURAUD from the baked per-vertex `normal` attribute. We do NOT
   * use three's SVGRenderer: it averages each face to ONE flat fill and discards
   * the 3 vertex shades, so a revolved part BANDS (one flat fill per triangle).
   * Instead we project every vertex OURSELVES and, per vertex, compute a shade
   * `s = ambient + key·max(0, n·L) + fill·max(0, n·V)` from the (now-correct)
   * per-vertex normal — so the shade follows the actual surface everywhere
   * (straight cylinders, stepped shoulders, splined profiles). The `fill` is a
   * constant camera-side headlight so a viewer-facing surface never blacks out
   * when the key swings away. Per triangle we emit one
   * `<linearGradient gradientUnits="userSpaceOnUse">` along the screen-space
   * shade gradient ∇s, spanning the triangle, with 2 stops = baseColour×s at the
   * dark and bright corners. Coincident vertices on a shared edge carry the SAME
   * smooth normal ⇒ identical shade ⇒ neighbouring gradients match along the
   * shared edge ⇒ continuous, smooth, NO banding even at 32-seg. A single
   * light-angle slider spins L about the view so the highlight sweeps.
   */
  import * as THREE from 'three';
  import { scene } from '$lib/shared/viewer/scene-state.svelte';
  import {
    deserializeComponentResult,
    type SerializedComponentResult,
  } from '$lib/engines/manifold/mesh-serial';
  import { buildSvgCamera } from '$lib/shared/svg/svg-camera';
  import { projectScene, shadeAndEmit, type ProjectedScene, type ProjectEntry } from '$lib/shared/svg/svg-emit';

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

  // Above this many triangles one <linearGradient> def PER triangle balloons the
  // SVG, so we fall back to a single FLAT fill per face (still painter-sorted).
  // Coarse (32-seg) parts sit well under this — the gradient path is the target.
  const HIGH_TRI = 4000;

  // Lighting terms. s = AMBIENT + KEY·max(0, n·L) + FILL·max(0, n·V), clamped to
  // 1. AMBIENT is the flat floor; KEY is the rotatable highlight (the slider
  // spins L); FILL is a constant CAMERA-SIDE headlight so a surface that faces
  // the viewer never drops to near-black when the key swings away (without the
  // fill, a dark-red base × ambient-only reads almost black — flagged in test).
  const AMBIENT = 0.25;
  const KEY = 0.55;
  const FILL = 0.28;
  // Default solid-mesh base colour (#cc2222 red); the cutaway mesh carries its
  // own per-vertex red-outer / grey-bore colours.
  const DEF_R = 0.8, DEF_G = 0.133, DEF_B = 0.133;

  // Tone-match the 3D MeshPhong bake. The bake's white scene light desaturates +
  // dims a saturated base colour (e.g. #23cd2e green → muted olive), but our
  // base×shade keeps it neon. So before shading we mute each face's base toward
  // its own luminance (DESAT) and dim it (BRIGHT) — a pure recolour of the base,
  // so the Gouraud gradient stays exact. Tune to taste against the 3D pane.
  const DESAT = 0.45;   // 0 = vivid (true colour) · 1 = greyscale
  const BRIGHT = 0.82;  // overall multiplier (the bake reads darker than full colour)
  // The base-mute (DESAT/BRIGHT), the per-vertex Gouraud shading + screen-space
  // gradient emit, the painter's sort, and the edge outline all live in the pure
  // `svg-emit` module; the ortho/persp camera build lives in `svg-camera`. This
  // shell owns lifecycle + the toolbar and passes plain values down.

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

  // Unique per-instance gradient-id namespace. /primitives mounts N of these and
  // `url(#id)` resolves DOCUMENT-WIDE, so without a private prefix two instances'
  // svgs (transiently coexisting during a tab switch) collide on `g{n}` ids → a
  // polygon resolves to the WRONG instance's gradient → flat shading. See
  // svg-emit's `idPrefix`. One stable token per mount.
  const svgUid = `s${(
    globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)
  ).replace(/-/g, '').slice(0, 10)}-`;

  // --- DOM handles (non-reactive; live across re-renders) ---
  let container = $state<HTMLDivElement | null>(null);
  // The <svg> we built last render (download target; replaced each render).
  let svgEl: SVGSVGElement | null = null;

  // --- PROJECTION CACHE (batch-5 Phase 0) ---
  // The projected/sorted triangle list + edge path depend only on geometry +
  // camera + scale, NOT on the light angle or per-part opacity. Cache it keyed
  // by those inputs so a light-dial / x-ray drag re-runs ONLY the (cheap) shade
  // pass — no re-projection, no EdgesGeometry rebuild.
  let cachedProj: ProjectedScene | null = null;
  let cachedProjKey = '';
  // Stable identity per rehydrated geometry object (part of the cache key so a
  // fresh bake invalidates the projection without a deep content hash).
  let geoIdCounter = 0;
  const geoIds = new WeakMap<object, number>();
  function geoIdOf(o: object): number {
    let id = geoIds.get(o);
    if (id === undefined) { id = ++geoIdCounter; geoIds.set(o, id); }
    return id;
  }
  // `#rrggbb` → [r,g,b] in 0..1, or null when unparseable (→ default base).
  function hexToRgb01(hex?: string): [number, number, number] | null {
    if (!hex) return null;
    const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }

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

  // The resolution (coarse/high) + camera (ortho/persp) toggles live in a small
  // ⚙ popup so the toolbar stays clean — coarse + ortho are the defaults we keep.
  let showSettings = $state(false);

  // Single light-angle dial (0–360°) — spins the key light L about the view axis
  // so the highlight sweeps across the part. Replaces the old light/rim/cel
  // artificial-shader controls. Persisted so the choice sticks.
  let lightAngle = $state(0);
  $effect(() => {
    try {
      const a = Number(localStorage.getItem('ge-svg-lightangle'));
      if (Number.isFinite(a)) lightAngle = ((a % 360) + 360) % 360;
    } catch { /* localStorage blocked — fine */ }
  });
  function setLightAngle(v: number) {
    lightAngle = v;
    try { localStorage.setItem('ge-svg-lightangle', String(v)); } catch { /* ignore */ }
  }

  // Fit + view-scale — mirror the 3D bake pane (PrimitiveDualCanvas). The SVG
  // emitter ALREADY reads `scene.xScale` (diameter) + `scene.zScale` (depth) +
  // `scene.zFocus`, so we drive the SAME shared scene state here: a slider moved
  // in the SVG view exaggerates BOTH panes identically ("so SVG matches 3D").
  //   • dia-scale  → scene.xScale  (>1 fattens the radial/diameter)
  //   • z-scale    → scene.zScale  (<1 squashes the length)
  //   • ⇕ fit      → frame the whole geometry: drop the exaggeration back to
  //                  true 1:1 + clear the Z-pan, and flag fitLength so the 3D
  //                  pane reframes in step.
  function fitView() {
    scene.xScale = 1;
    scene.zScale = 1;
    scene.zFocus = 0;
    scene.fitLength = true;
  }

  let size = $state({ w: 0, h: 0 });
  let hasRendered = $state(false);
  let warnHighPoly = $state(false);
  let triCount = $state(0);
  // Polygons actually written to the SVG — higher than triCount when Phong
  // refinement subdivides curved faces (the cost of the smooth-at-coarse look).
  let emitCount = $state(0);
  let errorMsg = $state<string | null>(null);

  // Observe the STABLE scroll viewport (.svg-stage), NOT the .svg-canvas inside
  // it. In ortho the canvas GROWS to the rendered SVG's natural (tall) pixel
  // size, and the vertical scrollbar appearing/disappearing oscillates its
  // width — so observing the canvas feeds the render → ResizeObserver → render
  // loop, which Svelte aborts as `effect_update_depth_exceeded` (the tab errored
  // out / blanked on a 2nd segment toggle). The stage's size is layout-driven
  // (flex), independent of content; `scrollbar-gutter: stable` (CSS below) pins
  // its clientWidth whether or not the scrollbar is showing, killing the last
  // oscillation source.
  $effect(() => {
    if (!container) return;
    const stage = container.parentElement ?? container;
    const measure = () => {
      const w = Math.max(0, Math.floor(stage.clientWidth));
      const h = Math.max(0, Math.floor(stage.clientHeight));
      if (w !== size.w || h !== size.h) size = { w, h };
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    return () => ro.disconnect();
  });

  function teardown() {
    if (container) container.replaceChildren();
    svgEl = null;
    hasRendered = false;
  }

  function renderToSvg(
    pair: NonNullable<ReturnType<typeof deserializeComponentResult>>,
    w: number,
    h: number,
  ) {
    errorMsg = null;

    // Pick cutaway (red outer / grey bore) when toggled + present, else solid.
    const useCut = scene.showCutaway && vertCount(pair.cutVC) > 0;
    // PER-PART path (batch-5 Phase 2): the composite parts for THIS section —
    // full-view `parts` (colour on the appearance) vs cut-view `cutParts`
    // (vertex-coloured section). Present → each sub-part gets its own opacity;
    // absent → fall back to the merged full/cutVC mesh (byte-identical to before).
    const partList = useCut ? pair.cutParts : pair.parts;
    const hasParts = !!partList && partList.length > 0;
    const geo = useCut
      ? (vertCount(pair.cutVC) > 0 ? pair.cutVC : null)
      : (vertCount(pair.full) > 0 ? pair.full : null);
    if (!geo && !hasParts) { errorMsg = 'No geometry to render'; return; }

    // View-only exaggeration [xScale, xScale, zScale] — mirrors PrimitiveDualScene
    // so the SVG frames long thin tools the same way the 3D pane does. Applied to
    // POSITIONS only (lighting stays in unscaled local space).
    const sX = scene.xScale, sZ = scene.zScale;
    // Back-face cull halves the fill count on a CLOSED solid (visually identical).
    // OFF for the cutaway: its exposed inner walls face away yet must render.
    const backfaceCull = !useCut;

    // Frame off the merged mesh when present (matches the 3D pane's bbox); else
    // the first part. buildSvgCamera only reads the bbox → sizing is identical.
    const camGeo = geo ?? partList![0].geo;

    // 1) Build the ortho/persp camera + SVG pixel size from the geometry bbox +
    //    the (read-here) scene view params.
    const cam = buildSvgCamera(camGeo, {
      projection,
      w, h,
      sX, sZ,
      cam: scene.cam,
      partCenter: scene.partCenter,
      zFocus: scene.zFocus,
    });

    // Per-part effective opacity + transparency bucket — the SAME formula as
    // PrimitiveDualScene (`rawOp × xrayOpacity`, clamped) so the SVG tracks the
    // x-ray slider AND matches the 3D pane. Shade-time inputs (recomputed on a
    // light/x-ray drag without re-projecting).
    const partAlpha: number[] = [];
    const partTrans: boolean[] = [];
    // Per-part material texture (#63c) — the SVG <pattern> fill mirrors the
    // part's appearance.texture (rock/cement/steel). Undefined → shaded fill.
    const partTexture: (string | undefined)[] = [];
    if (hasParts) {
      partList!.forEach((pm, i) => {
        const a = pm.appearance ?? {};
        const rawOp = (typeof a.opacity === 'number' && a.opacity > 0 && a.opacity < 1) ? a.opacity : 1;
        const pOp = Math.max(0.02, Math.min(1, rawOp * (scene.xrayOpacity ?? 1)));
        partAlpha[i] = pOp;
        partTrans[i] = pOp < 1 || rawOp < 1;
        partTexture[i] = a.texture;
      });
    } else {
      partAlpha[0] = 1; partTrans[0] = false;
    }
    const hasTexture = partTexture.some((t) => !!t);

    // 2a) PROJECT (geometry + camera + scale) — cached across light/x-ray drags.
    //     Key excludes lightAngle / showEdges / opacity (all shade-time only).
    const projKey = JSON.stringify({
      g: geoIdOf(pair), useCut, hasParts, np: partList?.length ?? 0, backfaceCull,
      proj: projection, w, h, sX, sZ,
      c: [scene.cam.x, scene.cam.y, scene.cam.z],
      pc: [scene.partCenter.x, scene.partCenter.y, scene.partCenter.z],
      zf: scene.zFocus,
    });
    if (!cachedProj || projKey !== cachedProjKey) {
      const entries: ProjectEntry[] = hasParts
        ? partList!.map((pm, i) => ({
            geo: pm.geo,
            pi: i,
            base: hexToRgb01(pm.appearance?.colorOuter) ?? [DEF_R, DEF_G, DEF_B],
          }))
        : [{ geo: geo!, pi: 0, base: [DEF_R, DEF_G, DEF_B] }];
      cachedProj = projectScene(
        entries, cam.camera, cam.renderW, cam.renderH, cam.fitToContainer,
        { sX, sZ, backfaceCull, HIGH_TRI },
      );
      cachedProjKey = projKey;
    }

    // 2b) SHADE + emit — light-dependent only. Painter's order: OPAQUE parts
    //     first, TRANSPARENT parts (fill-opacity) over the top.
    const out = shadeAndEmit(cachedProj, {
      idPrefix: svgUid,
      lightAngle,
      showEdges: scene.showEdges,
      AMBIENT, KEY, FILL,
      DESAT, BRIGHT,
      partAlpha, partTrans,
      partTexture: hasTexture ? partTexture : undefined,
    });
    triCount = out.triCount;
    emitCount = out.emitCount;
    warnHighPoly = out.flatFill;

    // 3) Mount the built (already-styled) <svg>.
    const svg = out.svg;
    if (container) container.replaceChildren(svg);
    svgEl = svg;
    hasRendered = true;
  }

  // Render whenever active + geometry present, re-firing on camera / partCenter /
  // cutaway / edges / view-scale / light-angle / size changes. Inactive → tear
  // down (nothing rendering for a hidden tab).
  $effect(() => {
    // Track reactive deps explicitly so the effect re-runs on each.
    const isActive = active;
    const pair = geos;
    const w = size.w, h = size.h;
    // camera / view deps
    void scene.cam.x; void scene.cam.y; void scene.cam.z;
    void scene.partCenter.x; void scene.partCenter.y; void scene.partCenter.z;
    void scene.zFocus; void scene.xScale; void scene.zScale;
    void scene.showCutaway; void scene.showEdges;
    void scene.xrayOpacity; // per-part opacity (shade-time; re-shades only)
    void projection;
    void lightAngle;

    if (!isActive) { teardown(); return; }
    if (!container || !pair || w === 0 || h === 0) return;
    if (vertCount(pair.full) === 0 && vertCount(pair.cutVC) === 0) {
      errorMsg = null;
      return;
    }
    try {
      renderToSvg(pair, w, h);
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }
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
    if (!svgEl) return;
    let xml = svgEl.outerHTML;
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
      <span class="svg-tris">{triCount.toLocaleString()} tris{emitCount > triCount
        ? ` · ${emitCount.toLocaleString()} fills`
        : ''}{busy ? ' · re-baking…' : ''}</span>
    {/if}
    <!-- Fit — frame the whole geometry (resets dia/depth exaggeration + Z-pan),
         mirroring the 3D bake pane's ⇕ fit. Pushed to the right of the toolbar. -->
    <button class="svg-fit" type="button"
      title="Fit — frame the whole part (reset diameter/depth scale + Z-pan to 1:1)"
      onclick={fitView}>⇕ fit</button>
    <!-- Resolution (coarse/high) + camera (ortho/persp) + view-scale folded into
         one ⚙ popup — defaults keep the toolbar uncluttered. -->
    <div class="svg-settings">
      <button class="svg-gear" class:on={showSettings}
        title="View settings — resolution · camera"
        aria-label="View settings"
        onclick={() => (showSettings = !showSettings)}>⚙</button>
      {#if showSettings}
        <!-- svelte-ignore a11y_click_events_have_key_events a11y_no_static_element_interactions -->
        <div class="svg-set-backdrop" onclick={() => (showSettings = false)}></div>
        <div class="svg-set-pop">
          {#if onSetRes}
            <div class="svg-set-row">
              <span class="svg-set-lbl">resolution</span>
              <div class="svg-proj" role="group" aria-label="Resolution">
                <button class="svg-proj-btn" class:on={res === 'coarse'}
                  title="Coarse — 32-segment bake (fast, light; right for a vector drawing)"
                  onclick={() => onSetRes?.('coarse')}>coarse</button>
                <button class="svg-proj-btn" class:on={res === 'high'}
                  title="High — full 256-segment bake (smoother circles, heavier SVG)"
                  onclick={() => onSetRes?.('high')}>high</button>
              </div>
            </div>
          {/if}
          <div class="svg-set-row">
            <span class="svg-set-lbl">camera</span>
            <div class="svg-proj" role="group" aria-label="Projection">
              <button class="svg-proj-btn" class:on={projection === 'ortho'}
                title="Orthographic — parallel edges, no foreshortening (technical drawing)"
                onclick={() => setProjection('ortho')}>ortho</button>
              <button class="svg-proj-btn" class:on={projection === 'persp'}
                title="Perspective projection" onclick={() => setProjection('persp')}>persp</button>
            </div>
          </div>
          <!-- View-scale — same shared scene.xScale / scene.zScale the 3D bake
               pane drives, so moving a slider here exaggerates BOTH panes alike.
               dia (X) fattens the radial/diameter; depth (Z) squashes the length. -->
          <div class="svg-set-row">
            <span class="svg-set-lbl">dia ×{scene.xScale.toFixed(2)}</span>
            <input class="svg-set-range" type="range" min="0.25" max="8" step="0.25"
              aria-label="Diameter scale"
              bind:value={scene.xScale} />
          </div>
          <div class="svg-set-row">
            <span class="svg-set-lbl">depth ×{scene.zScale.toFixed(2)}</span>
            <input class="svg-set-range" type="range" min="0.05" max="2" step="0.05"
              aria-label="Z-depth scale"
              bind:value={scene.zScale} />
          </div>
          <div class="svg-set-row">
            <button class="svg-set-reset" type="button"
              title="Reset diameter / depth exaggeration to true 1:1"
              onclick={() => { scene.xScale = 1; scene.zScale = 1; }}>1:1 true scale</button>
          </div>
        </div>
      {/if}
    </div>
    <!-- Light-angle dial — spins the key light L around the view so the Gouraud
         highlight sweeps across the part. -->
    <div class="svg-dials" title="Light angle — spin the key light around the view">
      <label class="svg-dial"><span>light {Math.round(lightAngle)}°</span>
        <input type="range" min="0" max="360" step="1" value={lightAngle}
          oninput={(e) => setLightAngle(Number((e.currentTarget as HTMLInputElement).value))} /></label>
    </div>
    <button class="svg-dl" onclick={downloadSvg} disabled={!hasRendered}>
      ⤓ .svg
    </button>
  </div>

  {#if warnHighPoly}
    <div class="svg-warn">
      high-poly — flat per-face fill (no Gouraud gradients above {HIGH_TRI.toLocaleString()}
      tris); bake at a lower segment count for a smooth, light drawing
    </div>
  {/if}

  <div class="svg-stage">
    <!-- Dedicated container we own (replaceChildren) — no Svelte children inside
         it, so overlays live as siblings. -->
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
  /* ⇕ fit — starts the right-hand cluster (push everything after it right). */
  .svg-fit {
    margin-left: auto;
    font-size: 0.78rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid #bbb;
    border-radius: 4px;
    background: #fafafa;
    color: #555;
    cursor: pointer;
    white-space: nowrap;
  }
  .svg-fit:hover { background: #f0f0f0; }
  /* ⚙ settings popup (resolution + camera + view-scale). */
  .svg-settings { position: relative; display: inline-flex; }
  .svg-gear {
    font-size: 0.9rem; line-height: 1; width: 1.5rem; height: 1.5rem;
    display: inline-flex; align-items: center; justify-content: center;
    border: 1px solid #bbb; border-radius: 4px; background: #fafafa; color: #555;
    cursor: pointer;
  }
  .svg-gear:hover { background: #f0f0f0; }
  .svg-gear.on { background: #0369a1; color: #fff; border-color: #0369a1; }
  .svg-set-backdrop { position: fixed; inset: 0; z-index: 50; }
  .svg-set-pop {
    position: absolute; top: calc(100% + 4px); right: 0; z-index: 51;
    display: flex; flex-direction: column; gap: 0.4rem;
    padding: 0.5rem 0.6rem; background: #fff;
    border: 1px solid #ccc; border-radius: 6px;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.14);
  }
  .svg-set-row { display: flex; align-items: center; gap: 0.6rem; justify-content: space-between; }
  .svg-set-lbl { font-size: 0.7rem; color: #57534e; text-transform: uppercase; letter-spacing: 0.3px; white-space: nowrap; }
  .svg-proj {
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
  /* View-scale sliders + reset inside the ⚙ popup. */
  .svg-set-range { width: 120px; accent-color: #0369a1; }
  .svg-set-reset {
    font-size: 0.72rem;
    padding: 0.2rem 0.5rem;
    width: 100%;
    border: 1px solid #bbb;
    border-radius: 4px;
    background: #fafafa;
    color: #555;
    cursor: pointer;
  }
  .svg-set-reset:hover { background: #f0f0f0; }
  .svg-dials { display: inline-flex; align-items: center; gap: 8px; }
  .svg-dial { display: inline-flex; align-items: center; gap: 4px; font: 600 10px Arial; color: #57534e; }
  .svg-dial span { white-space: nowrap; }
  .svg-dial input[type="range"] { width: 88px; accent-color: #0369a1; }
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
    scrollbar-gutter: stable; /* reserve the scrollbar gutter so clientWidth is
                                 constant whether or not it shows — stops the
                                 measure↔render oscillation (segment-toggle crash) */
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
