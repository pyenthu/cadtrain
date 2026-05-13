# slotted_cylinder — Simple Slotted Tube (Collet / Port Sub)

## What this represents

A tube with longitudinal slots cut **inward from the OD** — the simpler
single-row form. Real-world parts that match this geometry:

- **Collet** — segmented fingers that flex inward to grip a profile.
- **Drag spring** — bow-spring centralizer alternative; slots between
  the springs let the segments deflect.
- **Port sub / vent sub** — when the slots cut all the way through
  the wall (use `slotted_tube` with a high `slotDepth` if so).

For multi-row patterned slots with phase rotation between rows, use
`slotted_tube` — that's the richer primitive. `slotted_cylinder` is
the one-row simplified version.

## Coordinate convention

Z-down. The tube is centered at z=0 (length/2 above and below). Slots
are `M.cube` cutters anchored at the OD, sized `0.8 × length` in Z so
they don't reach the ends — leaves a `0.1 × length` solid band at both
top and bottom. This matches how real collet fingers terminate against
solid stock so the fingers can flex without ripping the ends.

## Composition

1. Base `tube(od/2, id/2, length)` from `../manifold-helpers`
2. For each of `numSlots`: an `M.cube([slotWidth, slotDepth, length*0.8])`
   centered cutter, positioned at OD `(od/2 - slotDepth/2)` outward in
   +Y, then rotated `i * (360/numSlots)` degrees around Z

The slot cutter is sized to penetrate `slotDepth` into the wall; if
`slotDepth ≥ wall`, the slot is through-wall (a port).

## Parameters

| Param        | Default | Range        | Meaning                              |
|--------------|---------|--------------|--------------------------------------|
| `od`         | 2.5 in  | 0.5 .. 6.0   | Outer diameter                       |
| `wall`       | 0.3 in  | 0.05 .. 1.0  | Wall thickness                       |
| `length`     | 4.0 in  | 1.0 .. 10.0  | Axial length                         |
| `numSlots`   | 4       | 1 .. 12      | Slot count, evenly phased            |
| `slotWidth`  | 0.15 in | 0.05 .. 0.5  | Circumferential width of each slot   |
| `slotDepth`  | 0.2 in  | 0.05 .. 0.5  | Radial penetration from OD inward    |

`slotDepth < wall` → blind slot (collet finger).
`slotDepth ≥ wall` → through-wall port (vent sub).

## Vocabulary

- *Slot* is universal; don't rename.
- *Finger* is the section of material BETWEEN slots — semantically
  important when modeling a collet. The primitive doesn't expose this
  as a slider, but the count is `numSlots` because that's what dictates
  the spacing.

## Geometry contract for AI refinement

- Slots are CSG subtracts from a tube — don't replace with extruded
  polygons (Manifold's segmentation will then differ from the base
  tube and the SVG outline will fracture).
- `length * 0.8` is the slot-Z span — preserve as a literal multiplier
  unless adding an explicit `slotZSpan` param (which is reasonable —
  see Planned features).

## Planned features (out of scope today)

- **`slotZSpan` param** — let the user set the slot's axial length
  independently from total length (today it's fixed at 0.8×).
- **End-fillet radius** — round the top and bottom of each slot to
  match how a real CNC end-mill cuts (avoids stress risers).
- **`through_wall` boolean** — if `slotDepth ≥ wall`, snap the
  effective depth to `wall + 0.01` so the slot is exactly through-wall
  with no clipping anomaly.

## References

- Related: `slotted_tube` (multi-row + phase), `grooved_cylinder`
  (circumferential grooves on OD instead of axial slots).
