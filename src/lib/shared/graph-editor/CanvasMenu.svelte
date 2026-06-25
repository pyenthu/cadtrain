<!--
  CanvasMenu.svelte — the ⚙ canvas-settings popover, extracted from
  GraphEditorPane (modularize K.65, mirrors the RepeatEditorPane / Popovers
  carves).

  A compact Flowbite-style dropdown anchored (position: fixed) to the ⚙ rail
  button's bounding rect, which GEP computes and passes in as `pos`. Holds two
  action rows (Auto-layout, Push apart) + a separator + three checkbox rows for
  the left/top/right canvas-edge boundaries.

  GEP OWNS the open/anchor (`canvasMenuOpen` + `canvasMenuPos` + `openCanvasMenu`)
  and the boundary STATE (`boundLeft/Top/Right`, used by pushApart) + the
  localStorage persistence (in `onSetBound`). This component is presentational:
  it reflects the bound values and calls back. CSS (.ge-canvas-menu* / .ge-cm-*)
  is duplicated here from GEP so Svelte's scoped CSS applies.
-->
<script lang="ts">
  type BoundState = 'off' | 'repellant';

  let {
    pos,
    onAutoLayout,
    onPushApart,
    boundLeft,
    boundTop,
    boundRight,
    onSetBound,
    onClose,
  }: {
    /** Viewport position anchored to the ⚙ button (GEP's canvasMenuPos). */
    pos: { left: number; top: number };
    onAutoLayout: () => void;
    onPushApart: () => void;
    boundLeft: BoundState;
    boundTop: BoundState;
    boundRight: BoundState;
    onSetBound: (edge: 'left' | 'top' | 'right', v: BoundState) => void;
    onClose: () => void;
  } = $props();
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- svelte-ignore a11y_click_events_have_key_events -->
<div class="ge-canvas-menu-shade" onclick={onClose}></div>
<!-- Compact Flowbite-style dropdown anchored to the ⚙ button's bounding rect
     (see GEP openCanvasMenu). Two action rows + a separator + three checkbox
     rows for the left/top/right canvas-edge boundaries. The checkbox toggle is
     BOOLEAN repellant on/off. -->
<div class="ge-canvas-menu" style="left: {pos.left}px; top: {pos.top}px">
  <button class="ge-cm-row action" type="button"
    onclick={() => { onAutoLayout(); onClose(); }}
    title="Rearrange nodes left-to-right by depth columns (clean by construction)">
    <span class="ge-cm-icon">📐</span>
    <span class="ge-cm-label">Auto-layout</span>
  </button>
  <button class="ge-cm-row action" type="button"
    onclick={() => { onPushApart(); onClose(); }}
    title="Push overlapping cards apart IN PLACE (keeps your manual arrangement; clears the params card + edge bounds below)">
    <span class="ge-cm-icon">🧲</span>
    <span class="ge-cm-label">Push apart</span>
  </button>
  <div class="ge-cm-sep"></div>
  <label class="ge-cm-row check"
    title="Push nodes away from the LEFT canvas edge during push-apart">
    <input type="checkbox"
      checked={boundLeft === 'repellant'}
      onchange={(ev) => onSetBound('left', (ev.currentTarget as HTMLInputElement).checked ? 'repellant' : 'off')} />
    <span class="ge-cm-label">Left boundary</span>
  </label>
  <label class="ge-cm-row check"
    title="Push nodes DOWN from the TOP canvas edge during push-apart (keeps cards from drifting off-screen above the PARAMS dock)">
    <input type="checkbox"
      checked={boundTop === 'repellant'}
      onchange={(ev) => onSetBound('top', (ev.currentTarget as HTMLInputElement).checked ? 'repellant' : 'off')} />
    <span class="ge-cm-label">Top boundary</span>
  </label>
  <label class="ge-cm-row check"
    title="Push nodes away from the RIGHT canvas edge during push-apart">
    <input type="checkbox"
      checked={boundRight === 'repellant'}
      onchange={(ev) => onSetBound('right', (ev.currentTarget as HTMLInputElement).checked ? 'repellant' : 'off')} />
    <span class="ge-cm-label">Right boundary</span>
  </label>
</div>

<style>
  /* ─── Canvas-settings popover (Flowbite-style compact dropdown) ─────── */
  /* Backdrop covers the viewport so an outside click closes the menu.
     `position: fixed` matches the menu's own fixed positioning so we don't
     need to chase a positioned ancestor — works the same whether mounted
     standalone (/graph-editor) or as a /primitives tab body. */
  .ge-canvas-menu-shade {
    position: fixed; inset: 0;
    z-index: 99;
  }
  .ge-canvas-menu {
    position: fixed;
    background: #fff; border: 1px solid #d6d3d1; border-radius: 6px;
    padding: 4px; width: 200px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.12), 0 2px 4px rgba(0,0,0,0.06);
    z-index: 100; display: flex; flex-direction: column;
  }
  /* Menu row — uniform height + horizontal layout (icon + label),
     matches the Flowbite DropdownItem visual rhythm. */
  .ge-cm-row {
    display: flex; align-items: center; gap: 8px;
    width: 100%; padding: 6px 10px; box-sizing: border-box;
    background: transparent; border: 0; border-radius: 4px; cursor: pointer;
    font: 500 12px Arial; color: #1f2937;
    text-align: left;
  }
  .ge-cm-row:hover { background: #f3f4f6; color: #0c4a6e; }
  .ge-cm-row.check { cursor: pointer; user-select: none; }
  .ge-cm-row.check input { margin: 0; cursor: pointer; accent-color: #cc2222; }
  .ge-cm-icon { width: 16px; text-align: center; font-size: 13px; line-height: 1; }
  .ge-cm-label { flex: 1 1 auto; }
  .ge-cm-sep { height: 1px; background: #f1f5f9; margin: 4px 6px; }
</style>
