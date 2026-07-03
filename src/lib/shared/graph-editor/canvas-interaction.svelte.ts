/**
 * canvas-interaction.svelte.ts — PER-INSTANCE viewport pan/zoom for the graph
 * editor (GEP modularize #940). Mirrors WireState / SketchState / SplineState:
 * a per-`GraphEditorPane` class, NOT a module-level `$state` singleton —
 * `/primitives` mounts N tab panes at once (`{#each tabs}` + `class:visible`),
 * and each pane has its OWN pan offset + zoom scale; a singleton would leak the
 * viewport across tabs.
 *
 * Owns the `pan`/`zoom` `$state`, the canvas-background pointer-drag-to-pan
 * bookkeeping (`panning`/`panStart`/`panOrig`), the wheel-zoom handler, and the
 * `clientToGraph` viewport→graph coordinate transform (handed to WireState so an
 * in-flight wire's free end tracks the pointer in graph space).
 *
 * The class never owns the bound `<svg>` DOM node — it's handed `getCanvasEl`
 * (matching how WireState receives a `clientToGraph` closure that itself reads
 * the pane's canvasEl). `panToNode` / `clientToCanvas` / `layoutCtx` and the
 * bind:this stay in the shell and READ `ci.pan`/`ci.zoom`.
 *
 * The canvas pointermove/pointerup handlers are SPLIT: the pan portion lives
 * here (`onCanvasPointerMove`/`onCanvasPointerUp` handle only `panning`), and
 * the shell's thin wrappers call these first, then run the wire-drag portion
 * (owned by WireState). pointerdown + wheel are pure pan/zoom and bind directly.
 *
 * Handlers are ARROW fields so `this` stays bound when used as Svelte event
 * handlers regardless of how they're referenced.
 */

export class CanvasInteractionState {
  /** Canvas pan offset, in screen px (the `<g translate>` on the SVG). */
  pan = $state({ x: 0, y: 0 });
  /** Canvas zoom scale (the `<g scale>`); clamped 0.2–3 by the wheel handler. */
  zoom = $state(1);

  /** True while a canvas-background pan drag is in flight. */
  panning = false;
  /** Client px where the pan drag started. */
  panStart = { x: 0, y: 0 };
  /** The pan offset at drag start (so the move is a delta off it). */
  panOrig = { x: 0, y: 0 };

  #getCanvasEl: () => SVGSVGElement | undefined;

  constructor(getCanvasEl: () => SVGSVGElement | undefined) {
    this.#getCanvasEl = getCanvasEl;
  }

  /** Convert a client (screen) coord to graph (canvas) coord by inverting the
   *  SVG's current pan + zoom. Handed to WireState so the in-flight wire's free
   *  end tracks the pointer in graph space. Falls back to the raw client coord
   *  when the canvas isn't mounted yet. */
  clientToGraph = (cx: number, cy: number): { x: number; y: number } => {
    const el = this.#getCanvasEl();
    if (!el) return { x: cx, y: cy };
    const r = el.getBoundingClientRect();
    return { x: ((cx - r.left) - this.pan.x) / this.zoom, y: ((cy - r.top) - this.pan.y) / this.zoom };
  };

  onCanvasPointerDown = (ev: PointerEvent) => {
    // Middle button + Shift ALWAYS pan, even over content (power-user handle).
    // Plain left-click pans ONLY when the target is the canvas background —
    // the SVG itself or the grid rect. Any other target (a button, an input,
    // a node body) gets its own handler — pointerdown bubbles up to the
    // canvas but we DON'T capture/pan when the click was meant for a child.
    const el = this.#getCanvasEl();
    const isShortcut = ev.button === 1 || ev.shiftKey;
    const target = ev.target as Element;
    const isBackground =
      target === el ||
      (target.tagName.toLowerCase() === 'rect' && (target.getAttribute('fill') ?? '').includes('grid'));
    if (isShortcut || (ev.button === 0 && isBackground)) {
      this.panning = true; this.panStart = { x: ev.clientX, y: ev.clientY }; this.panOrig = { ...this.pan };
      el?.setPointerCapture(ev.pointerId);
      ev.preventDefault();
    }
  };

  /** PAN portion of the canvas pointermove. The shell wrapper calls this first,
   *  then runs the wire-drag portion (WireState). */
  onCanvasPointerMove = (ev: PointerEvent) => {
    if (this.panning) {
      this.pan = { x: this.panOrig.x + (ev.clientX - this.panStart.x), y: this.panOrig.y + (ev.clientY - this.panStart.y) };
    }
  };

  /** PAN portion of the canvas pointerup (release capture + end the drag). The
   *  shell wrapper calls this first, then runs the wire-drag portion. */
  onCanvasPointerUp = (ev: PointerEvent) => {
    if (this.panning) { this.panning = false; this.#getCanvasEl()?.releasePointerCapture(ev.pointerId); }
  };

  onCanvasWheel = (ev: WheelEvent) => {
    ev.preventDefault();
    const k = Math.exp(-ev.deltaY * 0.001);
    this.zoom = Math.max(0.2, Math.min(3, this.zoom * k));
  };
}
