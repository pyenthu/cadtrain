<script lang="ts">
  // Lightweight draggable floating panel — same idea as SVTC's
  // src/lib/components/FloatingPanel/FloatingPanel.svelte, but tailwind-free
  // and stripped down to what we need:
  //   - drag the header to move
  //   - X to close
  //   - body content via children snippet
  // No resize handle, no width/height props — the panel sizes to its content
  // (capped at 80vw × 80vh). Use ad-hoc instances on routes that want to
  // surface auxiliary panes (3D preview, code snippets, advanced settings)
  // without burning permanent layout space.
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    visible: boolean;
    onClose: () => void;
    /** Initial x/y in pixels. Interpreted as viewport coordinates by default,
     *  or relative to the panel's positioned ancestor when `containerRelative`
     *  is true. */
    x?: number;
    y?: number;
    /** CSS width — default `min(560px, 80vw)`. */
    width?: string;
    /** CSS max-height — default `80vh`. */
    maxHeight?: string;
    /** If true, the panel positions absolutely (relative to nearest positioned
     *  ancestor) instead of fixed (viewport). Use when the popup should live
     *  inside a specific layout region — e.g. the tab body in /primitives. */
    containerRelative?: boolean;
    children: Snippet;
  }

  let { title, visible, onClose, x = 80, y = 80, width = 'min(560px, 80vw)', maxHeight = '80vh', containerRelative = false, children }: Props = $props();

  let posX = $state(x);
  let posY = $state(y);
  let dragging = $state(false);
  let offX = 0, offY = 0;
  let rootEl: HTMLElement | undefined = $state();

  $effect(() => { posX = x; posY = y; });

  /** When contained, drag math is in parent-local coordinates. We use the
   *  parent's bounding rect to translate clientX/Y into local space and clamp
   *  to the parent's box. */
  function parentRect(): DOMRect | null {
    if (!containerRelative) return null;
    const parent = rootEl?.offsetParent as HTMLElement | null;
    return parent?.getBoundingClientRect() ?? null;
  }

  function startDrag(e: MouseEvent) {
    dragging = true;
    const r = parentRect();
    const localX = r ? e.clientX - r.left : e.clientX;
    const localY = r ? e.clientY - r.top : e.clientY;
    offX = localX - posX;
    offY = localY - posY;
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', stopDrag);
  }
  function onMove(e: MouseEvent) {
    if (!dragging) return;
    const r = parentRect();
    const w = r?.width ?? window.innerWidth;
    const h = r?.height ?? window.innerHeight;
    const localX = r ? e.clientX - r.left : e.clientX;
    const localY = r ? e.clientY - r.top : e.clientY;
    posX = Math.max(0, Math.min(localX - offX, w - 80));
    posY = Math.max(0, Math.min(localY - offY, h - 60));
  }
  function stopDrag() {
    dragging = false;
    window.removeEventListener('mousemove', onMove);
    window.removeEventListener('mouseup', stopDrag);
  }
</script>

{#if visible}
  <div
    bind:this={rootEl}
    class="fp-root"
    class:dragging
    class:contained={containerRelative}
    style="left:{posX}px; top:{posY}px; width:{width}; max-height:{maxHeight};"
  >
    <div class="fp-hdr" role="presentation" onmousedown={startDrag}>
      <h3 class="fp-title">{title}</h3>
      <button
        class="fp-close"
        onclick={(e) => { e.stopPropagation(); onClose(); }}
        onmousedown={(e) => e.stopPropagation()}
        aria-label="Close"
        type="button"
      >×</button>
    </div>
    <div class="fp-body">
      {@render children?.()}
    </div>
  </div>
{/if}

<style>
  .fp-root {
    position: fixed; z-index: 50;
    background: #fff;
  }
  .fp-root.contained {
    position: absolute; z-index: 5;
  }
  /* shared visual styling — both fixed and contained variants. */
  .fp-root {
    border: 1px solid #d8d8de;
    border-radius: 8px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.18);
    display: flex; flex-direction: column;
    overflow: hidden;
    font-family: Arial, sans-serif;
  }
  .fp-hdr {
    display: flex; align-items: center; justify-content: space-between;
    padding: 6px 10px;
    background: linear-gradient(to right, #f6f6fa, #ecedf2);
    border-bottom: 1px solid #e2e2e8;
    cursor: grab;
    flex-shrink: 0;
  }
  .fp-root.dragging .fp-hdr { cursor: grabbing; }
  .fp-title { margin: 0; font: bold 12px Arial; color: #333; }
  .fp-close {
    background: #fff; border: 1px solid #d8d8de; cursor: pointer;
    width: 20px; height: 20px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 3px; font-size: 14px; line-height: 1; color: #888;
  }
  .fp-close:hover { background: #fdecec; color: #cc2222; border-color: #cc2222; }
  .fp-body {
    flex: 1; min-height: 0;
    overflow-y: auto;
    padding: 8px 10px;
  }
</style>
