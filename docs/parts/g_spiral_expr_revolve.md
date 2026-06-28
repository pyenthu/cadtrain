# g_spiral_expr_revolve

**Purpose:** The **revolve** analogue of `g_spiral_expr_sketch` — an imperative
`list<point>` expression loop → a **SKETCH** → **`r_revolve`**. Where
`g_spiral_expr_sketch` drives `r_weld_extrude` (extrude a closed band), this part
drives the revolve engine: the expression emits an **r ≥ 0 half-section** that
`r_revolve` spins 360° about the z-axis into a **solid rippled vase / baluster**.
The headline is the same — the sketch's 2D stage renders the profile the
expression builds, live, so you can *see* the lathe section before it spins.

**Location:** `basic/spirals/g_spiral_expr_revolve.asm.ts` (volume). The sixth
spiral: `g_spiral` (poly_repeat) · `g_spiral_sketch` (sketch_repeat) ·
`g_spiral_repeat` (part Repeat) · `g_spiral_expr` (expr → polygon) ·
`g_spiral_expr_sketch` (expr → sketch → extrude) · **`g_spiral_expr_revolve`**
(expr → sketch → **revolve**).

## Composition (3 nodes)
1. **Expression** (`profile_pts`, `shape:'list', elem:'point'`) — an **imperative
   loop** in the `list<point>` builder, two `for` loops (one accumulator):
   ```
   poly = []
   for i = 0 to NPts
     z = i * height / NPts
     r = r0 + amp * sin(turns * tau * i / NPts)
     poly.append([r, z])
   for j = 0 to 2
     poly.append([0, height - j * height])
   return poly
   ```
   Loop 1 walks the **wavy outer wall** (z = 0 (top, Z-down) → `height`, radius
   undulating `r0 ± amp` over `turns` ripples). Loop 2 appends the two **axis
   points** `[0, height]` then `[0, 0]` that close the half-section back to the
   spin axis. (The imperative DSL ignores indentation and runs each loop body
   until the next `for`/`return`, so the close points MUST be their own
   2-iteration loop — they can't be bare post-loop statements.)
2. **Sketch** — a single `expr-list-ref` op splicing the expression's
   `list<point>` output as the profile; the 2D stage draws it, the bake splices
   the compiled list as line ops.
3. **`r_revolve`** (`segments: 96`) — `resolveProfile` passes the raw `[r,z]`
   array straight through; `revolveProfile` treats the list as a **closed loop**
   and fans the `r ≈ 0` axis edges, so the section spins into a solid of
   revolution. `weldAndBuild` auto-corrects winding.

## Parameters
`NPts` 120 · `r0` 1.5 · `amp` 0.5 · `turns` 3 · `height` 4. Keep **`r0 > amp`**
so the outer radius stays ≥ 0 everywhere (min outer radius = `r0 − amp` = 1.0).

## Bake result (defaults)
Bakes clean (no WASM OOB): **69 120 verts** · **z-extent 0.000 → 4.000** (= `height`,
Z-down) · **outer-r 0.000 → 2.000** (axis 0 → ripple peak `r0 + amp` = 2.0).
Cutaway CSG succeeds → valid manifold solid.

## Why it matters
The first **`list<point>` expression → `r_revolve`** part — proves the imperative
loop builder drives the revolve engine natively (r_revolve uses the same welded
`manifold-mesh.ts` toolkit as r_weld_extrude). The two-loop "outer wall + axis
close" idiom is the revolve counterpart to `g_spiral_expr_sketch`'s "outer band +
inner band" closed ribbon. Round-trips in the expression builder (`isImperative`
true → the loop editor renders; re-hydrate/re-emit of the saved `meta.graph` is
idempotent, 0 validation errors).

## See also
- `r_revolve` — the sole revolve engine (welded method), shared by this part.
- `g_spiral_expr_sketch` — the extrude sibling (same expr→sketch front end).
- `g_collar` — a hand-authored polygon → r_revolve part (the non-expression revolve).
