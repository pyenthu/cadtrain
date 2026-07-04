/**
 * popover-clamp.ts — viewport-clamp Svelte action for the graph-editor popovers.
 *
 * EXTRACTED 2026-06-16 (modularize plan Phase A — Popovers.svelte). Shared by
 * BOTH the new `Popovers.svelte` (argExpr popover) AND `GraphEditorPane.svelte`
 * (the sketch/poly expression popovers still living there until phases E/F).
 * Keep this here so the two callers can't drift.
 */

/** Svelte action — after a fixed-position popover paints, measure it and shift
 *  left/up so the WHOLE thing stays on-screen (the expr popovers open at the
 *  click point and otherwise spill off the bottom/right when the vertex is near
 *  an edge). Re-runs when the bound value changes. */
export function clampToViewport(node: HTMLElement, _dep?: unknown) {
  const margin = 10;
  const fit = () => {
    const r = node.getBoundingClientRect();
    let l = r.left, t = r.top;
    if (r.right > window.innerWidth - margin) l = Math.max(margin, window.innerWidth - r.width - margin);
    if (r.bottom > window.innerHeight - margin) t = Math.max(margin, window.innerHeight - r.height - margin);
    if (l !== r.left) node.style.left = `${l}px`;
    if (t !== r.top) node.style.top = `${t}px`;
  };
  requestAnimationFrame(fit);
  return { update: () => requestAnimationFrame(fit) };
}

/** Pure viewport clamp — given a desired top-left `(x, y)` for a box of size
 *  `w × h` and a viewport of `vw × vh`, return the nearest `(x, y)` that keeps
 *  the WHOLE box on-screen (inside a `margin` gutter on every edge). If the box
 *  is larger than the viewport, its near edge is pinned to the margin (so the
 *  header/grab strip stays reachable rather than the far edge). Testable — no
 *  DOM or globals. Used by the draggable graph-editor popovers on pointermove. */
export function clampBox(
  x: number,
  y: number,
  w: number,
  h: number,
  vw: number,
  vh: number,
  margin = 8,
): { x: number; y: number } {
  const maxX = Math.max(margin, vw - w - margin);
  const maxY = Math.max(margin, vh - h - margin);
  return {
    x: Math.min(Math.max(x, margin), maxX),
    y: Math.min(Math.max(y, margin), maxY),
  };
}

/** DOM convenience over {@link clampBox}: measure the popover's own rendered
 *  size and clamp a proposed drag position against the live viewport. Call from
 *  a draggable popover's pointermove/up handler so a large popover near an edge
 *  is fully pushed back in. No-ops (returns the input) when the node isn't
 *  mounted or there's no `window` (SSR). */
export function clampDragPos(
  node: HTMLElement | null | undefined,
  x: number,
  y: number,
  margin = 8,
): { x: number; y: number } {
  if (!node || typeof window === 'undefined') return { x, y };
  const r = node.getBoundingClientRect();
  return clampBox(x, y, r.width, r.height, window.innerWidth, window.innerHeight, margin);
}
