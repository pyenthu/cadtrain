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
    <div class="sv-row sv-row-wide">
      <span class="sv-label">Z×</span>
      <input class="sv-range" type="range" min="0.05" max="1" step="0.05" bind:value={scene.zScale} />
      <input type="number" step="0.05" min={0.05} max={1} bind:value={scene.zScale} />
    </div>
    <div class="sv-row sv-row-toggles">
      <label class="sv-check">
        <input type="checkbox" bind:checked={scene.showCutaway} />
        Cross-section
      </label>
      <label class="sv-check">
        <input type="checkbox" bind:checked={scene.showEdges} />
        Edges
      </label>
    </div>
    <!-- Z-axis light strip — even illumination down a long/tall part. -->
    <div class="sv-row sv-zlight">
      <label class="sv-check sv-zlight-master">
        <input type="checkbox" bind:checked={scene.zStripLight} />
        Z-axis light
      </label>
      <span class="sv-sub">n</span>
      <input type="number" step="1" min={1} max={20} bind:value={scene.zStripCount} disabled={!scene.zStripLight} />
      <span class="sv-sub">i</span>
      <input type="number" step="10" min={0} bind:value={scene.zStripIntensity} disabled={!scene.zStripLight} />
      <span class="sv-sub">⌀</span>
      <input type="number" step="1" min={0} bind:value={scene.zStripRadius} disabled={!scene.zStripLight} />
    </div>
    <!-- True rectangular AREA light running along Z — even soft wash down a
         long/tall part. Independent of the point-light strip above; swaps the
         lit meshes to MeshStandardMaterial while on. -->
    <div class="sv-row sv-zlight">
      <label class="sv-check sv-zlight-master">
        <input type="checkbox" bind:checked={scene.zRectLight} />
        Rect light (Z)
      </label>
      <span class="sv-sub">i</span>
      <input type="number" step="0.5" min={0} bind:value={scene.zRectIntensity} disabled={!scene.zRectLight} />
      <span class="sv-sub">w</span>
      <input type="number" step="1" min={0} bind:value={scene.zRectWidth} disabled={!scene.zRectLight} title="width along Z (0 = auto-span the part)" />
      <span class="sv-sub">h</span>
      <input type="number" step="1" min={0} bind:value={scene.zRectHeight} disabled={!scene.zRectLight} title="height across the part" />
      <span class="sv-sub">⌀</span>
      <input type="number" step="1" bind:value={scene.zRectOffset} disabled={!scene.zRectLight} title="radial offset off the axis" />
    </div>
    <!-- TEMP warp experiment — sinusoidal Z displacement. Remove this
         row + scene.warp* fields + warp.ts to retire the feature. -->
    <div class="sv-row sv-warp">
      <label class="sv-check sv-warp-master">
        <input type="checkbox" bind:checked={scene.warpEnabled} />
        Warp
      </label>
      <label class="sv-warp-radio" class:dim={!scene.warpEnabled}><input type="radio" name="warpAxis" value="x" bind:group={scene.warpAxis} disabled={!scene.warpEnabled} />X</label>
      <label class="sv-warp-radio" class:dim={!scene.warpEnabled}><input type="radio" name="warpAxis" value="y" bind:group={scene.warpAxis} disabled={!scene.warpEnabled} />Y</label>
      <span class="sv-sub">a</span>
      <input type="number" step="0.05" min={0} max={2} bind:value={scene.warpAmp} disabled={!scene.warpEnabled} />
      <span class="sv-sub">ƒ</span>
      <input type="number" step="0.1" min={0} max={4} bind:value={scene.warpFreq} disabled={!scene.warpEnabled} />
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
  .sv-row-wide .sv-range { flex: 1; min-width: 0; accent-color: #cc2222; height: 14px; }
  .sv-row-toggles { gap: 14px; margin-top: 2px; }
  .sv-check { display: inline-flex; align-items: center; gap: 4px; cursor: pointer; }
  .sv-check input[type='checkbox'] { accent-color: #cc2222; cursor: pointer; }
  /* Z-axis light strip row */
  .sv-zlight { gap: 4px; flex-wrap: wrap; }
  .sv-zlight-master { margin-right: 4px; }
  /* TEMP warp experiment styling */
  .sv-warp { gap: 4px; flex-wrap: wrap; }
  .sv-warp-radio { display: inline-flex; align-items: center; gap: 2px; cursor: pointer; }
  .sv-warp-radio input[type='radio'] { accent-color: #cc2222; cursor: pointer; }
  .sv-warp-radio.dim { opacity: 0.4; }
  .sv-warp-master { margin-right: 4px; }
  .sv-panel input[type='number']:disabled { opacity: 0.35; cursor: not-allowed; }
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
