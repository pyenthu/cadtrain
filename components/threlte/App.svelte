<script lang="ts">
  import { Canvas } from '@threlte/core';
  import Scene from './Scene.svelte';
  import { initManifold, buildComponent } from '../builder';
  import { COMPONENTS, CATEGORIES } from '../library';
  import { exportComponent } from '../exporter';

  let ready = $state(false);
  let activeComp = $state(0);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let buildTime = $state(0);
  let showCutaway = $state(true);
  let showEdges = $state(true);

  // Clone defaults as mutable params
  let params = $state<Record<string, number>>(structuredClone(COMPONENTS[0].defaults));

  $effect(() => { initManifold().then(() => { ready = true; }); });

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
      } catch (e) {
        console.error('Build error:', e);
      }
    }, 10);
  });

  function selectComponent(i: number) {
    activeComp = i;
    params = structuredClone(COMPONENTS[i].defaults);
  }

  let comp = $derived(COMPONENTS[activeComp]);
  let exportSvg = $state('');
  let exportPng = $state('');
  let exporting = $state(false);

  async function doExport() {
    if (!geo) return;
    exporting = true;
    try {
      const result = await exportComponent(geo.full);
      exportSvg = result.svgString;
      exportPng = result.pngDataUrl;
    } catch (e) {
      console.error('Export error:', e);
    }
    exporting = false;
  }

  function generateSVG(comp: any, p: Record<string, number>): string {
    const W = 220, H = 300, cx = W / 2;
    const od = p.od || p.bodyOD || p.odTop || p.slipOD || p.odCompressed || 2.5;
    const wall = p.wall || 0.3;
    const id = od - 2 * wall;
    const length = p.length || p.bodyLength || p.height || p.pinLength || 4;
    const odBottom = p.odBottom || p.odLarge || od;

    // Scale to fit
    const maxDim = Math.max(od, odBottom);
    const sx = (W - 40) / maxDim;  // pixels per inch (width)
    const sy = (H - 40) / length;  // pixels per inch (height)
    const s = Math.min(sx, sy);

    const rOuter = od * s / 2;
    const rInner = id * s / 2;
    const h = length * s;
    const rOuterBot = odBottom * s / 2;
    const y0 = (H - h) / 2;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    svg += `<rect width="${W}" height="${H}" fill="white"/>`;

    // Center line
    svg += `<line x1="${cx}" y1="${y0-5}" x2="${cx}" y2="${y0+h+5}" stroke="#0a0" stroke-width="0.5" stroke-dasharray="4,3"/>`;

    // Outer profile (left half = cross-section, right half = exterior)
    // Right side — outer surface (red)
    svg += `<path d="M${cx} ${y0} L${cx+rOuter} ${y0} L${cx+rOuterBot} ${y0+h} L${cx} ${y0+h} Z" fill="#cc2222" stroke="#333" stroke-width="0.8"/>`;

    // Left side — cross-section (grey inner, red outer)
    svg += `<path d="M${cx} ${y0} L${cx-rOuter} ${y0} L${cx-rOuterBot} ${y0+h} L${cx} ${y0+h} Z" fill="#cc2222" stroke="#333" stroke-width="0.8"/>`;
    // Bore (grey)
    svg += `<path d="M${cx} ${y0} L${cx-rInner} ${y0} L${cx-rInner} ${y0+h} L${cx} ${y0+h} Z" fill="#999" stroke="#333" stroke-width="0.5"/>`;

    // Thread grooves if applicable
    const tc = p.threadCount || p.numThreads || p.numGrooves || 0;
    if (tc > 0) {
      const td = (p.threadDepth || p.grooveDepth || 0.06) * s;
      for (let i = 0; i < tc; i++) {
        const ty = y0 + h * (i + 0.5) / tc;
        // Right side threads
        svg += `<line x1="${cx+rOuter-td}" y1="${ty}" x2="${cx+rOuter}" y2="${ty}" stroke="#333" stroke-width="0.5"/>`;
        // Left side threads (cross-section)
        svg += `<line x1="${cx-rOuter}" y1="${ty}" x2="${cx-rOuter+td}" y2="${ty}" stroke="#333" stroke-width="0.5"/>`;
      }
    }

    // Dimension lines
    svg += `<text x="${cx+rOuter+8}" y="${y0+h/2}" font-size="8" fill="#555" text-anchor="start">OD: ${od.toFixed(1)}"</text>`;
    svg += `<text x="${cx-rInner-8}" y="${y0+h/2}" font-size="8" fill="#555" text-anchor="end">ID: ${id.toFixed(1)}"</text>`;
    svg += `<text x="${cx}" y="${y0+h+15}" font-size="8" fill="#555" text-anchor="middle">L: ${length.toFixed(1)}"</text>`;

    // Title
    svg += `<text x="${cx}" y="12" font-size="9" font-weight="bold" fill="#333" text-anchor="middle">${comp.name}</text>`;

    svg += `</svg>`;
    return svg;
  }
