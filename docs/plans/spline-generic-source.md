# Spline as a generic point-source + expression-driven points

**Status:** planning (2026-07-01). User direction: make the spline node THE source
of truth for curves — feed it into a sweep's **section** as well as its **path**, and
let its points come from a **function/expression** to cut node count. Folds into the
typed-output / dynamic-wiring spine (`docs/plans/typed-expression-outputs.md`, #20/#926).

## Why
Today a `spline` node outputs `list<point3>` and only feeds `r_sweep.path`. Two moves
make it a generic, simpler source of truth:

- **A. Spline → section too.** `r_sweep.section` is a 2D cross-section (`list<point2>`).
  If a spline can also produce a 2D curve, ONE spline node covers path, section, polygon
  points — any point-list slot — instead of a bespoke input per slot.
- **B. Expression-driven points.** Source the spline's points from a formula
  (`map(range(0,N), i => …)`) instead of hand-dragging — one expression node replaces N
  manual control points, and the whole path/section becomes parametric. Fewer operations.

## A. Spline as a generic point-source (path · section · polygon)
- Output today: `list<point3>` (3D). Section needs `list<point2>` (2D `[a,b]`).
- Approach: a **`dim: 2 | 3`** flag on the spline. `dim:2` = a PLANAR spline (edit + sample
  in a plane, e.g. XY) → `list<point2>` for sections/polygons; `dim:3` = today's spatial
  spline → `list<point3>` for paths. One node type, two dims; the 3D editor constrains to a
  plane in 2D mode.
- Typed sockets (#926) enforce the right slot: a `list<point2>` spline into `section`/polygon,
  a `list<point3>` spline into `path` — with a plain-language reject on a mismatch. (Optional
  project-to-2D adapter — drop a coord — mirrors the record→array adapter in #20 Phase E.)
- Payoff: the spline is the ONE curve producer — path, section, polygon points, any future
  curve slot — the "generic simplified source of truth."

## B. Expression-driven spline points
- Add an **expression source** for the spline's points, two sub-modes:
  1. Expression → **control points** (the spline still smooths + arc-length-resamples them):
     a *parametric* spline (`map(range(0,N), i => [x(i),y(i),z(i)])`), editable as a formula.
  2. Expression → **sampled points directly** (no smoothing): the expression IS the curve.
     NOTE this already exists — a plain expr `list<point3>` output feeds `r_sweep.path` today
     (Phase A). So sub-mode 2 ≈ "skip the spline"; the spline's value-add is arc-length-even
     resampling of a *parametric* curve (sub-mode 1).
- UI: a toggle on the spline popup — "manual points" ⇄ "from expression" (opens the loop/expr
  builder from #11). Reduces a manual-points spline + sweep to one expression → sweep.

## Relationship / sequencing
- Both ride the typed-output spine: a spline is a **typed point-source** (`list<point2|3>`),
  sourced manually OR by expression, wired by type into any point-list consumer. Build after
  #926 Phase B/C (typed sockets + explicit annotation) land so the section-vs-path type match
  is enforced, not guessed.
- A: add `dim` + 2D output + section wire-compat. B: add the expression source (reuse the #11
  imperative loop builder for the point formula).
- Pairs with #23 (generalize r_sweep to a varying section) — a spline *section* + a spline
  *path* + varying section = fully spline-driven swept solids.
