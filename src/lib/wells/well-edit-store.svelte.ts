/**
 * well-edit-store.svelte.ts — the PER-APP reactive editing store for /wells
 * (#42b-B, gap doc `docs/plans/wells-ewells-gaps.md` §B1). The foundation the
 * CompletionsEditor + SurveyEditor write through.
 *
 * PER-INSTANCE class, NOT a module singleton — mirror `WireState` /
 * `graph-history.svelte.ts`: /wells keeps every open tab's pane mounted, so each
 * well's edit state (doc + history) must be its own object; a module `$state`
 * singleton would leak edits across tabs. The `$state` lives in class fields
 * (Svelte 5 compiles runes in `.svelte.ts` class fields).
 *
 * This is a THIN `$state` facade over one `WellEditCore` (the pure, runes-free
 * engine in `well-edit-core.ts` where all mutation + undo/redo LOGIC + its unit
 * tests live). The core mutates THIS store's `$state` `doc` proxy IN PLACE, so:
 *  - the doc's IDENTITY is stable across every edit + undo/redo (no remount /
 *    re-bake loop — pass `store.doc` straight to the 3D scene),
 *  - deep-proxy reactivity fires on every field/array write (the 2D derived view
 *    recomputes), and
 *  - `revision` also bumps on every change, so a consumer that wants a coarse
 *    "something changed" trigger (a re-derive / re-bake) can just watch it.
 *
 * Methods are ARROW fields so `this` stays bound when the editors use them as
 * callbacks regardless of how they're referenced.
 */
import type { Wson, CasingString, SurveyStation, Completion } from './wson';
import type { CompletionPatch } from './wson-mutate';
import { WellEditCore, type WellArrayKey, type WellChangeInfo } from './well-edit-core';

export interface WellEditStoreOpts {
  /** Fired after ANY change (edit / undo / redo / reset). The `info.survey` flag
   *  says whether the survey moved. */
  onChange?: (info: WellChangeInfo) => void;
  /** Fired specifically when the SURVEY changed → the shell re-warps / re-bakes
   *  the trajectory (the SurveyEditor's "live re-warp" seam). Convenience filter
   *  over `onChange` (fires only when `info.survey`). */
  onSurveyChange?: () => void;
}

export class WellEditStore {
  /** The live editable WSON doc — a Svelte `$state` DEEP PROXY, mutated IN PLACE
   *  (stable identity). Read it in a derived / pass it to the 2D + 3D surfaces. */
  doc = $state<Wson>({ meta: { wellName: '' } });
  canUndo = $state(false);
  canRedo = $state(false);
  /** Bumps on every committed change — a coarse reactive signal for consumers
   *  that recompute wholesale (`$derived(() => (store.revision, build(store.doc)))`). */
  revision = $state(0);

  #core: WellEditCore;
  #onChange?: (info: WellChangeInfo) => void;
  #onSurveyChange?: () => void;

  constructor(initial: Wson, opts: WellEditStoreOpts = {}) {
    // Clone the source into our OWN $state proxy (JSON, not structuredClone — the
    // source may itself be a $state proxy), then let the core mutate THAT proxy in
    // place so deep reactivity fires and identity stays stable.
    this.doc = JSON.parse(JSON.stringify(initial));
    this.#onChange = opts.onChange;
    this.#onSurveyChange = opts.onSurveyChange;
    this.#core = new WellEditCore(this.doc, (info) => this.#sync(info));
  }

  #sync(info: WellChangeInfo): void {
    this.canUndo = this.#core.canUndo;
    this.canRedo = this.#core.canRedo;
    this.revision++;
    this.#onChange?.(info);
    if (info.survey) this.#onSurveyChange?.();
  }

  // ── strings (casing / tubing / liner) ────────────────────────────────────────
  addString = (value: Partial<CasingString> = {}): number => this.#core.addString(value);
  removeString = (index: number): boolean => this.#core.removeString(index);
  updateString = (index: number, patch: Partial<CasingString>): boolean => this.#core.updateString(index, patch);

  // ── completions ──────────────────────────────────────────────────────────────
  addCompletion = (value: Partial<Completion> = {}): number => this.#core.addCompletion(value);
  removeCompletion = (index: number): boolean => this.#core.removeCompletion(index);
  updateCompletion = (index: number, patch: CompletionPatch): boolean => this.#core.updateCompletion(index, patch);

  // ── survey stations ──────────────────────────────────────────────────────────
  addStation = (value: Partial<SurveyStation> = {}): number => this.#core.addStation(value);
  removeStation = (index: number): boolean => this.#core.removeStation(index);
  updateStation = (index: number, patch: Partial<SurveyStation>): boolean => this.#core.updateStation(index, patch);

  // ── generic element ops (oh / cementing / any array) ─────────────────────────
  addElement = (key: WellArrayKey, value: object): number => this.#core.addElement(key, value);
  removeElement = (key: WellArrayKey, index: number): boolean => this.#core.removeElement(key, index);
  updateElement = (key: WellArrayKey, index: number, patch: object): boolean => this.#core.updateElement(key, index, patch as Record<string, unknown>);

  // ── history / lifecycle ──────────────────────────────────────────────────────
  undo = (): boolean => this.#core.undo();
  redo = (): boolean => this.#core.redo();
  /** Load a different well + wipe history (call on tab-switch / file load). */
  reset = (doc?: Wson): void => this.#core.reset(doc);
}
