# Plan — smooth `g_wavy_star` (de-blocking the star)

> Goal: a star/lobed solid that reads as **smooth** like replicad's
> wavy-vase, authored through **our own graph editor GUI** — not a
> hand-written swap script. Two strategies; build #2 first (works today),
> keep #1 as the canonical upgrade.

## The actual problem (root cause)

`g_star`'s silhouette is a **polygon of 2N straight edges** (5-point star →
10 vertices, alternating `R = i%2 ? R_outer : R_inner`). Each arm is two
straight `lineTo` segments meeting at a sharp corner. `divs`/`segments` only
subdivide along *already-curved* paths, so raising them (even to 256) cannot
bend a straight edge — confirmed by the 256-segment render still being
faceted. **The profile, not the tessellation, is the blockiness.**

Fix = give the profile real curvature. Two routes below.

---

## Strategy #2 — continuous-radius `poly_repeat` (BUILD FIRST)

Smooth N-lobed form by sampling a **continuous** radius function densely
instead of 2 corners per arm. Fully expressible in the graph today — zero
engine changes, so this is what we author live in the GUI.

**Graph (mirror g_star, change 3 things):**

1. `poly_repeat.count`: `p.points * 2` → **`p.points * 48`** (dense sampling).
2. Replace the alternating-R binding with a **continuous cosine**:
   - `R_mid = (R_outer + R_inner) / 2`
   - `amp   = (R_outer - R_inner) / 2`
   - `theta = i * tau / NPts`
   - `R     = R_mid + amp * cos(p.points * theta)`   ← N smooth lobes
   - keep `r = R * cos(theta)`, `z = R * sin(theta)`
3. `r_weld_extrude` call: `divs 12 → 24`, `segments 32 → 64` (smooth the sides too).

Params unchanged: `points=5, r_outer=2, r_inner=1, length=4`.

**Why it works:** `cos(points·θ)` completes `points` full cycles over
0..2π → `points` lobes out to `R_outer`, `points` valleys in to `R_inner`,
with a smooth (C¹) transition between — no corners. 48 samples/lobe ≈ 240
profile points → no visible facets.

**GUI build steps (our graph editor):**
1. `/primitives` → duplicate `g_star` into a new tab as `g_wavy_star`
   (or `+ → Assembly`, then rebuild the 3 nodes).
2. Edit the `poly_repeat` card: bump `count`, add the `R_mid`/`amp` bindings,
   swap the `R` expression.
3. Edit the `r_weld_extrude` Call card: `divs 24`, `segments 64`.
4. Bake-preview; compare side-by-side with `g_star` in an adjacent tab.
5. Save (lands in `basic/`).

**Verify:** verts up ~5–6×, z-extent unchanged (`length`), outer-r = `r_outer`.
Expect bake ~4–6× g_star (still well under draft budget).

**Cost / trade:** larger mesh than g_star; arms are *lobes* (rounded
bumps), valleys never reach a true sharp inner point — that's the smooth look
we want. For a "rounded star" with flatter arms, shape the modulation
(e.g. `amp * Math.sign(cos)·|cos|^0.6`) — a later dial.

---

## Strategy #1 — sketch + spline + fillet (canonical upgrade)

True smooth Bézier arms with **filleted corners** via the sketch engine
(`src/lib/graph/sketch.ts`: `spline` / `fillet` ops, `segments` sampling).
Sharper, more controllable than #2 (each corner radius independent), and the
"production" way to author smooth profiles.

**The gap that must be fixed FIRST:** the `sketch` graph node takes a
**static `ops[]` array** — there is no loop/repeat construct, so a 5-arm star
needs 5× hand-authored op groups. Two ways to close it:

- **(1a, minimal)** Author the fixed-N ops inline for `points=5`. Works now,
  but `points` is no longer parametric (changing it won't regenerate arms).
- **(1b, real fix)** Add a **`sketch_repeat`** node (or a `repeat-ref` inside
  sketch `ops`, mirroring how `polygon` consumes a `poly_repeat`): emit
  `Array.from({length: N}, (_,i) => ...ops)` flattened into the sketch ops.
  This makes spline/fillet stars fully parametric and is the durable fix.
  Touches: `composition-graph.ts` (node type), `composition-emit.ts`
  (sketch emit ~L358), the graph editor sketch card UI, `sketch.ts` if the
  sampler needs per-arc segment hints.

**Plan order for #1:**
1. Decide 1a vs 1b (recommend **1b** — parametric, reusable for any lobed
   profile; ~the same surface area as the existing `poly_repeat` plumbing).
2. Add the `sketch_repeat` plumbing + emit + a card in the graph editor.
3. Author `g_star_smooth` in the GUI: per-arm `spline` out to the tip +
   `fillet` at tip and valley, `segments: 64`, into `r_weld_extrude` `divs:32`.
4. Bake-verify; compare against `g_wavy_star` (#2) and g_star.

---

## Sequencing

1. **#2 first** — no code change; author `g_wavy_star` live in the graph
   editor, prove the smooth look, ship. (Immediate payoff.)
2. **#1 next** — land the `sketch_repeat` engine fix, then author
   `g_star_smooth` via the GUI as the canonical smooth exemplar.
3. Both documented in `docs/parts/` before commit (Rule 14); fold into
   `/plan` (Rule 19).

## Files in scope

- #2: graph authoring only (volume part `g_wavy_star`) — no `src/` changes.
- #1: `src/lib/graph/composition-graph.ts`, `composition-emit.ts`,
  `GraphEditorPane.svelte` (sketch card), maybe `src/lib/graph/sketch.ts`.
