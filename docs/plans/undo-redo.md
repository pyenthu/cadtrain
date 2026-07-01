# Undo / redo for the graph editor

**Status:** planning (2026-07-01, user). Add undo (+ redo) to the node-graph editor.
Today an accidental delete / wire / edit can only be reverted by hand or by reloading
(losing the session) — undo/redo is table stakes.

## Model (fits the existing state shape)
- `GraphEditorPane` holds `graph` as `$state`; every mutation reassigns
  `graph = mutator(graph, …)` and the mutators (`composition-graph-mutate.ts`) return a
  NEW graph (pure). So a HISTORY STACK of graph snapshots is natural — each committed
  mutation is a distinct immutable-ish object to push.
- **Per-instance history CLASS** (like `WireState`/`SketchState`, `graph-editor/*.svelte.ts`) —
  `/primitives` mounts N panes, so history must NOT be a module singleton; one stack per pane.
  Shape: `{ past: Graph[]; present: Graph; future: Graph[] }`.
- Undo: push `present`→`future`, pop `past`→`present`. Redo: reverse. A NEW edit after an undo
  clears `future` (standard). Bound the stack (~100) to cap memory (graphs are small JSON).

## What's undoable
- Graph MUTATIONS: node add/delete, wire/unwire, param add/remove/wire, arg edits, transforms
  (mv/rot/csg), polygon/spline/expr edits, container ops, and layout MOVE (a drag = ONE entry —
  the `dragLive` overlay already means a single `graph` write on pointerup).
- NOT undoable (view-only, not graph mutations): pan/zoom, active tab, selection, collapse,
  bake backend, scene scale.

## Coalescing (so undo isn't per-keystroke)
- Consecutive edits to the SAME node+field within a short window (param typing, slider scrub)
  merge into ONE undo step (a `coalesceKey` + debounce). A drag is already one entry.

## Wiring it in — the one real refactor
- Route graph writes through a SINGLE choke point `commit(nextGraph, { label?, coalesceKey? })`
  that pushes history + reassigns `graph`. Today `graph = setX(graph,…)` is scattered across GEP;
  funnel them through `commit()` (pairs well with the GEP modularize #22). Wire-drop, sketch,
  expr, spline, transforms all go through it.
- Keybinds: **Cmd/Ctrl+Z** = undo, **Cmd/Ctrl+Shift+Z** (and Ctrl+Y) = redo. Toolbar **↶ / ↷**
  buttons in the left rail — distinct from the existing **↺ restore** control (that's a reset/reload).
- Autosave unaffected: undo/redo just change `graph`, which autosaves as usual. History is
  SESSION-only (not persisted).

## Phasing
- **P1:** per-instance `HistoryStack` class + the `commit()` choke point + Cmd+Z/Shift+Z +
  ↶/↷ buttons + drag/typing coalescing.
- **P2 (optional):** labeled history + a small visual history list; group multi-step AI-assist
  turns as one undo entry.

## Ties
- Per-instance CLASS pattern (`WireState`/`SketchState`). The single-commit choke point supports
  #22 (modularize GraphEditorPane) and would let the AI assist loop (#0/#1) push one undo entry
  per applied tool-turn.
