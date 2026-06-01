<script lang="ts">
  import type { Wson } from '$lib/wells/schema';

  let file = $state<File | null>(null);
  let previewUrl = $state<string | null>(null);
  let supplementaryText = $state('');
  let extracting = $state(false);
  let result = $state<{ wson: Wson; issues: string[]; model: string } | null>(null);
  let errorMsg = $state<string | null>(null);

  function pickFile(e: Event) {
    const input = e.target as HTMLInputElement;
    const f = input.files?.[0];
    if (!f) return;
    setFile(f);
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    const f = e.dataTransfer?.files?.[0];
    if (f) setFile(f);
  }

  function setFile(f: File) {
    file = f;
    result = null;
    errorMsg = null;
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = f.type.startsWith('image/') ? URL.createObjectURL(f) : null;
  }

  async function extract() {
    if (!file) return;
    extracting = true;
    result = null;
    errorMsg = null;

    try {
      const fd = new FormData();
      fd.append('file', file);
      if (supplementaryText.trim()) fd.append('text', supplementaryText.trim());

      const r = await fetch('/api/wells/extract', { method: 'POST', body: fd });
      if (!r.ok) {
        const txt = await r.text();
        throw new Error(`HTTP ${r.status}: ${txt.slice(0, 300)}`);
      }
      result = await r.json();
    } catch (e) {
      errorMsg = (e as Error).message;
    } finally {
      extracting = false;
    }
  }

  function downloadJson() {
    if (!result) return;
    const blob = new Blob([JSON.stringify(result.wson, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${result.wson.meta?.wellName?.replace(/\s+/g, '_') ?? 'well'}.wson.json`;
    a.click();
    URL.revokeObjectURL(url);
  }
</script>

<svelte:head><title>Wells — CAD Train</title></svelte:head>

<div class="page">
  <header>
    <h1>Wells</h1>
    <p class="sub">
      Extract structured WSON from a well-engineering document (PDF or image).
      Output schema mirrors SVTC's drawing-app contract — paste the JSON into
      a SVTC tab to render the well in 2D + 3D.
    </p>
  </header>

  <section class="upload">
    <div
      class="dropzone"
      class:has-file={file != null}
      ondragover={(e) => e.preventDefault()}
      ondrop={onDrop}
      role="button"
      tabindex="0"
    >
      {#if previewUrl}
        <img src={previewUrl} alt="upload preview" />
      {:else if file}
        <div class="pdf-icon">
          <span class="pdf-glyph">PDF</span>
          <span class="filename">{file.name}</span>
          <span class="filesize">({(file.size / 1024).toFixed(0)} KB)</span>
        </div>
      {:else}
        <div class="dz-empty">
          <strong>Drop a PDF or image here</strong>
          <span>or pick one below</span>
        </div>
      {/if}
    </div>

    <div class="controls">
      <input type="file" accept=".pdf,image/*" onchange={pickFile} />
      <button onclick={extract} disabled={!file || extracting} class="primary">
        {extracting ? 'Extracting…' : 'Extract'}
      </button>
      {#if result}
        <button onclick={downloadJson} class="secondary">Download JSON</button>
      {/if}
    </div>

    <details class="text-extra">
      <summary>+ Add supplementary text (optional)</summary>
      <textarea
        bind:value={supplementaryText}
        placeholder="Paste deviation tally, casing program text, etc. — anything that didn't OCR cleanly from the document."
      ></textarea>
    </details>
  </section>

  {#if errorMsg}
    <section class="err">
      <strong>Extraction failed:</strong>
      <pre>{errorMsg}</pre>
    </section>
  {/if}

  {#if result}
    {@const w = result.wson}
    <section class="result">
      <div class="meta-row">
        <h2>{w.meta?.wellName ?? '(no name)'}</h2>
        <div class="model">via {result.model}</div>
      </div>

      {#if result.issues.length}
        <div class="issues">
          <strong>Validation issues:</strong>
          <ul>{#each result.issues as it}<li>{it}</li>{/each}</ul>
        </div>
      {/if}

      <div class="grid">
        <div class="card meta">
          <h3>Meta</h3>
          <dl>
            <dt>TD</dt><dd>{w.meta?.td ?? '—'} ft</dd>
            <dt>RKB→GL</dt><dd>{w.meta?.rkbToGl ?? '—'} ft</dd>
            {#if w.meta?.description}<dt>Desc</dt><dd>{w.meta.description}</dd>{/if}
            {#if w.meta?._shape}<dt>Shape</dt><dd>{w.meta._shape}</dd>{/if}
            {#if w.meta?._band}<dt>Band</dt><dd>{w.meta._band}</dd>{/if}
            {#if w.meta?.location}
              <dt>Location</dt>
              <dd>
                {w.meta.location.x}, {w.meta.location.y}
                {#if w.meta.location.crs}({w.meta.location.crs}){/if}
                {#if w.meta.location.lat != null}
                  <br />lat {w.meta.location.lat}, lon {w.meta.location.lon}
                {/if}
              </dd>
            {/if}
          </dl>
        </div>

        <div class="card">
          <h3>Open hole ({w.oh?.length ?? 0})</h3>
          {#if w.oh?.length}
            <table>
              <thead><tr><th>Bit</th><th>Top</th><th>Bot</th></tr></thead>
              <tbody>{#each w.oh as oh}<tr><td>{oh.bitSize}"</td><td>{oh.top}</td><td>{oh.bot}</td></tr>{/each}</tbody>
            </table>
          {:else}<p class="dim">No open hole intervals.</p>{/if}
        </div>

        <div class="card">
          <h3>Casings ({w.ch?.length ?? 0})</h3>
          {#if w.ch?.length}
            <table>
              <thead><tr><th>OD</th><th>ID</th><th>Top</th><th>Bot</th><th>Type</th></tr></thead>
              <tbody>{#each w.ch as ch}<tr><td>{ch.od}"</td><td>{ch.id}"</td><td>{ch.top}</td><td>{ch.bot}</td><td>{ch.type ?? ''}</td></tr>{/each}</tbody>
            </table>
          {:else}<p class="dim">No casings.</p>{/if}
        </div>

        <div class="card">
          <h3>Cementing ({w.cementing?.length ?? 0})</h3>
          {#if w.cementing?.length}
            <table>
              <thead><tr><th>OD</th><th>Top</th><th>Bot</th></tr></thead>
              <tbody>{#each w.cementing as c}<tr><td>{c.od}"</td><td>{c.top}</td><td>{c.bot}</td></tr>{/each}</tbody>
            </table>
          {:else}<p class="dim">No cement annuli.</p>{/if}
        </div>

        <div class="card wide">
          <h3>Completions ({w.completions?.length ?? 0})</h3>
          {#if w.completions?.length}
            <table>
              <thead><tr><th>Description</th><th>OD</th><th>Top</th><th>Bot</th><th>Joints</th></tr></thead>
              <tbody>
                {#each w.completions as c}
                  <tr>
                    <td>{c.description}</td>
                    <td>{c.od}"</td>
                    <td>{c.top}</td>
                    <td>{c.bot}</td>
                    <td>{c.noJoints ?? ''}</td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {:else}<p class="dim">No completions.</p>{/if}
        </div>

        <div class="card">
          <h3>Perforations ({w.perforations?.length ?? 0})</h3>
          {#if w.perforations?.length}
            <table>
              <thead><tr><th>Top</th><th>Bot</th><th>Label</th></tr></thead>
              <tbody>{#each w.perforations as p}<tr><td>{p.top}</td><td>{p.bot}</td><td>{p.label ?? ''}</td></tr>{/each}</tbody>
            </table>
          {:else}<p class="dim">No perforations.</p>{/if}
        </div>

        <div class="card">
          <h3>Strata ({w.strata?.length ?? 0})</h3>
          {#if w.strata?.length}
            <table>
              <thead><tr><th>Name</th><th>Top</th><th></th></tr></thead>
              <tbody>{#each w.strata as s}<tr><td>{s.name}</td><td>{s.top}</td><td><span class="swatch" style="background:{s.color ?? '#ccc'}"></span></td></tr>{/each}</tbody>
            </table>
          {:else}<p class="dim">No formation picks.</p>{/if}
        </div>

        <div class="card">
          <h3>Profile ({w.profile?.length ?? 0} stations)</h3>
          {#if w.profile?.length}
            <p class="dim">
              MD {w.profile[0].md} → {w.profile[w.profile.length - 1].md} ft
              · max inclination {Math.max(...w.profile.map((s) => s.dev)).toFixed(1)}°
            </p>
          {:else}<p class="dim">No survey stations.</p>{/if}
        </div>
      </div>

      <details class="raw">
        <summary>Raw JSON</summary>
        <pre>{JSON.stringify(w, null, 2)}</pre>
      </details>
    </section>
  {/if}
</div>

<style>
  .page { padding: 16px 24px; height: 100%; overflow: auto; background: #f8fafc; box-sizing: border-box; }
  header h1 { margin: 0; font-size: 24px; font-weight: 600; color: #1e293b; }
  header .sub { margin: 4px 0 16px; font-size: 13px; color: #64748b; max-width: 720px; line-height: 1.5; }

  .upload { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin-bottom: 16px; }
  .dropzone { min-height: 140px; border: 2px dashed #cbd5e1; border-radius: 8px; display: flex; align-items: center; justify-content: center; padding: 24px; transition: border-color 120ms; }
  .dropzone.has-file { border-color: #2563eb; border-style: solid; }
  .dz-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; color: #94a3b8; }
  .dz-empty strong { color: #475569; font-size: 14px; }
  .dropzone img { max-height: 220px; max-width: 100%; border-radius: 4px; box-shadow: 0 1px 4px rgba(0,0,0,0.1); }
  .pdf-icon { display: flex; flex-direction: column; align-items: center; gap: 6px; }
  .pdf-glyph { background: #dc2626; color: #fff; font-weight: 700; padding: 12px 20px; border-radius: 4px; font-size: 14px; letter-spacing: 1px; }
  .filename { color: #1e293b; font-weight: 500; }
  .filesize { color: #94a3b8; font-size: 12px; }

  .controls { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
  .controls input[type=file] { font-size: 12px; }
  .controls button { padding: 6px 14px; border-radius: 4px; border: 1px solid #cbd5e1; background: #fff; font: inherit; font-size: 13px; cursor: pointer; }
  .controls button:hover:not(:disabled) { background: #f1f5f9; }
  .controls button:disabled { opacity: 0.5; cursor: not-allowed; }
  .controls button.primary { background: #2563eb; color: #fff; border-color: #2563eb; font-weight: 600; }
  .controls button.primary:hover:not(:disabled) { background: #1d4ed8; }

  .text-extra { margin-top: 12px; }
  .text-extra summary { font-size: 12px; color: #64748b; cursor: pointer; user-select: none; }
  .text-extra textarea { width: 100%; min-height: 80px; margin-top: 8px; padding: 8px; border: 1px solid #cbd5e1; border-radius: 4px; font: 12px ui-monospace, monospace; box-sizing: border-box; }

  .err { background: #fee2e2; border: 1px solid #fca5a5; border-radius: 6px; padding: 12px 16px; margin-bottom: 16px; color: #991b1b; }
  .err pre { margin: 4px 0 0; font-size: 12px; white-space: pre-wrap; }

  .result { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; }
  .meta-row { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 8px; }
  .meta-row h2 { margin: 0; font-size: 18px; color: #1e293b; }
  .meta-row .model { font: 11px ui-monospace, monospace; color: #94a3b8; }

  .issues { background: #fef3c7; border: 1px solid #fcd34d; border-radius: 4px; padding: 8px 12px; margin-bottom: 12px; font-size: 12px; color: #78350f; }
  .issues ul { margin: 4px 0 0; padding-left: 20px; }

  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 12px; }
  .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 6px; padding: 10px 12px; }
  .card.wide { grid-column: span 2; }
  .card h3 { margin: 0 0 6px; font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; color: #475569; }
  .card .dim { color: #94a3b8; font-size: 12px; font-style: italic; margin: 0; }

  .card dl { display: grid; grid-template-columns: 80px 1fr; gap: 4px 8px; margin: 0; font-size: 12px; }
  .card dt { color: #64748b; font-weight: 600; }
  .card dd { margin: 0; color: #1e293b; }

  .card table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .card th { text-align: left; color: #64748b; font-weight: 600; padding: 4px 6px; border-bottom: 1px solid #e2e8f0; }
  .card td { padding: 4px 6px; color: #1e293b; }
  .card tbody tr:hover { background: #f1f5f9; }

  .swatch { display: inline-block; width: 14px; height: 14px; border-radius: 2px; border: 1px solid #cbd5e1; }

  .raw { margin-top: 16px; }
  .raw summary { font-size: 12px; color: #64748b; cursor: pointer; user-select: none; }
  .raw pre { background: #1e293b; color: #f1f5f9; padding: 12px; border-radius: 4px; font: 11px ui-monospace, monospace; max-height: 400px; overflow: auto; margin-top: 8px; }
</style>
