# hollow_cylinder — Plain Tube / Pup Joint / Coupling Body

## What this represents

The fundamental hollow tube — every pipe-body, mandrel, sleeve, sub, pup
joint, or coupling barrel in the wellbore starts here. Pick this when
the part is just *cylindrical wall stock with a bore through it* and any
features (threads, grooves, ports) are added by composing on top.

It models a section of API casing or tubing as straight stock, not a
threaded connection. Use `threaded_box` / `threaded_pin` for the make-up
ends, or `enhanced_box` / `conn_box` for a fully-formed rotary-shouldered
connection.

## Coordinate convention

Z-down: top = lower z, bottom = higher z. `tube()` returns a Manifold
centered at z=0, so the geom is symmetric — `length/2` above and below
the build origin. The Inspector's auto-Z-center keeps this readable.

## Composition

Single `tube(outerR, innerR, length)` from `../manifold-helpers`.
Inner radius is derived `(od - 2*wall) / 2`. No CSG operations — this
is the floor that everything else builds on.

## Parameters

| Param    | Default  | Range          | Meaning                                |
|----------|----------|----------------|----------------------------------------|
| `od`     | 2.875 in | 0.5 .. 6.0     | Outer diameter (2-7/8" tubing default) |
| `wall`   | 0.375 in | 0.05 .. 1.0    | Wall thickness                         |
| `length` | 4.0 in   | 0.5 .. 15.0    | Axial length                           |

The defaults match a typical 2-7/8" tubing pup-joint with API-spec wall.

## Validation rules

- `wall * 2 >= od` → "wall too thick — bore would collapse"
  Common slider-drag mistake; the user gets inline feedback instead of
  a CSG crash.
- `length <= 0` → "length must be > 0"

## Geometry contract for AI refinement

- Single named exports: `meta` + `geom` (via `defineGeom(meta, …)`)
- `id: 'hollow_cylinder'` unchanged
- Don't replace the `tube()` call with raw `M.cube` or `cyl` — the
  helper bakes in segment count and the Z-centering convention

## Planned features (out of scope today)

- **API-spec snap** — dropdown that pulls OD/wall pairs from
  `static/kb/api/casing-tubing-data.json` (299 rows already loaded).
- **Pup-joint length presets** — 2 ft / 4 ft / 6 ft / 8 ft / 10 ft.
- **Weight readout** — `lb/ft` derived from OD/wall + 7.85 g/cc steel.

## References

- KB: `static/kb/api/casing-tubing-data.json` (LP/CSG/TBG OD × wall grid)
- Assembly: any recipe under `docs/assemblies/*.md` (every multi-part
  assembly uses hollow_cylinder for body stock)
