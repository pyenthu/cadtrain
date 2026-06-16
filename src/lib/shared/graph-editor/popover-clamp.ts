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
