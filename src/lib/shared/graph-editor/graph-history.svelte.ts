/**
 * graph-history.svelte.ts — per-pane UNDO/REDO for the GraphEditorPane graph
 * (Phase 3 of docs/plans/hierarchical-class-design.md — the "real gap today").
 *
 * SNAPSHOT-based, not per-handler commands: the plan's §5.2 insight is that a
 * composition Graph is small + every mutator is already pure + immutable, so the
 * honest inverse of any change is just the previous snapshot. GEP already commits
 * graph `$state` in TRANSACTIONS (drag commits on pointerup via the dragLive
 * overlay; params commit on Enter, not per-keystroke — memories
 * graph_editor_drag_bake_perf + feedback_apply_on_enter), so tracking the graph
 * with one `$effect` records exactly the user-visible steps — no need to wrap the
 * ~180 mutate free-functions as explicit commands (that's a later refinement).
 *
 * PER-PANE class (NOT a module singleton): /primitives mounts every open tab's
 * GraphEditorPane at once, so each needs its own history — same reason WireState
 * / SketchState are classes (memory: per-instance reactive state = a CLASS).
 */
import type { Graph } from '$lib/graph/composition-graph-types';

const CAP = 100; // ring-cap the undo depth so a long session can't grow unbounded

export class GraphHistory {
  #undo: Graph[] = [];
  #redo: Graph[] = [];
  /** The last graph we saw — the candidate "before" state for the next change. */
  #last: Graph | null = null;
  /** True for exactly the one `record()` that follows an undo/redo restore, so a
   *  restore doesn't get recorded as a fresh edit (which would break redo). */
  #restoring = false;

  // Reactive so toolbar buttons can bind enabled/disabled to canUndo/canRedo.
  canUndo = $state(false);
  canRedo = $state(false);

  #sync() { this.canUndo = this.#undo.length > 0; this.canRedo = this.#redo.length > 0; }

  /** Seed the baseline (part load / switch). Clears history — a fresh part has
   *  nothing to undo back into. */
  reset(g: Graph) {
    this.#undo.length = 0; this.#redo.length = 0;
    this.#last = g; this.#restoring = false; this.#sync();
  }

  /** Call from an `$effect(() => history.record(graph))`. Records the PREVIOUS
   *  graph onto the undo stack when the graph reference changes (a committed
   *  transaction), unless this change was itself an undo/redo restore. */
  record(current: Graph) {
    if (this.#restoring) { this.#restoring = false; this.#last = current; return; }
    if (this.#last !== null && this.#last !== current) {
      this.#undo.push(this.#last);
      if (this.#undo.length > CAP) this.#undo.shift();
      this.#redo.length = 0;
      this.#sync();
    }
    this.#last = current;
  }

  /** Returns the graph to restore to, or null if nothing to undo. Caller assigns
   *  it to the pane's `graph` $state; the following `record()` is skipped. */
  undo(current: Graph): Graph | null {
    const prev = this.#undo.pop();
    if (prev === undefined) return null;
    this.#redo.push(current);
    this.#restoring = true;
    this.#sync();
    return prev;
  }

  redo(current: Graph): Graph | null {
    const next = this.#redo.pop();
    if (next === undefined) return null;
    this.#undo.push(current);
    this.#restoring = true;
    this.#sync();
    return next;
  }
}
