<script lang="ts">
  import { Canvas } from '@threlte/core';
  import { WebGLRenderer } from 'three';
  import { initManifold, buildComponent } from '$components/builder';
  import { COMPONENTS } from '$components/library';

  // Custom renderer for canvas capture support
  function createRenderer(canvas: HTMLCanvasElement) {
    return new WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  }

  // Upload state
  let fileInput: HTMLInputElement;
  let preview = $state<string | null>(null);
  let file = $state<File | null>(null);
  let loading = $state(false);
  let result = $state<any>(null);
  let errorMsg = $state<string | null>(null);

  // Geometry state
  let ready = $state(false);
  let geo = $state<any>(null);
  let geoVersion = $state(0);
  let buildTime = $state(0);
  let showCutaway = $state(true);
  let showEdges = $state(true);
  let activeComp = $state<number>(-1);
  let params = $state<Record<string, number>>({});

  let SceneComponent = $state<any>(null);
  $effect(() => {
    import('$shared/ComponentScene.svelte').then(m => { SceneComponent = m.default; });
    initManifold().then(() => { ready = true; });
  });

  // Rebuild geometry when params or component changes
  let paramsKey = $derived(JSON.stringify(params) + activeComp);
  $effect(() => {
    const _k = paramsKey;
    if (!ready || activeComp < 0) return;
    const comp = COMPONENTS[activeComp];
    if (!comp) return;
    const t0 = performance.now();
    setTimeout(() => {
      try {
        geo = buildComponent(comp.id, params);
        geoVersion++;
        buildTime = performance.now() - t0;
      } catch (e) { console.error('Build error:', e); }
    }, 10);
  });

  let comp = $derived(activeComp >= 0 ? COMPONENTS[activeComp] : null);

  function onFileChange(e: Event) {
    const target = e.target as HTMLInputElement;
    if (target.files && target.files[0]) {
      file = target.files[0];
      const reader = new FileReader();
      reader.onload = () => { preview = reader.result as string; };
      reader.readAsDataURL(file);
      result = null;
      errorMsg = null;
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer?.files[0];
    if (f) {
      file = f;
      const reader = new FileReader();
      reader.onload = () => { preview = reader.result as string; };
      reader.readAsDataURL(f);
      result = null;
      errorMsg = null;
    }
  }

  // Auto-refine state
  let refining = $state(false);
  let iter = $state(0);
  let scoreHistory = $state<any[]>([]);
  let stopRequested = $state(false);
  let lastReasoning = $state<string>('');

  // Save to training state
  let saving = $state(false);
  let saveMsg = $state<string | null>(null);

  async function saveToTraining() {
    if (!comp || !preview) return;
    saving = true;
    saveMsg = null;
    try {
      // Capture the target image (original upload) as the training image
      // It represents what we identified it as, with the final params
      const resp = await fetch('/api/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          image_b64: preview,
          component_id: comp.id,
          params,
          source: 'refined',
        }),
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const r = await resp.json();
      saveMsg = `Added to training data (cache: ${r.cache_size} records)`;
    } catch (e: any) {
      saveMsg = `Error: ${e.message}`;
    }
    saving = false;
  }

  async function startRefine() {
    if (!comp || !preview) return;
    refining = true;
    stopRequested = false;
    scoreHistory = [];
    lastReasoning = '';

    for (iter = 1; iter <= 10; iter++) {
      if (stopRequested) break;

      // Wait for canvas to render the current params
      await new Promise(r => setTimeout(r, 800));
      const canvas = document.querySelector('.viewer-col canvas') as HTMLCanvasElement;
      if (!canvas) break;
      const currentRender = canvas.toDataURL('image/png');

      try {
        const resp = await fetch('/api/refine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            original_image: preview,
            current_render: currentRender,
            component_id: comp.id,
            current_params: params,
          }),
        });
        if (!resp.ok) {
          errorMsg = `Refine failed: ${resp.status}`;
          break;
        }
        const r = await resp.json();
        scoreHistory = [...scoreHistory, { iter, ...r.scores }];
        lastReasoning = r.reasoning || '';

        if (r.converged) {
          break;
        }

        if (r.new_params) {
          params = { ...params, ...r.new_params };
        }
      } catch (e: any) {
        errorMsg = e.message;
        break;
      }
    }

    refining = false;
  }

  function stopRefine() {
    stopRequested = true;
  }

  async function identify() {
    if (!file) return;
    loading = true;
    errorMsg = null;

    try {
      const formData = new FormData();
      formData.append('image', file);
      const resp = await fetch('/api/identify', { method: 'POST', body: formData });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }
      result = await resp.json();

      // Find component and apply params
      const idx = COMPONENTS.findIndex(c => c.id === result.component_id);
      if (idx >= 0) {
        activeComp = idx;
        // Merge defaults with estimated params
        const newParams = structuredClone(COMPONENTS[idx].defaults);
        for (const [k, v] of Object.entries(result.estimated_params || {})) {
          if (k in newParams) newParams[k] = Number(v);
        }
        params = newParams;
      }
    } catch (e: any) {
      errorMsg = e.message || 'Failed to identify';
    }
    loading = false;
  }
