<script lang="ts">
  /**
   * WellViewControls — the display / view + layer control bar over the 3D
   * well stage (W-A, `docs/plans/wells-interface.md` §A). Modeled on the CAD
   * editor's `SceneControls` gear pattern but laid out as a horizontal ewells
   * chrome bar pinned to the top of the stage.
   *
   * Drives `WellSchematic3D`'s props by MUTATING the shared `WellViewSettings`
   * object (deep-reactive — the 3D view + depth ruler read the same object, so
   * there is ONE source of truth; see view-settings.ts).
   *
   * NOTE — camera presets (elevation / plan / 3D) are intentionally NOT here:
   * the scene's camera is derived + owned by <OrbitControls>, with only an
   * `onCameraMove` READOUT hook and no external setter. Adding presets would
   * mean reworking the scene's camera ownership (out of this piece's scope);
   * deferred + noted rather than faked.
   */
  import type { WellViewSettings } from './view-settings';

  let { settings }: { settings: WellViewSettings } = $props();

  // Collapsed → a slim strip with just a re-open toggle, so the bar never
  // eats the stage when the user wants a clean view.
  let open = $state(true);

  // Layer/element toggles live on the LEFT element rail now (WellElementRail —
  // SVTC's main element switch). This bar keeps the VIEW toggles + scale dials.

  // Clamp a typed numeric-entry value on commit.
  function clampNum(v: number, min: number, max: number, fallback: number) {
    return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
  }
</script>

<div
  class="wvc"
  class:closed={!open}
  role="toolbar"
  tabindex="-1"
  aria-label="Well view controls"
  onpointerdown={(e) => e.stopPropagation()}
  onwheel={(e) => e.stopPropagation()}
>
  <button
    class="wvc-handle"
    type="button"
    title={open ? 'Hide view controls' : 'Show view controls'}
    aria-label="Toggle view controls"
    aria-expanded={open}
    onclick={() => (open = !open)}
  >
    <span class="wvc-handle-ic">⚙</span>
    {#if !open}<span class="wvc-handle-txt">View</span>{/if}
  </button>

  {#if open}
    <!-- View toggles -->
    <div class="wvc-group" aria-label="View">
      <button type="button" class="wvc-chip" class:on={settings.cutaway}
        title="Half-section cutaway" aria-pressed={settings.cutaway}
        onclick={() => (settings.cutaway = !settings.cutaway)}>◑ Cutaway</button>
      <button type="button" class="wvc-chip" class:on={settings.directional}
        title="Follow the deviation survey" aria-pressed={settings.directional}
        onclick={() => (settings.directional = !settings.directional)}>⟋ Directional</button>
      <button type="button" class="wvc-chip" class:on={settings.dtx}
        title="DTX depth emphasis (expand cluttered zones)" aria-pressed={settings.dtx}
        onclick={() => (settings.dtx = !settings.dtx)}>↕ DTX</button>
      <button type="button" class="wvc-chip" class:on={settings.showRuler}
        title="Depth ruler + component labels" aria-pressed={settings.showRuler}
        onclick={() => (settings.showRuler = !settings.showRuler)}>▏ Ruler</button>
      <button type="button" class="wvc-chip" class:on={settings.whiteBg}
        title="White schematic background" aria-pressed={settings.whiteBg}
        onclick={() => (settings.whiteBg = !settings.whiteBg)}>◻ White</button>
    </div>

    <span class="wvc-sep"></span>

    <!-- Dials — slider + numeric entry (both mutate the shared settings). -->
    <div class="wvc-group wvc-dials" aria-label="Scale">
      <label class="wvc-dial" class:dim={!settings.cutaway} title="Cutaway plane rotation">
        <span class="wvc-dial-lbl">Cut az</span>
        <input type="range" min="0" max="360" step="5" bind:value={settings.cutAzimuth} disabled={!settings.cutaway} />
        <input class="wvc-num" type="number" min="0" max="360" step="5" value={settings.cutAzimuth} disabled={!settings.cutaway}
          onchange={(e) => (settings.cutAzimuth = clampNum(+e.currentTarget.value, 0, 360, settings.cutAzimuth))} />
      </label>
      <label class="wvc-dial" title="Radial exaggeration (inches → scene units)">
        <span class="wvc-dial-lbl">Dia ×</span>
        <input type="range" min="1" max="20" step="0.5" bind:value={settings.diaScale} />
        <input class="wvc-num" type="number" min="1" max="20" step="0.5" value={settings.diaScale}
          onchange={(e) => (settings.diaScale = clampNum(+e.currentTarget.value, 1, 20, settings.diaScale))} />
      </label>
      <label class="wvc-dial" title="Depth stretch (applied after DTX)">
        <span class="wvc-dial-lbl">Depth ×</span>
        <input type="range" min="0.25" max="4" step="0.25" bind:value={settings.zScale} />
        <input class="wvc-num" type="number" min="0.25" max="4" step="0.25" value={settings.zScale}
          onchange={(e) => (settings.zScale = clampNum(+e.currentTarget.value, 0.25, 4, settings.zScale))} />
      </label>
    </div>
  {/if}
</div>

<style>
  .wvc {
    position: absolute;
    top: 8px;
    left: 8px;
    right: 8px;
    z-index: 20;
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 6px 10px;
    padding: 6px 8px;
    background: rgba(16, 16, 26, 0.86);
    border: 1px solid #2a2a3e;
    border-radius: 8px;
    backdrop-filter: blur(3px);
    font: 11px Arial, sans-serif;
    color: #ccd;
    user-select: none;
  }
  .wvc.closed {
    right: auto;
    padding: 4px;
    gap: 0;
  }
  .wvc-handle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    border: none;
    color: #aab;
    cursor: pointer;
    padding: 2px 4px;
    font: inherit;
  }
  .wvc-handle:hover { color: #fff; }
  .wvc-handle-ic { font-size: 13px; color: #cc4444; }
  .wvc-handle-txt { font-weight: 700; }

  .wvc-group { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; }

  .wvc-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: #1a1a2a;
    border: 1px solid #2f2f46;
    border-radius: 9999px;
    color: #889;
    cursor: pointer;
    padding: 3px 9px;
    font: 600 11px Arial;
    white-space: nowrap;
    transition: background 80ms, color 80ms, border-color 80ms;
  }
  .wvc-chip:hover { color: #fff; border-color: #44446a; }
  .wvc-chip.on {
    background: #232340;
    border-color: #cc3333;
    color: #fff;
  }
  .wvc-sep {
    width: 1px;
    align-self: stretch;
    background: #2a2a3e;
    margin: 0 2px;
  }

  .wvc-dials { gap: 4px 12px; }
  .wvc-dial {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    cursor: pointer;
  }
  .wvc-dial.dim { opacity: 0.4; }
  .wvc-dial-lbl { color: #99a; white-space: nowrap; }
  .wvc-dial input[type='range'] {
    width: 78px;
    accent-color: #cc3333;
    cursor: pointer;
  }
  .wvc-num {
    width: 48px;
    background: #12121e;
    border: 1px solid #34345a;
    border-radius: 5px;
    color: #fff;
    font: 11px ui-monospace, monospace;
    padding: 2px 4px;
    text-align: right;
    font-variant-numeric: tabular-nums;
  }
  .wvc-num:disabled { opacity: 0.5; }
</style>
