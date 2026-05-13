# threaded_pin_collared — Pin with Explicit Collar (EUE-style Pin End)

## What this represents

A **pin with an explicit collar** — the male end of an API EUE-style
connection where the pin sits on a forged upset that's larger than the
pipe body OD. Different from `threaded_pin` (no collar — straight from
body to threads).

Geometry features:
- Optional **body stub** at the body OD (when `bodyStubLength > 0`)
- **Taper transition** from body OD up to collar OD
- **Collar** (the thicker section where threads are cut)
- **Threads** carved into the collar OD, with optional taper

Use this when you need a pin with a visible upset, e.g. for modeling:
- An EUE tubing pin in detail (with the upset showing)
- A premium-connection pin with a forged shoulder
- A drill-collar tool-joint pin where the OD steps up at the connection

For the simpler no-upset form use `threaded_pin`. For the corresponding
female form with an upset/collar shoulder use `enhanced_box` or a
custom composition.

## Coordinate convention

Z-down. Built bottom-to-top in the geom — the body stub at the bottom,
collar at the top. But because the part is auto-Z-centered by the
finalizer, the visual is symmetric across z=0.

Stack (from `geom`):
- `z = 0 .. bodyStubLength` — optional body stub
- `z = bodyStubLength .. +taperHeight` — taper to collar
- `z = stubLen+taperLen .. +collarLen` — collar with threads

## Composition

1. **Seed cube** (tiny, 0.001³) — Manifold `.add()` chain seed.
2. **Body stub** — when `bodyStubLength > 0`, add `cyl(stubLen, od/2)`
   at the bottom.
3. **Taper** — when `taperHeight > 0`, add `cyl(taperLen, od/2, collarOD/2)`
   transitioning body to collar OD.
4. **Collar** — `cyl(collarLen, odStart, odEnd)` where `odStart =
   collarOD/2` and `odEnd = collarOD/2 - taper*collarLen` (optional
   thread-form taper on top of the collar's main OD). Translated to
   sit above the transition.
5. **Bore** — `cyl(stubLen+taperLen+collarLen+0.02, id/2)` subtracted
   from the whole body. Constant ID, like `threaded_pin`.
6. **Threads** — loop `threadCount` times, per-thread radius computed
   along the collar taper, subtract thin tube cutters.

## Parameters

| Param            | Default  | Range        | Meaning                                |
|------------------|----------|--------------|----------------------------------------|
| `od`             | 2.875 in | 1 .. 14      | Body OD                                |
| `wall`           | 0.217 in | 0.1 .. 1.0   | Wall thickness                         |
| `collarOD`       | 3.668 in | 1 .. 16      | Collar (upset) OD                      |
| `taperHeight`    | 0.4 in   | 0 .. 2       | Taper transition length (body→collar)  |
| `collarLength`   | 0.8 in   | 0.3 .. 6     | Collar axial length (thread length)    |
| `bodyStubLength` | 0 in     | 0 .. 2       | Optional body stub at the bottom       |
| `threadCount`    | 8        | 2 .. 40      | Threads cut into the collar            |
| `threadDepth`    | 0.04 in  | 0.02 .. 0.15 | Radial thread depth                    |
| `taper`          | 0.0625   | 0 .. 0.2     | Thread taper (1:16 default)            |

Default `2.875" / 3.668"` body/collar matches a 2-7/8" EUE upset
(API: ~upset OD 1.27× body OD on tubing).

## Vocabulary

- **Collar** — the thicker section of pipe at the connection. Synonym
  for **upset** when forged; **coupling** when separate.
- **EUE upset** — the externally-upset thread end. The upset ratio for
  2-7/8" EUE is ~1.27× (e.g. 2.875 → 3.668).
- The body OD slider is `od`, NOT `bodyOD`, because the param feeds
  multiple downstream geometry pieces. Keep the short name; the label
  in the Inspector is "Body OD".

## Geometry contract for AI refinement

- Seed cube at the start is to satisfy Manifold's first-add requirement
  — don't remove.
- Body stub is *optional* (`stubLen > 0` branch) — the user can set
  `bodyStubLength = 0` to drop it. Preserve this branch.
- Bore is subtracted from the AGGREGATE (stub + taper + collar), not
  each piece individually. This is correct — preserve.
- Default `taper = 0.0625` (1:16) for the threads is API rotary
  shoulder spec — keep as default; user can override.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `wall * 2 >= od` → "wall too thick"
- `collarOD <= od` → "collar OD must be > body OD"
- `taper * collarLength * 2 >= collarOD` → "thread taper eats collar"
- `threadDepth >= wall` → "thread depth exceeds wall"

## Planned features (out of scope today)

- **Upset preset** — selecting an API tubing size auto-fills both
  `od` and `collarOD` from spec tables.
- **Make-up shoulder** — flat seal face at the top of the collar.
- **Lead-in chamfer** — bevel at the top edge to ease stabbing.
- **Pre-set thread profile** — currently representative thin-tube
  cuts; future: actual API thread profile via NL→ManifoldCAD track.

## References

- Related: `threaded_pin` (no collar), `thread_eue` (EUE with body
  length + upset modeled as separate pieces), `enhanced_box` (the
  female equivalent — box with collar and internal threads).
- KB: `static/kb/api/casing-tubing-data.json` for matching collar
  ODs by tubing/casing class.