</script>

<div class="reverse">
  <!-- Left: Upload + Result -->
  <div class="upload-col">
    <div class="section-header">1. Upload Image</div>
    <div class="dropzone"
      ondragover={(e) => e.preventDefault()}
      ondrop={onDrop}
      onclick={() => fileInput.click()}
      role="button"
      tabindex="0"
    >
      {#if preview}
        <img src={preview} alt="Upload preview" />
      {:else}
        <div class="dz-text">
          <div class="dz-icon">📁</div>
          <div>Drop a PNG here<br/>or click to browse</div>
        </div>
      {/if}
    </div>
    <input type="file" accept="image/*" bind:this={fileInput} onchange={onFileChange} hidden />
    <button class="identify-btn" disabled={!file || loading} onclick={identify}>
      {loading ? 'Identifying...' : '2. Identify Component'}
    </button>
    {#if errorMsg}
      <div class="error">{errorMsg}</div>
    {/if}

    {#if result}
      <div class="result-info">
        <div class="ri-header">
          <strong>{result.component_name}</strong>
          <span class="confidence">{(result.confidence * 100).toFixed(0)}%</span>
        </div>
        <div class="reasoning">{result.reasoning}</div>
      </div>
    {/if}
  </div>

  <!-- Center: Live 3D viewer -->
  <div class="viewer-col">
    <div class="section-header">3. Live 3D Render <span class="ms">{buildTime.toFixed(0)}ms</span></div>
    <div class="canvas-wrap">
      {#if SceneComponent && geo}
        <Canvas {createRenderer}>
          {@const Scene = SceneComponent}
          <Scene {geo} {geoVersion} {showCutaway} {showEdges} />
        </Canvas>
      {:else if loading}
        <div class="empty">Identifying with Claude...</div>
      {:else if !result}
        <div class="empty">Upload an image to see the 3D model</div>
      {:else}
        <div class="empty">Building model...</div>
      {/if}
    </div>
    {#if comp}
      <div class="comp-info">
        <strong>{comp.name}</strong>
        <span class="comp-desc">{comp.description}</span>
        <div class="tags">
          {#each comp.tags as tag}<span class="tag">{tag}</span>{/each}
        </div>
      </div>
    {/if}
  </div>

  <!-- Right: Tunable parameters -->
  <div class="params-col">
    <div class="section-header">4. Tune Parameters</div>
    {#if !comp}
      <div class="empty">Identify a component first</div>
    {:else}
      <label class="chk"><input type="checkbox" bind:checked={showCutaway} /> Cross-Section</label>
      <label class="chk"><input type="checkbox" bind:checked={showEdges} /> Edges</label>
      <hr />
      {#each Object.entries(comp.params) as [key, def]}
        <div class="pr">
          <span class="pr-label">{def.label}</span>
          <input type="range" min={def.min} max={def.max} step={def.step} bind:value={params[key]} />
          <input type="number" step={def.step} bind:value={params[key]} />
        </div>
      {/each}
      <hr />
      <div class="save-section">
        <strong>Training Cache</strong>
        <button class="save-btn" onclick={saveToTraining} disabled={saving}>
          {saving ? 'Saving...' : '💾 Save to Training'}
        </button>
        {#if saveMsg}
          <div class="save-msg" class:success={!saveMsg.startsWith('Error')}>{saveMsg}</div>
        {/if}
      </div>
      <hr />
      <div class="refine-section">
        <strong>Auto-Refine</strong>
        {#if !refining}
          <button class="refine-btn" onclick={startRefine}>
            🔁 Auto-Refine to Match
          </button>
        {:else}
          <button class="refine-btn stop" onclick={stopRefine}>
            ⏹ Stop (iter {iter}/10)
          </button>
        {/if}
        {#if scoreHistory.length > 0}
          <div class="score-history">
            {#each scoreHistory as s}
              <div class="score-row">
                <span>iter {s.iter}</span>
                <span class="ssim" class:good={s.ssim > 0.92}>SSIM {s.ssim?.toFixed(3)}</span>
                <span class="px">px {s.pixel_diff_pct?.toFixed(1)}%</span>
              </div>
            {/each}
          </div>
          {#if lastReasoning}
            <div class="ai-reasoning">{lastReasoning}</div>
          {/if}
        {/if}
      </div>
      <hr />
      <div class="json-block">
        <strong>JSON Output</strong>
        <pre>{JSON.stringify(params, null, 2)}</pre>
      </div>
    {/if}
  </div>
</div>

<style>
  .reverse { display: grid; grid-template-columns: 280px 1fr 280px; height: 100%; gap: 0; }
  .upload-col, .viewer-col, .params-col { padding: 12px; overflow-y: auto; }
  .upload-col { background: #fafafa; border-right: 1px solid #ddd; }
  .viewer-col { background: #fff; display: flex; flex-direction: column; }
  .params-col { background: #fafafa; border-left: 1px solid #ddd; }
  .section-header { font: bold 11px Arial; color: #666; text-transform: uppercase; letter-spacing: 1px; padding-bottom: 8px; border-bottom: 1px solid #ddd; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
  .ms { font-size: 9px; color: #888; font-weight: normal; text-transform: none; letter-spacing: 0; }

  .dropzone {
    border: 2px dashed #bbb;
    border-radius: 6px;
    background: #fff;
    height: 220px;
    display: flex; align-items: center; justify-content: center;
    cursor: pointer;
    overflow: hidden;
    margin-bottom: 8px;
  }
  .dropzone:hover { border-color: #cc2222; }
  .dropzone img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .dz-text { text-align: center; color: #888; font-size: 11px; }
  .dz-icon { font-size: 28px; margin-bottom: 8px; }

  .identify-btn {
    width: 100%;
    padding: 10px;
    background: #cc2222;
    color: white;
    border: none;
    border-radius: 4px;
    font: bold 11px Arial;
    cursor: pointer;
  }
  .identify-btn:hover:not(:disabled) { background: #aa1111; }
  .identify-btn:disabled { background: #ccc; cursor: default; }
  .error { padding: 8px; background: #fee; color: #c00; border-radius: 4px; font-size: 10px; margin-top: 8px; }

  .result-info { margin-top: 12px; padding: 10px; background: #fff; border: 1px solid #ddd; border-radius: 4px; }
  .ri-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
  .ri-header strong { font-size: 13px; color: #333; }
  .confidence { font-size: 10px; background: #1b4332; color: #52b788; padding: 2px 8px; border-radius: 10px; }
  .reasoning { font-size: 10px; color: #666; line-height: 1.5; padding: 6px 0; border-left: 2px solid #cc2222; padding-left: 8px; }

  .canvas-wrap { flex: 1; min-height: 400px; border: 1px solid #ddd; border-radius: 4px; overflow: hidden; position: relative; }
  .empty { display: flex; align-items: center; justify-content: center; height: 100%; color: #888; font-size: 12px; }

  .comp-info { padding: 10px; background: #fafafa; border: 1px solid #ddd; border-radius: 4px; margin-top: 8px; }
  .comp-info strong { font-size: 13px; color: #333; }
  .comp-desc { font-size: 11px; color: #666; display: block; margin-top: 2px; }
  .tags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 6px; }
  .tag { font: 9px Arial; background: #e8e8e8; color: #555; padding: 2px 6px; border-radius: 8px; }

  .chk { display: flex; align-items: center; gap: 6px; margin: 3px 0; cursor: pointer; font-size: 11px; }
  .chk input { width: 14px; height: 14px; }
  hr { border: none; border-top: 1px solid #ddd; margin: 8px 0; }
  .pr { display: flex; align-items: center; gap: 4px; margin: 3px 0; }
  .pr-label { width: 80px; font-size: 10px; color: #555; flex-shrink: 0; }
  .pr input[type="range"] { flex: 1; height: 4px; accent-color: #cc2222; min-width: 0; }
  .pr input[type="number"] { width: 50px; font: 10px monospace; border: 1px solid #ddd; border-radius: 3px; padding: 2px 4px; text-align: right; }

  .save-section strong, .refine-section strong { display: block; font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .save-btn { width: 100%; padding: 10px; background: #2e7d32; color: white; border: none; border-radius: 4px; font: bold 11px Arial; cursor: pointer; margin-bottom: 6px; }
  .save-btn:hover:not(:disabled) { background: #1b5e20; }
  .save-btn:disabled { background: #ccc; cursor: default; }
  .save-msg { font-size: 10px; padding: 4px 8px; border-radius: 3px; background: #fff8e1; color: #666; }
  .save-msg.success { background: #e8f5e9; color: #2e7d32; }
  .refine-btn { width: 100%; padding: 10px; background: #16213e; color: white; border: none; border-radius: 4px; font: bold 11px Arial; cursor: pointer; margin-bottom: 8px; }
  .refine-btn:hover { background: #1e3556; }
  .refine-btn.stop { background: #d32f2f; }
  .score-history { background: #fff; border: 1px solid #ddd; border-radius: 4px; padding: 6px; margin-top: 4px; }
  .score-row { display: flex; gap: 6px; font: 10px monospace; padding: 2px 0; border-bottom: 1px solid #f0f0f0; }
  .score-row:last-child { border-bottom: none; }
  .score-row .ssim { color: #888; }
  .score-row .ssim.good { color: #2e7d32; font-weight: bold; }
  .score-row .px { color: #888; }
  .ai-reasoning { font-size: 10px; color: #555; line-height: 1.4; padding: 6px; background: #fff8e1; border-left: 2px solid #f57c00; margin-top: 6px; border-radius: 0 4px 4px 0; }
  .json-block strong { display: block; font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 4px; }
  .json-block pre { font: 10px monospace; background: #fff; padding: 8px; border: 1px solid #ddd; border-radius: 4px; max-height: 200px; overflow-y: auto; margin: 0; }
</style>
