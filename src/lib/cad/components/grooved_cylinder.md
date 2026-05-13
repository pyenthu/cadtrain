# grooved_cylinder — External Circumferential Grooves (Seal / Snap-Ring / Landing Nipple)

## What this represents

A tube with **circumferential grooves cut into the OD** — the primitive
behind:

- **O-ring / packoff seal grooves** on hangers, plugs, and seal sub
  outer surfaces.
- **Snap-ring grooves** for lock rings holding two stacked components.
- **Profile nipples / landing nipples** — the internal grooves a
  plug's keys engage with. (For internal grooves, use this primitive
  with the recognition that "OD" in the schema corresponds to "ID" of
  a downhole nipple — or compose with a tube whose bore matches.)

Grooves are *circumferential* (around the body), not *axial* (along
the length, which is `slotted_*`). Don't confuse them.

## Coordinate convention

Z-down. The base tube is centered at z=0. Grooves are placed at
`p.length * (i+1) / (numGrooves + 1)` along Z — evenly spaced inside
the length, with end-padding so the first and last groove aren't
flush with the tube ends.

## Composition

1. Base `tube(od/2, id/2, length)` from `../manifold-helpers`
2. For each of `numGrooves`: subtract a thin annular cutter — a tube
   from `od/2 + 0.01` (just outside the OD) to `od/2 - grooveDepth`,
   height 0.06"

The fixed 0.06" groove height is intentional — typical O-ring grooves
are 1/16" wide and the primitive currently exposes only depth, not
width. See Planned features for the future `grooveWidth` slider.

## Parameters

| Param         | Default | Range          | Meaning                              |
|---------------|---------|----------------|--------------------------------------|
| `od`          | 2.5 in  | 0.5 .. 6.0     | Outer diameter                       |
| `wall`        | 0.3 in  | 0.1 .. 1.0     | Wall thickness                       |
| `length`      | 3.0 in  | 1.0 .. 8.0     | Axial length                         |
| `numGrooves`  | 4       | 1 .. 12        | Groove count, evenly distributed     |
| `grooveDepth` | 0.08 in | 0.02 .. 0.15   | Radial depth from OD inward          |

## Vocabulary

- *Groove* — universal. Don't rename.
- O-ring sizing: a #-218 O-ring (typical 2-7/8" tubing) has a
  cross-section of ~0.139" → groove depth ~0.11", groove width ~0.18".
  Today's primitive uses 0.06" fixed groove height, which is narrower
  than real spec.

## Geometry contract for AI refinement

- Grooves are subtractive `tube()` cutters, NOT cross-section sweeps.
- Outer radius of the cutter is `od/2 + 0.01` (overshoot) — preserve.
- Don't replace the loop with a single combined cutter; per-groove
  subtraction lets each be repositioned independently if `numGrooves`
  becomes irregular.

## Planned features (out of scope today)

- **`grooveWidth` slider** — today the groove width is fixed at 0.06".
  Real seal grooves are ~0.18" wide for #-218 O-rings.
- **Groove profile** — square vs trapezoidal vs round. The primitive
  models a square groove; trapezoidal would model a snap-ring groove
  more accurately.
- **`groovePositions` array** — instead of even spacing, allow explicit
  per-groove Z positions. Useful for asymmetric profiles (e.g. seal
  groove + retainer groove at different Z's).
- **Internal grooves variant** — flip the cutter to cut from the bore
  outward for profile-nipple modelling.

## References

- Related: `seal_bore` (internal grooves + cone + pin; composite),
  `slips` (axial-rather-than-circumferential grooves on OD).
