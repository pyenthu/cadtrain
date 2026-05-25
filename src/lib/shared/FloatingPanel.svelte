<script lang="ts">
  // Lightweight draggable floating panel — same idea as SVTC's
  // src/lib/cad/FloatingPanel/FloatingPanel.svelte, but tailwind-free
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
    /** Optional lighter subtitle shown beside the title (e.g. name · short desc). */
    subtitle?: string;
    /** Optional tooltip on the title group — hover for more detail. */
    titleTip?: string;
    /** Optional interactive content rendered between the title and subtitle
     *  (e.g. a settings ⚙ button). */
    titleAction?: Snippet;
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
     *  inside a specific layout region — e.g. the tab body in /components. */
    containerRelative?: boolean;
    /** If true, the panel renders as a static block element (no float, no
     *  drag) so the parent can place it in a grid/flex column. Use with a
     *  parent layout that explicitly carves out space for the dock. */
    docked?: boolean;
    /** Called when the user toggles dock mode via the header button. Pass
     *  to opt in to the toggle button; omit to hide it. */
    onToggleDock?: () => void;
    children: Snippet;
  }

  let { title, subtitle = '', titleTip = '', titleAction = undefined, visible, onClose, x = 80, y = 80, width = 'min(560px, 80vw)', maxHeight = '80vh', containerRelative = false, docked = false, onToggleDock = undefined, children }: Props = $props();

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
    class:contained={containerRelative && !docked}
    class:docked
    style={docked ? '' : `left:${posX}px; top:${posY}px; width:${width}; max-height:${maxHeight};`}
  >
    <div class="fp-hdr" role="presentation" onmousedown={docked ? undefined : startDrag}>
      <div class="fp-titlewrap" title={titleTip || undefined}>
        <h3 class="fp-title">{title}</h3>
        {#if titleAction}{@render titleAction()}{/if}
        {#if subtitle}<span class="fp-sub">{subtitle}</span>{/if}
      </div>
      <div class="fp-hdr-actions">
        {#if onToggleDock}
          <button
            class="fp-dock"
            onclick={(e) => { e.stopPropagation(); onToggleDock?.(); }}
            onmousedown={(e) => e.stopPropagation()}
            title={docked ? 'Undock (float)' : 'Dock to right'}
            aria-label={docked ? 'Undock panel' : 'Dock panel to right'}
            type="button"
          >
            {#if docked}
              <!-- "Float / undock" — Word's pop-out glyph: a window with a small
                   arrow lifting out from the corner. Drawn as two overlapping
                   rectangles so the affordance reads as "lift this panel out". -->
              <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
                <rect x="1.5" y="3.5" width="8" height="7" rx="0.6"
                      fill="none" stroke="currentColor" stroke-width="1"/>
                <rect x="4.5" y="1.5" width="8" height="7" rx="0.6"
                      fill="#fff" stroke="currentColor" stroke-width="1"/>
              </svg>
            {:else}
              <!-- "Dock to right" — Word/Excel's task-pane icon: a rectangle
                   with the right ~third filled to show a docked side panel. -->
              <svg viewBox="0 0 14 14" width="12" height="12" aria-hidden="true">
                <rect x="1.5" y="2.5" width="11" height="9" rx="0.6"
                      fill="none" stroke="currentColor" stroke-width="1"/>
                <rect x="9" y="2.5" width="3.5" height="9"
                      fill="currentColor" stroke="none"/>
              </svg>
            {/if}
          </button>
        {/if}
        <button
          class="fp-close"
          onclick={(e) => { e.stopPropagation(); onClose(); }}
          onmousedown={(e) => e.stopPropagation()}
          aria-label="Close"
          type="button"
        >×</button>
      </div>
    </div>
    <div class="fp-body">
      {@render children?.()}
    </div>
  </div>
{/if}

<style>
  .fp-root {
    /* z-index high enough to clear in-page chrome (accordion title
       bars at default stacking, sticky inspector header etc.). The
       formula / inspector popups need to FLOAT above everything but
       other modals. */
    position: fixed; z-index: 1000;
    background: #fff;
  }
  .fp-root.contained {
    position: absolute; z-index: 100;
  }
  /* Docked mode — the panel becomes a static block. The PARENT layout is
     responsible for carving out a column / row for it to occupy (e.g.
     a grid with `grid-template-columns: ... <dock-w>`). No drag, no
     positioning math, no shadow. */
  .fp-root.docked {
    position: static;
    width: 100%;
    height: 100%;
    max-height: none !important;
    border-radius: 0;
    border: none;
    border-left: 1px solid #d8d8de;
    box-shadow: none;
    z-index: auto;
  }
  .fp-root.docked .fp-hdr { cursor: default; }
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
  .fp-titlewrap { display: flex; align-items: baseline; gap: 8px; min-width: 0; overflow: hidden; }
  .fp-title { margin: 0; font: bold 12px Arial; color: #333; white-space: nowrap; flex-shrink: 0; }
  .fp-sub { font: 11px Arial; color: #8a8a98; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
  .fp-hdr-actions {
    display: inline-flex;
    gap: 4px;
    align-items: center;
  }
  .fp-close, .fp-dock {
    background: #fff; border: 1px solid #d8d8de; cursor: pointer;
    width: 20px; height: 20px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 3px; font-size: 12px; line-height: 1; color: #888;
  }
  .fp-close:hover { background: #fdecec; color: #cc2222; border-color: #cc2222; }
  .fp-dock:hover  { background: #eef0fc; color: #3b3b8a; border-color: #3b3b8a; }
  .fp-body {
    flex: 1; min-height: 0;
    overflow-y: auto;
    padding: 4px 6px;
  }
</style>
