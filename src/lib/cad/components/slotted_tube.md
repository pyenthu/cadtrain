# slotted_tube — Multi-Row Slotted Liner (Sand Screen / Slotted Liner)

## What this represents

A hollow tube with **one or more rows of longitudinal slots** cut
through the wall, with independent row spacing and inter-row phase
rotation. The real-world model is a **slotted liner** used for sand
control in unconsolidated reservoirs:

- Rows of milled or laser-cut slots, axially distributed along the
  joint.
- Each row's slots are rotated (*phased*) relative to the next so the
  cumulative open area is uniform around the circumference and the
  tube doesn't develop a structural weak axis.
- Slot widths set by reservoir-sand size (10/40 sand → ~250 μm slots;
  often 0.012" in field units).

Use this for **slotted liners**, **wire-wrap screen mandrels** (as the
underlying perforated base), or any port sub with patterned slotting.
For a single-row, blind-slot collet form use `slotted_cylinder`.

## Coordinate convention

Z-down. The base tube is centered at z=0 (the manifold-helpers convention).
Slots are positioned by `first_offset` (top of first row, from the
build origin) and stepped down by `row_offset`. Each slot is a Z-aligned
cutter `slot_height` tall.

`first_offset + (slot_rows - 1) * row_offset + slot_height` must be
≤ `length` — checked by `validate()`.

## Composition

A non-obvious cutter geometry: each slot is built from a **full-diameter
disc** with two **enormous side-blockers** (radius `outerR * 50`)
subtracted, leaving only a strip `slot_width` wide. The blockers are
oversized so their inner boundary reads as a near-straight line over
the disc's small extent — this is a robust way to make a rectangular
through-wall slot under Manifold's tolerance without polygon math.

```
fullDisk     = cyl(slot_height, outerR)
leftBlock    = cyl(slot_height, blockerR) at +Y
rightBlock   = cyl(slot_height, blockerR) at -Y
slotLocal    = fullDisk − leftBlock − rightBlock     // a strip
slotMoved    = mv(slotLocal, [0, 0, zOffset])
slotFinal    = rot(slotMoved, [0, 0, angle])         // phase around Z
body = body.subtract(slotFinal)
```

A `+0.01"` overshoot on `outerR` and the blocker-radius-of-50× ensure
the slot reads as a clean through-cut.

## Parameters

| Param              | Default  | Range         | Meaning                                       |
|--------------------|----------|---------------|-----------------------------------------------|
| `od`               | 2.875 in | 0.5 .. 6.0    | Outer diameter                                |
| `wall`             | 0.375 in | 0.05 .. 1.0   | Wall thickness                                |
| `length`           | 7.0 in   | 0.5 .. 15.0   | Total tube length                             |
| `slot_count`       | 7        | 0 .. 12       | Slots per row (0 = un-slotted tube)           |
| `slot_width`       | 0.1 in   | 0.05 .. 1.0   | Circumferential width of each slot            |
| `slot_height`      | 0.75 in  | 0.1 .. 14     | Axial length of each slot                     |
| `first_offset`     | 0.5 in   | 0 .. 14       | Z offset of the top of the first row          |
| `row_offset`       | 1.5 in   | 0.1 .. 14     | Z spacing between rows (top of one to next)   |
| `slot_phase`       | 60°      | 0 .. 180      | Starting circumferential phase of row 0       |
| `slot_rows`        | 4        | 1 .. 10       | Number of rows                                |
| `row_phase_offset` | 60°      | 0 .. 180      | Additional phase rotation per row             |

`row_phase_offset` between rows is what makes adjacent rows stagger —
without it, all rows would have slots in the same circumferential
positions, weakening the same axis along the full length.

## Validation rules

- `wall * 2 >= od` → "wall too thick"
- `slot_width >= od` → "slot_width must be less than OD" (sanity)
- `slot_height <= 0` → "slot_height must be > 0"
- Total Z reach overflow → "slot pattern overflows tube (X > length Y)"
  Catches the common case of nudging `row_offset` or `slot_rows` too far.
- `slot_rows > 1 && row_offset < slot_height` → "row_offset < slot_height
  — consecutive rows overlap" (the rows would visually merge)

## Vocabulary

- *Slot* — universal.
- *Phase* — angular offset around Z. Real slotted liners spec phase as
  e.g. "60° phasing" meaning each row rotates 60° from the previous.

## Geometry contract for AI refinement

- Don't replace the disk-minus-blockers cutter with extruded polygons —
  Manifold's per-mesh segmentation will diverge and the SVG outline
  will fracture along slot edges.
- `blockerR = outerR * 50` is intentional — keep the 50× multiplier.
- Round `slot_count` and `slot_rows` to integers inside `geom` (the
  source already does this via `Math.round` — preserve when refining).

## Planned features (out of scope today)

- **Sand-size preset** — dropdown mapping reservoir sand class (e.g.
  10/40, 20/40, 40/60) to a slot-width default that targets a 2:1
  retention ratio.
- **Helical pattern** — instead of discrete rows, advance the phase
  continuously along Z for a spiral of slots.
- **Cross-flow option** — wrap-around slots that wrap circumferentially
  rather than axially (for swell-packer applications).

## References

- Related: `slotted_cylinder` (single-row, blind), `grooved_cylinder`
  (OD circumferential grooves, not slots).
- Field reference: Halliburton "Slotted Liner Designs" — slot width
  table by sand class.
