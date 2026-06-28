# g_spiral_expr

**Purpose:** The spiral built as **ONE expression** — the #11 "expression-as-builder"
demonstrator. A single `list<point>` expression output generates the entire spiral
profile, wires into a polygon, and extrudes via `r_weld_extrude`. Bakes identically
to the original `g_spiral` (8628 verts) but with the profile collapsed from a
`poly_repeat` loop into one typed list expression.

**Location:** `basic/spirals/g_spiral_expr.asm.ts` (volume). Siblings:
`g_spiral` (polygon + poly_repeat), `g_spiral_sketch` (sketch + sketch_repeat),
`g_spiral_repeat` (part-level Repeat). This is the fourth — the typed-list form.

## Composition (3 nodes)
1. **Expression** (`profile_pts`, `shape:'list', elem:'point'`) — params
   `NPts, r0, growth, turns, width`. A **multi-line** body (named helpers + a
   `return`, the readable form):
   ```
   outer(i) = [(r0 + growth*i/NPts)*cos(i*turns*tau/NPts), (r0 + growth*i/NPts)*sin(i*turns*tau/NPts)]
   inner(j) = [(r0 + growth*(NPts-1-j)/NPts - width)*cos((NPts-1-j)*turns*tau/NPts), (r0 + growth*(NPts-1-j)/NPts - width)*sin((NPts-1-j)*turns*tau/NPts)]
   return concat(map(range(0, NPts), outer), map(range(0, NPts), inner))
   ```
   - `outer(i)` = outer edge forward (`r = r0 + growth·i/NPts`, `θ = i·turns·τ/NPts`)
   - `inner(j)` = inner edge reversed (`r − width`, index `NPts−1−j`)
   Result = a closed flat spiral band of `2·NPts` `[x,y]` points. (Compiles
   identically to the dense one-liner — see `expr-multiline.test.ts`.)
2. **Polygon** — a single `expr-list-ref` entry splicing the expression's
   `profile_pts` output into its points (the `+ expr` / drag-to-wire affordance).
3. **`r_weld_extrude`** — extrudes the polygon `length` in z (`divs 12, twist 0,
   taper 0, segments 64`) into the spiral wall.

## Parameters
| param | meaning | default |
|---|---|---|
| `NPts` | samples per spiral edge (band = 2·NPts pts) | 360 |
| `r0` | start radius | 0.4 |
| `growth` | radial growth over the full sweep | 1 |
| `turns` | number of revolutions | 2 |
| `width` | radial band thickness | 0.2 |
| `length` | extrude depth (z) | 2 |

## Why it matters
Replaces the three-node `poly_repeat` loop (`g_spiral`) with ONE expression whose
`map` IS the loop. Edit the formula on the Σ expression and the whole profile
follows — the substrate for data-driven / generative profiles. Built end-to-end on
the typed-ports system: the `list<point>` output is type-checked, the socket is
typed, and the ✨ auto-wire panel can match it to the polygon. Authored via the
graph model (`addExprDef`/`addPolygonExprListRef`/`addCall`) + emit; see the
`expr-list.test.ts` spiral test for the canonical construction.
