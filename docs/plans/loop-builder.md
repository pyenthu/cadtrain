# Imperative loop builder — UI refinement plan

**Status:** planning (2026-06-28). Refines the imperative accumulator loop builder
(#11, `expr-imperative.ts` + `ExprImperativeBlocks.svelte`) toward a simpler,
roomier, type-it-yourself flow. NO code until this is approved.

## Where it is now (shipped, `fc08ee8`)
A `list<point>` output can be an imperative program — engine + emit + validation +
a blocks UI all work and BAKE (8628 verts, identical to the functional form):
```
◇ poly : list<point>
↻ for i = 0 … [NPts ▾]
    poly.append( [body…] )      [+ statement]      ← per-statement GUI rows (too much)
↻ for j = 0 … [NPts ▾]
    poly.append( [body…] )      [+ statement]
return poly
↻ + for loop                                       ← add affordance at the BOTTOM
```
Pain points (user review): the per-statement GUI is over-specified; the add
affordance is at the bottom; outputs are a vertical column (cramped); the loop
body doesn't resize.

## Target shape
```
┌─ params ──┬─ [ profile_pts ] [ out2 ] [ + ]          ⟨⟩ text ─┐   ← outputs = horizontal TABS
│ NPts      │  ◇ poly : list<point>          [ + add ▾ ]         │      (frees the full width)
│ r0        │  ↻ for i = 0 … [ NPts ▾ ]                          │
│ growth    │    ┌──────────────────────────────────┐ ⤡         │   ← body = ONE resizable
│ …         │    │ rx = (r0 + growth*i/NPts)*cos(…)  │           │      text field; you TYPE it
│ + param   │    │ rz = (r0 + growth*i/NPts)*sin(…)  │           │
│           │    │ poly.append([rx, rz])             │           │
│           │    └──────────────────────────────────┘           │
│           │  return poly                                       │
└───────────┴────────────────────────────────────────────────────┘
```

## The changes
1. **Outputs → horizontal tabs** across the top of the editor pane (was a vertical
   list column). The builder then spans the full width.
2. **Loop body → one resizable autocomplete text field.** REMOVE the `+ statement`
   menu + the per-statement rows. The user TYPES the body: temp vars
   (`rx = …`, `rz = …`) then `poly.append([rx, rz])`. Autocomplete still fires
   (ExpressionSrcPane). No over-specified GUI.
3. **`+ add ▾` on the top line** (by the accumulator / on the head row), a small
   menu with three options:
   - **+ variable** — a new input PARAM (`NPts`, `r0`, …)
   - **+ expression** — a TOP-LEVEL intermediate value, computed once *above* the loops
   - **+ loop** — a for-loop (structured header + an empty body)
4. **For header stays structured** — `for i = 0 … [ count ▾ ]`, collapsible. Only the
   *body* becomes free text.
5. **Model/emit** — each loop stores its body as TEXT; compile splits the body into
   lines (`name = expr` → a temp `const`, `list.append(expr)` → a `push`) and
   codegens the JS for-loop. Top-level expressions become `const`s before the loops.
   The functional `map/concat` form still auto-converts on open.
6. **Resizable loop body** — the resize handle actually works (the per-statement
   layout was fighting it).

## Build order (each verifiable on its own)
- **(A) Outputs-as-tabs** — layout only, no model change.
- **(B) Loop body → single resizable text field** + remove `+ statement`. Model: a
  loop's `statements[]` becomes a `body: string`; compile parses the body lines.
- **(C) Top `+ add` menu** (variable / expression / loop) + top-level expressions
  in the model (`vars: {name, expr}[]`), serialized above the loops.

## Definitions (assumed — confirm)
- **variable** = an input PARAM (today's left column).
- **expression** = a top-level intermediate value (once, before the loops).
- **temp vars** = typed inside a loop body (not a separate provision).

## Out of scope (for now)
The `+` operator (visual concat/compose), multiple accumulators, conditionals.

## Notes / cleanup
- `ExprLoopBlocks.svelte` (functional-only block view) is already superseded by
  `ExprImperativeBlocks` and unused — delete in this pass.
- Keep both styles baking identically (the emit branches on `isImperative`).
