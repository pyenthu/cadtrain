/**
 * wson-mutate.ts — the MINIMAL "edit-the-diagram" mutation layer for /wells.
 *
 * Pure, in-place mutators over a WSON doc's `completions[]` (the common edit
 * case — the differentiator SVTC's `CanvasCompPopup` opens on double-click).
 * They mutate the passed doc DIRECTLY and return it, so when the doc is a
 * Svelte `$state` proxy (see `routes/wells/+page.svelte`) the field/array
 * writes trip deep reactivity and the derived 2D scene recomputes — WITHOUT a
 * new object identity, so the 3D view (if mounted) sees the same ref mutated
 * in place rather than a remount (avoids the wells re-bake loop).
 *
 * DELIBERATELY PURE (no DOM/Svelte/Three) so it unit-tests headless
 * (`wson-mutate.test.ts`) exactly like `wson-2d.ts`. Undo/file-write are out of
 * scope (in-session edit only) — mirrors SVTC's minimal setSrc-then-rerender.
 */

/** A partial patch for a completion — only the fields the popover edits.
 *  `top`/`bot` are absolute metres; editing promotes a `length`-relative
 *  completion to absolute extents (what SVTC's popup does on Length/Top edit). */
export interface CompletionPatch {
  description?: string;
  od?: number;
  top?: number;
  bot?: number;
  length?: number;
}

/** Loose doc shape — any WSON-like object carrying a `completions[]`. */
type MutableDoc = { completions?: Array<Record<string, unknown>>; [k: string]: unknown };

function validIndex(doc: MutableDoc, index: number): doc is MutableDoc & { completions: Array<Record<string, unknown>> } {
  return Array.isArray(doc?.completions) && index >= 0 && index < doc.completions.length;
}

/**
 * Apply a partial patch to `doc.completions[index]`, in place. Only finite
 * numbers are written (a blank input never clobbers a value with NaN); string
 * fields write through as-is. Returns the same doc for chaining/assertions.
 */
export function applyCompletionPatch<T extends MutableDoc>(doc: T, index: number, patch: CompletionPatch): T {
  if (!validIndex(doc, index)) return doc;
  const c = doc.completions[index]!;
  if (patch.description !== undefined) c.description = patch.description;
  if (patch.od !== undefined && Number.isFinite(patch.od)) c.od = patch.od;
  if (patch.top !== undefined && Number.isFinite(patch.top)) c.top = patch.top;
  if (patch.bot !== undefined && Number.isFinite(patch.bot)) c.bot = patch.bot;
  if (patch.length !== undefined && Number.isFinite(patch.length)) c.length = patch.length;
  return doc;
}

/** Remove `doc.completions[index]`, in place (array splice → reactive). */
export function removeCompletion<T extends MutableDoc>(doc: T, index: number): T {
  if (!validIndex(doc, index)) return doc;
  doc.completions.splice(index, 1);
  return doc;
}
