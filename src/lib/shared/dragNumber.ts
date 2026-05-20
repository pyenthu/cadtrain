/**
 * dragNumber — Svelte action for a drag-to-scrub number input.
 *
 * Lifted verbatim from the inline action in `routes/components/+page.svelte`
 * (the inspector prop cards) so the `/primitives` inspector can present the
 * SAME parameter interface. Drag horizontally on the input to scrub the
 * value (pointer-capture + a 3px threshold so a plain click still focuses
 * for typing); typing + Enter commits separately (handled by the input's
 * own keydown). Adds `body.dragnum-active` during a drag so the cursor can
 * be themed globally.
 *
 * Usage:
 *   <input type="number" use:dragNumber={{ step, min, max, get, set }} />
 */
export interface DragNumParams {
  step: number;
  min?: number;
  max?: number;
  get: () => number;
  set: (v: number) => void;
}

export function dragNumber(node: HTMLInputElement, params: DragNumParams) {
  let p = params;
  let pending = false;
  let dragging = false;
  let startX = 0;
  let startVal = 0;
  const THRESHOLD = 3;
  const onDown = (e: PointerEvent) => {
    if (e.button !== 0) return;
    pending = true;
    dragging = false;
    startX = e.clientX;
    startVal = p.get();
  };
  const onMove = (e: PointerEvent) => {
    if (!pending) return;
    const dx = e.clientX - startX;
    if (!dragging && Math.abs(dx) < THRESHOLD) return;
    if (!dragging) {
      dragging = true;
      try { node.setPointerCapture(e.pointerId); } catch {}
      document.body.classList.add('dragnum-active');
      node.blur();
    }
    const step = p.step || 1;
    const pxPerStep = step < 0.1 ? 2 : step < 1 ? 1.5 : 1;
    let v = startVal + (dx / pxPerStep) * step;
    if (p.min !== undefined) v = Math.max(p.min, v);
    if (p.max !== undefined) v = Math.min(p.max, v);
    v = Math.round(v / step) * step;
    const decimals = step < 0.01 ? 4 : step < 0.1 ? 3 : step < 1 ? 2 : 0;
    v = parseFloat(v.toFixed(decimals));
    p.set(v);
  };
  const onUp = (e: PointerEvent) => {
    if (!pending) return;
    pending = false;
    if (dragging) {
      dragging = false;
      try { node.releasePointerCapture(e.pointerId); } catch {}
      document.body.classList.remove('dragnum-active');
      e.preventDefault();
    }
  };
  node.addEventListener('pointerdown', onDown);
  node.addEventListener('pointermove', onMove);
  node.addEventListener('pointerup', onUp);
  node.addEventListener('pointercancel', onUp);
  return {
    update(next: DragNumParams) { p = next; },
    destroy() {
      node.removeEventListener('pointerdown', onDown);
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      node.removeEventListener('pointercancel', onUp);
    },
  };
}
