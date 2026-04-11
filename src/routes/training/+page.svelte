<script lang="ts">
  import { Canvas } from '@threlte/core';
  import { initManifold, buildFromAnalysis, DEFAULT_TOOL_PARAMS } from '$viewer/builder';

  let TOOLS = $state<{ id: string; name: string; analysis: any }[]>([]);
  let activeTab = $state(0);
  let ready = $state(false);
  let loading = $state(true);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let buildTime = $state(0);
  let showCutaway = $state(true);
  let showEdges = $state(true);
  let params = $state(structuredClone(DEFAULT_TOOL_PARAMS));

  let SceneComponent = $state<any>(null);

  async function loadTools() {
    const toolIds = [
      'short_ratch_latch', 'extension_thread', 'one_piece_sealbore',
      'top_snap_locator', 'bridge_plug',
      'comp_FLOW_CONTROL.FLOW_COUPLING', 'comp_FLOW_CONTROL.NIPPLE_BN',
      'comp_FLOW_CONTROL.TRSSV_FLAPPER', 'comp_MISC.GAS_LIFT_MANDREL',
      'comp_PACKERS.PACKER_BAKER_PERMANENT', 'comp_PACKERS.PACKER_RH',
      'comp_PBR.POLISHED_BORE_ASSEMBLY_1',
      'comp_TUBING_HANGER.TUBING_HANGER_BOX_UP', 'perma_lach_pls',
    ];
    const loaded: typeof TOOLS = [];
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

  function rebuildActive() {
    if (!ready || TOOLS.length === 0) return;
    const t0 = performance.now();
    const tool = TOOLS[activeTab];
    geo = buildFromAnalysis(tool.analysis, params);
    geoVersion++;
    buildTime = performance.now() - t0;
  }

  $effect(() => {
    import('$shared/ComponentScene.svelte').then(m => { SceneComponent = m.default; });
    initManifold().then(() => { ready = true; loadTools(); });
  });

  let paramsKey = $derived(JSON.stringify(params) + activeTab);
  $effect(() => {
    const _k = paramsKey;
    if (ready && TOOLS.length > 0) setTimeout(() => rebuildActive(), 10);
  });

  function switchTab(i: number) {
    activeTab = i;
    const tool = TOOLS[i];
    if (tool) {
      const ar = tool.analysis.aspect_ratio || 6;
      params = { ...structuredClone(DEFAULT_TOOL_PARAMS), scale: ar > 8 ? 1.8 : 2.4, totalHeight: ar * (ar > 8 ? 1.8 : 2.4) };
    }
  }
</script>

<div class="training-layout">
  <div class="tabs">
    {#each TOOLS as tool, i}
      <button class="tab" class:active={i === activeTab} onclick={() => switchTab(i)}>{tool.name}</button>
    {/each}
    {#if loading}<span class="loading">Loading...</span>{/if}
  </div>
  <div class="main">
    <div class="left">
      {#if TOOLS[activeTab]}
        <img src="/training_data/{TOOLS[activeTab].id}/images/original.png" alt="Original" />
      {/if}
    </div>
    <div class="center">
      {#if SceneComponent}
        <Canvas>
          <svelte:component this={SceneComponent} {geo} {geoVersion} {showCutaway} {showEdges} />
        </Canvas>
      {/if}
      <div class="info">{buildTime.toFixed(0)}ms</div>
    </div>
    <div class="right">
      <label class="chk"><input type="checkbox" bind:checked={showCutaway} /> Cross-Section</label>
      <label class="chk"><input type="checkbox" bind:checked={showEdges} /> Edges</label>
      <hr />
      <div class="pr"><span>Scale</span><input type="range" min="1" max="5" step="0.1" bind:value={params.scale} /><input type="number" step="0.1" bind:value={params.scale} /></div>
      <div class="pr"><span>Height</span><input type="range" min="3" max="30" step="0.5" bind:value={params.totalHeight} /><input type="number" step="0.5" bind:value={params.totalHeight} /></div>
      <div class="pr"><span>Bore</span><input type="range" min="0.5" max="2" step="0.1" bind:value={params.boreScale} /><input type="number" step="0.1" bind:value={params.boreScale} /></div>
      {#if TOOLS[activeTab]}
        <hr />
        <strong style="font-size:11px">Sections ({TOOLS[activeTab].analysis.sections?.length || 0})</strong>
        {#each TOOLS[activeTab].analysis.sections || [] as sec}
          <div class="sec"><span class="dot" style="background:{sec.color==='red'?'#cc2222':'#888'}"></span>{sec.name}</div>
        {/each}
      {/if}
    </div>
  </div>
</div>

<style>
  .training-layout { display: flex; flex-direction: column; height: 100%; }
  .tabs { display: flex; gap: 2px; background: #333; padding: 4px 8px 0; overflow-x: auto; flex-shrink: 0; }
  .tab { padding: 6px 12px; border: none; border-radius: 5px 5px 0 0; background: #555; color: #ccc; cursor: pointer; font-size: 10px; font-weight: bold; white-space: nowrap; }
  .tab:hover { background: #666; }
  .tab.active { background: #f5f5f5; color: #333; }
  .loading { color: #888; font-size: 11px; padding: 6px; }
  .main { display: flex; flex: 1; overflow: hidden; }
  .left { width: 18%; display: flex; align-items: center; justify-content: center; border-right: 2px solid #ccc; background: #fff; }
  .left img { max-height: 80%; max-width: 90%; object-fit: contain; }
  .center { flex: 1; position: relative; }
  .right { width: 240px; background: #fafafa; border-left: 1px solid #ddd; padding: 10px; overflow-y: auto; }
  .info { position: absolute; bottom: 8px; right: 8px; font: 10px monospace; color: #888; background: rgba(255,255,255,0.9); padding: 2px 6px; border-radius: 4px; }
  .pr { display: flex; align-items: center; gap: 4px; margin: 3px 0; }
  .pr span { width: 50px; font-size: 10px; color: #555; }
  .pr input[type="range"] { flex: 1; height: 4px; accent-color: #cc2222; }
  .pr input[type="number"] { width: 45px; font: 10px monospace; border: 1px solid #ddd; border-radius: 3px; padding: 2px; text-align: right; }
  .chk { display: flex; align-items: center; gap: 6px; margin: 3px 0; font-size: 11px; cursor: pointer; }
  .chk input { width: 14px; height: 14px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 8px 0; }
  .sec { display: flex; align-items: center; gap: 6px; font-size: 10px; margin: 2px 0; color: #555; }
  .dot { width: 6px; height: 6px; border-radius: 50%; }
</style>
