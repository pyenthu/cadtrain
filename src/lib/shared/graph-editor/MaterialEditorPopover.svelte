<!--
  MaterialEditorPopover.svelte — the click-to-edit popover for a material node
  (G-MAT-CARD). Anchored to the clicked ◑/name; edits the node's appearance
  bundle (name · OUT/IN colour · material preset · opacity · texture) via
  onPatch. Fixed-positioned (screen space) like the expr-def editor. Closes on
  the × or an outside click / Escape (handled by the shell's overlay).
-->
<script lang="ts">
  let {
    node,
    anchor,
    onPatch,
    onClose,
    showName = true,
    title = '◑ material',
  }: {
    node: { name?: string; colorOuter?: string; colorInner?: string; material?: string; opacity?: number; texture?: string };
    anchor: { x: number; y: number };
    onPatch: (patch: any) => void;
    onClose: () => void;
    /** Hide the `name` row when editing a PART's appearance (a part has no name,
     *  only a colour/material bundle) vs a material NODE (which is named). */
    showName?: boolean;
    /** Header label — `◑ material` for a material node, the part label for a part. */
    title?: string;
  } = $props();

  const MATERIALS = ['none', 'steel', 'aluminum', 'titanium', 'brass'];
  const TEXTURES = ['none', 'rock', 'cement', 'steel'];
  const DEFAULT_OUTER = '#cc2222';
  const DEFAULT_INNER = '#888888';

  const opacityVal = $derived(node.opacity ?? 1);
  const asOpacity = (raw: string): number | null => {
    const v = Number(raw);
    if (!Number.isFinite(v) || v >= 0.99) return null;
    return Math.max(0.05, v);
  };
</script>

<!-- Outside-click + Escape scrim -->
<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ge-mat-scrim" onpointerdown={onClose}></div>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="ge-mat-pop" style={`left:${anchor.x}px; top:${anchor.y}px`}
     onpointerdown={(e) => e.stopPropagation()}>
  <div class="ge-mat-head">
    <span>{title}</span>
    <button type="button" class="ge-mat-x" onclick={onClose} aria-label="Close">×</button>
  </div>

  {#if showName}
    <label class="ge-mat-row">
      <span>name</span>
      <input class="ge-mat-name" type="text" value={node.name ?? ''}
        onchange={(e) => onPatch({ name: (e.currentTarget as HTMLInputElement).value })}/>
    </label>
  {/if}

  <div class="ge-mat-row">
    <span>colour</span>
    <div class="ge-mat-sw">
      <input type="color" value={node.colorOuter ?? DEFAULT_OUTER} title="Outside colour"
        oninput={(e) => onPatch({ colorOuter: (e.currentTarget as HTMLInputElement).value })}/>
      <input type="color" value={node.colorInner ?? DEFAULT_INNER} title="Inside (bore) colour"
        oninput={(e) => onPatch({ colorInner: (e.currentTarget as HTMLInputElement).value })}/>
    </div>
  </div>

  <label class="ge-mat-row">
    <span>material</span>
    <select value={node.material ?? 'none'}
      onchange={(e) => onPatch({ material: (e.currentTarget as HTMLSelectElement).value })}>
      {#each MATERIALS as m}<option value={m}>{m}</option>{/each}
    </select>
  </label>

  <label class="ge-mat-row">
    <span>texture</span>
    <select value={node.texture ?? 'none'}
      onchange={(e) => onPatch({ texture: (e.currentTarget as HTMLSelectElement).value })}>
      {#each TEXTURES as t}<option value={t}>{t}</option>{/each}
    </select>
  </label>

  <label class="ge-mat-row">
    <span>opacity</span>
    <span class="ge-mat-op">
      <input type="range" min="0.05" max="1" step="0.05" value={opacityVal}
        oninput={(e) => onPatch({ opacity: asOpacity((e.currentTarget as HTMLInputElement).value) })}/>
      <em>{opacityVal.toFixed(2)}</em>
    </span>
  </label>
</div>

<style>
  .ge-mat-scrim { position: fixed; inset: 0; z-index: 1000; }
  .ge-mat-pop {
    position: fixed; z-index: 1001; width: 208px;
    background: #ecfdf5; border: 1.5px solid #10b981; border-radius: 8px;
    box-shadow: 0 6px 20px rgba(0,0,0,0.18); padding: 8px;
    font: 700 11px ui-monospace, monospace; color: #065f46;
    display: flex; flex-direction: column; gap: 6px;
  }
  .ge-mat-head { display: flex; align-items: center; justify-content: space-between; font-size: 12px; }
  .ge-mat-x { border: none; background: none; cursor: pointer; font-size: 15px; color: #065f46; line-height: 1; padding: 0 2px; }
  .ge-mat-row { display: grid; grid-template-columns: 58px 1fr; align-items: center; gap: 6px; }
  .ge-mat-row > span:first-child { color: #059669; text-transform: uppercase; letter-spacing: 0.3px; font-size: 9px; }
  .ge-mat-name, select {
    width: 100%; height: 22px; box-sizing: border-box; padding: 0 4px;
    font: 11px ui-monospace, monospace; color: #065f46;
    background: #fff; border: 1px solid #6ee7b7; border-radius: 4px;
  }
  .ge-mat-sw { display: flex; gap: 6px; }
  .ge-mat-sw input[type=color] { width: 40px; height: 22px; padding: 0; border: 1px solid #6ee7b7; border-radius: 4px; background: #fff; cursor: pointer; }
  .ge-mat-op { display: flex; align-items: center; gap: 6px; }
  .ge-mat-op input[type=range] { flex: 1; accent-color: #059669; }
  .ge-mat-op em { font-style: normal; font-size: 10px; color: #059669; min-width: 26px; text-align: right; }
</style>
