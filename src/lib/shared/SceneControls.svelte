<script lang="ts">
  // Camera + light controls — collapsed to a settings-cog icon at the
  // canvas top-right by default. Clicking the icon expands the inputs
  // panel; clicking again (or on the close ×) collapses it. The panel
  // reads/writes the shared `scene` state in scene-state.svelte.ts so
  // OrbitControls drags + typed values stay in sync.
  //
  // Mounted by parent pages as a sibling to <Canvas> inside a
  // position:relative container.
  import { scene } from '$lib/shared/scene-state.svelte';
  let open = $state(false);
</script>

<button
  class="sv-toggle"
  class:open
  type="button"
  title="Camera + lights"
  aria-label="Camera and light controls"
  aria-expanded={open}
  onclick={() => (open = !open)}
  onpointerdown={(e) => e.stopPropagation()}
  onmousedown={(e) => e.stopPropagation()}
>
  <!-- Inline gear glyph (Unicode ⚙) — keeps the component self-contained,
       no icon dependency. -->
  ⚙
</button>

{#if open}
  <div
    class="sv-panel"
    onpointerdown={(e) => e.stopPropagation()}
    onpointermove={(e) => e.stopPropagation()}
    onmousedown={(e) => e.stopPropagation()}
    onwheel={(e) => e.stopPropagation()}
    ontouchstart={(e) => e.stopPropagation()}
  >
    <div class="sv-hdr">
      <span class="sv-title">Camera + Lights</span>
      <button class="sv-close" type="button" aria-label="Close" onclick={() => (open = false)}>×</button>
    </div>
    <div class="sv-row">
      <span class="sv-label">Cam</span>
      <input type="number" step="0.1" bind:value={scene.cam.x} />
      <input type="number" step="0.1" bind:value={scene.cam.y} />
      <input type="number" step="0.1" bind:value={scene.cam.z} />
    </div>
    <div class="sv-row">
      <span class="sv-label">L1</span>
      <input type="number" step="0.1" bind:value={scene.l1.x} />
      <input type="number" step="0.1" bind:value={scene.l1.y} />
      <input type="number" step="0.1" bind:value={scene.l1.z} />
      <span class="sv-sub">i</span>
      <input type="number" step="5" min={0} bind:value={scene.l1.i} />
    </div>
    <div class="sv-row">
      <span class="sv-label">L2</span>
      <input type="number" step="0.1" bind:value={scene.l2.x} />
      <input type="number" step="0.1" bind:value={scene.l2.y} />
      <input type="number" step="0.1" bind:value={scene.l2.z} />
      <span class="sv-sub">i</span>
      <input type="number" step="5" min={0} bind:value={scene.l2.i} />
    </div>
  </div>
{/if}

<style>
  .sv-toggle {
    position: absolute;
    top: 8px;
    right: 8px;
    z-index: 30;
    width: 28px; height: 28px;
    display: flex; align-items: center; justify-content: center;
    background: rgba(0, 0, 0, 0.55);
    color: #ddd;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 4px;
    cursor: pointer;
    font-size: 14px;
    line-height: 1;
    user-select: none;
    transition: background 80ms, color 80ms;
  }
  .sv-toggle:hover { background: rgba(0, 0, 0, 0.75); color: #fff; }
  .sv-toggle.open { background: #cc2222; border-color: #cc2222; color: #fff; }
  .sv-panel {
    position: absolute;
    top: 42px;
    right: 8px;
    z-index: 30;
    display: flex; flex-direction: column; gap: 4px;
    padding: 6px 8px 8px;
    background: rgba(0, 0, 0, 0.75);
    color: #fff;
    border-radius: 4px;
    font: 11px Arial, sans-serif;
    pointer-events: auto;
    user-select: none;
    min-width: 270px;
  }
  .sv-hdr {
    display: flex; justify-content: space-between; align-items: center;
    margin: -2px 0 4px;
  }
  .sv-title { font: bold 10px Arial; opacity: 0.7; letter-spacing: 0.5px; text-transform: uppercase; }
  .sv-close { background: transparent; border: none; color: #ddd; font-size: 16px; line-height: 1; cursor: pointer; padding: 0 4px; }
  .sv-close:hover { color: #fff; }
  .sv-row   { display: flex; align-items: center; gap: 4px; }
  .sv-label { width: 22px; opacity: 0.85; }
  .sv-sub   { width: 8px; text-align: center; opacity: 0.7; }
  .sv-panel input[type='number'] {
    width: 46px;
    padding: 2px 4px;
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 3px;
    font: inherit;
    font-variant-numeric: tabular-nums;
    text-align: right;
    appearance: textfield;
    -moz-appearance: textfield;
  }
  .sv-panel input[type='number']::-webkit-inner-spin-button,
  .sv-panel input[type='number']::-webkit-outer-spin-button {
    -webkit-appearance: none;
    appearance: none;
    margin: 0;
  }
</style>
