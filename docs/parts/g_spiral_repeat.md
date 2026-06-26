# g_spiral_repeat — Spiral via the part-level Repeat card

A third take on the spiral (after [`g_spiral`](g_spiral.md) = polygon +
poly_repeat, and [`g_spiral_sketch`](g_spiral_sketch.md) = sketch +
sketch_repeat). This one uses the **part-level `repeat` node** (the Repeat
card) to *place a base part N times along the spiral path* — an exploration
of how generic the repeat card is. Created 2026-06-26.

## How it works

```
n_root (list) → n_repeat (repeat, var i, count NPts)
                  └─ child: n_box = r_cuboid(width, width, length)
                  bindings:  R0, dr, turns, len, theta, R
                  partModifiers[n_box]:  mv [R·cosθ, R·sinθ, len/2]
```

Each of the `NPts` iterations places one small square post (`r_cuboid`)
at the spiral point `(R·cosθ, R·sinθ)`, with `theta`/`R` derived per-i
from the bindings — exactly the same expressions as g_spiral's loops.
The posts overlap (spacing < `width`) so they read as a continuous wall;
`place([...])` composes them.

## Key finding — repeat-card parity (the generic fix)

This part surfaced an inconsistency: the **part-repeat emitter injected the
loop count only as `N`**, whereas `poly_repeat` / `sketch_repeat` inject it
as **`NPts`**. So binding exprs written `…/NPts` failed in the Repeat card
with "NPts is not defined". Fixed in `composition-emit.ts` (the part-repeat
preamble now emits **both** `const N` and `const NPts`), so the SAME
expressions work across all three repeat flavors. Bindings + per-part `mv`
axes already accept full exprs of the loop var — no other gap.

## How it compares

| | g_spiral / g_spiral_sketch | g_spiral_repeat |
|---|---|---|
| builds | one **welded 2D outline → extrude** | **N discrete part copies → place()** |
| geometry | ~8.6k verts, clean thin ribbon | ~13–26k verts, bumpy square posts |
| cross-section | thin radial ribbon (`width`) | square post (`width × width`) |
| best for | a true continuous spiral solid | patterned placement of a unit |

The part-repeat **places** copies; it does not weld/loft *between* them.
For a clean continuous swept solid from the repeat you'd want a future
**"loft/sweep between consecutive copies"** mode — that single feature would
make the Repeat card a universal swept-solid builder (springs, threads,
helical ramps, spiral blades) at a fraction of the vertex count.

## Params

Identical to g_spiral (NPts, r0, growth, turns, width, length). Lives at
`primitives/basic/g_spiral_repeat.asm.ts`. Renders + bakes from the Repeat
card (verified 2026-06-26: ✓ ~8.8k tris).
