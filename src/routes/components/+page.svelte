<script lang="ts">
  import { Canvas } from '@threlte/core';
  import { initManifold, buildComponent } from '$components/builder';
  import { COMPONENTS, CATEGORIES } from '$components/library';

  let ready = $state(false);
  let activeComp = $state(0);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let buildTime = $state(0);
  let showCutaway = $state(true);
  let showEdges = $state(true);
  let params = $state(structuredClone(COMPONENTS[0].defaults));

  // Lazy import Scene to avoid SSR issues with Three.js
  let SceneComponent = $state<any>(null);
  $effect(() => {
    import('$shared/ComponentScene.svelte').then(m => { SceneComponent = m.default; });
    initManifold().then(() => { ready = true; });
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

  function generateSVG(comp: any, p: Record<string, number>): string {
    const W = 200, H = 280, cx = W / 2;
    const od = p.od || p.bodyOD || p.odTop || p.slipOD || p.odCompressed || 2.5;
    const wall = p.wall || 0.3;
    const id = od - 2 * wall;
    const length = p.length || p.bodyLength || p.height || p.pinLength || 4;
    const odBottom = p.odBottom || p.odLarge || od;
    const maxDim = Math.max(od, odBottom);
    const s = Math.min((W - 30) / maxDim, (H - 40) / length);
    const rO = od * s / 2, rI = id * s / 2, h = length * s;
    const rOB = odBottom * s / 2;
    const y0 = (H - h) / 2;

    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">`;
    svg += `<rect width="${W}" height="${H}" fill="white"/>`;
    svg += `<line x1="${cx}" y1="${y0-4}" x2="${cx}" y2="${y0+h+4}" stroke="#0a0" stroke-width="0.5" stroke-dasharray="4,3"/>`;
    svg += `<path d="M${cx} ${y0} L${cx+rO} ${y0} L${cx+rOB} ${y0+h} L${cx} ${y0+h} Z" fill="#cc2222" stroke="#333" stroke-width="0.7"/>`;
    svg += `<path d="M${cx} ${y0} L${cx-rO} ${y0} L${cx-rOB} ${y0+h} L${cx} ${y0+h} Z" fill="#cc2222" stroke="#333" stroke-width="0.7"/>`;
    svg += `<path d="M${cx} ${y0} L${cx-rI} ${y0} L${cx-rI} ${y0+h} L${cx} ${y0+h} Z" fill="#999" stroke="#333" stroke-width="0.4"/>`;
    const tc = p.threadCount || p.numThreads || p.numGrooves || 0;
    if (tc > 0) {
      const td = (p.threadDepth || p.grooveDepth || 0.06) * s;
      for (let i = 0; i < tc; i++) {
        const ty = y0 + h * (i + 0.5) / tc;
        svg += `<line x1="${cx+rO-td}" y1="${ty}" x2="${cx+rO}" y2="${ty}" stroke="#333" stroke-width="0.5"/>`;
        svg += `<line x1="${cx-rO}" y1="${ty}" x2="${cx-rO+td}" y2="${ty}" stroke="#333" stroke-width="0.5"/>`;
      }
    }
    svg += `<text x="${cx+rO+5}" y="${y0+h/2}" font-size="7" fill="#555">OD:${od.toFixed(1)}</text>`;
    svg += `<text x="${cx-rI-5}" y="${y0+h/2}" font-size="7" fill="#555" text-anchor="end">ID:${id.toFixed(1)}</text>`;
    svg += `<text x="${cx}" y="${y0+h+12}" font-size="7" fill="#555" text-anchor="middle">L:${length.toFixed(1)}</text>`;
    svg += `<text x="${cx}" y="10" font-size="8" font-weight="bold" fill="#333" text-anchor="middle">${comp.name}</text>`;
    svg += `</svg>`;
    return svg;
  }
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
      <Canvas>
        <svelte:component this={SceneComponent} {geo} {geoVersion} {showCutaway} {showEdges} />
      </Canvas>
    {/if}
  </div>

  <div class="svg-col">
    <div class="svg-label">2D Cross-Section</div>
    <div class="svg-box">{@html generateSVG(comp, params)}</div>
  </div>

  <div class="params">
    <div class="ph">Parameters</div>
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
  .svg-box { border: 1px solid #eee; border-radius: 4px; }
  .vp-header { position: absolute; top: 8px; left: 16px; font: bold 15px Arial; color: #333; z-index: 10; }
  .vp-desc { position: absolute; top: 28px; left: 16px; font: 11px Arial; color: #888; z-index: 10; }
  .tags { position: absolute; top: 44px; left: 16px; display: flex; gap: 4px; flex-wrap: wrap; z-index: 10; }
  .tag { font: 10px Arial; background: #e8e8e8; color: #555; padding: 2px 8px; border-radius: 10px; }
  .ms { font-size: 10px; color: #888; font-weight: normal; }
  .params { width: 240px; background: #fafafa; border-left: 1px solid #ddd; padding: 10px; overflow-y: auto; }
  .ph { font: bold 13px Arial; margin-bottom: 8px; }
  .pr { display: flex; align-items: center; gap: 4px; margin: 3px 0; }
  .pr span { width: 80px; font-size: 10px; color: #555; flex-shrink: 0; }
  .pr input[type="range"] { flex: 1; height: 4px; accent-color: #cc2222; }
  .pr input[type="number"] { width: 45px; font: 10px monospace; border: 1px solid #ddd; border-radius: 3px; padding: 2px 4px; text-align: right; }
  .chk { display: flex; align-items: center; gap: 6px; margin: 3px 0; cursor: pointer; font-size: 11px; }
  .chk input { width: 14px; height: 14px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 8px 0; }
  .derived { font: 11px monospace; color: #888; }
</style>
