/**
 * controller.svelte.ts — GraphEditorController, the per-pane TRUNK of the editor
 * (Phase 4 of docs/plans/hierarchical-class-design.md §5.1).
 *
 * GraphEditorPane grew ~10 loosely-related state islands (graph, undo history,
 * wire/canvas/sketch/spline interaction). This class is the trunk that OWNS the
 * graph accessor + undo history and COMPOSES the existing leaf-state classes as
 * members — so downstream code (the 7 extraction candidates, NodeCard, the
 * command layer) has one handle instead of a bag of consts.
 *
 * ADDITIVE, per the plan: it does NOT yet move GEP's `graph` `$state` into the
 * class (that's a wide, risky rename) — instead it reads/writes the shell's graph
 * through get/set closures, so the shell keeps working byte-for-byte while the
 * trunk assembles around it. The leaf-state members are ATTACHED by the shell as
 * it constructs them (they have construction-order interdependencies —
 * ci→wire→sketch, spline needs bakeNonce — so building them inside a constructor
 * would risk TDZ; assigning references sidesteps that). PER-PANE class (NOT a
 * module singleton): /primitives mounts every tab's pane at once.
 */
import type { Graph } from '$lib/graph/composition/composition-graph-types';
import { GraphHistory } from './graph-history.svelte';
import type { WireState } from './wire-state.svelte';
import type { CanvasInteractionState } from './canvas-interaction.svelte';
import type { SketchState } from './sketch-state.svelte';
import type { SplineState } from './spline-state.svelte';

export class GraphEditorController {
  /** Per-pane undo/redo (snapshot-based, §5.2). */
  readonly history = new GraphHistory();

  // Leaf-state members — ATTACHED by the shell after it constructs each (their
  // deps mean order matters). Optional until attached; downstream reads via the
  // trunk once wired. `!` because the shell always attaches them at mount.
  wire!: WireState;
  canvas!: CanvasInteractionState;
  sketch!: SketchState;
  spline!: SplineState;

  #getGraph: () => Graph;
  #setGraph: (g: Graph) => void;

  constructor(getGraph: () => Graph, setGraph: (g: Graph) => void) {
    this.#getGraph = getGraph;
    this.#setGraph = setGraph;
  }

  /** The live pane graph (read-through to the shell's `$state`). */
  get graph(): Graph { return this.#getGraph(); }

  // ── undo/redo — the shell's keymap + rail buttons delegate here ──────────
  /** Call from `$effect(() => ctrl.recordGraph())` — records a committed change. */
  recordGraph() { this.history.record(this.#getGraph()); }
  /** Seed the baseline after part load so the load isn't undoable. */
  resetHistory() { this.history.reset(this.#getGraph()); }
  undo() { const g = this.history.undo(this.#getGraph()); if (g) this.#setGraph(g); }
  redo() { const g = this.history.redo(this.#getGraph()); if (g) this.#setGraph(g); }
}
