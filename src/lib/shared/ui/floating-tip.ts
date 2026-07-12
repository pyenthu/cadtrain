/**
 * Delegated black/white tooltip host.
 *
 * Put `use:tipHost` on a container; every descendant with a `title` (or
 * `data-tip`) attribute gets a body-portaled black tooltip on hover, with the
 * native `title` suppressed while shown. Body-portaled (position:fixed) so it
 * is never clipped by an `overflow:auto` ancestor — the reason the CSS
 * `[data-tip]::after` pattern can't be used inside the scrolling editor column.
 *
 * Styled via the global `.floating-tip` class (see the consuming component).
 */
export function tipHost(root: HTMLElement) {
  let tipEl: HTMLDivElement | null = null;
  let target: HTMLElement | null = null;
  let savedTitle: string | null = null;

  function findTarget(start: EventTarget | null): HTMLElement | null {
    let el = start as HTMLElement | null;
    while (el && el !== root) {
      const t = el.getAttribute?.('data-tip') ?? el.getAttribute?.('title');
      if (t && t.trim()) return el;
      el = el.parentElement;
    }
    return null;
  }
  function position() {
    if (!tipEl || !target) return;
    const r = target.getBoundingClientRect();
    const tr = tipEl.getBoundingClientRect();
    let top = r.top - tr.height - 8;
    if (top < 4) top = r.bottom + 8;
    let left = Math.min(r.left, window.innerWidth - tr.width - 4);
    if (left < 4) left = 4;
    tipEl.style.top = `${top}px`;
    tipEl.style.left = `${left}px`;
  }
  function show(el: HTMLElement) {
    const text = el.getAttribute('data-tip') ?? el.getAttribute('title') ?? '';
    if (!text.trim()) return;
    target = el;
    if (el.hasAttribute('title')) { savedTitle = el.getAttribute('title'); el.removeAttribute('title'); }
    tipEl = document.createElement('div');
    tipEl.className = 'floating-tip';
    tipEl.textContent = text;
    document.body.appendChild(tipEl);
    position();
  }
  function hide() {
    if (tipEl) { tipEl.remove(); tipEl = null; }
    if (target && savedTitle !== null) target.setAttribute('title', savedTitle);
    target = null;
    savedTitle = null;
  }
  function onOver(e: Event) {
    const el = findTarget(e.target);
    if (el === target) return;
    // Moving onto a different tip target switches; moving onto anything with
    // NO tip (empty canvas, a tap elsewhere on touch) hides. Previously this
    // only switched and never hid → on touch the tip stuck forever (no
    // mouseout follows a tap).
    hide();
    if (el) show(el);
  }
  function onOut(e: MouseEvent) {
    if (!target) return;
    const to = e.relatedTarget as Node | null;
    if (to && target.contains(to)) return;
    hide();
  }
  // Any tap/click dismisses the tip — including taps OUTSIDE root, which the
  // root-scoped mouseover never sees. This is what makes the tooltip
  // "disappear on clicking outside" on both touch and desktop.
  function onDocPointerDown(e: Event) {
    if (!target) return;
    if (target.contains(e.target as Node)) return; // tapping the tip's own owner keeps it
    hide();
  }
  root.addEventListener('mouseover', onOver, true);
  root.addEventListener('mouseout', onOut, true);
  document.addEventListener('pointerdown', onDocPointerDown, true);
  window.addEventListener('scroll', hide, true);
  return {
    destroy() {
      hide();
      root.removeEventListener('mouseover', onOver, true);
      root.removeEventListener('mouseout', onOut, true);
      document.removeEventListener('pointerdown', onDocPointerDown, true);
      window.removeEventListener('scroll', hide, true);
    },
  };
}
