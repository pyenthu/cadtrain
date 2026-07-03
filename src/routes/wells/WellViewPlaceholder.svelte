<script lang="ts">
  /**
   * WellViewPlaceholder — the CENTRAL view of the /wells app shell, one per
   * open `.wson` tab.
   *
   * THIS IS A MOUNT SEAM. A parallel session is porting the 3D well engine into
   * `src/lib/wells/` and will expose `src/lib/wells/WellSchematic3D.svelte`
   * (prop: `wson`). At merge, the real 3D view replaces this placeholder at the
   * clearly-marked `<!-- MOUNT: ... -->` comment below. Until then this shows
   * the loaded WSON's header summary so the shell is useful + testable on its
   * own. This component deliberately does NOT import from `$lib/wells/**`
   * (engine turf) — it uses the route-local `wson-summary.ts` parser.
   */
  import { Canvas } from '@threlte/core';
  import WellSchematic3D from '$lib/wells/WellSchematic3D.svelte';
  import { summarise, type WsonDoc } from './wson-summary';

  let {
    wson = null,
    error = null,
    fileName = '',
  }: { wson?: WsonDoc | null; error?: string | null; fileName?: string } = $props();

  const summary = $derived(summarise(wson));
  const fmtM = (v: number | null) => (v == null ? '—' : `${v} m`);
</script>

<div class="wv">
  {#if error}
    <div class="wv-error">
      <div class="wv-error-ic">⚠</div>
      <div>
        <div class="wv-error-title">Failed to parse {fileName}</div>
        <code class="wv-error-msg">{error}</code>
      </div>
    </div>
  {:else if summary}
    <!-- Real 3D well-schematic view: WellSchematic3D is Threlte scene content
         (own camera + OrbitControls), so it mounts inside a <Canvas>. -->
    <section class="wv-stage">
      <Canvas>
        <WellSchematic3D wson={wson as any} />
      </Canvas>
    </section>

    <section class="wv-summary">
      <header class="wv-whead">
        <h1>{summary.wellName}</h1>
        <div class="wv-chips">
          <span class="wv-chip">{summary.deviated ? '⟋ deviated' : '│ vertical'}</span>
          {#if summary.wellType}<span class="wv-chip">{summary.wellType}</span>{/if}
          <span class="wv-chip">TD {fmtM(summary.td)}</span>
          <span class="wv-chip">PBTD {fmtM(summary.pbtd)}</span>
        </div>
      </header>

      <div class="wv-counts">
        <div class="wv-count"><b>{summary.counts.openHole}</b><span>open hole</span></div>
        <div class="wv-count"><b>{summary.counts.casing}</b><span>casing strings</span></div>
        <div class="wv-count"><b>{summary.counts.completions}</b><span>completions</span></div>
        <div class="wv-count"><b>{summary.counts.perforations}</b><span>perforations</span></div>
        <div class="wv-count"><b>{summary.counts.survey}</b><span>survey stations</span></div>
      </div>
    </section>
  {:else}
    <div class="wv-empty">No WSON loaded.</div>
  {/if}
</div>

<style>
  .wv {
    height: 100%;
    display: flex;
    flex-direction: column;
    min-height: 0;
    background: #14141f;
    color: #e8e8ef;
    overflow: hidden;
  }

  .wv-stage {
    flex: 1;
    min-height: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    margin: 14px;
    border: 1px dashed #34345a;
    border-radius: 10px;
    background: radial-gradient(circle at 50% 35%, #20203a 0%, #10101a 80%);
  }
  .wv-stage-inner {
    text-align: center;
    color: #6a6a90;
  }
  .wv-3d-glyph {
    font-size: 46px;
    color: #cc3333;
    opacity: 0.55;
    line-height: 1;
  }
  .wv-3d-title {
    margin-top: 10px;
    font: 600 14px Arial;
    color: #aab;
  }
  .wv-3d-sub {
    margin-top: 4px;
    font: 11px ui-monospace, monospace;
    color: #667;
  }
  .wv-3d-sub code {
    color: #7fa;
  }

  .wv-summary {
    flex: none;
    padding: 4px 18px 18px;
  }
  .wv-whead h1 {
    font-size: 18px;
    margin: 0 0 8px;
    color: #fff;
  }
  .wv-chips {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-bottom: 12px;
  }
  .wv-chip {
    font: 600 11px ui-monospace, monospace;
    background: #232340;
    border: 1px solid #34345a;
    border-radius: 9999px;
    padding: 2px 10px;
    color: #aab;
  }
  .wv-counts {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(120px, 1fr));
    gap: 10px;
  }
  .wv-count {
    background: #1b1b2c;
    border: 1px solid #2a2a3e;
    border-radius: 8px;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .wv-count b {
    font-size: 20px;
    color: #fff;
  }
  .wv-count span {
    font-size: 11px;
    color: #778;
  }

  .wv-error {
    margin: 24px;
    display: flex;
    gap: 12px;
    align-items: flex-start;
    background: #2a1620;
    border: 1px solid #cc3333;
    border-radius: 8px;
    padding: 14px 16px;
  }
  .wv-error-ic {
    font-size: 20px;
    color: #ff6666;
  }
  .wv-error-title {
    font: 600 13px Arial;
    color: #ff8a8a;
  }
  .wv-error-msg {
    display: block;
    margin-top: 4px;
    font: 11px ui-monospace, monospace;
    color: #d99;
  }
  .wv-empty {
    margin: auto;
    color: #55556a;
    font: 12px ui-monospace, monospace;
  }
</style>
