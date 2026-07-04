<script lang="ts">
  /**
   * WellViewPlaceholder — the CENTRAL view of the /wells app shell, one per
   * open `.wson` tab. Renders TWO surfaces sharing one `WellViewSettings`:
   *
   *   • 2D (DEFAULT, `WellSchematic2D`) — a pure SVG track schematic. Cheap,
   *     synchronous, NO Manifold CSG. This is the #1 perf lever: opening a tab
   *     no longer triggers the full 3D boolean build (ewells parity — see
   *     `docs/research/wells-perf-ewells-vs-cadtrain.md`).
   *   • 3D (`WellSchematic3D`) — the Manifold half-section cutaway. LAZY: only
   *     mounted once the user first switches to 3D (`mounted3D` sticky latch,
   *     like ewells' `mounted3D`), and kept mounted thereafter so re-selecting
   *     is instant.
   *
   * The control bar (`WellViewControls`) + element rail (`WellElementRail`)
   * mutate the shared settings, so their layer/scale toggles drive BOTH views.
   * The 2D view carries its own depth ruler column; the 3D view uses the
   * overlay `WellDepthRuler`, fed the depth-scale the scene publishes via
   * `onDepthMap`. Both scales are the SAME formula (`wson-2d.buildRemap` ==
   * `WellSchematic3D`'s `remap`), so 2D and 3D place depth identically.
   */
  import { Canvas } from '@threlte/core';
  import WellSchematic3D from '$lib/wells/WellSchematic3D.svelte';
  import WellSchematic2D from './WellSchematic2D.svelte';
  import WellViewControls from './WellViewControls.svelte';
  import WellElementRail from './WellElementRail.svelte';
  import WellDepthRuler from './WellDepthRuler.svelte';
  import WellTimingBadge from './WellTimingBadge.svelte';
  import type { WellBuildTiming } from '$lib/wells/threeD/manifoldCut';
  import { buildRemap, type Wson2DInput } from '$lib/wells/wson-2d';
  import { summarise, type WsonDoc } from './wson-summary';
  import { defaultViewSettings, type WellViewSettings } from './view-settings';

  import type { CompletionPatch } from '$lib/wells/wson-mutate';

  let {
    wson = null,
    error = null,
    fileName = '',
    // The shell passes a shared settings object; fall back to a per-view
    // default so the component still works standalone.
    view = defaultViewSettings(),
    onUpdateCompletion,
    onDeleteCompletion,
  }: {
    wson?: WsonDoc | null;
    error?: string | null;
    fileName?: string;
    view?: WellViewSettings;
    /** Edit-the-diagram hooks — forwarded to the 2D view's double-click editor.
     *  Pure prop forwarding: does NOT touch the 3D scene / its reactivity. */
    onUpdateCompletion?: (srcIndex: number, patch: CompletionPatch) => void;
    onDeleteCompletion?: (srcIndex: number) => void;
  } = $props();

  const summary = $derived(summarise(wson));

  // Lazy-mount the 3D scene only once the user first picks it — sticky latch,
  // so switching away and back is instant (and its camera persists). Until
  // then, opening a tab does ZERO Manifold work.
  let mounted3D = $state(false);
  $effect(() => {
    if (view.viewMode === '3d') mounted3D = true;
  });

  // Shared depth remap for the 2D view (raw MD → display depth) — IDENTICAL to
  // the 3D scene's own `remap`, so both surfaces agree on depth. The 2D view's
  // internal ruler reads this too.
  const remap2d = $derived(
    wson ? buildRemap(wson as unknown as Wson2DInput, { dtx: view.dtx, zScale: view.zScale }) : (md: number) => md,
  );

  // Depth-scale published by the 3D view (raw MD → display depth). The 3D
  // overlay ruler consumes the SAME fn — one source of truth. Identity until
  // the scene reports (e.g. before Manifold/geometry settles).
  let remap = $state<(md: number) => number>((md) => md);
  let rawTd = $state(1000);
  function onDepthMap(info: { remap: (md: number) => number; rawTd: number; td: number }) {
    remap = info.remap;
    rawTd = info.rawTd;
  }

  // DIAGNOSTIC — per-rebuild 3D build timing for the flash badge. `flashN` bumps
  // on every rebuild so the badge replays its flash animation (dial changes show
  // their cost). Only rendered for the 3D view.
  let build3d = $state<WellBuildTiming | null>(null);
  let flashN = $state(0);
  function onBuildTiming(t: WellBuildTiming) {
    build3d = t;
    flashN += 1;
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
    <!-- Stage: 2D SVG surface (default) + lazy 3D scene + shared overlays. -->
    <section class="wv-stage" class:white={view.viewMode === '2d' || view.whiteBg}>
      <!-- 2D track schematic — always mounted (cheap). Hidden when in 3D. -->
      <div class="wv-surface" class:hidden={view.viewMode !== '2d'}>
        <WellSchematic2D {wson} {view} remap={remap2d} {onUpdateCompletion} {onDeleteCompletion} />
      </div>

      <!-- 3D cutaway — mounted only after first 3D selection. Hidden in 2D. -->
      {#if mounted3D}
        <div class="wv-surface" class:hidden={view.viewMode !== '3d'}>
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
              {onBuildTiming}
            />
          </Canvas>
          {#if view.showRuler}
            <!-- 3D overlay ruler (2D carries its own column). -->
            <WellDepthRuler {wson} {remap} {rawTd} whiteBg={view.whiteBg} leftInset={60} />
          {/if}
          <!-- Diagnostic phase-timing flash badge (3D view only). -->
          <WellTimingBadge timing={build3d} {flashN} />
        </div>
      {/if}

      <!-- Top view/scale bar + left element rail (both mutate `view`). -->
      <WellViewControls settings={view} />
      <WellElementRail settings={view} {wson} />
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
  /* Each render surface (2D SVG / 3D Canvas) fills the stage; the inactive one
     is hidden but kept mounted so switching modes is instant + preserves state
     (the /primitives always-mounted-panes pattern). */
  .wv-surface {
    position: absolute;
    inset: 0;
  }
  .wv-surface.hidden {
    visibility: hidden;
    pointer-events: none;
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
