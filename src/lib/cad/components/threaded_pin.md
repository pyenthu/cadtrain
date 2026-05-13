# threaded_pin — Generic External Threads (Male End)

## What this represents

A **generic threaded pin** — the male end of any threaded pipe
connection. This is a *primitive*, not a specific connection: it has
no upset, no shoulder, no specific thread profile baked in. Compose it
with other primitives to build a specific connection form.

Use cases:
- The male half of any custom connection.
- The bottom-pin of a `seal_bore` (already wired this way — see
  `seal_bore.ts` import).
- A nipple section for any sub-assembly.

When you need a fully-formed connection use `conn_box` / `enhanced_box`
or the specific casing/tubing variants (`thread_ltc`, `thread_eue`,
or `threaded_pin_collared` for a pin with an explicit collar/upset).

## Coordinate convention

Z-down. The body uses raw `cyl()` (not centered) — starts at z=0 and
extends to z=length. When composed downstream (e.g. by `seal_bore`),
it's translated to the appropriate Z.

## Composition

1. **Outer body** — `cyl(length, rStart, rEnd)` — straight (taper=0)
   or tapered. When tapered: `rStart = od/2` (top — bigger), `rEnd =
   od/2 - taper * length` (bottom — smaller). This matches API rotary
   threads where the pin tapers DOWN going AWAY from the body (i.e.
   wider at the body end so the thread engages on make-up).
2. **Bore** — straight `cyl(length+0.02, id/2, id/2)` with `-0.01"`
   Z overshoot. Constant-bore: the pin's bore stays at the body ID
   regardless of OD taper.
3. **Threads** — loop `threadCount` times, subtract a thin tube
   (height 0.04") at each evenly-spaced Z. The cutter radius is
   computed *per-thread* by interpolating along the taper:
   `localR = rStart - taper * length * t`. The cutter spans
   `localR - threadDepth .. localR + 0.01` so it cuts into the OD
   without breaching the bore.

## Parameters

| Param         | Default | Range        | Meaning                                  |
|---------------|---------|--------------|------------------------------------------|
| `od`          | 2.5 in  | 0.5 .. 14    | OD at the top (body end)                 |
| `wall`        | 0.3 in  | 0.1 .. 1.0   | Wall thickness, constant                 |
| `length`      | 2.0 in  | 0.5 .. 6     | Pin length                               |
| `threadCount` | 10      | 2 .. 40      | Threads cut along the pin                |
| `threadDepth` | 0.06 in | 0.02 .. 0.15 | Radial thread depth (into OD)            |
| `taper`       | 0       | 0 .. 0.2     | OD taper per unit length (1:N rate)      |

`taper = 0` → parallel pin (premium / radial-shoulder connections).
`taper = 0.0625` → 1:16, API rotary-shouldered (NC, IF).
`taper = 0.0833` → 1:12, typical EUE/LTC.

## Vocabulary

See `threaded_box.md` — same family glossary.

## Geometry contract for AI refinement

- The body is a SOLID `cyl(length, rStart, rEnd)` minus a constant-
  diameter bore. The bore does NOT taper with the OD — preserve this.
  (Real API rotary pins have a constant ID by design — the pin
  thinner at the tip is from the OD taper, not bore widening.)
- Thread cutter direction: cutter outer radius `localR + 0.01`, inner
  `localR - threadDepth`. This carves OUTSIDE the body wall (the
  cutter sits above the OD and cuts inward). Don't reverse to inner-
  cutting; that would cut the bore instead.
- `taper` of `0.0625` for API NC threads matches the `threaded_pin_collared`
  default — consistency across the threaded pin family.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `wall * 2 >= od` → "wall too thick"
- `taper * length * 2 >= od` → "taper consumes the pin OD"
- `threadDepth >= wall` → "thread depth exceeds wall"

## Planned features (out of scope today)

- **Pre-set taper choices** — dropdown for standard rates.
- **Torque shoulder add-on** — flat shoulder at base of pin.
- **Bullnose / pilot** — chamfered or hemispherical tip to ease
  stabbing into the matching box.
- **Thread profile selector** — same as `threaded_box` planned work.

## References

- Composable into: `enhanced_box` (collar end with cone), `seal_bore`
  (bottom pin connection — already imports `threaded_pinGeom`).
- Related: `threaded_box` (female counterpart), `threaded_pin_collared`
  (pin with explicit upset collar).
