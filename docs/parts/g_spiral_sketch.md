# g_spiral_sketch — Archimedean Spiral Strip (sketch-system twin)

A faithful re-author of [`g_spiral`](g_spiral.md) using the **sketch**
subsystem instead of the **polygon** subsystem — created 2026-06-26 to
demonstrate that `sketch_repeat` can express exactly what `poly_repeat`
does (per the design review in that session). Same geometry, byte-equal
shape; the only difference is which 2D-profile system builds the outline.

## What this represents

Identical to `g_spiral`: a thin flat coil — the area between **two
concentric Archimedean spirals** offset by a constant radial `width`,
extruded straight down z via `r_weld_extrude`. The outline walks **out**
along the outer spiral (`i = 0 … NPts-1`) then **back** along the inner
spiral in reverse (`j → idx = NPts-1-j`), closing into a ribbon.

## Graph structure (the sketch translation)

```
n_root (list)
  ├─ n_sketch (sketch)          ops: [↻ ref n_loopA, ↻ ref n_loopB]
  │    ├─ n_loopA (sketch_repeat, var i)   outer edge, forward
  │    └─ n_loopB (sketch_repeat, var j)   inner edge, reversed
  └─ n_call (r_weld_extrude)    profile = __POLY__n_sketch, length = p.length
```

Each `sketch_repeat` is the direct analog of a `poly_repeat`:

| poly_repeat (g_spiral) | sketch_repeat (here) |
|---|---|
| node carries `r` / `z` exprs | a single **`line` op** (`mode:'abs'`) carries `r`/`z` |
| `bindings[]` (R0, dr, turns, theta, R) | **identical** `bindings[]` (reuses the same type) |
| `count`, `loopVar` | `count`, `loopVar` (i / j) |
| — | `Δr`/`Δz` advance (left blank — spiral uses absolute coords) |
| polygon `points[]` repeat-ref | sketch `ops[]` repeat-ref |

**Loop A** (`var i`) — bindings `theta = i*turns*tau/NPts`,
`R = R0 + dr*i/NPts`; op `(r,z) = (R·cos θ, R·sin θ)`.
**Loop B** (`var j`) — bindings `idx = NPts-1-j`,
`theta = idx*turns*tau/NPts`, `R = R0 + dr*idx/NPts - width`; same op.

The two refs splice into one sketch profile; `mode:'abs'` keeps each
point an independent absolute coordinate (no relative accumulation /
Δ-advance). The sketch is fed to `r_weld_extrude` exactly like g_spiral's
polygon (a centred cartesian profile — `r`/`z` span ±, not a revolve
half-section).

## Params (identical to g_spiral)

| param | default | meaning |
|---|---|---|
| `NPts` | 360 | points per spiral edge (×2 edges = the ribbon) |
| `r0` | 0.4 | inner start radius |
| `growth` | 1 | radial growth over the full sweep |
| `turns` | 2 | revolutions |
| `width` | 0.06 | radial ribbon width (inner edge = outer − width) |
| `length` | 2 | extrude depth (z) |

## Verified

Bakes identically to g_spiral at defaults: **8,628 verts**, cross-section
x∈[−1.15, 1.40] · y∈[−1.28, 1.03] (the r0→r0+growth spiral), z∈[0, 2].
Lives at `primitives/basic/g_spiral_sketch.asm.ts`. Renders in the editor
as two `↻ sketch repeat` cards (Bindings ƒ(i)/ƒ(j) + a one-op prototype).

## Takeaway

`sketch_repeat` has **full parity** with `poly_repeat` for expression-
driven point loops — same bindings, same per-iteration eval, same
multi-ref splice. The spiral's "unintuitive" feel is inherent (two loops,
one reversed, building a ribbon outline), not a limitation of either
system. See also [g_spiral.md](g_spiral.md).
