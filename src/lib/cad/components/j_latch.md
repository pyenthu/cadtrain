# j_latch — J-Slot Profile (Ratch-Latch / Lock Mandrel)

## What this represents

A **J-slot mechanism** — the lock/unlock rotary interlock used to
engage and release running tools, pulling tools, and lock mandrels.
The profile resembles the letter "J": a vertical slot leading down to
a perpendicular foot.

Real-world parts modeled by this primitive:
- **J-slot running tool** — the OD profile that a sleeve runs in/out
  of when rotating the workstring.
- **Ratch-latch receiving head** — the female side that catches a
  pin running in a J-slot path.
- **Lock mandrel locator** — the location-finder profile inside a
  landing nipple, picked up by a rotation when the assembly bottoms.

The motion is: **down → rotate → up** to engage, **down → rotate
the other way → up** to release. The J-slot enforces this sequence
mechanically.

## Coordinate convention

Z-down. The body is centered at z=0. Each J-slot has:
- A **vertical leg** (the down-track) sized
  `slotWidth × slotDepth × (length * 0.6)`, centered at the upper
  part of the body (`length * 0.4` offset)
- A **horizontal foot** (the rotation track) sized
  `(slotWidth * 2) × slotDepth × slotWidth`, anchored at the lower
  part of the body (`length * 0.1` offset)

The foot extends in the `+X` direction relative to the leg (the
`p.slotWidth * 0.5` offset puts it half a slot-width over from the
leg axis). Multiple J-slots are phased evenly around Z by
`i * (360 / numSlots)`.

## Composition

1. Base `tube(od/2, id/2, length)` from `../manifold-helpers`
2. For each of `numSlots`:
   - **Vertical leg** — `M.cube([slotWidth, slotDepth, length*0.6], true)`,
     centered, translated outward to `(od/2 - slotDepth/2)` in +Y so it
     cuts inward from the OD, lifted to `length * 0.4` in Z.
   - **Horizontal foot** — `M.cube([slotWidth*2, slotDepth, slotWidth], true)`,
     translated by `slotWidth*0.5` in +X (offset from leg axis) and
     `length*0.1` in +Z (the rotation track sits low).
   - Both cubes rotated by `i * (360/numSlots)` around Z to phase
     around the body.

## Parameters

| Param        | Default | Range         | Meaning                              |
|--------------|---------|---------------|--------------------------------------|
| `od`         | 2.2 in  | 0.5 .. 4.0    | Outer diameter                       |
| `wall`       | 0.3 in  | 0.1 .. 0.8    | Wall thickness                       |
| `length`     | 1.5 in  | 0.5 .. 3.0    | Axial length                         |
| `slotWidth`  | 0.15 in | 0.05 .. 0.3   | Width of the J-slot path             |
| `slotDepth`  | 0.25 in | 0.1 .. 0.5    | Radial depth (penetration into wall) |
| `numSlots`   | 2       | 1 .. 4        | J-slot count (always 1, 2, or 4)     |

`numSlots = 2` is the common case — diametrically opposed J-slots
balance the side load on the rotation pin. `numSlots = 1` is used for
keyed running tools where orientation matters.

## Vocabulary

- **J-slot** — universal field term. Don't rename.
- **Running tool / lock mandrel** — the male part that locks into the
  J-slot.
- **Foot** / **toe** — the horizontal section of the J at the bottom.
- **Leg** / **vertical track** — the axial section of the J.
- **Latch** vs **lock** — a *latch* unlocks automatically when
  pulled with enough force; a *lock* requires the reverse-rotation
  sequence to disengage. The J-slot supports either depending on how
  the pin is captured at the foot.

## Geometry contract for AI refinement

- Vertical leg and horizontal foot are **separate `M.cube` subtractions**
  — preserve the two-cube pattern. Joining them into one polygon
  cutter is possible but harder to phase and parametrize.
- Both cube cutters are centered (`true` flag on `M.cube`) — preserve.
- Rotation order matters: translate to OD outward first, THEN rotate
  around Z. Reversing the order rotates the cutter around the body
  centerline incorrectly.

## Validation rules

No `meta.validate` today. Reasonable rules to add:
- `wall * 2 >= od` → "wall too thick"
- `slotDepth >= wall` → warning: "slot is through-wall" (might be
  intentional, but worth surfacing)
- `slotWidth * 2 + slotWidth*0.5 + slotDepth > od` → "J-slot footprint
  exceeds body" (catches degenerate sizing)

## Planned features (out of scope today)

- **Foot direction toggle** — today the foot extends in +X (clockwise
  rotation engages). Add a `direction: cw|ccw` choice.
- **Foot length** — separate from `slotWidth*2`; some J-slot designs
  have a longer rotation track so the rotation tolerance is wider.
- **No-go shoulder at the foot** — a small step at the end of the
  foot to positively lock the pin. Today the foot is a plain slot.
- **Double-J** — a stacked J-slot for two-stage lock (first lock
  prepares, second lock fires). Common in firing-head tools.

## References

- Field reference: HAL ratch-latch receiving head (modeled separately
  at `/archive/tools/ratch-latch`); the J-slot geometry here is the
  generic primitive that underlies that and many other tools.
- Related: `grooved_cylinder` (circumferential, not J-shaped).
