<script lang="ts">
  /**
   * /forge — image → 3D mesh. Scaffold: upload a reference image → POST it to
   * /api/forge/generate → show the per-stage pipeline status. The gen-model
   * stages (Hunyuan-3D mesh, World Labs splat, …) are STUBBED and report
   * "not configured" until their API keys are set in the server env. No keys
   * are entered here. See docs/plans/forge.md.
   */
  import type { ForgeResult } from '$lib/forge/types';

  let fileName = $state('');
  let imgData = $state<string | null>(null);
  let busy = $state(false);
  let err = $state('');
  let result = $state<(ForgeResult & { _configured?: boolean }) | null>(null);

  function pickFile(e: Event) {
    const f = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!f) return;
    err = ''; result = null; fileName = f.name;
    const r = new FileReader();
    r.onload = () => { imgData = String(r.result); };
    r.onerror = () => { err = 'could not read that image'; };
    r.readAsDataURL(f);
  }

  async function generate() {
    if (!imgData || busy) return;
    busy = true; err = ''; result = null;
    try {
      const res = await fetch('/api/forge/generate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ image: imgData, name: fileName, want: ['mesh'] }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { err = data?.message ?? `generate failed (${res.status})`; return; }
      result = { ...data.result, _configured: data.configured };
    } catch (e: any) {
      err = `request failed: ${e?.message ?? e}`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="forge">
  <header>
    <h1>Forge <span class="sub">image → 3D</span></h1>
    <p class="lead">
      Drop a reference image and forge a 3D model from it. Wraps the
      <code>image-blaster</code> chain (Hunyuan-3D mesh · World Labs splat ·
      clean-plate · SFX). <strong>Scaffold</strong> — the generators are stubbed
      until API keys are configured server-side.
    </p>
  </header>

  <section class="card">
    <label class="drop" class:has={!!imgData}>
      <input type="file" accept="image/*" onchange={pickFile} />
      {#if imgData}
        <img src={imgData} alt={fileName} />
        <span class="fname">{fileName}</span>
      {:else}
        <span class="hint">Click to choose an image (PNG / JPG)</span>
      {/if}
    </label>

    <button class="gen" type="button" disabled={!imgData || busy} onclick={generate}>
      {busy ? 'Forging…' : 'Generate 3D'}
    </button>

    {#if err}<p class="err">{err}</p>{/if}

    {#if result}
      <div class="result">
        {#if !result._configured}
          <p class="notice">No generator configured yet — set the API keys below in the server env.</p>
        {/if}
        <ul class="steps">
          {#each result.steps as s (s.stage)}
            <li class="step {s.status}">
              <b>{s.stage}</b>
              <span class="prov">{s.provider}</span>
              <span class="badge">{s.status}</span>
              {#if s.message}<small>{s.message}</small>{/if}
              {#if s.output}<a href={`/api/volume?path=${encodeURIComponent(s.output)}`}>↓ output</a>{/if}
            </li>
          {/each}
        </ul>
      </div>
    {/if}
  </section>

  <footer class="env">
    <span>To enable generation, set on the server (never here):</span>
    <code>FORGE_FAL_KEY</code> <code>FORGE_WORLDLABS_KEY</code>
    <code>FORGE_NANOBANANA_KEY</code> <code>FORGE_ELEVENLABS_KEY</code>
  </footer>
</div>

<style>
  .forge { max-width: 760px; margin: 0 auto; padding: 28px 20px 48px; color: #1a1a2e; }
  header h1 { font: 700 26px Arial; margin: 0 0 4px; }
  header h1 .sub { font: 400 15px Arial; color: #cc2222; }
  .lead { font: 14px/1.5 Arial; color: #555; margin: 0 0 20px; }
  .lead code { background: #f0f0f5; padding: 1px 5px; border-radius: 3px; font-size: 12px; }
  .card { border: 1px solid #e2e2ec; border-radius: 10px; padding: 18px; background: #fbfbfe; }
  .drop { position: relative; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 8px; min-height: 200px; border: 2px dashed #ccd; border-radius: 8px; cursor: pointer; background: #fff; }
  .drop.has { border-style: solid; border-color: #cc2222; }
  .drop input { position: absolute; inset: 0; opacity: 0; cursor: pointer; }
  .drop img { max-height: 220px; max-width: 100%; border-radius: 6px; }
  .drop .hint { font: 14px Arial; color: #999; }
  .drop .fname { font: 12px Arial; color: #666; }
  .gen { margin-top: 14px; width: 100%; padding: 10px; font: 700 15px Arial; color: #fff; background: #cc2222;
    border: 0; border-radius: 8px; cursor: pointer; }
  .gen:disabled { background: #d9a6a6; cursor: not-allowed; }
  .err { color: #cc2222; font: 13px Arial; margin: 10px 0 0; }
  .result { margin-top: 16px; }
  .notice { font: 13px Arial; color: #a06000; background: #fff7e6; border: 1px solid #ffe2ac; padding: 8px 10px; border-radius: 6px; }
  .steps { list-style: none; padding: 0; margin: 10px 0 0; display: flex; flex-direction: column; gap: 6px; }
  .step { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; font: 13px Arial; padding: 6px 8px;
    border: 1px solid #eee; border-radius: 6px; }
  .step .prov { color: #777; }
  .step .badge { margin-left: auto; font: 700 11px Arial; padding: 1px 7px; border-radius: 10px; }
  .step.ok .badge { background: #e6f6e6; color: #277627; }
  .step.not-configured .badge { background: #fff7e6; color: #a06000; }
  .step.error .badge { background: #fde8e8; color: #cc2222; }
  .step small { flex-basis: 100%; color: #999; }
  .env { margin-top: 18px; font: 12px Arial; color: #888; display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .env code { background: #f0f0f5; padding: 1px 6px; border-radius: 3px; color: #555; }
</style>
