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

  const LAYERS: Array<{ key: keyof WellViewSettings['layers']; label: string; dot: string }> = [
    { key: 'showOpenHole', label: 'Open hole', dot: '#c084fc' },
    { key: 'showCasing', label: 'Casing', dot: '#94a3b8' },
    { key: 'showCement', label: 'Cement', dot: '#d6c7a1' },
    { key: 'showTubing', label: 'Tubing', dot: '#eab308' },
    { key: 'showCompletions', label: 'Completions', dot: '#f59e0b' },
    { key: 'showPerforations', label: 'Perfs', dot: '#ef4444' },
  ];
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
    <!-- Layers -->
    <div class="wvc-group" aria-label="Layers">
      {#each LAYERS as l}
        <button
          type="button"
          class="wvc-chip"
          class:on={settings.layers[l.key]}
          title="Toggle {l.label}"
          aria-pressed={settings.layers[l.key]}
          onclick={() => (settings.layers[l.key] = !settings.layers[l.key])}
        >
          <span class="wvc-dot" style="background:{l.dot}"></span>{l.label}
        </button>
      {/each}
    </div>

    <span class="wvc-sep"></span>

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

    <!-- Dials -->
    <div class="wvc-group wvc-dials" aria-label="Scale">
      <label class="wvc-dial" class:dim={!settings.cutaway} title="Cutaway plane rotation">
        <span class="wvc-dial-lbl">Cut az</span>
        <input type="range" min="0" max="360" step="5" bind:value={settings.cutAzimuth} disabled={!settings.cutaway} />
        <span class="wvc-dial-val">{settings.cutAzimuth}°</span>
      </label>
      <label class="wvc-dial" title="Radial exaggeration (inches → scene units)">
        <span class="wvc-dial-lbl">Dia ×</span>
        <input type="range" min="1" max="20" step="0.5" bind:value={settings.diaScale} />
        <span class="wvc-dial-val">{settings.diaScale}</span>
      </label>
      <label class="wvc-dial" title="Depth stretch (applied after DTX)">
        <span class="wvc-dial-lbl">Depth ×</span>
        <input type="range" min="0.25" max="4" step="0.25" bind:value={settings.zScale} />
        <span class="wvc-dial-val">{settings.zScale}</span>
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
  .wvc-dot {
    width: 9px; height: 9px; border-radius: 50%;
    display: inline-block; flex: none;
    box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.4);
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
  .wvc-dial-val {
    min-width: 30px;
    text-align: right;
    color: #fff;
    font-variant-numeric: tabular-nums;
  }
</style>
