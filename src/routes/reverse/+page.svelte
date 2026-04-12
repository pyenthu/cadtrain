<script lang="ts">
  import { goto } from '$app/navigation';

  let fileInput: HTMLInputElement;
  let preview = $state<string | null>(null);
  let file = $state<File | null>(null);
  let loading = $state(false);
  let result = $state<any>(null);
  let errorMsg = $state<string | null>(null);

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

  async function identify() {
    if (!file) return;
    loading = true;
    errorMsg = null;
    result = null;

    try {
      const formData = new FormData();
      formData.append('image', file);
      const resp = await fetch('/api/identify', { method: 'POST', body: formData });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${text}`);
      }
      result = await resp.json();
    } catch (e: any) {
      errorMsg = e.message || 'Failed to identify';
    }
    loading = false;
  }

  function openInComponents() {
    if (!result) return;
    const params = new URLSearchParams();
    params.set('id', result.component_id);
    for (const [k, v] of Object.entries(result.estimated_params || {})) {
      params.set(k, String(v));
    }
    goto(`/components?${params.toString()}`);
  }
</script>

<div class="reverse">
  <div class="header">
    <h2>Reverse Identification</h2>
    <p>Upload a PNG of a downhole tool component — Claude will identify it and estimate parameters.</p>
  </div>

  <div class="main">
    <div class="upload-col">
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
            <div>Drop a PNG here or click to browse</div>
          </div>
        {/if}
      </div>
      <input type="file" accept="image/*" bind:this={fileInput} onchange={onFileChange} hidden />
      <button class="identify-btn" disabled={!file || loading} onclick={identify}>
        {loading ? 'Identifying...' : 'Identify Component'}
      </button>
      {#if errorMsg}
        <div class="error">{errorMsg}</div>
      {/if}
    </div>

    <div class="result-col">
      {#if result}
        <div class="result-card">
          <div class="result-header">
            <h3>{result.component_name}</h3>
            <span class="confidence">Confidence: {(result.confidence * 100).toFixed(0)}%</span>
          </div>
          <div class="reasoning">{result.reasoning}</div>

          <div class="params-block">
            <strong>Estimated Parameters</strong>
            {#each Object.entries(result.estimated_params || {}) as [key, val]}
              <div class="param-row">
                <span class="param-key">{key}</span>
                <span class="param-val">{val}</span>
              </div>
            {/each}
          </div>

          <button class="open-btn" onclick={openInComponents}>
            Open in Component Viewer →
          </button>
        </div>
      {:else if !loading}
        <div class="empty">
          Upload an image and click "Identify" to see results
        </div>
      {/if}
    </div>
  </div>
</div>

<style>
  .reverse { height: 100%; padding: 24px; background: #f5f5f5; overflow-y: auto; }
  .header { margin-bottom: 24px; }
  .header h2 { margin: 0 0 4px; font-size: 20px; color: #333; }
  .header p { margin: 0; color: #888; font-size: 13px; }
  .main { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; max-width: 1100px; }
  .upload-col, .result-col { display: flex; flex-direction: column; gap: 12px; }
  .dropzone {
    border: 2px dashed #bbb;
    border-radius: 8px;
    background: #fff;
    height: 360px;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    overflow: hidden;
  }
  .dropzone:hover { border-color: #cc2222; }
  .dropzone img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .dz-text { text-align: center; color: #888; }
  .dz-icon { font-size: 32px; margin-bottom: 8px; }
  .identify-btn {
    padding: 12px;
    background: #cc2222;
    color: white;
    border: none;
    border-radius: 6px;
    font: bold 13px Arial;
    cursor: pointer;
  }
  .identify-btn:hover:not(:disabled) { background: #aa1111; }
  .identify-btn:disabled { background: #ccc; cursor: default; }
  .error { padding: 8px 12px; background: #fee; color: #c00; border-radius: 4px; font-size: 11px; }
  .result-card {
    background: #fff;
    border: 1px solid #ddd;
    border-radius: 8px;
    padding: 16px;
  }
  .result-header { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 8px; }
  .result-header h3 { margin: 0; font-size: 16px; color: #333; }
  .confidence { font-size: 11px; color: #888; background: #f0f0f0; padding: 2px 8px; border-radius: 10px; }
  .reasoning { font-size: 12px; color: #555; line-height: 1.5; padding: 8px; background: #f9f9f9; border-left: 3px solid #cc2222; margin-bottom: 12px; }
  .params-block { margin-bottom: 12px; }
  .params-block strong { display: block; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; margin-bottom: 6px; }
  .param-row { display: flex; justify-content: space-between; padding: 4px 0; border-bottom: 1px solid #f0f0f0; font-size: 12px; }
  .param-key { color: #555; font-family: monospace; }
  .param-val { color: #333; font-family: monospace; font-weight: bold; }
  .open-btn {
    width: 100%;
    padding: 10px;
    background: #16213e;
    color: white;
    border: none;
    border-radius: 6px;
    font: bold 12px Arial;
    cursor: pointer;
    margin-top: 8px;
  }
  .open-btn:hover { background: #1a2a4a; }
  .empty { padding: 40px; text-align: center; color: #888; font-size: 12px; background: #fff; border: 1px dashed #ddd; border-radius: 8px; }
</style>
