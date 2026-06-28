# p_sq_grove — square ring-groove (simplest `r_surface` demo)

> A plain cylinder with **ONE square ring groove** — a rectangular-section
> channel around the full circumference, ~⅓ of the way up. The **non-helical
> cousin** of `r_helical_surface`'s thread: the same `r(θ, z)` surface, but the
> radius dip is a function of **z only** (a step band), not of the helix phase.
> Built by the converged engine `r_surface` (`src/lib/cad/stdlib/r_surface.ts`,
> Rule 21). Volume part: `primitives/basic/thread_grooves/p_sq_grove.prim.ts`.

## The idea

`r_surface(fn, Nu, Nv, wrapU, capLo, capHi)` lays one welded `gridPatch` over a
parametric surface `fn(u, v) → [x, y, z]` (`u, v ∈ [0,1]`) + caps the two open
`v`-ends. Here `fn` is a body of revolution whose radius drops by a fixed
`depth` inside a `z`-band — a **square (step) cross-section** groove:

```ts
(u, v) => {
  const th = u * 2π;
  const z  = v * L;                                    // L = 4 (Z-down: z=0 top)
  const r  = baseR - ((v > lo && v < hi) ? depth : 0); // square step in v
  return [r·cos(th), r·sin(th), z];
}
// baseR = 1.5, depth = 0.3, lo = 0.4, hi = 0.6  →  groove z ∈ (1.6, 2.4)
// r_surface(fn, 64, 96, true, true, true)
```

- **wrapU = true** — the `u` seam closes exactly (the surface is a full body of
  revolution; `fn` is 2π-periodic in `u`).
- **capLo / capHi = true** — fan the two open ends shut → a watertight solid.
- **Nv = 96** — dense enough along the axis that the step's radial jump
  (1.5 → 1.2) lands across a short `Δz = L/Nv ≈ 0.042`, so the groove walls read
  as crisp near-vertical edges rather than a soft ramp. (`r_surface` can only
  make a single-valued surface, so a *truly* vertical wall / undercut isn't
  possible here — that's the Option-4 swept-band-+-CSG case, not this demo.)

## CRITICAL — `meta.params` is EMPTY on purpose

The part takes **no GUI dials**: `export function p_sq_grove()` has no
parameters, and all constants (`baseR`, `L`, `depth`, the band) are inline. This
mirrors the sibling `surf_revolve`. The reason: the loader **canonicalises the
function signature to the `meta.params` key order**. The first arg `r_surface`
expects is a **function** (`fn`), which is not a dial — a non-empty `params`
block would reorder/drop the un-dial-able args. With `params: {}` the
canonicalisation is a no-op and `(fn, Nu, Nv, wrapU, capLo, capHi)` passes
straight through. `meta.uses: ['r_surface']`, `kind: 'prim'`.

## Bake-only — no editable graph (expected)

Like `surf_revolve`, this is an `r_surface(fn)` part with **no `meta.graph`**, so
the node-graph editor opens it "in legacy mode — the canvas can't hydrate" and
would regenerate a `return undefined` body if saved there. **Do not save it from
the graph editor.** It renders/bakes through `/api/primitives/preview` (the
`/primitives` `PrimitiveDualCanvas`), not the graph canvas. The wireable-grid
pipeline that would make an `r_surface` surface editable is being built
separately.

## Bake verification (`/api/primitives/preview`, default segments)

| metric | value |
|---|---|
| verts (full mesh) | 37,248 |
| z-extent | 0.000 → 4.000 (span 4.0) |
| radial range | 1.500 (outer wall) · 1.200 (groove floor) · depth 0.300 |
| groove band (1.6 < z < 2.4) | pure `r = 1.200` floor |
| watertight | yes — cutaway CSG succeeds (`cutawaySkipped: false`), `ok: true` |

The two-radius histogram (29,824 verts @ r=1.50, 7,296 @ r=1.20, 128 cap-apex
@ r=0) confirms a clean square channel: full-radius cylinder with a crisp
rectangular-section groove ~⅓ up.
