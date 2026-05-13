# whipstock — Angled Deflector Wedge (Multilateral / Kick-Off Tool)

## What this represents

A **whipstock** — the angled deflector that's set at the junction of a
multilateral well (or at a sidetrack point in a single-lateral well)
to ramp the milling bit (then the drill bit) off the parent wellbore
axis and into the casing wall, opening a window or initiating a
sidetrack.

Two field categories:
- **Permanent whipstock** — set on a packer and left downhole; the
  lateral is drilled past it. Common in multilateral junctions.
- **Retrievable whipstock** — fished out after the lateral is opened.

Geometry is the same primitive either way: a cylindrical body with an
angled face cut into one side (the ramp). The bit rides up the ramp,
which forces it laterally toward the casing.

Pair with `window_cutout` to model a complete window-and-set assembly.

## Coordinate convention

Z-down. The whipstock body sits at z=0..length. The ramp is cut by
subtracting a large rotated cube — the angled-face geometry that
results is the *negative* of the cut: a wedge-shaped solid with a
ramp face inclined at `arctan(rampHeight / length)` from vertical.

The ramp direction is +X (the cube is translated `od * 0.6` in +X
before subtraction), so the bit deflects toward +X when set.

## Composition

1. `body = cyl(length, od/2)` — a solid cylinder (not a tube — the
   whipstock is a SOLID wedge, not a hollow casing).
2. **Ramp cutter** — `M.cube([od*1.5, od*1.5, length*1.5], true)`
   — a large cube, centered, sized to overshoot the body in every
   dimension.
3. Compute `rampAngle = atan2(rampHeight, length) * 180/π` — convert
   the user's "ramp height" (the rise over the body length) to
   degrees of tilt about the Y axis.
4. Rotate the cube by `-rampAngle` around Y. This tips the cutter
   face so it slices the body diagonally.
5. Translate `[od*0.6, 0, length/2 + rampOffset]`. The X-offset puts
   the cube's centerline outside the body — only the angled face
   intersects, leaving the wedge.
6. `body.subtract(tilted)` — the angled face is what's left.

## Parameters

| Param        | Default | Range       | Meaning                                  |
|--------------|---------|-------------|------------------------------------------|
| `od`         | 5.0 in  | 2 .. 10     | OD of the whipstock body                 |
| `length`     | 4.0 in  | 2 .. 8      | Length of the whipstock                  |
| `rampHeight` | 2.0 in  | 0.5 .. 4    | Total rise over the ramp length (lateral |
|              |         |             | deflection at the top of the ramp)       |
| `rampOffset` | 0 in    | 0 .. 2      | Z offset to shift the ramp up/down       |

The **ramp angle** is implicit: `arctan(rampHeight / length)`. With
the defaults (`2/4 = 0.5`), the angle is 26.6° — typical for window-
milling whipstocks.

## Vocabulary

- **Whipstock** — universal field term. Other names: *deflector*,
  *kick-off tool*, *bull plug deflector*.
- **Ramp angle** = the inclination of the deflector face from
  vertical. 3°/ft is common for sidetracking; whole-window milling
  uses much steeper ramps (~30°+).
- **Kick-off** = the act of starting a deviated section of wellbore
  by deflecting the bit.
- **Window mill** = the cutting tool that ramps along the whipstock
  to open the window. Different from a regular drill bit (side-
  cutting capability).

## Geometry contract for AI refinement

- The cube cutter is `od*1.5` in every dimension — preserve the
  oversize to avoid edge artifacts when the cube tilts.
- Rotation order: rotate first (`rot([0, -rampAngle, 0])`), THEN
  translate. Reversing flips the ramp direction relative to the body.
- Negative rampAngle (sign convention): the cube tilts SUCH THAT the
  TOP of the body is OPEN (no material) and the BOTTOM is FULL — the
  bit climbs UP the ramp going DOWN the hole. Don't flip the sign.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `rampHeight > length` → "ramp angle exceeds 45° — bit cannot climb"
- `rampHeight <= 0` → "ramp height must be > 0"
- `rampOffset > length / 2` → warning: "ramp pushed off-body"

## Planned features (out of scope today)

- **Anchor system** — packer-type anchor at the bottom for setting.
  Today the whipstock is unanchored geometry.
- **Multi-side ramp** — directional drilling sometimes uses
  double-ramp whipstocks. Add `rampDirection` choice (N/E/S/W or
  arbitrary azimuth degrees).
- **Window-position indicator** — mark where on the body the bit
  contacts the casing wall, so a paired `window_cutout` can be sized
  to match.
- **Catcher / hooked top** — retrievable whipstocks have an upper
  fishing neck.

## References

- Pair with: `window_cutout` (the casing window the whipstock
  deflects into).
- Field reference: Halliburton "WhipMaster" series, Baker Hughes
  "OneTrip" lateral system.
- Related: `slips`, `packer_element` (anchor system, not modeled
  here yet).
