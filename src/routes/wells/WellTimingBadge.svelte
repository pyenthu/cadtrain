<script lang="ts">
  /**
   * WellTimingBadge — DIAGNOSTIC flash overlay for the /wells 3D view.
   *
   * The 3D build (per-string Manifold solids + boolean cutaway + per-vertex warp
   * + mesh extraction, all synchronous on the main thread) is the well-schematic
   * perf hot path (docs/research/wells-perf-ewells-vs-cadtrain.md). This badge
   * surfaces WHERE the time goes on each rebuild — styled like the TF/OCCT `Nms`
   * timing chips in PrimitiveDualCanvas. Pure diagnostic; no geometry effect.
   *
   * `flashN` bumps on every rebuild so the {#key} remount replays the flash
   * animation — dial changes visibly re-cost themselves.
   */
  import type { WellBuildTiming } from '$lib/wells/threeD/manifoldCut';

  let {
    timing = null,
    flashN = 0,
  }: { timing?: WellBuildTiming | null; flashN?: number } = $props();

  const ms = (n: number) => `${Math.round(n)}ms`;
</script>

{#if timing}
  {#key flashN}
    <div class="wtb" title="3D build phase timing (diagnostic). Console: [wells-3d]">
      <span class="wtb-total">{ms(timing.total)}</span>
      <span class="wtb-ph">shell {ms(timing.solid)}</span>
      <span class="wtb-ph" class:hot={timing.cutActive}>cutaway {ms(timing.cutaway)}</span>
      <span class="wtb-ph">warp {ms(timing.warp)}</span>
      <span class="wtb-ph">mesh {ms(timing.extract)}</span>
      <span class="wtb-sep">·</span>
      <span class="wtb-n">{timing.strings} strings</span>
      <span class="wtb-n">{timing.csgOps} CSG</span>
      <span class="wtb-n">{timing.tris.toLocaleString()} tris</span>
    </div>
  {/key}
{/if}

<style>
  .wtb {
    position: absolute;
    right: 8px;
    bottom: 8px;
    z-index: 8;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px;
    max-width: 60%;
    justify-content: flex-end;
    padding: 3px 8px;
    border-radius: 4px;
    background: rgba(15, 15, 25, 0.82);
    border: 1px solid rgba(255, 255, 255, 0.12);
    font: 600 10px ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #cbd5e1;
    pointer-events: none;
    /* Flash on remount (replayed via {#key flashN}). */
    animation: wtb-flash 0.6s ease-out;
  }
  .wtb-total {
    color: #fde68a;
    font-weight: 700;
    letter-spacing: 0.3px;
  }
  .wtb-ph { color: #93c5fd; }
  .wtb-ph.hot { color: #fca5a5; font-weight: 700; }
  .wtb-sep { color: #52525b; }
  .wtb-n { color: #86efac; }
  @keyframes wtb-flash {
    0% { box-shadow: 0 0 0 2px rgba(250, 204, 21, 0.9); background: rgba(60, 50, 15, 0.92); }
    100% { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0); background: rgba(15, 15, 25, 0.82); }
  }
</style>
