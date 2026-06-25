/**
 * delete-confirm.svelte.ts — two-step INLINE delete confirm for the graph
 * editor's destructive affordances (node-card ×, sketch-card ×, param-chip 🗑).
 *
 * A stray single click used to nuke a whole node / param. This arms on the first
 * click (the caller swaps the glyph to ✓ and styles it `armed`); a SECOND click
 * within the window actually deletes. Auto-disarms on a timeout, an outside
 * pointerdown, or a window blur.
 *
 * IN-APP only — NO `window.confirm`/`alert`/`prompt` (they block the event loop
 * and break the Chrome automation harness). Mirrors the ExpressionsMenu inline
 * delete-confirm idiom (`confirmId` $state gating a second click).
 *
 * One instance per component; key each row by a string id (node id / param
 * name) so a component with many rows only ever arms one at a time.
 */
export class DeleteConfirm {
  /** The id currently awaiting confirmation, or null. Reactive. */
  armed = $state<string | null>(null);
  #timer: ReturnType<typeof setTimeout> | null = null;
  #onOutside: (() => void) | null = null;
  #ms: number;

  constructor(timeoutMs = 3000) {
    this.#ms = timeoutMs;
  }

  /** True when `id` is the row currently armed — drive the glyph/style off this. */
  isArmed(id: string): boolean {
    return this.armed === id;
  }

  /**
   * Handle a click on the delete affordance for `id`. First click arms; a
   * second click on the SAME id confirms.
   * @returns true when the caller should perform the delete NOW.
   */
  request(id: string): boolean {
    if (this.armed === id) {
      this.disarm();
      return true;
    }
    this.#arm(id);
    return false;
  }

  disarm(): void {
    if (this.#timer) {
      clearTimeout(this.#timer);
      this.#timer = null;
    }
    if (this.#onOutside && typeof window !== 'undefined') {
      window.removeEventListener('pointerdown', this.#onOutside);
      window.removeEventListener('blur', this.#onOutside);
      this.#onOutside = null;
    }
    this.armed = null;
  }

  #arm(id: string): void {
    this.disarm();
    this.armed = id;
    this.#timer = setTimeout(() => this.disarm(), this.#ms);
    if (typeof window === 'undefined') return;
    this.#onOutside = () => this.disarm();
    // Bubble-phase + deferred registration: the arming click (which
    // stopPropagation()s) is already done, so it can't disarm itself; a LATER
    // pointerdown anywhere that bubbles to window disarms. The confirm click on
    // the same button stopPropagation()s before this listener is reached, so it
    // deletes rather than disarming.
    setTimeout(() => {
      if (!this.#onOutside) return;
      window.addEventListener('pointerdown', this.#onOutside);
      window.addEventListener('blur', this.#onOutside);
    }, 0);
  }
}
