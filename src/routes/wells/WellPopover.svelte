<script lang="ts">
  /**
   * WellPopover — a small anchored floating panel (SVTC / cadtrain
   * popovers-over-inline convention, memory `feedback_popup_over_inline`).
   * Body-fixed so it escapes the stage's `overflow:hidden`; positioned to the
   * RIGHT of the anchor rect (the element rail lives on the left edge), flipped
   * left when it would overflow the viewport. Dark chrome to match the /wells
   * control aesthetic. Closes on outside-click / Escape.
   *
   * Content is provided by the caller via the `children` snippet, so the same
   * panel hosts element details, per-element rows and the display-param editors.
   */
  import type { Snippet } from 'svelte';

  let {
    anchor,
    title,
    onClose,
    width = 240,
    children,
  }: {
    /** Trigger's bounding rect (client coords) to anchor beside. */
    anchor: DOMRect;
    title: string;
    onClose: () => void;
    width?: number;
    children: Snippet;
  } = $props();

  let panelEl = $state<HTMLElement | null>(null);

  // Position to the anchor's right; flip to its left if it would run off-screen.
  const GAP = 8;
  const pos = $derived.by(() => {
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    let left = anchor.right + GAP;
    if (left + width > vw - 8) left = Math.max(8, anchor.left - width - GAP);
    // Vertically align the panel top with the anchor, clamped into the viewport.
    let top = anchor.top;
    const maxTop = vh - 8 - 120; // leave room; panel grows downward
    if (top > maxTop) top = Math.max(8, maxTop);
    return { left, top };
  });

  function onDocPointerDown(e: PointerEvent) {
    const t = e.target as Node;
    if (panelEl && !panelEl.contains(t)) onClose();
  }
  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }
</script>

<svelte:window onpointerdown={onDocPointerDown} onkeydown={onKey} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="wpop"
  bind:this={panelEl}
  role="dialog"
  tabindex="-1"
  aria-label={title}
  style="left:{pos.left}px; top:{pos.top}px; width:{width}px"
  onpointerdown={(e) => e.stopPropagation()}
  onwheel={(e) => e.stopPropagation()}
>
  <div class="wpop-head">
    <span class="wpop-title">{title}</span>
    <button class="wpop-close" type="button" title="Close" aria-label="Close" onclick={onClose}>✕</button>
  </div>
  <div class="wpop-body">
    {@render children()}
  </div>
</div>

<style>
  .wpop {
    position: fixed;
    z-index: 1000;
    background: rgba(20, 20, 32, 0.98);
    border: 1px solid #34345a;
    border-radius: 9px;
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.5);
    color: #ccd;
    font: 11px Arial, sans-serif;
    overflow: hidden;
  }
  .wpop-head {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    background: #1c1c30;
    border-bottom: 1px solid #2a2a3e;
  }
  .wpop-title {
    font-weight: 700;
    font-size: 12px;
    color: #fff;
    flex: 1 1 auto;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .wpop-close {
    flex: none;
    background: none;
    border: none;
    color: #889;
    cursor: pointer;
    font-size: 13px;
    line-height: 1;
    padding: 2px;
  }
  .wpop-close:hover { color: #ff6666; }
  .wpop-body {
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
</style>
