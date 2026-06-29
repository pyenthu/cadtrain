# p_sq_grove

**Simplest square-groove SOLID** — a graph-editable revolve.

A closed 8-point r–z **polygon** (a cylinder wall with a square notch cut into the
OD between `gz0` and `gz1`) **revolved 360°** via `r_revolve` → a watertight solid
with a square ring groove. **No CSG** (a single revolve), graph-editable (opens with
nodes, not "legacy mode"), unlike the earlier bake-only `r_surface(fn)` stand-in.

- **Location:** `primitives/basic/thread_grooves/p_sq_grove.prim.ts` (volume) · `kind: prim` · `uses: ['r_revolve']`
- **Graph:** `polygon` (n_psg_p, 8 pts) → `__POLY__` → `r_revolve` Call (A, 64 segments)
- **Params:** `od` 3 · `id` 1.2 · `length` 4 · `depth` 0.3 · `gz0` 1.6 · `gz1` 2.4
- **Bake:** ~1k–3k verts (resolution-dependent), watertight (cutaway runs), z[0,4], r[0,od/2], groove floor at `od/2 − depth`.

**Caveat — currently a SOLID cylinder, not a tube.** `r_revolve` caps the ends to the
axis, so the `id` (bore) param has no visible effect yet — the result is a solid
cylinder with an OD groove. A true bore (outer wall + inner wall as two surfaces) is
the **two-surface `r_solid`** construction (the canonical `p_sq_grove` per
`docs/plans/parametric-surface-solid.md`), built once the wireable-surface pipeline lands.
