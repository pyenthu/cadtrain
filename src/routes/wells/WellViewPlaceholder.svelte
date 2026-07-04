<script lang="ts">
  /**
   * WellViewPlaceholder — the CENTRAL view of the /wells app shell, one per
   * open `.wson` tab. Mounts the real 3D engine (`WellSchematic3D`) inside a
   * Threlte `<Canvas>`, framed by the display control bar (`WellViewControls`,
   * W-A) and the depth ruler / annotation overlay (`WellDepthRuler`, W-C).
   *
   * All three read ONE shared `WellViewSettings` object (view-settings.ts) that
   * the /wells shell owns and threads in — the single source of truth for the
   * layer/scale/view state. The 3D view publishes its depth-scale back via
   * `onDepthMap` so the ruler stays in lockstep (never re-derives DTX).
   */
  import { Canvas } from '@threlte/core';
  import WellSchematic3D from '$lib/wells/WellSchematic3D.svelte';
  import WellViewControls from './WellViewControls.svelte';
  import WellElementRail from './WellElementRail.svelte';
  import WellDepthRuler from './WellDepthRuler.svelte';
  import { summarise, type WsonDoc } from './wson-summary';
  import { defaultViewSettings, type WellViewSettings } from './view-settings';

  let {
    wson = null,
    error = null,
    fileName = '',
    // The shell passes a shared settings object; fall back to a per-view
    // default so the component still works standalone.
    view = defaultViewSettings(),
  }: {
    wson?: WsonDoc | null;
    error?: string | null;
    fileName?: string;
    view?: WellViewSettings;
  } = $props();

  const summary = $derived(summarise(wson));

  // Depth-scale published by the 3D view (raw MD → display depth). The ruler
  // consumes the SAME fn — one source of truth for depth. Identity until the
  // scene reports (e.g. before Manifold/geometry settles).
  let remap = $state<(md: number) => number>((md) => md);
  let rawTd = $state(1000);
  function onDepthMap(info: { remap: (md: number) => number; rawTd: number; td: number }) {
    remap = info.remap;
    rawTd = info.rawTd;
  }
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
    <!-- Stage: Threlte scene + non-Canvas overlays (control bar + ruler). -->
    <section class="wv-stage" class:white={view.whiteBg}>
      <Canvas>
        <WellSchematic3D
          wson={wson as any}
          layers={view.layers}
          cutaway={view.cutaway}
          cutAzimuth={view.cutAzimuth}
          directional={view.directional}
          dtx={view.dtx}
          diaScale={view.diaScale}
          zScale={view.zScale}
          whiteBg={view.whiteBg}
          {onDepthMap}
        />
      </Canvas>

      <!-- Top view/scale bar + left element rail (both mutate `view`). -->
      <WellViewControls settings={view} />
      <WellElementRail settings={view} {wson} />
      {#if view.showRuler}
        <!-- Ruler starts right of the 44px element rail (8px inset + gap). -->
        <WellDepthRuler {wson} {remap} {rawTd} whiteBg={view.whiteBg} leftInset={60} />
      {/if}
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

  /* Stage fills the pane (W-G b — trimmed the big 14px inset + dashed frame so
     the 3D view uses the space). Overlays position against this. */
  .wv-stage {
    flex: 1;
    min-height: 0;
    position: relative;
    overflow: hidden;
    background: radial-gradient(circle at 50% 35%, #20203a 0%, #10101a 80%);
  }
  /* W-G c — schematics read best on white. Flag today tints the 3D backdrop;
     W-D's 2D/SVG track view will render on this same white surface. */
  .wv-stage.white {
    background: #ffffff;
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
