<script lang="ts">
  // Overlay panel: camera position, light positions, light intensities. Reads
  // and writes the shared `scene` state in scene-state.svelte.ts, so what's
  // typed here drives ComponentScene and what OrbitControls drags writes back
  // shows up here.
  //
  // Mounted by parent pages as a sibling to <Canvas> inside a position:relative
  // container. NOT projected via threlte's <HTML> — that anchors at the 3D
  // origin (canvas centre), which lands the panel on top of the model.
  import { scene } from '$lib/shared/scene-state.svelte';
</script>

<!-- Stop pointer events so a drag inside an input box doesn't also drag the
     OrbitControls behind it. -->
<div
  class="sv-panel"
  onpointerdown={(e) => e.stopPropagation()}
  onpointermove={(e) => e.stopPropagation()}
  onmousedown={(e) => e.stopPropagation()}
  onwheel={(e) => e.stopPropagation()}
  ontouchstart={(e) => e.stopPropagation()}
>
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

<style>
  .sv-panel {
    position: absolute;
    top: 8px;
    left: 8px;
    z-index: 30;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 6px 8px;
    background: rgba(0, 0, 0, 0.65);
    color: #fff;
    border-radius: 4px;
    font: 11px Arial, sans-serif;
    pointer-events: auto;
    user-select: none;
  }
  .sv-row   { display: flex; align-items: center; gap: 4px; }
  .sv-label { width: 22px; opacity: 0.85; }
  .sv-sub   { width: 8px; text-align: center; opacity: 0.7; }
  /* Compact number boxes with the browser spinner arrows hidden — per user
     request the boxes are plain rectangles, no up/down chevrons. */
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
