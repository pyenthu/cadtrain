<!--
  RowMaterialPopover.svelte — the per-ROW material / colour override popover for a
  parts_table row (#38d). A DECOUPLED child (like PartSrcPickerPopover /
  MaterialEditorPopover): it takes the row's current RowMaterial + a screen-space
  anchor and emits the FULL new bundle (or null to clear) via `onCommit`; it imports
  nothing from GEP / the graph, so PartsTableCard stays self-contained.

  All rows of a parts_table share ONE template `src`, so color-by-source paints them
  identically — this override (colour · material preset · opacity) is how a user makes
  one instance differ. Fixed-positioned (screen space) + anchored to the row swatch;
  closes on ×/outside/Escape (the scrim). Mirrors docs/plans/refs/parts-table-card.png.
-->
<script lang="ts">
  import type { RowMaterial } from '$lib/graph/composition/composition-graph-types';
  import { MATERIAL_PRESET_NAMES, materialPreset } from '$lib/shared/viewer/material-preset';

  let {
    material,
    anchor,
    onCommit,
    onClose,
  }: {
    /** The row's current override (null / {} = no override). */
    material: RowMaterial | null;
    /** Screen-space position (clientX/clientY of the swatch). */
    anchor: { x: number; y: number };
    /** Commit the FULL new bundle, or null to CLEAR the override. */
    onCommit: (m: RowMaterial | null) => void;
    onClose: () => void;
  } = $props();

  const DEFAULT_COLOR = '#cc2222';
  // Local working copy — seeded from the incoming override; every edit emits the
  // MERGED bundle so the parent replaces the whole row material in one mutation.
  let color = $state(material?.color ?? '');
  let preset = $state(material?.preset ?? 'none');
  let opacity = $state(material?.opacity ?? 1);

  function commit() {
    const out: RowMaterial = {};
    if (color) out.color = color;
    if (preset && preset !== 'none') out.preset = preset;
    if (typeof opacity === 'number' && opacity > 0 && opacity < 1) out.opacity = opacity;
    onCommit(Object.keys(out).length ? out : null);
  }
  function pickColor(hex: string) { color = hex; commit(); }
  function clearAll() { color = ''; preset = 'none'; opacity = 1; onCommit(null); onClose(); }

  // Picking a MATERIAL overrides the colour with that material's own tint (steel →
  // blue-grey, sandstone → tan, …). The override is FLAGGED (below) so it is clear
  // the colour now comes from the material; the user can still pick a custom colour
  // afterwards, which clears the flag.
  function setMaterial(v: string) {
    preset = v;
    const mc = materialPreset(v).color;
    if (mc) color = mc;
    commit();
  }
  // Colour is currently the material's own tint (i.e. material-driven, not custom).
  const matColor = $derived(preset && preset !== 'none' ? materialPreset(preset).color : undefined);
  const colorFromMat = $derived(!!matColor && color.toLowerCase() === (matColor as string).toLowerCase());

  // Portal to <body>. This popover is `position: fixed` (screen space), but it is
  // rendered INSIDE PartsTableCard, which lives in the node's SVG `foreignObject`.
  // A transformed ancestor (the pan/zoom SVG) becomes the containing block for a
  // fixed descendant, so the popover would resolve its left/top against that
  // transformed frame → off-screen. Moving it to <body> restores true screen-space.
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="rm-scrim" use:portal onpointerdown={onClose}></div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="rm-pop" use:portal style={`left:${anchor.x}px; top:${anchor.y}px`}
     onpointerdown={(e) => e.stopPropagation()}>
  <!-- ONE row, on a regular label-over-input grid so the swatch · material ·
       opacity align uniformly (colour has no text label — it is self-evident). -->
  <div class="rm-fields">
    <label class="rm-field rm-field-color">
      <!-- Flag: when the colour is the MATERIAL's own tint (not a custom pick). -->
      <span class="rm-flag" class:on={colorFromMat} aria-hidden={!colorFromMat}
        title="Colour set by the material — pick a colour to override">{colorFromMat ? '↳ matl' : ''}</span>
      <input type="color" class="rm-color" value={color || DEFAULT_COLOR} title="Row colour"
        oninput={(e) => pickColor((e.currentTarget as HTMLInputElement).value)} />
    </label>
    <label class="rm-field rm-field-mat">
      <span>material</span>
      <select value={preset} onchange={(e) => setMaterial((e.currentTarget as HTMLSelectElement).value)}>
        {#each MATERIAL_PRESET_NAMES as m (m)}<option value={m}>{m}</option>{/each}
      </select>
    </label>
    <label class="rm-field rm-field-op">
      <span>opacity <em>{opacity.toFixed(2)}</em></span>
      <input type="range" min="0.05" max="1" step="0.05" value={opacity}
        oninput={(e) => { opacity = Number((e.currentTarget as HTMLInputElement).value); commit(); }} />
    </label>
    <button type="button" class="rm-x" onclick={onClose} aria-label="Close" title="Close">×</button>
  </div>

  <button type="button" class="rm-clear" onclick={clearAll}>clear override</button>
</div>

<style>
  .rm-scrim { position: fixed; inset: 0; z-index: 1000; }
  .rm-pop {
    position: fixed; z-index: 1001; width: 254px;
    background: #f6f1fe; border: 1.5px solid #7c3aed; border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.18); padding: 8px;
    font: 700 11px ui-monospace, monospace; color: #3a2a55;
    display: flex; flex-direction: column; gap: 8px;
  }
  .rm-x { flex: none; height: 24px; line-height: 24px; border: none; background: none; cursor: pointer; font-size: 17px; color: #6b3fb0; padding: 0 2px; }
  .rm-x:hover { color: #3a2a55; }
  /* One compact row: swatch · material · opacity, bottom-aligned so the labels
     stack above each control. */
  /* Uniform label-over-input grid: a fixed-height label row (empty for the swatch)
     keeps every control's input on the SAME baseline. */
  .rm-fields { display: flex; align-items: flex-end; gap: 8px; }
  .rm-field { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .rm-field > span {
    height: 11px; line-height: 11px; color: #6b3fb0; text-transform: uppercase;
    letter-spacing: 0.3px; font-size: 9px; white-space: nowrap;
  }
  .rm-field > span em { font-style: normal; color: #3a2a55; }
  /* Flag: colour is the material's own tint (not a custom pick). */
  .rm-flag.on { color: #a21caf; }
  .rm-field-color { flex: none; }
  .rm-color { width: 30px; height: 24px; padding: 0; border: 1px solid #c9b6ef; border-radius: 4px; background: #fff; cursor: pointer; }
  .rm-field-mat { flex: 1.1; }
  .rm-field select {
    width: 100%; height: 24px; box-sizing: border-box; padding: 0 5px;
    font: 11px ui-monospace, monospace; color: #3a2a55;
    background: #fff; border: 1px solid #c9b6ef; border-radius: 4px;
  }
  .rm-field-op { flex: 1.4; }
  .rm-field-op input[type=range] { width: 100%; height: 24px; accent-color: #7c3aed; margin: 0; padding: 0; }
  .rm-clear {
    height: 24px; border: 1px solid #c9b6ef; border-radius: 4px;
    background: #fff; cursor: pointer; color: #6b3fb0; font: 600 10px ui-monospace, monospace;
    text-transform: uppercase; letter-spacing: 0.4px;
  }
  .rm-clear:hover { background: #efe7fb; }
</style>
