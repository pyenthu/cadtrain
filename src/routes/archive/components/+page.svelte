<script lang="ts">
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { initManifold, buildComponent } from '$components/builder';
  import { COMPONENTS, CATEGORIES } from '$components/library';
  import { exportSVG } from '$components/exporter';

  // Custom renderer with preserveDrawingBuffer for canvas capture
  function createRenderer(canvas: HTMLCanvasElement) {
    return new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  }

  let ready = $state(false);
  let activeComp = $state(0);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let buildTime = $state(0);
  let showCutaway = $state(true);
  let showEdges = $state(true);
  let params = $state(structuredClone(COMPONENTS[0].defaults));

  // Panel collapse state. Persisted to localStorage so the user's preference
  // sticks across reloads. Default: open on desktop, closed on phones since
  // the 3D viewport needs the room.
  let showSvg = $state(true);
  let showParams = $state(true);
  $effect(() => {
    if (typeof window === 'undefined') return;
    const isPhone = window.matchMedia('(max-width: 600px)').matches;
    showSvg = localStorage.getItem('comp:showSvg') === '1' || (!isPhone && localStorage.getItem('comp:showSvg') !== '0');
    showParams = localStorage.getItem('comp:showParams') === '1' || (!isPhone && localStorage.getItem('comp:showParams') !== '0');
  });
  function toggleSvg() { showSvg = !showSvg; localStorage.setItem('comp:showSvg', showSvg ? '1' : '0'); }
  function toggleParams() { showParams = !showParams; localStorage.setItem('comp:showParams', showParams ? '1' : '0'); }
  // Camera override sourced from ?cam={"position":[…],"up":[…],"zoom":n}
  // — used by scripts/gen_synthetic.ts to drive the synthetic data
  // pipeline through five distinct angles. Null = use the default
  // OrthographicCamera in ComponentScene.
  let cameraOverride = $state<{
    position?: [number, number, number];
    up?: [number, number, number];
    zoom?: number;
  } | null>(null);

  // Lazy import Scene to avoid SSR issues with Three.js
  let SceneComponent = $state<any>(null);
  $effect(() => {
    import('$shared/ComponentScene.svelte').then(m => { SceneComponent = m.default; });
    initManifold().then(() => { ready = true; });

    // Read URL params. Two shapes are supported:
    //   ?id=hollow_cylinder&od=2.5&wall=0.3        (flat, original)
    //   ?id=packer_element&p={"od":7,"length":2}   (JSON, used by gen_synthetic)
    //   ?cam={"position":[4,4,-2],"up":[0,0,-1]}   (camera override)
    // The flat keys override the JSON ones if both are present.
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      const id = url.searchParams.get('id');
      if (id) {
        const idx = COMPONENTS.findIndex(c => c.id === id);
        if (idx >= 0) {
          activeComp = idx;
          const newParams = structuredClone(COMPONENTS[idx].defaults);
          // First pass: JSON-encoded params from `?p=`.
          const pRaw = url.searchParams.get('p');
          if (pRaw) {
            try {
              const parsed = JSON.parse(pRaw);
              if (parsed && typeof parsed === 'object') Object.assign(newParams, parsed);
            } catch (e) {
              console.warn('[components] bad ?p= JSON:', e);
            }
          }
          // Second pass: flat per-key overrides win over the JSON blob.
          for (const [k, _] of Object.entries(newParams)) {
            const urlVal = url.searchParams.get(k);
            if (urlVal !== null) newParams[k] = parseFloat(urlVal);
          }
          params = newParams;
        }
      }
      const camRaw = url.searchParams.get('cam');
      if (camRaw) {
        try {
          const parsed = JSON.parse(camRaw);
          if (parsed && typeof parsed === 'object') cameraOverride = parsed;
        } catch (e) {
          console.warn('[components] bad ?cam= JSON:', e);
        }
      }
    }
  });

  let paramsKey = $derived(JSON.stringify(params) + activeComp);
  $effect(() => {
    const _k = paramsKey;
    if (!ready) return;
    const t0 = performance.now();
    const comp = COMPONENTS[activeComp];
    setTimeout(() => {
      try {
        geo = buildComponent(comp.id, params);
        geoVersion++;
        buildTime = performance.now() - t0;
      } catch (e) { console.error(e); }
    }, 10);
  });

  function selectComponent(i: number) {
    activeComp = i;
    params = structuredClone(COMPONENTS[i].defaults);
  }

  let comp = $derived(COMPONENTS[activeComp]);

  // SVG export via three-svg-renderer
  let svgHtml = $state('');
  let pngUrl = $state('');
  let exporting = $state(false);

  // Auto-export SVG when geometry changes
  $effect(() => {
    if (!geo) return;
    const _v = geoVersion;
    exporting = true;
    exportSVG(geo.cutVC, { width: 200, height: 320 })
      .then(svg => { svgHtml = svg; exporting = false; })
      .catch(e => { console.error('SVG export error:', e); exporting = false; });
  });

  // Capture PNG directly from the live Threlte canvas (pixel-perfect match)
  $effect(() => {
    if (!geo) return;
    const _v = geoVersion;
    // Wait 2 frames for Threlte to render the new geometry
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const canvas = document.querySelector('.viewport canvas') as HTMLCanvasElement;
        if (canvas) {
          pngUrl = canvas.toDataURL('image/png');
        }
      });
    });
  });
