<script lang="ts">
  interface CaseRow {
    dirname: string;
    expected_id: string;
    predicted_id?: string;
    predicted_name?: string;
    confidence?: number;
    reasoning?: string;
    estimated_params?: Record<string, any>;
    retrieved_examples?: any[];
    is_correct?: boolean;
    elapsed_ms?: number;
    backend?: string;
    model?: string;
    image_url: string;
    error?: string;
  }

  interface Manifest {
    rows: CaseRow[];
    total: number;
    correct: number;
    accuracy: number;
    backend: string;
    model: string;
    ran_at: string;
  }

  let manifest = $state<Manifest | null>(null);
  let selectedDirname = $state<string | null>(null);
  let loadError = $state<string | null>(null);

  async function loadManifest() {
    try {
      const r = await fetch('/eval/components/index.json', { cache: 'no-cache' });
      if (!r.ok) throw new Error(`index.json ${r.status}`);
      manifest = await r.json();
      if (manifest && manifest.rows.length && !selectedDirname) {
        selectedDirname = manifest.rows[0].dirname;
      }
    } catch (e: any) {
      loadError = e?.message ?? String(e);
    }
  }

  $effect(() => { loadManifest(); });

  let current = $derived(manifest?.rows.find(r => r.dirname === selectedDirname) ?? null);
</script>

<svelte:head><title>Components Eval — CAD Train</title></svelte:head>

