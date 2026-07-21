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
  import type { RowMaterial } from '$lib/graph/composition-graph-types';
  import { MATERIAL_PRESET_NAMES } from '$lib/shared/viewer/material-preset';
  import { INSTANCE_PALETTE } from '$lib/shared/viewer/instance-colors';

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
  <div class="rm-head">
    <span>◑ row material</span>
    <button type="button" class="rm-x" onclick={onClose} aria-label="Close">×</button>
  </div>

  <div class="rm-row">
    <span>colour</span>
    <input type="color" value={color || DEFAULT_COLOR} title="Row outer colour"
      oninput={(e) => pickColor((e.currentTarget as HTMLInputElement).value)} />
  </div>

  <!-- Quick palette — the 12-stop INSTANCE_PALETTE so each row gets a distinct hue
       with one click (the point of a per-row override). -->
  <div class="rm-swatches">
    {#each INSTANCE_PALETTE as hex (hex)}
      <button type="button" class="rm-chip" class:sel={color === hex}
        style={`background:${hex}`} title={hex} aria-label={hex}
        onclick={() => pickColor(hex)}></button>
    {/each}
  </div>

  <label class="rm-row">
    <span>material</span>
    <select value={preset} onchange={(e) => { preset = (e.currentTarget as HTMLSelectElement).value; commit(); }}>
      {#each MATERIAL_PRESET_NAMES as m (m)}<option value={m}>{m}</option>{/each}
    </select>
  </label>

  <label class="rm-row">
    <span>opacity</span>
    <span class="rm-op">
      <input type="range" min="0.05" max="1" step="0.05" value={opacity}
        oninput={(e) => { opacity = Number((e.currentTarget as HTMLInputElement).value); commit(); }} />
      <em>{opacity.toFixed(2)}</em>
    </span>
  </label>

  <button type="button" class="rm-clear" onclick={clearAll}>clear override</button>
</div>

<style>
  .rm-scrim { position: fixed; inset: 0; z-index: 1000; }
  .rm-pop {
    position: fixed; z-index: 1001; width: 200px;
    background: #f6f1fe; border: 1.5px solid #7c3aed; border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.18); padding: 8px;
    font: 700 11px ui-monospace, monospace; color: #3a2a55;
    display: flex; flex-direction: column; gap: 6px;
  }
  .rm-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
  .rm-x { border: none; background: none; cursor: pointer; font-size: 15px; color: #3a2a55; line-height: 1; padding: 0 2px; }
  .rm-row { display: grid; grid-template-columns: 58px 1fr; align-items: center; gap: 6px; }
  .rm-row > span:first-child { color: #6b3fb0; text-transform: uppercase; letter-spacing: 0.3px; font-size: 9px; }
  .rm-row input[type=color] { width: 40px; height: 22px; padding: 0; border: 1px solid #c9b6ef; border-radius: 4px; background: #fff; cursor: pointer; }
  .rm-row select {
    width: 100%; height: 22px; box-sizing: border-box; padding: 0 4px;
    font: 11px ui-monospace, monospace; color: #3a2a55;
    background: #fff; border: 1px solid #c9b6ef; border-radius: 4px;
  }
  .rm-swatches { display: grid; grid-template-columns: repeat(6, 1fr); gap: 3px; }
  .rm-chip { height: 16px; border: 1px solid rgba(0,0,0,0.15); border-radius: 3px; cursor: pointer; padding: 0; }
  .rm-chip.sel { outline: 2px solid #3a2a55; outline-offset: 1px; }
  .rm-op { display: flex; align-items: center; gap: 6px; }
  .rm-op input[type=range] { flex: 1; accent-color: #7c3aed; }
  .rm-op em { font-style: normal; font-size: 10px; color: #6b3fb0; min-width: 26px; text-align: right; }
  .rm-clear {
    margin-top: 2px; height: 22px; border: 1px solid #c9b6ef; border-radius: 4px;
    background: #fff; cursor: pointer; color: #6b3fb0; font: 600 10px ui-monospace, monospace;
  }
  .rm-clear:hover { background: #efe7fb; }
</style>
