/**
 * well-edit-core.ts — the PURE mutation + undo/redo ENGINE behind the /wells
 * editing core (#42b-B, gap doc `docs/plans/wells-ewells-gaps.md` §B1).
 *
 * This is the runes-free half of the split (mirrors `graph-editor-bake.ts` [pure]
 * ↔ `graph-editor-bake.svelte.ts` [runes]): all editing LOGIC lives here so it
 * unit-tests headless (`well-edit-core.test.ts`), and `well-edit-store.svelte.ts`
 * is a thin `$state` facade over one `WellEditCore`. (vitest runs plain `node`
 * with no svelte plugin, so `$state` can't execute in a test — the logic must be
 * runes-free to be testable.)
 *
 * DESIGN — snapshot undo, in-place mutation:
 *  - The doc is mutated IN PLACE (never re-assigned) so its identity is stable.
 *    The `.svelte.ts` wrapper hands us a Svelte `$state` DEEP PROXY as `doc`; in-
 *    place writes trip deep reactivity (the 2D view re-derives, the 3D scene's
 *    `$derived.by` re-runs) WITHOUT a changing-identity prop that would remount
 *    the 3D scene and thrash the bake (the exact loop the shell already avoids —
 *    see `routes/wells/+page.svelte` working-doc comment + memory
 *    `fresh_array_props_effect_loops`).
 *  - Undo/redo is SNAPSHOT-based (like `graph-history.svelte.ts`): every mutation
 *    pushes a deep CLONE of the pre-edit doc; undo restores a snapshot by writing
 *    its contents back INTO the live doc (identity preserved). A WSON doc is small
 *    + plain-JSON, so snapshots are cheap and the honest inverse of any edit is
 *    just the previous snapshot.
 *
 * Reuses the tested `wson-mutate` completion helper (`applyCompletionPatch`) as
 * the canonical completion-field path.
 */
import type { Wson, CasingString, SurveyStation, Completion } from './wson';
import { applyCompletionPatch, type CompletionPatch } from './wson-mutate';

/** Ring-cap the undo depth so a long editing session can't grow unbounded. */
const CAP = 100;

/** Deep clone via JSON — WSON is plain JSON, and JSON round-trip is the ONE safe
 *  clone for a Svelte `$state` proxy (`structuredClone(proxy)` throws
 *  DataCloneError — see the +page working-doc comment). */
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

/** The WSON arrays the editing core can mutate generically. */
export type WellArrayKey = 'ch' | 'completions' | 'profile' | 'oh' | 'perforations' | 'cementing';

export interface WellChangeInfo {
  /** The kind of change — an interactive edit vs a history restore vs a reset. */
  cause: 'edit' | 'undo' | 'redo' | 'reset';
  /** True when the change touched the SURVEY (`profile`) → the shell should
   *  re-warp / re-bake the trajectory (the "live re-warp" the SurveyEditor wants).
   *  Set on any profile edit, and on undo/redo/reset when the profile actually
   *  differs pre↔post (so undoing a casing edit doesn't spuriously re-warp). */
  survey: boolean;
}

/** Sensible default rows for the "add" affordance in each editor. */
const DEFAULT_STRING: CasingString = { od: 9.625, id: 8.681, top: 0, bot: 1000, grade: 'L80', type: 'production' };
const DEFAULT_COMPLETION: Completion = { tool_comp: 'MISC.TUBING', description: 'New component', od: 2.875, length: 1 };

export class WellEditCore {
  /** The live editable doc — mutated IN PLACE (identity preserved). The caller
   *  owns cloning the source before handing it in (the wrapper clones the sample
   *  into its `$state`; tests pass a throwaway object). */
  doc: Wson;
  canUndo = false;
  canRedo = false;

  #undo: Wson[] = [];
  #redo: Wson[] = [];
  #onChange?: (info: WellChangeInfo) => void;

  constructor(doc: Wson, onChange?: (info: WellChangeInfo) => void) {
    this.doc = doc;
    this.#onChange = onChange;
  }

  /** Depth of the undo / redo stacks — exposed for tests + diagnostics. */
  get undoDepth(): number { return this.#undo.length; }
  get redoDepth(): number { return this.#redo.length; }

  // ── internals ──────────────────────────────────────────────────────────────

  #array(key: WellArrayKey): unknown[] | undefined {
    const a = (this.doc as unknown as Record<string, unknown>)[key];
    return Array.isArray(a) ? a : undefined;
  }

  /** Push the CURRENT doc onto the undo stack + clear redo (a fresh edit branches
   *  history). Call BEFORE applying a mutation. */
  #snapshot(): void {
    this.#undo.push(clone(this.doc));
    if (this.#undo.length > CAP) this.#undo.shift();
    this.#redo.length = 0;
  }

  #emit(cause: WellChangeInfo['cause'], survey: boolean): void {
    this.canUndo = this.#undo.length > 0;
    this.canRedo = this.#redo.length > 0;
    this.#onChange?.({ cause, survey });
  }