</script>

<div class="app">
  <!-- Nav bar -->
  <div class="nav">
    <a href="/viewer/" class="nav-link">Training Tabs</a>
    <span class="nav-sep">|</span>
    <span class="nav-active">Components</span>
    <span class="nav-sep">|</span>
    <a href="http://localhost:3333" class="nav-link" target="_blank">Bottom Sub</a>
  </div>

  <div class="main">
    <!-- Left: component list -->
    <div class="sidebar">
      {#each CATEGORIES as cat}
        <div class="cat-header">{cat.name}</div>
        {#each COMPONENTS as c, i}
          {#if c.category === cat.id}
            <button class="comp-btn" class:active={i === activeComp} onclick={() => selectComponent(i)}>
              {c.name}
            </button>
          {/if}
        {/each}
      {/each}
    </div>

    <!-- Center: 3D view -->
    <div class="viewport">
      <div class="viewport-header">{comp.name} <span class="build-badge">{buildTime.toFixed(0)}ms</span></div>
      <div class="viewport-desc">{comp.description}</div>
      <div class="viewport-tags">
        {#each comp.tags as tag}
          <span class="tag">{tag}</span>
        {/each}
      </div>
      <Canvas>
        <Scene {geo} {geoVersion} {showCutaway} {showEdges} />
      </Canvas>
    </div>

    <!-- Exports: SVG + PNG stacked -->
    <div class="exports">
      <button class="export-btn" onclick={doExport} disabled={exporting || !geo}>
        {exporting ? 'Rendering...' : 'Export SVG + PNG'}
      </button>
      {#if exportSvg}
        <div class="export-label">SVG (three-svg-renderer)</div>
        <div class="svg-box">{@html exportSvg}</div>
      {/if}
      {#if exportPng}
        <div class="export-label">PNG (WebGL)</div>
        <img src={exportPng} class="png-box" alt="3D render" />
      {/if}
      {#if !exportSvg && !exportPng}
        <div class="export-label">Schematic SVG</div>
        <div class="svg-box">{@html generateSVG(comp, params)}</div>
      {/if}
    </div>

    <!-- Right: params -->
    <div class="params">
      <div class="params-header">Parameters</div>
      <label class="row-check"><input type="checkbox" bind:checked={showCutaway} /> Cross-Section</label>
      <label class="row-check"><input type="checkbox" bind:checked={showEdges} /> Edges</label>
      <hr />
      {#each Object.entries(comp.params) as [key, def]}
        <div class="param-row">
          <span class="param-label">{def.label}</span>
          <input type="range" min={def.min} max={def.max} step={def.step} bind:value={params[key]} />
          <input type="number" step={def.step} bind:value={params[key]} />
        </div>
      {/each}
      <hr />
      <div class="derived">
        {#if params.od && params.wall}
          <div>ID: {(params.od - 2 * params.wall).toFixed(2)}</div>
        {/if}
        {#if params.odSmall && params.wall}
          <div>Small ID: {(params.odSmall - 2 * params.wall).toFixed(2)}</div>
        {/if}
        {#if params.odLarge && params.wall}
          <div>Large ID: {(params.odLarge - 2 * params.wall).toFixed(2)}</div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .app { display: flex; flex-direction: column; width: 100vw; height: 100vh; font-family: Arial, sans-serif; }
  .nav { display: flex; gap: 12px; align-items: center; padding: 6px 16px; background: #222; color: #ccc; font-size: 12px; }
  .nav-link { color: #8af; text-decoration: none; }
  .nav-link:hover { text-decoration: underline; }
  .nav-active { color: #fff; font-weight: bold; }
  .nav-sep { color: #555; }
  .main { display: flex; flex: 1; overflow: hidden; }
  .sidebar { width: 200px; background: #f5f5f5; border-right: 1px solid #ddd; overflow-y: auto; padding: 4px 0; }
  .cat-header { font-size: 10px; font-weight: bold; color: #888; text-transform: uppercase; padding: 8px 12px 2px; letter-spacing: 1px; }
  .comp-btn { display: block; width: 100%; text-align: left; padding: 6px 12px 6px 20px; border: none; background: none; cursor: pointer; font-size: 12px; color: #333; }
  .comp-btn:hover { background: #eee; }
  .comp-btn.active { background: #cc2222; color: white; font-weight: bold; }
  .viewport { flex: 1; position: relative; min-width: 0; }
  .exports { width: 240px; background: #fff; border-left: 1px solid #ddd; padding: 8px; overflow-y: auto; display: flex; flex-direction: column; gap: 8px; }
  .export-label { font: bold 10px Arial; color: #888; text-transform: uppercase; letter-spacing: 1px; }
  .svg-box { border: 1px solid #ddd; border-radius: 4px; display: flex; justify-content: center; }
  .png-box { border: 1px solid #ddd; border-radius: 4px; width: 220px; background: #f5f5f5; }
  .export-btn { width: 100%; padding: 8px; background: #cc2222; color: white; border: none; border-radius: 4px; font: bold 11px Arial; cursor: pointer; }
  .export-btn:hover { background: #aa1111; }
  .export-btn:disabled { background: #ccc; cursor: default; }
  .viewport-header { position: absolute; top: 8px; left: 16px; font: bold 16px Arial; color: #333; z-index: 10; }
  .viewport-desc { position: absolute; top: 30px; left: 16px; font: 11px Arial; color: #888; z-index: 10; }
  .viewport-tags { position: absolute; top: 48px; left: 16px; display: flex; gap: 4px; flex-wrap: wrap; z-index: 10; max-width: 500px; }
  .tag { font: 10px Arial; background: #e8e8e8; color: #555; padding: 2px 8px; border-radius: 10px; border: 1px solid #ddd; }
  .build-badge { font-size: 10px; color: #888; font-weight: normal; }
  .params { width: 260px; background: #fafafa; border-left: 1px solid #ddd; padding: 12px; overflow-y: auto; }
  .params-header { font: bold 13px Arial; margin-bottom: 8px; }
  .param-row { display: flex; align-items: center; gap: 4px; margin: 4px 0; }
  .param-label { width: 85px; font-size: 10px; color: #555; flex-shrink: 0; }
  .param-row input[type="range"] { flex: 1; height: 4px; accent-color: #cc2222; }
  .param-row input[type="number"] { width: 48px; font: 10px monospace; border: 1px solid #ddd; border-radius: 3px; padding: 2px 4px; text-align: right; }
  .row-check { display: flex; align-items: center; gap: 6px; margin: 3px 0; cursor: pointer; font-size: 11px; }
  .row-check input { width: 14px; height: 14px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 8px 0; }
  .derived { font: 11px monospace; color: #888; }
</style>
