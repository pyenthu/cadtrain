<script lang="ts">
  /**
   * TypeDefinerPopover — the shape definer (TypeDefinerPanel) in a draggable,
   * resizable floating popover (typed-ports L2b/c). Opened from the ◇ rail
   * button in the graph editor; ⤢ opens the roomier full-page /primitives/types.
   */
  import TypeDefinerPanel from './TypeDefinerPanel.svelte';

  let { onClose }: { onClose: () => void } = $props();

  let popEl = $state<HTMLElement | null>(null);
  let pos = $state<{ x: number; y: number } | null>(null);
  let drag = $state<{ dx: number; dy: number } | null>(null);

  function onHeadPointerDown(e: PointerEvent) {
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    const r = popEl!.getBoundingClientRect();
    pos ??= { x: r.left, y: r.top };
    drag = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }
  function onHeadPointerMove(e: PointerEvent) {
    if (!drag) return;
    pos = { x: e.clientX - drag.dx, y: e.clientY - drag.dy };
  }
  function onHeadPointerUp(e: PointerEvent) {
    drag = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* not captured */ }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="td-pop" bind:this={popEl} style={pos ? `left:${pos.x}px; top:${pos.y}px;` : ''}>
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="td-pop-head" onpointerdown={onHeadPointerDown} onpointermove={onHeadPointerMove} onpointerup={onHeadPointerUp}>
    <span class="td-pop-glyph">◇</span>
    <span class="td-pop-title">Type Definer</span>
    <span class="td-pop-sp"></span>
    <a class="td-pop-link" href="/primitives/types" target="_blank" rel="noopener" title="Open the full-page definer">⤢</a>
    <button class="td-pop-close" type="button" onclick={onClose} title="Close">✕</button>
  </div>
  <div class="td-pop-body"><TypeDefinerPanel /></div>
</div>

<style>
  .td-pop {
    position: fixed; left: 84px; top: 96px; width: 720px; height: 460px; z-index: 1000;
    background: #fff; border: 1px solid #cbd5e1; border-radius: 10px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, .18);
    display: flex; flex-direction: column; overflow: hidden;
    resize: both; min-width: 480px; min-height: 300px;
  }
  .td-pop-head {
    display: flex; align-items: center; gap: 8px; padding: 8px 12px;
    border-bottom: 1px solid #e2e8f0; background: #faf9ff; cursor: grab; user-select: none;
  }
  .td-pop-glyph { color: #7c3aed; font-size: 15px; }
  .td-pop-title { font: 700 13px Arial, sans-serif; color: #1e293b; }
  .td-pop-sp { flex: 1 1 auto; }
  .td-pop-link { text-decoration: none; color: #94a3b8; font-size: 15px; line-height: 1; }
  .td-pop-link:hover { color: #7c3aed; }
  .td-pop-close { font: 700 14px Arial; color: #94a3b8; background: none; border: none; cursor: pointer; padding: 0 2px; }
  .td-pop-close:hover { color: #ef4444; }
  .td-pop-body { flex: 1 1 auto; min-height: 0; }
</style>
