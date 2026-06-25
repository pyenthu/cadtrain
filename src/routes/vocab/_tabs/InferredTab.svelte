<!--
  Inferred detail-tab body (seed terms) — 2D vendor reference + auto-derived
  r_revolve 3D bake + polygon/feature/warning details + catalogue variants +
  cheap "promote inferred polygon" footer.
  Extracted from vocab/+page.svelte (R8). The page owns inferCache + the
  /api/vocab/infer + /api/vocab/promote calls; this is presentational and
  bubbles Infer / Promote via callbacks.
-->
<script lang="ts">
  let {
    entry,
    inf,
    PrimitiveDualCanvas,
    CompJsonSilhouette,
    promoteBusy,
    onInfer,
    onPromote,
  }: {
    entry: any;
    inf: any;
    PrimitiveDualCanvas: any;
    CompJsonSilhouette: any;
    promoteBusy: boolean;
    onInfer: () => void;
    onPromote: () => void;
  } = $props();
</script>

<div class="tab-body">
  <!-- Terse seed description + catalogue chips -->
  <p class="def-line">{entry.description ?? '(no description)'}</p>
  <div class="info-row">
    <span class="info-chip cat">{entry.category} · {entry.sub_category}</span>
    {#if entry.metadata?.tool_comp}
      <code class="info-code">{entry.metadata.tool_comp}</code>
    {/if}
    <span class="info-chip dim">OD {entry.dims_from_catalogue?.od_in ?? '—'}" · ID {entry.dims_from_catalogue?.id_in ?? '—'}" · L {entry.dims_from_catalogue?.length_ft ?? '—'} ft</span>
    {#if (entry.variants?.length ?? 0) > 1}<span class="info-chip variant">{entry.variants.length} variants</span>{/if}
  </div>

  <!-- 2D drawing + Inferred 3D side-by-side -->
  <div class="view-row">
    {#if entry.compjson_ref && CompJsonSilhouette}
      <CompJsonSilhouette ref={entry.compjson_ref} title="2D vendor reference" height={300} />
    {:else}
      <div class="empty-card">no compjson_ref on file</div>
    {/if}
    <div class="bake-card">
      <header class="bake-head">
        <div class="bake-title">Inferred 3D · r_revolve</div>
        <span class="spacer"></span>
        {#if !inf}
          <button class="bar-btn" type="button" onclick={onInfer}>Infer</button>
        {:else if inf === 'loading'}
          <span class="bar-status">inferring…</span>
        {:else if 'error' in (inf as any)}
          <button class="bar-btn" type="button" onclick={onInfer}>retry</button>
          <span class="bar-status err">err: {(inf as any).error}</span>
        {:else}
          <span class="bar-meta">{(inf as any).bake?.verts ?? '?'} verts · z={(inf as any).bake?.z_extent ?? '?'} · r={(inf as any).bake?.outer_r ?? '?'}</span>
        {/if}
      </header>
      <div class="bake-body">
        {#if !inf}
          <div class="bake-cta">
            Click <strong>Infer</strong> to derive an axisymmetric profile from the 2D drawing.
            <br>Deterministic — half-section + OD-calibration → <code>r_revolve</code> polygon.
          </div>
        {:else if inf === 'loading'}
          <div class="empty">inferring polygon + bake…</div>
        {:else if 'error' in (inf as any)}
          <div class="error">inference failed: {(inf as any).error}</div>
        {:else if !(inf as any).bake?.ok}
          <div class="error">bake failed: {(inf as any).bake?.message ?? 'no bake result'}</div>
        {:else if PrimitiveDualCanvas}
          {@const inferredI = inf as any}
          <PrimitiveDualCanvas
            id={inferredI.exemplar}
            name={inferredI.exemplar}
            description=""
            args={[]}
            source={inferredI.source}
            showControls={true}
            showLabels={false}
          />
        {:else}
          <div class="empty">3D canvas loading…</div>
        {/if}
      </div>
    </div>
  </div>

  <!-- Inferred details: polygon vertices · warnings · source -->
  {#if inf && typeof inf === 'object' && !('error' in (inf as any)) && (inf as any).polygon?.length}
    {@const inf2 = inf as any}
    <details class="block">
      <summary>polygon vertices ({inf2.polygon.length}) · axisymmetric: {inf2.axisymmetric ? 'yes' : 'no'}</summary>
      <pre class="code">{inf2.polygon.map(([r, z]: [number, number], i: number) => `  [${i.toString().padStart(2)}]  r=${r.toFixed(4).padStart(8)}  z=${z.toFixed(4).padStart(8)}`).join('\n')}</pre>
    </details>
    {#if inf2.internal_features?.length}
      <details class="block">
        <summary>{inf2.internal_features.length} internal feature{inf2.internal_features.length === 1 ? '' : 's'} (seats / elastomer / marks)</summary>
        <pre class="code">{inf2.internal_features.map((f: any, i: number) => `[${i}] ${f.kind} (fill ${f.fill_color}) — ${f.polygon.length} verts`).join('\n')}</pre>
      </details>
    {/if}
    {#if inf2.warnings?.length}
      <details class="block" open>
        <summary>{inf2.warnings.length} warning{inf2.warnings.length === 1 ? '' : 's'}</summary>
        <ul class="warn-list">
          {#each inf2.warnings as w (w)}<li>⚠ {w}</li>{/each}
        </ul>
      </details>
    {/if}
    <details class="block">
      <summary>generated source (.rev.ts)</summary>
      <pre class="code">{inf2.source}</pre>
    </details>
    <div class="promote-footer">
      <button class="promote-btn" type="button" disabled={promoteBusy}
        title="Write the inferred polygon back into vocabulary.seeds.json as the seed's rule and flip status to promoted."
        onclick={onPromote}
      >{promoteBusy ? 'promoting…' : '✓ Promote inferred polygon → seeds.json'}</button>
      <span class="promote-hint">cheap promotion: stores the auto-polygon (no rich definition)</span>
    </div>
  {/if}

  <!-- Catalogue variants table -->
  {#if entry.variants?.length}
    <details class="block">
      <summary>{entry.variants.length} catalogue variant{entry.variants.length === 1 ? '' : 's'}</summary>
      <table class="params-table">
        <thead><tr><th>#</th><th>OD"</th><th>ID"</th><th>L ft</th><th>weight</th><th>company</th><th>top thread</th><th>bot thread</th><th>grade</th></tr></thead>
        <tbody>
          {#each entry.variants as v (v.comp_id)}
            <tr>
              <td><code>{v.comp_id}</code></td>
              <td>{v.od_in ?? '—'}</td>
              <td>{v.id_in ?? '—'}</td>
              <td>{v.length_ft ?? '—'}</td>
              <td>{v.weight_lb ?? '—'}</td>
              <td>{v.company ?? '—'}</td>
              <td>{v.top_thread ?? '—'}</td>
              <td>{v.bot_thread ?? '—'}</td>
              <td>{v.grade ?? '—'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </details>
  {/if}
  <details class="block">
    <summary>raw seed JSON</summary>
    <pre class="code">{JSON.stringify(entry, null, 2)}</pre>
  </details>
</div>

<style>
  /* Tab body — scrollable inner column. */
  .tab-body { padding: 6px 14px 14px; overflow-y: auto; display: grid; gap: 8px; align-content: start; min-height: 0; }
  .tab-body .def-line { font: 13px/1.55 Arial; color: #374151; margin: 0; }
  /* Compact info-chip row beneath the definition. */
  .info-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .info-chip { padding: 2px 8px; border-radius: 9999px; font: 11px Arial; background: #f3f4f6; color: #475569; border: 1px solid #e5e7eb; }
  .info-chip.cat       { background: #ede9fe; color: #5b21b6; border-color: #c4b5fd; }
  .info-chip.dim       { background: #e0f2fe; color: #0c4a6e; border-color: #0369a1; font-family: ui-monospace, monospace; }
  .info-chip.variant   { background: #fef3c7; color: #78350f; border-color: #fbbf24; }
  .info-code { font: 11px ui-monospace, monospace; background: #fef3c7; color: #78350f; padding: 2px 6px; border-radius: 3px; border: 1px solid #fbbf24; }
  /* 2D drawing + 3D bake side-by-side. */
  .view-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: stretch; min-height: 320px; }
  .view-row > * { min-width: 0; }
  .empty-card { display: flex; align-items: center; justify-content: center; color: #a8a29e; font: 11px Arial; min-height: 320px; background: #fafaf9; border: 1px dashed #e7e5e4; border-radius: 6px; }
  .bake-card {
    display: grid; grid-template-rows: auto 1fr;
    background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;
    overflow: hidden;
  }
  .bake-card .bake-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #e7e5e4; background: #fff; }
  .bake-card .bake-head .spacer { flex: 1; }
  .bake-card .bake-title { font: 600 11px Arial; color: #57534e; text-transform: uppercase; letter-spacing: 0.5px; }
  .bake-card .bake-body { padding: 6px; overflow: hidden; min-height: 0; }
  .bake-head .bar-meta { font: 10px ui-monospace, monospace; color: #57534e; }
  .bake-head .bar-status { font: 11px Arial; color: #6b7280; }
  .bake-head .bar-status.err { color: #b91c1c; }
  .bake-cta { padding: 24px 16px; text-align: center; color: #57534e; font: 12px Arial; line-height: 1.6; }
  .bake-cta code { font: 11px ui-monospace, monospace; color: #1e40af; }
  .bar-btn { font: 600 11px Arial; padding: 3px 10px; border: 1px solid #0369a1; background: #e0f2fe; color: #0c4a6e; border-radius: 4px; cursor: pointer; }
  .bar-btn:hover:not(:disabled) { background: #bae6fd; }
  .bar-btn:disabled { opacity: 0.5; cursor: default; }
  .bar-meta { font: 12px ui-monospace, monospace; color: #475569; }
  .bar-status { font: 11px ui-monospace, monospace; color: #475569; padding: 0 8px; }
  .block { margin-top: 2px; border: 1px solid #e5e7eb; border-radius: 4px; background: #fff; }
  .block summary { padding: 3px 10px; font: 600 12px Arial; color: #1f2937; cursor: pointer; user-select: none; }
  .block summary:hover { background: #f9fafb; }
  .block[open] summary { border-bottom: 1px solid #f1f5f9; }
  .code { padding: 10px 12px; margin: 0; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; overflow: auto; max-height: 320px; }
  .params-table { width: 100%; border-collapse: collapse; font: 11px Arial; }
  .params-table th, .params-table td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; text-align: left; }
  .params-table th { background: #f9fafb; font-weight: 600; color: #475569; }
  .params-table td code { font: 600 11px ui-monospace, monospace; color: #0c4a6e; }
  .warn-list { margin: 4px 0 0 16px; padding: 0; }
  .warn-list li { font: 11px Arial; color: #78350f; padding: 2px 0; }
  .empty { color: #6b7280; font: 12px Arial; padding: 8px; }
  .error { color: #b91c1c; font: 11px ui-monospace, monospace; padding: 8px; }
  /* Promote footer at the bottom of the active tab body. */
  .promote-footer { display: flex; align-items: center; gap: 12px; padding: 12px 14px; margin-top: 6px; background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; }
  .promote-btn {
    font: 600 12px Arial; padding: 6px 14px;
    background: #dcfce7; color: #14532d; border: 1px solid #15803d; border-radius: 4px;
    cursor: pointer;
  }
  .promote-btn:hover:not(:disabled) { background: #bbf7d0; }
  .promote-btn:disabled { opacity: 0.5; cursor: not-allowed; }
  .promote-hint { font: 11px Arial; color: #166534; flex: 1; }
  .promote-hint code { font: 11px ui-monospace, monospace; background: #dcfce7; padding: 1px 4px; border-radius: 2px; }
</style>
