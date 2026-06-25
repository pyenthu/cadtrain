<!--
  Curated-term detail body (non-seed vocabulary terms) — definition + synonyms
  + 2D reference / 3D bake side-by-side + params table + rule / preamble /
  polygon / composition / lock-drift detail blocks. No top tabs (curated
  terms have a single stacked body).
  Extracted from vocab/+page.svelte (R8). The page owns sceneCache + the
  /api/primitives/source fetch; this is presentational.
-->
<script lang="ts">
  let {
    entry,
    sc,
    lockEntry,
    PrimitiveDualCanvas,
    CompJsonSilhouette,
    ruleSummary,
  }: {
    entry: any;
    sc: any;
    lockEntry: any;
    PrimitiveDualCanvas: any;
    CompJsonSilhouette: any;
    ruleSummary: (entry: any) => string;
  } = $props();
</script>

<div class="tab-body">
  <p class="def-line rich">{entry.definition ?? '(no definition)'}</p>
  {#if entry.synonyms?.length}
    <div class="chips-row">
      <span class="chips-label">synonyms</span>
      {#each entry.synonyms as s (s)}<span class="prop-chip syn">{s}</span>{/each}
    </div>
  {/if}
  <div class="info-row">
    {#if entry.extends}
      <span class="info-chip ext-info">extends {entry.extends}</span>
    {/if}
    <a class="info-chip link" href="/graph-editor" onclick={(ev) => { ev.preventDefault(); if (typeof window !== 'undefined') window.open(`/graph-editor?id=${entry.exemplar}`, '_blank'); }}>open <code>{entry.exemplar}</code> in graph editor ↗</a>
    <span class="info-chip rule">{ruleSummary(entry)}</span>
  </div>

  <!-- 2D (when ref) + 3D side-by-side -->
  <div class="view-row">
    {#if entry.compjson_ref && CompJsonSilhouette}
      <CompJsonSilhouette ref={entry.compjson_ref} title="2D reference" height={300} />
    {:else}
      <div class="empty-card faded">no 2D reference</div>
    {/if}
    <div class="bake-card">
      <header class="bake-head">
        <div class="bake-title">3D · {entry.kind}</div>
        <span class="spacer"></span>
      </header>
      <div class="bake-body">
        {#if !PrimitiveDualCanvas}
          <div class="empty">scene component loading…</div>
        {:else if !sc || sc === 'loading'}
          <div class="empty">fetching {entry.exemplar}…</div>
        {:else if sc === 'error'}
          <div class="error">couldn't load {entry.exemplar} — does it exist on the volume?</div>
        {:else}
          {@const params = sc as { source: string; args: (number | string)[] }}
          <PrimitiveDualCanvas
            id={entry.exemplar}
            name={entry.exemplar}
            description=""
            args={params.args}
            source={params.source}
            showControls={true}
            showLabels={false}
          />
        {/if}
      </div>
    </div>
  </div>

  {#if entry.params}
    <details class="block" open>
      <summary>params ({Object.keys(entry.params).length})</summary>
      <table class="params-table">
        <thead><tr><th>key</th><th>default</th><th>min</th><th>max</th><th>step</th><th>unit</th></tr></thead>
        <tbody>
          {#each Object.entries(entry.params) as [k, p] (k)}
            <tr><td><code>{k}</code></td><td>{(p as any).default}</td><td>{(p as any).min ?? '—'}</td><td>{(p as any).max ?? '—'}</td><td>{(p as any).step ?? '—'}</td><td>{(p as any).unit ?? '—'}</td></tr>
          {/each}
        </tbody>
      </table>
    </details>
  {/if}
  {#if entry.rule?.kind === 'primitive' && entry.rule?.preamble}
    <details class="block">
      <summary>preamble ({entry.rule.preamble.length} lines)</summary>
      <pre class="code">{entry.rule.preamble.join('\n')}</pre>
    </details>
  {/if}
  {#if entry.rule?.kind === 'primitive' && entry.rule?.polygon}
    <details class="block">
      <summary>polygon ({entry.rule.polygon.length} vertices)</summary>
      <pre class="code">{entry.rule.polygon.map((p: string, i: number) => `  [${i}] ${p}`).join('\n')}</pre>
    </details>
  {/if}
  {#if entry.rule?.kind === 'compose'}
    <details class="block">
      <summary>composition</summary>
      <pre class="code">{JSON.stringify(entry.rule.composition, null, 2)}</pre>
    </details>
  {/if}
  {#if entry.expects_bake}
    <details class="block">
      <summary>expects bake</summary>
      <pre class="code">{JSON.stringify(entry.expects_bake, null, 2)}</pre>
    </details>
  {/if}
  {#if lockEntry}
    <details class="block">
      <summary>lock entry · drift</summary>
      <pre class="code">{JSON.stringify(lockEntry, null, 2)}</pre>
    </details>
  {/if}
  <details class="block">
    <summary>full rule JSON</summary>
    <pre class="code">{JSON.stringify(entry.rule, null, 2)}</pre>
  </details>
</div>

<style>
  /* Tab body — scrollable inner column. */
  .tab-body { padding: 6px 14px 14px; overflow-y: auto; display: grid; gap: 8px; align-content: start; min-height: 0; }
  .tab-body .def-line.rich { font: 14px/1.55 Arial; color: #1f2937; margin: 0; padding: 10px 12px; background: #f8fafc; border-left: 3px solid #0369a1; border-radius: 0 4px 4px 0; }
  /* Chip groups — synonyms. */
  .chips-row { display: flex; flex-wrap: wrap; gap: 4px; align-items: center; }
  .chips-label { font: 600 10px Arial; color: #6b7280; text-transform: uppercase; letter-spacing: 0.6px; min-width: 80px; }
  .prop-chip { padding: 2px 8px; border-radius: 9999px; font: 11px Arial; background: #fff; border: 1px solid #fde68a; color: #78350f; }
  .prop-chip.syn { background: #f3f4f6; color: #475569; border-color: #e5e7eb; }
  /* Compact info-chip row beneath the definition. */
  .info-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .info-chip { padding: 2px 8px; border-radius: 9999px; font: 11px Arial; background: #f3f4f6; color: #475569; border: 1px solid #e5e7eb; }
  .info-chip.ext-info  { background: #fce7f3; color: #831843; border-color: #f9a8d4; }
  .info-chip.link      { background: #dbeafe; color: #1d4ed8; border-color: #93c5fd; text-decoration: none; }
  .info-chip.link:hover { background: #bfdbfe; }
  .info-chip.rule      { background: #f3f4f6; font-family: ui-monospace, monospace; }
  /* 2D drawing + 3D bake side-by-side. */
  .view-row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; align-items: stretch; min-height: 320px; }
  .view-row > * { min-width: 0; }
  .empty-card { display: flex; align-items: center; justify-content: center; color: #a8a29e; font: 11px Arial; min-height: 320px; background: #fafaf9; border: 1px dashed #e7e5e4; border-radius: 6px; }
  .empty-card.faded { opacity: 0.6; }
  .bake-card {
    display: grid; grid-template-rows: auto 1fr;
    background: #fafaf9; border: 1px solid #e7e5e4; border-radius: 6px;
    overflow: hidden;
  }
  .bake-card .bake-head { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border-bottom: 1px solid #e7e5e4; background: #fff; }
  .bake-card .bake-head .spacer { flex: 1; }
  .bake-card .bake-title { font: 600 11px Arial; color: #57534e; text-transform: uppercase; letter-spacing: 0.5px; }
  .bake-card .bake-body { padding: 6px; overflow: hidden; min-height: 0; }
  .block { margin-top: 2px; border: 1px solid #e5e7eb; border-radius: 4px; background: #fff; }
  .block summary { padding: 3px 10px; font: 600 12px Arial; color: #1f2937; cursor: pointer; user-select: none; }
  .block summary:hover { background: #f9fafb; }
  .block[open] summary { border-bottom: 1px solid #f1f5f9; }
  .code { padding: 10px 12px; margin: 0; font: 11px ui-monospace, SFMono-Regular, Menlo, monospace; color: #1f2937; overflow: auto; max-height: 320px; }
  .params-table { width: 100%; border-collapse: collapse; font: 11px Arial; }
  .params-table th, .params-table td { padding: 4px 8px; border-bottom: 1px solid #f1f5f9; text-align: left; }
  .params-table th { background: #f9fafb; font-weight: 600; color: #475569; }
  .params-table td code { font: 600 11px ui-monospace, monospace; color: #0c4a6e; }
  .empty { color: #6b7280; font: 12px Arial; padding: 8px; }
  .error { color: #b91c1c; font: 11px ui-monospace, monospace; padding: 8px; }
</style>