  /** Shallow-merge `patch` into `target`, in place. A blank/NaN number or an
   *  `undefined` never clobbers an existing value (mirrors `wson-mutate`). */
  #patch(target: Record<string, unknown>, patch: Record<string, unknown>): void {
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) continue;
      if (typeof v === 'number' && !Number.isFinite(v)) continue;
      target[k] = v;
    }
  }

  /** Replace the live doc's CONTENTS with a clone of `snap`, in place (identity
   *  preserved so a `$state` proxy stays the same reactive object). */
  #restoreInto(snap: Wson): void {
    const live = this.doc as unknown as Record<string, unknown>;
    for (const k of Object.keys(live)) delete live[k];
    Object.assign(live, clone(snap));
  }

  // ── generic element ops (the foundation) ─────────────────────────────────────

  /** Append `value` (deep-cloned) to `doc[key]`, creating the array if absent.
   *  Returns the new element's index. */
  addElement(key: WellArrayKey, value: object): number {
    this.#snapshot();
    const doc = this.doc as unknown as Record<string, unknown>;
    const a = (Array.isArray(doc[key]) ? doc[key] : (doc[key] = [])) as unknown[];
    a.push(clone(value));
    this.#emit('edit', key === 'profile');
    return a.length - 1;
  }

  /** Remove `doc[key][index]`. No-op (returns false, no history entry) for an
   *  out-of-range index or a missing array. */
  removeElement(key: WellArrayKey, index: number): boolean {
    const a = this.#array(key);
    if (!a || index < 0 || index >= a.length) return false;
    this.#snapshot();
    a.splice(index, 1);
    this.#emit('edit', key === 'profile');
    return true;
  }

  /** Merge `patch` into `doc[key][index]`, in place. No-op for a bad index.
   *  Completions route through the canonical `applyCompletionPatch`. */
  updateElement(key: WellArrayKey, index: number, patch: Record<string, unknown>): boolean {
    const a = this.#array(key);
    if (!a || index < 0 || index >= a.length) return false;
    this.#snapshot();
    if (key === 'completions') {
      applyCompletionPatch(this.doc as { completions?: Array<Record<string, unknown>> }, index, patch as CompletionPatch);
    } else {
      this.#patch(a[index] as Record<string, unknown>, patch);
    }
    this.#emit('edit', key === 'profile');
    return true;
  }

  // ── typed convenience — STRINGS (casing / tubing / liner = `ch[]`) ───────────

  addString(value: Partial<CasingString> = {}): number { return this.addElement('ch', { ...DEFAULT_STRING, ...value }); }
  removeString(index: number): boolean { return this.removeElement('ch', index); }
  updateString(index: number, patch: Partial<CasingString>): boolean { return this.updateElement('ch', index, patch as Record<string, unknown>); }

  // ── typed convenience — COMPLETIONS (`completions[]`) ────────────────────────

  addCompletion(value: Partial<Completion> = {}): number { return this.addElement('completions', { ...DEFAULT_COMPLETION, ...value }); }
  removeCompletion(index: number): boolean { return this.removeElement('completions', index); }
  updateCompletion(index: number, patch: CompletionPatch): boolean { return this.updateElement('completions', index, patch as Record<string, unknown>); }

  // ── typed convenience — SURVEY STATIONS (`profile[]`) ────────────────────────

  /** Append a survey station. Defaults its MD to the deepest existing station so a
   *  fresh row lands at the bottom of the survey (the user then edits it). */
  addStation(value: Partial<SurveyStation> = {}): number {
    const prof = this.#array('profile') as SurveyStation[] | undefined;
    const lastMd = prof?.at(-1)?.md ?? 0;
    return this.addElement('profile', { md: lastMd, dev: 0, az: 0, ...value });
  }
  removeStation(index: number): boolean { return this.removeElement('profile', index); }
  updateStation(index: number, patch: Partial<SurveyStation>): boolean { return this.updateElement('profile', index, patch as Record<string, unknown>); }

  // ── history ──────────────────────────────────────────────────────────────────

  /** Undo the last mutation. Returns false (no change) when the undo stack is
   *  empty. Signals a survey change iff the restore altered the profile. */
  undo(): boolean {
    const snap = this.#undo.pop();
    if (snap === undefined) return false;
    const before = JSON.stringify(this.doc.profile ?? null);
    this.#redo.push(clone(this.doc));
    if (this.#redo.length > CAP) this.#redo.shift();
    this.#restoreInto(snap);
    const after = JSON.stringify(this.doc.profile ?? null);
    this.#emit('undo', before !== after);
    return true;
  }

  /** Redo the last undone mutation. Returns false when the redo stack is empty. */
  redo(): boolean {
    const snap = this.#redo.pop();
    if (snap === undefined) return false;
    const before = JSON.stringify(this.doc.profile ?? null);
    this.#undo.push(clone(this.doc));
    if (this.#undo.length > CAP) this.#undo.shift();
    this.#restoreInto(snap);
    const after = JSON.stringify(this.doc.profile ?? null);
    this.#emit('redo', before !== after);
    return true;
  }

  /** Load a different well (or clear to the current doc) + wipe history — a fresh
   *  doc has nothing to undo back into. Passing no `doc` just clears history. */
  reset(doc?: Wson): void {
    this.#undo.length = 0;
    this.#redo.length = 0;
    if (doc) this.#restoreInto(doc);
    this.#emit('reset', true);
  }
}
