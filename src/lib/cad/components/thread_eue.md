# thread_eue — API EUE (External Upset End) Tubing Pin

## What this represents

The **External Upset End (EUE)** is the most common API tubing
connection — the pipe-body has a forged thicker section near the
threaded end (the *upset*), and threads are cut into that upset rather
than weakening the pipe wall.

Geometry features:
- **Body** — straight pipe section at OD `bodyOD`, full length
  `bodyLength`. This is the API tubing nominal size (2-3/8", 2-7/8", etc).
- **Taper transition** — short conical fillet between body OD and the
  larger upset OD. Length `taperH`.
- **Upset** — the thicker pipe end at `upsetOD`, length `upsetLength`,
  with `threadCount` external threads cut into its OD.

EUE connections are paired with **EUE couplings** (separate
component — see `tubing_hanger_coupling` for the form-similar but
larger wellhead variant; standard EUE couplings are a future primitive).

## Coordinate convention

Z-down. Stacked top-to-bottom:
- z=0 .. bodyLength → body
- z=bodyLength .. +taperH → taper transition (body OD → upset OD)
- z=bodyLength+taperH .. +upsetLength → upset with threads

## Composition

1. `body = tube(bodyOD/2, id/2, bodyLength)` — straight pipe section
2. `taper = cyl(taperH, bodyOD/2, upsetOD/2)` minus a constant-bore
   cylinder — annular cone bridging body to upset
3. `upset = tube(upsetOD/2, id/2, upsetLength)` — thicker pipe end
4. **Threads** — loop `threadCount` times, subtract a 0.04"-thick
   thin tube cutter from upset OD inward by `threadDepth`. Evenly
   spaced along upsetLength.

The bore stays at `(bodyOD - 2*wall)` through the whole part —
consistent ID is the defining feature of EUE (vs Internal Upset where
the bore narrows at the upset).

## Parameters

| Param         | Default  | Range        | Meaning                                  |
|---------------|----------|--------------|------------------------------------------|
| `bodyOD`      | 2.375 in | 1 .. 5       | API tubing OD (2-3/8" default)           |
| `upsetOD`     | 2.875 in | 1.5 .. 6     | OD of the upset (where threads are cut)  |
| `wall`        | 0.25 in  | 0.1 .. 0.8   | Wall thickness, constant body+upset      |
| `bodyLength`  | 4.0 in   | 2 .. 10      | Length of the straight body              |
| `upsetLength` | 1.5 in   | 0.5 .. 3     | Length of the upset (thread length)      |
| `threadCount` | 10       | 4 .. 16      | Threads cut into the upset               |
| `threadDepth` | 0.05 in  | 0.02 .. 0.10 | Radial thread depth                      |
| `taperH`      | 0.2 in   | 0.1 .. 0.5   | Taper transition length                  |

Default `2.375" / 2.875"` body/upset = standard 2-3/8" tubing EUE.

## Vocabulary

- **EUE** = External Upset End. The opposite is **IUE** (Internal
  Upset End) where the bore is narrowed instead of the OD widened —
  retains drift but weakens the thread.
- **NUE** = Non-Upset End (no upset, threads cut into nominal wall —
  weaker connection, used on small tubing).
- **Upset** (noun) = the formed thicker section. **Upset** (verb) =
  the forging process that creates it.
- API tubing sizes: 2-3/8", 2-7/8", 3-1/2", 4", 4-1/2" — all use
  matching EUE thread profiles. The exact thread spec (TPI, taper) is
  per API 5B, not modeled at primitive level (the geom shows
  representative cuts, not API-compliant form).

## Geometry contract for AI refinement

- Body bore and upset bore must remain the SAME `id` — the constant-
  ID feature is what makes this EUE (not IUE).
- Thread cutters are *thin tubes*, not extruded helices — Manifold
  helical extrusion isn't supported at this scale. The visual is
  "stacked rings"; the prompt to refine for true helical threads
  should reject this primitive and produce a new one (e.g. via NL
  authoring track).
- Don't merge body + taper + upset into a single `cyl` — keeping them
  separate preserves the edge classification (red OD per segment)
  and matches the SVG-export expectation of distinct geometry pieces.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `wall * 2 >= bodyOD` → "body wall too thick"
- `upsetOD <= bodyOD` → "upset OD must be > body OD"
- `threadDepth >= wall` → "thread depth exceeds wall"

## Planned features (out of scope today)

- **API spec dropdown** — 2-3/8", 2-7/8", 3-1/2", etc. Picks `bodyOD`,
  `upsetOD`, `wall` from `static/kb/api/casing-tubing-data.json`.
- **EUE box variant** — same forging, internal threads instead of
  external. Today only the pin form is modeled.
- **Joint length presets** — 25 ft / 31 ft Range 1, 31-34 ft Range 2,
  42 ft Range 3 (API tubing joint lengths).
- **Thread profile** — currently representative cuts; would integrate
  with NL→ManifoldCAD track to produce true helical threads.

## References

- KB: `static/kb/api/casing-tubing-data.json` (rows for 2-3/8", 2-7/8"
  tubing dimensions).
- Related: `thread_ltc` (long-thread casing, coupled), `threaded_pin`
  (generic pin without upset), `enhanced_box` (drill-string box with
  collar — the upset-with-threads pattern at higher OD ratios).