<div class="layout">
  <main class="content">
    <header class="page-head">
      <h1>Components Recognition — CLI Eval</h1>
      {#if manifest}
        <p class="summary">
          <strong>Top-1 accuracy:</strong>
          <span class="acc-pill" class:perfect={manifest.correct === manifest.total}>
            {manifest.correct}/{manifest.total}
            ({(100 * manifest.accuracy).toFixed(1)}%)
          </span>
          · backend={manifest.backend ?? '?'} · model={manifest.model ?? '?'}
          · ran {manifest.ran_at}
        </p>
      {:else if loadError}
        <p class="err">Failed to load: {loadError}</p>
        <p class="hint">Run <code>python tests/test_components_real.py --port 5181</code> then re-stage results.</p>
      {:else}
        <p class="hint">Loading…</p>
      {/if}
    </header>

    {#if current}
      <div class="case">
        <section class="src-pane">
          <div class="pane-head">
            <h2>Input</h2>
            <span class="dim">{current.dirname}</span>
          </div>
          <div class="src-frame">
            <img src={current.image_url} alt={current.dirname} />
          </div>
          <div class="meta-row">
            <span class="meta-key">Expected:</span>
            <code class="expected">{current.expected_id}</code>
          </div>
        </section>

        <section class="diff-pane">
          <div class="pane-head">
            <h2>Identified</h2>
            {#if current.is_correct}
              <span class="badge ok">✓ correct</span>
            {:else if current.error}
              <span class="badge err">ERROR</span>
            {:else}
              <span class="badge miss">✗ wrong</span>
            {/if}
          </div>

          {#if current.error}
            <pre class="raw err-raw">{current.error}</pre>
          {:else}
            <table class="diff">
              <tbody>
                <tr>
                  <td class="k">component_id</td>
                  <td class="v">
                    <code class:ok={current.is_correct} class:miss={!current.is_correct}>{current.predicted_id}</code>
                  </td>
                </tr>
                <tr>
                  <td class="k">component_name</td>
                  <td class="v">{current.predicted_name ?? '—'}</td>
                </tr>
                <tr>
                  <td class="k">confidence</td>
                  <td class="v">{current.confidence ?? '—'}</td>
                </tr>
                <tr>
                  <td class="k">elapsed</td>
                  <td class="v">{current.elapsed_ms ? (current.elapsed_ms / 1000).toFixed(1) + 's' : '—'}</td>
                </tr>
                <tr>
                  <td class="k">backend</td>
                  <td class="v"><code>{current.backend ?? '—'}</code></td>
                </tr>
                <tr>
                  <td class="k">model</td>
                  <td class="v"><code>{current.model ?? '—'}</code></td>
                </tr>
              </tbody>
            </table>

            {#if current.reasoning}
              <h3>Reasoning</h3>
              <pre class="raw">{current.reasoning}</pre>
            {/if}

            {#if current.estimated_params && Object.keys(current.estimated_params).length}
              <h3>Estimated params</h3>
              <table class="diff">
                <tbody>
                  {#each Object.entries(current.estimated_params) as [k, v]}
                    <tr><td class="k">{k}</td><td class="v">{typeof v === 'number' ? v : JSON.stringify(v)}</td></tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          {/if}
        </section>
      </div>
    {/if}
  </main>

  <aside class="navigator">
    <div class="nav-head">
      <span>Cases</span>
      <span class="count">{manifest?.rows.length ?? 0}</span>
    </div>
    {#if manifest}
      {#each manifest.rows as r}
        <button
          class="nav-item"
          class:active={r.dirname === selectedDirname}
          onclick={() => selectedDirname = r.dirname}
        >
          <span class="nav-title">{r.expected_id}</span>
          <span class="nav-sub">
            <span class="status-dot" class:pass={r.is_correct} class:fail={r.is_correct === false} class:never={r.is_correct == null}></span>
            {r.dirname.replace(/^prim_/, '')}
          </span>
        </button>
      {/each}
    {/if}
    <div class="nav-back"><a href="/tests">← back to /tests</a></div>
  </aside>
</div>

<style>
  .layout { display: flex; height: 100%; font-family: Arial, sans-serif; background: #fafafa; }
  .content { flex: 1; overflow-y: auto; padding: 24px 28px; min-width: 0; }
  .page-head h1 { margin: 0 0 6px; font-size: 20px; color: #333; }
  .page-head p { margin: 0; color: #666; font-size: 13px; line-height: 1.6; }
  .summary { font-size: 13px; }
  .acc-pill { display: inline-block; padding: 3px 12px; border-radius: 12px; background: #fdecea; color: #762626; font-weight: bold; font-size: 13px; margin: 0 4px; }
  .acc-pill.perfect { background: #d4edda; color: #155724; }
  code { background: #f0f0f0; padding: 1px 6px; border-radius: 3px; font: 11px monospace; }

  .case { display: grid; grid-template-columns: minmax(380px, 1fr) minmax(0, 1.4fr); gap: 18px; margin-top: 16px; align-items: stretch; }
  .src-pane, .diff-pane { background: white; border: 1px solid #e0e0e0; border-radius: 6px; padding: 14px; }
  .pane-head { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; padding-bottom: 8px; border-bottom: 1px solid #eee; margin-bottom: 12px; }
  .pane-head h2 { margin: 0; font-size: 14px; color: #333; }
  .pane-head .dim { font-size: 10px; color: #999; font-family: monospace; }

  .src-frame { background: #f5f5f5; border-radius: 4px; padding: 14px; display: flex; justify-content: center; align-items: center; }
  .src-frame img { max-width: 100%; max-height: 400px; }

  .meta-row { padding-top: 12px; font-size: 12px; }
  .meta-key { color: #888; margin-right: 8px; }
  .expected { background: #fff5cd; padding: 2px 8px; border-radius: 3px; }

  .badge { font: bold 11px Arial; padding: 3px 10px; border-radius: 12px; }
  .badge.ok { background: #d4edda; color: #155724; }
  .badge.miss { background: #fdecea; color: #762626; }
  .badge.err { background: #f8d7da; color: #721c24; }

  .diff { width: 100%; border-collapse: collapse; font-size: 12px; }
  .diff td { padding: 6px 8px; border-bottom: 1px solid #f0f0f0; vertical-align: top; }
  .diff td.k { color: #888; width: 130px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  .diff td.v code.ok { background: #d4edda; color: #155724; padding: 2px 8px; }
  .diff td.v code.miss { background: #fdecea; color: #762626; padding: 2px 8px; }
  .diff h3 { margin: 14px 0 6px; font-size: 12px; color: #555; text-transform: uppercase; letter-spacing: 1px; }
  .diff-pane h3 { margin: 16px 0 8px; font-size: 11px; color: #888; text-transform: uppercase; letter-spacing: 1px; font-weight: normal; }

  .raw { background: #f5f5f5; border: 1px solid #e0e0e0; border-radius: 4px; padding: 10px; font: 12px monospace; white-space: pre-wrap; word-wrap: break-word; margin: 0 0 8px; line-height: 1.5; }
  .err-raw { background: #fff5f5; border-color: #f5c6cb; }
  .err { color: #762626; font-size: 13px; }
  .hint { font-size: 12px; color: #999; }

  .navigator { width: 280px; min-width: 280px; background: white; border-left: 1px solid #e0e0e0; padding: 16px 10px; overflow-y: auto; }
  .nav-head { display: flex; justify-content: space-between; align-items: baseline; padding: 0 8px 10px; border-bottom: 1px solid #eee; margin-bottom: 8px; font: bold 11px Arial; color: #16213e; text-transform: uppercase; letter-spacing: 1px; }
  .nav-head .count { font-size: 10px; color: #999; font-weight: normal; }
  .nav-item { display: flex; flex-direction: column; align-items: flex-start; gap: 3px; width: 100%; text-align: left; padding: 8px 12px; margin-bottom: 2px; border: none; background: none; border-radius: 4px; cursor: pointer; }
  .nav-item:hover { background: #f5f5f5; }
  .nav-item.active { background: #16213e; }
  .nav-item.active .nav-title { color: white; }
  .nav-item.active .nav-sub { color: #aec0d9; }
  .nav-title { font: bold 12px Arial; color: #333; line-height: 1.3; }
  .nav-sub { font: 9px monospace; color: #888; display: flex; align-items: center; gap: 6px; }
  .status-dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .status-dot.pass { background: #28a745; }
  .status-dot.fail { background: #dc3545; }
  .status-dot.never { background: #adb5bd; }
  .nav-back { padding: 12px 8px; border-top: 1px solid #eee; margin-top: 8px; font-size: 11px; }
  .nav-back a { color: #16213e; text-decoration: none; }
  .nav-back a:hover { text-decoration: underline; }
</style>
