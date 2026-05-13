# tapered_cone — Constant-Wall Cone (Upset Transition / Crossover)

## What this represents

A hollow cone with **constant wall thickness** — the geometric primitive
behind the upset transition between a pipe body and its larger-OD
connection. Used as a sub-component inside `conn_box`, `enhanced_box`,
and `seal_bore` to bridge the body OD up to the box/pin OD.

Different from `taper`: this one keeps the wall thickness uniform along
the slope so the bore tapers with the OD. That's the correct physical
behaviour for a forged upset on a tool joint — the metal is rolled
outward, not added.

## Coordinate convention

Z-down. `cyl(length, odTop/2, od/2)` puts `odTop` at z=0 (top — the
NARROW end, by convention here) and `od` at z=length (bottom — the WIDE
end). When used as an upset transition: the wide bottom mates with the
parent body OD; the narrow top is the connection's outer flange.

## Composition

Outer cone minus inner cone:

- `outer = cyl(length, odTop/2, od/2)` — Manifold tapered cyl, no CSG
- `inner = cyl(length + 2*OS, innerR1, innerR2).translate(0, 0, -OS)`
  — same shape with `wall` inset, with a `OS = 0.4"` overshoot at
  each end so the bore extends through both faces

The inner-cone radii are computed by extrapolating the slope back by
`-OS` at the top and forward by `+OS` at the bottom (`innerR1` /
`innerR2` in the source). Without this slope-aware extension, the
overshoot would punch a parallel-walled hole instead of a tapered one.

## Parameters

| Param    | Default | Range        | Meaning                              |
|----------|---------|--------------|--------------------------------------|
| `od`     | 2.875 in| 0.5 .. 14    | OD at the bottom (wide end)          |
| `odTop`  | 3.5 in  | 0.5 .. 14    | OD at the top (narrow end usually,   |
|          |         |              | but can be wider — see vocabulary)   |
| `wall`   | 0.29 in | 0.05 .. 1.0  | Wall thickness, constant along length|
| `length` | 1.0 in  | 0.5 .. 20    | Axial length of the cone             |

The default has `odTop > od` (3.5 > 2.875) — the cone is **wider at the
top**, matching the conn_box upset shape (body OD at bottom, upset OD
at top).

## Vocabulary

- *Upset* (noun) = the formed/forged thicker section at a pipe end.
- *Upset ratio* = `connection OD / body OD`. API tubing is usually
  `1.1×–1.4×`.
- The param `od` is "bottom OD" and `odTop` is "top OD" — names match
  Z-down. Don't rename to `odBottom` / `odTop` for symmetry unless you
  also update every caller (this is imported as `taperedConeGeom` by
  conn_box.ts, enhanced_box.ts, seal_bore.ts).

## Validation rules

- `wall * 2 >= od` → "wall too thick at the bottom"
- `wall * 2 >= odTop` → "wall too thick at the top"
- `length <= 0` → "length must be > 0"

## Geometry contract for AI refinement

- `cyl(h, r1, r2)` is the only helper that produces a true tapered
  cylinder — substituting two stacked cylinders breaks the SVG outline
  export, which relies on a single continuous edge.
- Don't remove the `OS` overshoot — it prevents hair-thin closing
  surfaces at the bore openings under Manifold's CSG tolerance.
- The slope-extension trick (`innerR1 = idTop/2 - slope * OS`) is
  intentional; reverting to constant inner radii will produce visible
  artifacts at the bore ends.

## Planned features (out of scope today)

- **API spec snapping** — given `od` (body) + a thread class (NC50,
  4-1/2 IF), compute the canonical upset `odTop`. Today the user
  picks both ODs freely.
- **Forged-vs-machined visual** — different vertex-color treatment for
  forged shoulders (rolled grain visible) vs machined (sharp edges).

## References

- Used by: `conn_box` (drill-pipe box), `enhanced_box` (box with
  collar threads), `seal_bore` (top cone before the seal bore body).
