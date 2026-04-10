<script lang="ts">
  import { Canvas } from '@threlte/core';
  import Scene from './Scene.svelte';
  import { initManifold, buildFromAnalysis, DEFAULT_TOOL_PARAMS } from './builder';

  // Tool definitions — loaded from analysis JSON
  let TOOLS = $state<{ id: string; name: string; analysis: any }[]>([]);

  let activeTab = $state(0);
  let ready = $state(false);
  let loading = $state(true);
  let geo = $state(null);
  let geoVersion = $state(0);
  let buildTime = $state(0);
  let showCutaway = $state(true);
  let showEdges = $state(true);

  let params = $state(structuredClone(DEFAULT_TOOL_PARAMS));

  // Load all tool analyses
  async function loadTools() {
    const toolIds = [
      'short_ratch_latch', 'extension_thread', 'one_piece_sealbore',
      'top_snap_locator', 'bridge_plug', 'setting_tool'
    ];
    const loaded: { id: string; name: string; analysis: any }[] = [];
    for (const id of toolIds) {
      try {
        const resp = await fetch(`/training_data/${id}/analysis.json`);
        if (resp.ok) {
          const analysis = await resp.json();
          loaded.push({ id, name: analysis.tool_name || id.replace(/_/g, ' '), analysis });
        }
      } catch {}
    }
    TOOLS = loaded;
    loading = false;
    if (TOOLS.length > 0) rebuildActive();
  }

  async function rebuildActive() {
    if (!ready || TOOLS.length === 0) return;
    const t0 = performance.now();
    const tool = TOOLS[activeTab];
    geo = buildFromAnalysis(tool.analysis, params);
    geoVersion++;
    buildTime = performance.now() - t0;
  }

  $effect(() => {
    initManifold().then(() => {
      ready = true;
      loadTools();
    });
  });

  // Rebuild when tab or params change
  let paramsKey = $derived(JSON.stringify(params) + activeTab);
  $effect(() => {
    const _k = paramsKey;
    if (ready && TOOLS.length > 0) {
      setTimeout(() => rebuildActive(), 10);
    }
  });

  function switchTab(i: number) {
    activeTab = i;
    // Reset params per tool aspect ratio
    const tool = TOOLS[i];
    if (tool) {
      params = {
        ...structuredClone(DEFAULT_TOOL_PARAMS),
        totalHeight: (tool.analysis.aspect_ratio || 6) * 2.4,
      };
    }
  }
</script>

