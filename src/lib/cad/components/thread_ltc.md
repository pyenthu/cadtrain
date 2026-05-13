# thread_ltc — API LTC (Long Thread Casing) with Coupling

## What this represents

The **API Long Thread Casing (LTC)** connection — one of three API
8-round casing connections (the others are STC = Short Thread Casing,
and BTC = Buttress Thread Casing).

Geometry features:
- **Pipe body** with external threads cut along its OD over the full
  `length` (the *thread engagement* is long — that's the "Long" in LTC).
- **Coupling** — a separate forged ring at larger OD `couplingOD`
  that surrounds the threaded section. The mating joint's threads enter
  from the other end of the coupling.

LTC trades thread-engagement length for shear capacity: the longer
thread provides better seal and resistance to jump-out in deep wells
with high tension loads.

## Coordinate convention

Z-down. The pipe body is centered at z=0 (length/2 above and below).
Coupling is centered at the middle of the body (`length/2 - couplingLength/2`).

This models the *connection itself* — i.e. the threaded end of one
joint plus the coupling, NOT a full pipe joint. Compose with a
`hollow_cylinder` body to model a full Range 2 casing joint.

## Composition

1. `pipe = tube(od/2, id/2, length)` — straight body
2. **Threads** — loop `threadCount` times, subtract a thin tube cutter
   (height 0.03") from OD inward by `threadDepth`. Evenly spaced along
   `length`.
3. `coupling = tube(couplingOD/2, od/2 - threadDepth, couplingLength)`
   — the larger-OD ring placed around the threaded section. The bore
   matches the thread roots so it sits flush.

## Parameters

| Param            | Default | Range        | Meaning                              |
|------------------|---------|--------------|--------------------------------------|
| `od`             | 5.5 in  | 2 .. 10      | Casing OD (5-1/2" default)           |
| `wall`           | 0.35 in | 0.15 .. 1.0  | Wall thickness                       |
| `length`         | 4.0 in  | 2 .. 8       | Threaded section length              |
| `threadCount`    | 16      | 8 .. 24      | Thread count along `length`          |
| `threadDepth`    | 0.05 in | 0.02 .. 0.10 | Radial thread depth                  |
| `couplingOD`     | 6.05 in | 2 .. 12      | Coupling OD (API: ~OD + 0.55")       |
| `couplingLength` | 1.5 in  | 0.5 .. 3     | Coupling axial length                |

Default `5.5" / 6.05"` body/coupling matches API 5-1/2" LTC casing
(coupling OD per API 5B is 6.05" for 5-1/2" casing). Common casing
sizes: 4-1/2", 5", 5-1/2", 7", 9-5/8", 13-3/8".

## Vocabulary

- **LTC** = Long Thread Casing. **STC** = Short Thread Casing
  (same form, shorter thread engagement — cheaper, less hold).
- **BTC** = Buttress Thread Casing (different thread form — square-
  shouldered, higher pressure rating). BTC would be its own primitive.
- **Coupling** = the ring that joins two casing joints. Separately
  manufactured, threaded to both joints during make-up.
- **API 8-round** = the thread form (8 threads per inch, rounded
  crest/root). Distinct from API V-thread which is sharper.
- **Make-up** = the act of threading two joints together.

## Geometry contract for AI refinement

- Coupling MUST be a separate `tube()` added to the body via `.add()`,
  not subtracted from a larger OD blank — the SVG export's vertex-
  color classification depends on the coupling being its own piece.
- Thread cutter height (`0.03"`) is purposely small — fewer threads
  per visible cutter than `thread_eue` (`0.04"`) because LTC has more
  threads in a comparable length. Don't unify the constants.
- Thread cutters anchored at `tz = length * (i + 0.5) / threadCount`
  — evenly spaced. Maintain this for AI refinement (the regularity
  is the visual signature of API thread).

## Validation rules

No `meta.validate` today. Reasonable additions:
- `wall * 2 >= od` → "wall too thick"
- `couplingOD <= od` → "coupling OD must be > pipe OD"
- `couplingLength > length` → "coupling overflows body"

## Planned features (out of scope today)

- **API casing-spec dropdown** — pick from
  `static/kb/api/casing-tubing-data.json`. The 299-row KB has every
  standard casing/tubing OD-wall-grade combination.
- **STC variant** — same primitive with shorter thread length.
- **BTC variant** — buttress thread form; new primitive.
- **Premium connection family** — VAM, Hydril, Tenaris-Blue etc.
  Each has its own thread profile + seal geometry. Out of scope here,
  but the catalog should reference these names so future Claude
  sessions know they're distinct connections.
- **Coupling-less variant** — Integral-Joint Casing (IJC) where the
  threads are cut into a forged box on the pipe end (no separate
  coupling). The wellhead `tubing_hanger_coupling` is the moral
  equivalent at higher OD.

## References

- KB: `static/kb/api/casing-tubing-data.json` (299 rows: LP/CSG/TBG
  operational specs).
- Related: `thread_eue` (tubing EUE pin), `threaded_pin_collared`
  (pin with explicit collar — analogous form factor).
