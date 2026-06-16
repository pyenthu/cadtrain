/**
 * pointer-capture.ts — shared pointer-capture helper for the graph editor
 * (modularize K.65, Phase C). Used by the wire-drag flow (wire-state.svelte.ts)
 * AND the sketch-card title/resize drags in GraphEditorPane — keep it here so
 * the two can't drift.
 */

/** On touch/pen, the browser sets IMPLICIT pointer capture on the element that
 *  received pointerdown, so every later pointermove/pointerup for this pointerId
 *  is dispatched to THAT element — a drag-to-another-target (wire socket A→B, a
 *  card-title drag onto empty canvas) never delivers its move/up to the element
 *  under the finger and can't complete. Release it here so events route to
 *  whatever is under the pointer, same as the mouse path. */
export function releaseImplicitCapture(ev: PointerEvent) {
  try {
    const el = ev.currentTarget as Element;
    if (el.hasPointerCapture?.(ev.pointerId)) el.releasePointerCapture(ev.pointerId);
  } catch { /* older browsers */ }
}