<div class="app">
  <!-- Tab bar -->
  <div class="tabs">
    {#each TOOLS as tool, i}
      <button
        class="tab"
        class:active={i === activeTab}
        onclick={() => switchTab(i)}
      >
        {tool.name}
      </button>
    {/each}
    {#if loading}
      <span class="tab-loading">Loading tools...</span>
    {/if}
  </div>

  <div class="content">
    <!-- Left: original image -->
    <div class="panel-left">
      {#if TOOLS[activeTab]}
        <img src="/training_data/{TOOLS[activeTab].id}/images/original.png" alt="Original" />
      {/if}
      <div class="header-label">Original Drawing</div>
    </div>

    <!-- Center: 3D model -->
    <div class="panel-center">
      <div class="header-label">ManifoldCAD 3D Model</div>
      <Canvas>
        <Scene {geo} {geoVersion} {showCutaway} {showEdges} />
      </Canvas>
      <div class="build-info">{buildTime.toFixed(0)}ms</div>
    </div>

    <!-- Right: params -->
    <div class="panel-right">
      <div class="header-label">Parameters</div>
      <div class="param-scroll">
        <label class="row-check"><input type="checkbox" bind:checked={showCutaway} /> Cross-Section</label>
        <label class="row-check"><input type="checkbox" bind:checked={showEdges} /> Edges</label>
        <hr />
        <div class="param-row"><span>Scale (OD)</span><input type="range" min="1" max="5" step="0.1" bind:value={params.scale} /><input type="number" step="0.1" bind:value={params.scale} /></div>
        <div class="param-row"><span>Total Height</span><input type="range" min="3" max="30" step="0.5" bind:value={params.totalHeight} /><input type="number" step="0.5" bind:value={params.totalHeight} /></div>
        <div class="param-row"><span>Wall Scale</span><input type="range" min="0.5" max="2" step="0.1" bind:value={params.wallScale} /><input type="number" step="0.1" bind:value={params.wallScale} /></div>
        <div class="param-row"><span>Bore Scale</span><input type="range" min="0.5" max="2" step="0.1" bind:value={params.boreScale} /><input type="number" step="0.1" bind:value={params.boreScale} /></div>
        <hr />
        {#if TOOLS[activeTab]}
          <div class="section-list">
            <strong>Sections ({TOOLS[activeTab].analysis.sections.length})</strong>
            {#each TOOLS[activeTab].analysis.sections as sec, i}
              <div class="section-item">
                <span class="sec-dot" style="background:{sec.color === 'red' ? '#cc2222' : '#888'}"></span>
                <span class="sec-name">{sec.name}</span>
                <span class="sec-detail">OD:{sec.od.toFixed(2)} L:{sec.length.toFixed(2)}</span>
              </div>
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>

<style>
  .app { display:flex; flex-direction:column; width:100vw; height:100vh; font-family:Arial,sans-serif; }
  .tabs { display:flex; gap:2px; background:#333; padding:4px 8px 0; overflow-x:auto; flex-shrink:0; }
  .tab { padding:8px 16px; border:none; border-radius:6px 6px 0 0; background:#555; color:#ccc; cursor:pointer; font-size:11px; font-weight:bold; white-space:nowrap; }
  .tab:hover { background:#666; }
  .tab.active { background:#f5f5f5; color:#333; }
  .tab-loading { color:#888; font-size:11px; padding:8px; }
  .content { display:flex; flex:1; background:#f0f0f0; overflow:hidden; }
  .panel-left { width:18%; display:flex; flex-direction:column; align-items:center; justify-content:center; border-right:2px solid #ccc; position:relative; background:#fff; }
  .panel-left img { max-height:70%; max-width:90%; object-fit:contain; margin-top:36px; }
  .panel-center { width:52%; position:relative; }
  .panel-right { width:30%; position:relative; background:#fafafa; border-left:1px solid #ddd; overflow:hidden; display:flex; flex-direction:column; }
  .param-scroll { flex:1; overflow-y:auto; padding:8px 12px; margin-top:36px; }
  .header-label { position:absolute; top:0;left:0;right:0; height:36px; display:flex; align-items:center; justify-content:center; font-size:12px; font-weight:bold; color:#444; text-transform:uppercase; letter-spacing:1px; background:#f5f5f5; border-bottom:2px solid #ccc; z-index:10; }
  .build-info { position:absolute; bottom:8px; right:8px; font:10px monospace; color:#888; background:rgba(255,255,255,0.9); padding:2px 6px; border-radius:4px; }
  .param-row { display:flex; align-items:center; gap:4px; margin:4px 0; }
  .param-row span { width:80px; font-size:10px; color:#555; flex-shrink:0; }
  .param-row input[type="range"] { flex:1; height:4px; cursor:pointer; accent-color:#cc2222; }
  .param-row input[type="number"] { width:50px; font-size:10px; font-family:monospace; border:1px solid #ddd; border-radius:3px; padding:2px 4px; text-align:right; }
  .row-check { display:flex; align-items:center; gap:6px; margin:4px 0; cursor:pointer; font-size:11px; }
  .row-check input { width:14px; height:14px; }
  hr { border:none; border-top:1px solid #ddd; margin:8px 0; }
  .section-list { margin-top:4px; }
  .section-list strong { font-size:11px; color:#444; }
  .section-item { display:flex; align-items:center; gap:6px; margin:3px 0; font-size:10px; }
  .sec-dot { width:8px; height:8px; border-radius:50%; flex-shrink:0; }
  .sec-name { color:#333; flex:1; }
  .sec-detail { color:#888; font-family:monospace; font-size:9px; }
</style>
