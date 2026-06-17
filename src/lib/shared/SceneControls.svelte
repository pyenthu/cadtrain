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
  // Warp now bakes into the geometry server-side (a ~hundreds-of-ms re-bake),
  // so trigger it only on COMMIT — the master toggle, an axis switch, or an
  // amp/freq `change` (Enter / blur / step-arrow), NOT per keystroke. Bumping
  // this nonce is the single signal PrimitiveDualCanvas keys its re-bake on;
  // `bind:value` still updates the live warp* values continuously.
  function commitWarp() { scene.warpBakeNonce++; }
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
    <div class="sv-row sv-row-toggles">
      <label class="sv-check">
        <input type="checkbox" bind:checked={scene.showCutaway} />
        Cross-section
      </label>
      <label class="sv-check">
        <input type="checkbox" bind:checked={scene.showEdges} />
        Edges
      </label>
      <label class="sv-check" title="Orthographic (parallel) camera — no perspective foreshortening">
        <input type="checkbox" bind:checked={scene.cam3dOrtho} />
        Ortho
      </label>
    </div>
    <!-- Smooth-shading: render-time flatShading flip (free, no re-bake).
         Auto = the per-part heuristic (curved engines smooth, cubes/hex flat);
         Smooth / Flat force it. Crease = the BUILD-TIME minSharpAngle baked into
         calculateNormals — changing it RE-BAKES (it splits the crease vertices).
         Default 60°; edges above it stay hard, below it shade smooth. -->
    <div class="sv-row sv-shade" title="Smooth shading (render-time) + crease angle (re-bakes)">
      <span class="sv-label">Shade</span>
      <select class="sv-select" bind:value={scene.smoothShade} title="Auto = per-part heuristic; Smooth/Flat override it (render-time, no re-bake)">
        <option value="auto">Auto</option>
        <option value="smooth">Smooth</option>
        <option value="flat">Flat</option>
      </select>
      <span class="sv-sub" title="Crease angle (°) — baked into the normals; re-bakes on change">∠</span>
      <input
        type="number" step="5" min="1" max="180" value={scene.creaseAngle}
        title="Crease angle (degrees): edges sharper than this stay hard, softer ones smooth. Default 60. Re-bakes on Enter/blur."
        onchange={(e) => { const v = Number((e.currentTarget as HTMLInputElement).value); if (Number.isFinite(v)) scene.creaseAngle = Math.max(1, Math.min(180, Math.round(v))); }}
      />
    </div>
    <!-- Warp — sinusoidal Z displacement, BAKED into the Manifold geometry
         server-side (so the black wire edges follow the bulge). Each control
         calls commitWarp() to re-bake only on commit, not per keystroke. -->
    <div class="sv-row sv-warp">
      <label class="sv-check sv-warp-master">
        <input type="checkbox" bind:checked={scene.warpEnabled} onchange={commitWarp} />
        Warp
      </label>
      <label class="sv-warp-radio" class:dim={!scene.warpEnabled}><input type="radio" name="warpAxis" value="x" bind:group={scene.warpAxis} onchange={commitWarp} disabled={!scene.warpEnabled} />X</label>
      <label class="sv-warp-radio" class:dim={!scene.warpEnabled}><input type="radio" name="warpAxis" value="y" bind:group={scene.warpAxis} onchange={commitWarp} disabled={!scene.warpEnabled} />Y</label>
      <span class="sv-sub">a</span>
      <input type="number" step="0.05" min={0} max={2} bind:value={scene.warpAmp} onchange={commitWarp} disabled={!scene.warpEnabled} />
      <span class="sv-sub">ƒ</span>
      <input type="number" step="0.1" min={0} max={4} bind:value={scene.warpFreq} onchange={commitWarp} disabled={!scene.warpEnabled} />
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
  /* appearance:auto restores the NATIVE box+check — the Tailwind/Flowbite base
     reset sets appearance:none on form controls, which strips the checkmark
     (and makes accent-color a no-op) so toggles looked like they never switched. */
  .sv-check input[type='checkbox'] { appearance: auto; -webkit-appearance: auto; accent-color: #cc2222; cursor: pointer; width: 14px; height: 14px; }
  /* Z-axis light strip row */
  .sv-zlight { gap: 4px; flex-wrap: wrap; }
  .sv-zlight-master { margin-right: 4px; }
  /* TEMP warp experiment styling */
  .sv-warp { gap: 4px; flex-wrap: wrap; }
  .sv-warp-radio { display: inline-flex; align-items: center; gap: 2px; cursor: pointer; }
  .sv-warp-radio input[type='radio'] { appearance: auto; -webkit-appearance: auto; accent-color: #cc2222; cursor: pointer; }
  .sv-warp-radio.dim { opacity: 0.4; }
  .sv-warp-master { margin-right: 4px; }
  /* Shading row — Auto/Smooth/Flat select + crease-angle number */
  .sv-shade { gap: 6px; margin-top: 2px; }
  .sv-select {
    padding: 2px 4px;
    background: rgba(255, 255, 255, 0.08);
    color: #fff;
    border: 1px solid rgba(255, 255, 255, 0.18);
    border-radius: 3px;
    font: inherit;
    cursor: pointer;
  }
  .sv-select option { background: #222; color: #fff; }
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
