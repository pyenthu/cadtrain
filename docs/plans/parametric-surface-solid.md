# Parametric uv surfaces + solids via the expression builder

**Status:** planning (2026-06-28). User direction from a long design thread. Extends
the expression builder (the imperative loop system) from `list<point>` profiles to
**parametric uv SURFACES**, and builds **solids as two independent welded surfaces** —
which retires CSG for a huge class of parts.

## The core idea
A profile is a 1D loop → `list<point>`. A **surface** is a 2D (nested) loop → a
**uv grid** of points. A **solid** is **two** surfaces — an OUTER (primary) and an
INNER (offset) — both the same `Nu × Nv`, welded into a closed shell. This is the 3D
analogue of the polygon's outer-edge-loop + inner-edge-loop → closed wall.

| | the expression emits | the consumer |
|---|---|---|
| profile (today) | `list<point>` via one loop | polygon → extrude / revolve |
| **surface** | a uv **grid** via `for u { for v { surf.append(fn(u,v)) } }` | `r_surface` → one welded patch |
| **solid** | **outer grid + inner grid**, same Nu×Nv | `r_solid` → weld both + stitch edges → shell |

## ⭐ Why it matters — it kills CSG for shells
A hollow / thick-walled body is built today as a **Manifold boolean** (super-linear):
- tube/casing = cylinder − cylinder · `box_thread` = bore − thread band · vase = solid − shrunk solid.

Define the **outer and inner surfaces directly and weld** → **one `weldAndBuild`**,
linear in grid size, **no boolean**. That's exactly the most common CAD parts —
pipes, casings, threaded boxes, vases, ducts, shells. `r_helical_surface` (a
*displacement* surface) and `r_solid` (*two* surfaces) become one family that
retires CSG for everything that isn't a genuine cross-cut.

**CSG still earns its keep** for truly disjoint booleans (cross-drilled hole, side
pocket, A ∩ B) — anything NOT expressible as "the wall between one outer + one inner
surface." Those stay boolean.

## Two independent surfaces (decided: option b)
The inner is its OWN expression, not a normal-offset of the outer. Simpler (no normal
math), matches the polygon's two independent loops, and covers every case for free:
flat-inner/wavy-outer, constant wall, variable radius, threaded-inner/smooth-outer —
all just two different `fn(u,v)`s.

## Winding (a handled detail, not a problem)
- **outer** grid → forward (normals out).
- **inner** grid → **same points, triangle winding REVERSED** (`[a,b,c]→[a,c,b]` or walk v backwards) → normals into the cavity.
- **4 edge bands** stitch the outer boundary rings to the inner boundary rings (u=0/u=1/v=0/v=1) with consistent winding → that's what closes the solid.
- `weldAndBuild` auto-corrects the GLOBAL volume sign (backstop); the engine only sets the RELATIVE inner-reversed winding — same pattern `r_surface`/`r_threads` use for cap fans today.

## The three build pieces
1. **2D / nested loop in the expression builder** — `for u { for v { surf.append(fn) } }`
   (or a flat `for k` with `u = k÷Nv, v = k mod Nv`). The one genuinely new builder
   capability; everything else reuses `expr-imperative.ts` + `ExprImperativeBlocks`.
2. **a `surface` output shape** — the expr output carries `shape:'surface'`
   (grid = points + `Nu`/`Nv`), wireable just like `list<point>` (it's DATA, not a
   closure — this is what `r_surface(fn)` got wrong; a grid is wireable).
3. **`r_solid(outerGrid, innerGrid, Nu, Nv)`** in `stdlib` — outer (fwd) + inner
   (reversed) + 4 stitched edge bands → `weldAndBuild` → watertight shell, no CSG.
   (`r_surface(grid)` — single open surface from a data grid — falls out as the half-step.)

## Build order (each verifiable on its own)
1. **2D-loop builder** — nested loop in `expr-imperative.ts` (parse/compile/validate)
   + `ExprImperativeBlocks` UI; emit a uv grid; tests. Foundation, testable alone.
2. **`shape:'surface'`** output + wiring (the grid output socket → r_surface/r_solid).
3. **`r_surface(grid)`** engine + a single-surface demo (an expression-driven patch).
4. **`r_solid(outer, inner)`** engine + a **tube** demo (no-CSG shell — the proof).
5. **threaded-box-without-CSG** demo — prove the efficiency claim against `box_thread`.

## NURBS later
The consumer is always "a grid of points." A function generates it now; a NURBS
evaluator generates it later — same `r_solid`, swappable generator. Nothing to redo.

## Reuses (not from scratch)
`expr-imperative.ts` (loops), `ExprImperativeBlocks.svelte` (the builder UI),
`manifold-mesh.ts` `gridPatch`/`weldAndBuild` (now hardened against degenerate tris),
`r_surface.ts` (the welded-patch + cap pattern). See [[sweep-thread-engine]].