</script>

<div class="comp-layout">
  <div class="sidebar">
    {#each CATEGORIES as cat}
      <div class="cat">{cat.name}</div>
      {#each COMPONENTS as c, i}
        {#if c.category === cat.id}
          <button class="comp-btn" class:active={i === activeComp} onclick={() => selectComponent(i)}>{c.name}</button>
        {/if}
      {/each}
    {/each}
  </div>

  <div class="viewport">
    <div class="vp-header">{comp.name} <span class="ms">{buildTime.toFixed(0)}ms</span></div>
    <div class="vp-desc">{comp.description}</div>
    <div class="tags">
      {#each comp.tags as tag}<span class="tag">{tag}</span>{/each}
    </div>
    {#if SceneComponent}
      <Canvas {createRenderer}>
        {@const Scene = SceneComponent}
        <Scene {geo} {geoVersion} {showCutaway} {showEdges} {cameraOverride} />
      </Canvas>
    {/if}
  </div>

  <div class="svg-col" class:collapsed={!showSvg}>
    <button class="panel-toggle" onclick={toggleSvg} aria-expanded={showSvg} title={showSvg ? 'Hide previews' : 'Show previews'}>
      <span class="ph-title">Previews</span>
      <span class="caret">{showSvg ? '▾' : '▸'}</span>
    </button>
    {#if showSvg}
      <div class="svg-label">SVG (Vector)</div>
      <div class="svg-box">
        {#if exporting}
          <div class="rendering">Rendering...</div>
        {:else if svgHtml}
          {@html svgHtml}
        {/if}
      </div>
      <div class="svg-label" style="margin-top:8px">PNG (Raster)</div>
      <div class="png-box">
        {#if pngUrl}
          <img src={pngUrl} alt="3D render" />
        {/if}
      </div>
    {/if}
  </div>

  <div class="params" class:collapsed={!showParams}>
    <button class="panel-toggle" onclick={toggleParams} aria-expanded={showParams} title={showParams ? 'Hide parameters' : 'Show parameters'}>
      <span class="ph-title">Parameters</span>
      <span class="caret">{showParams ? '▾' : '▸'}</span>
    </button>
    {#if showParams}
      <label class="chk"><input type="checkbox" bind:checked={showCutaway} /> Cross-Section</label>
      <label class="chk"><input type="checkbox" bind:checked={showEdges} /> Edges</label>
      <hr />
      {#each Object.entries(comp.params) as [key, def]}
        <div class="pr">
          <span>{def.label}</span>
          <input type="range" min={def.min} max={def.max} step={def.step} bind:value={params[key]} />
          <input type="number" step={def.step} bind:value={params[key]} />
        </div>
      {/each}
      <hr />
      <div class="derived">
        {#if params.od && params.wall}<div>ID: {(params.od - 2 * params.wall).toFixed(2)}</div>{/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .comp-layout { display: flex; height: 100%; }
  .sidebar { width: 180px; background: #f5f5f5; border-right: 1px solid #ddd; overflow-y: auto; padding: 4px 0; }
  .cat { font: bold 10px Arial; color: #888; text-transform: uppercase; padding: 8px 12px 2px; letter-spacing: 1px; }
  .comp-btn { display: block; width: 100%; text-align: left; padding: 5px 12px 5px 18px; border: none; background: none; cursor: pointer; font-size: 11px; color: #333; }
  .comp-btn:hover { background: #eee; }
  .comp-btn.active { background: #cc2222; color: white; font-weight: bold; }
  .viewport { flex: 1; position: relative; min-width: 0; }
  .svg-col { width: 210px; background: #fff; border-left: 1px solid #ddd; padding: 8px; display: flex; flex-direction: column; align-items: center; }
  .svg-label { font: bold 10px Arial; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .svg-box { border: 1px solid #eee; border-radius: 4px; overflow: hidden; min-height: 150px; display: flex; align-items: center; justify-content: center; width: 100%; }
  .svg-box :global(svg) { width: 100%; height: auto; display: block; }
  .png-box { border: 1px solid #eee; border-radius: 4px; overflow: hidden; }
  .png-box img { width: 100%; display: block; }
  .rendering { font: 11px Arial; color: #888; padding: 20px; }
  .vp-header { position: absolute; top: 8px; left: 16px; font: bold 15px Arial; color: #333; z-index: 10; }
  .vp-desc { position: absolute; top: 28px; left: 16px; font: 11px Arial; color: #888; z-index: 10; }
  .tags { position: absolute; top: 44px; left: 16px; display: flex; gap: 4px; flex-wrap: wrap; z-index: 10; }
  .tag { font: 10px Arial; background: #e8e8e8; color: #555; padding: 2px 8px; border-radius: 10px; }
  .ms { font-size: 10px; color: #888; font-weight: normal; }
  .params { width: 280px; min-width: 280px; background: #fafafa; border-left: 1px solid #ddd; padding: 10px; overflow-y: auto; }
  .ph { font: bold 13px Arial; margin-bottom: 8px; }

  /* Collapsible panel toggle. The button is the section header — clicking
     anywhere on it toggles. When the panel is collapsed (.collapsed) the
     panel shrinks to a thin sliver showing only the toggle, giving the 3D
     viewport more room. Double-up as the section title so we save vertical
     space (no separate .ph header needed when toggle is present). */
  .panel-toggle {
    width: 100%; display: flex; align-items: center; justify-content: space-between;
    padding: 6px 8px; margin: -10px -10px 8px -10px;
    background: #ececec; border: none; border-bottom: 1px solid #ddd;
    cursor: pointer; font: bold 12px Arial; color: #333;
  }
  .panel-toggle:hover { background: #e0e0e0; }
  .panel-toggle .ph-title { letter-spacing: 0.3px; }
  .panel-toggle .caret { font-size: 11px; color: #666; }
  .svg-col .panel-toggle { margin: -8px -8px 8px -8px; }

  .params.collapsed,
  .svg-col.collapsed {
    width: 36px; min-width: 36px; padding: 0;
    overflow: hidden;
  }
  .params.collapsed .panel-toggle,
  .svg-col.collapsed .panel-toggle {
    margin: 0; height: 100%; flex-direction: column; gap: 8px;
    border-bottom: none; padding: 12px 4px;
  }
  .params.collapsed .panel-toggle .ph-title,
  .svg-col.collapsed .panel-toggle .ph-title {
    writing-mode: vertical-rl; transform: rotate(180deg);
    font-size: 10px; letter-spacing: 1px; text-transform: uppercase;
  }
  .pr { display: flex; align-items: center; gap: 4px; margin: 3px 0; }
  .pr span { width: 80px; font-size: 10px; color: #555; flex-shrink: 0; }
  .pr input[type="range"] { flex: 1; height: 4px; accent-color: #cc2222; }
  .pr input[type="number"] { width: 45px; font: 10px monospace; border: 1px solid #ddd; border-radius: 3px; padding: 2px 4px; text-align: right; }
  .chk { display: flex; align-items: center; gap: 6px; margin: 3px 0; cursor: pointer; font-size: 11px; }
  .chk input { width: 14px; height: 14px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 8px 0; }
  .derived { font: 11px monospace; color: #888; }

  /* Below 900px (phones, narrow tablets) the four-column row is unreadable —
     panels overlap each other (see screenshot). Stack vertically: sidebar →
     viewport → svg/png → params. The viewport needs an explicit min-height
     since flex:1 inside a column would otherwise be 0. */
  @media (max-width: 900px) {
    .comp-layout { flex-direction: column; height: auto; min-height: 100%; overflow-y: auto; }
    .sidebar {
      width: 100%; max-height: 180px; overflow-y: auto;
      border-right: none; border-bottom: 1px solid #ddd;
      display: flex; flex-wrap: wrap; gap: 2px; padding: 6px;
    }
    .cat { width: 100%; padding: 6px 4px 2px; }
    .comp-btn { width: auto; flex: 0 1 auto; padding: 4px 8px; border-radius: 4px; font-size: 11px; }
    .viewport { width: 100%; min-height: 380px; flex-shrink: 0; }
    .svg-col {
      width: 100%; border-left: none; border-top: 1px solid #ddd;
      flex-direction: row; align-items: flex-start; gap: 12px; padding: 12px;
    }
    .svg-col .svg-box, .svg-col .png-box { flex: 1; max-width: 50%; }
    .svg-label { width: 100%; }
    .params { width: 100%; min-width: 0; border-left: none; border-top: 1px solid #ddd; }
  }
</style>
