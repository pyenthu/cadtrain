# sliding_sleeve — Sliding-Sleeve Valve Mandrel (ICV / Circulating Valve Body)

## What this represents

The **mandrel body** of a sliding-sleeve valve — a hollow tube with
**axial ports** (radial cutouts in the wall) and **polished seal bores**
at each end. The matching internal sleeve (not modeled here) slides
up or down to **open or close the ports** by exposing or covering them.

Common downhole tools that use this primitive:
- **Interval Control Valve (ICV)** — HS-ICV (Halliburton), MCC-ICV
  (Baker Hughes), iCAS (Schlumberger). Operator-controlled valves for
  zonal isolation in multi-zone completions.
- **Circulating valve** — opens to allow workover fluid circulation
  between tubing and annulus.
- **Sliding side door (SSD)** — older mechanical version of an ICV,
  shifted with wireline tools.

This primitive is the **outer body / port shell**. The internal sleeve
that slides to cover/uncover the ports is a separate piece in the
real-world assembly (and would be its own primitive when modeled).

## Coordinate convention

Z-down. The base tube is centered at z=0 (length/2 above and below).
Ports are placed at the middle (z = length/2). Seal bores are placed
at the TOP (z = sealBoreHeight/2) and BOTTOM (z = length - sealBoreHeight*1.5).

## Composition

1. `body = tube(od/2, id/2, length)` — the mandrel.
2. **Ports** — loop `numPorts` times: a `M.cube([od*1.2, portWidth,
   portHeight], true)` cutter, centered, rotated by `i * 360/numPorts`
   around Z, translated to `[0, 0, length/2]`. The cube's X dimension
   `od*1.2` is oversize so the cutter passes fully through both walls
   — these are *radial through-ports*, not blind slots. Phased evenly
   around the circumference.
3. **Top seal bore** — `tube(id/2 + sealBoreDepth, id/2 - 0.01,
   sealBoreHeight)` subtracted from inside the bore at the top end.
   This is an *internal counterbore* — widens the bore by
   `sealBoreDepth` for `sealBoreHeight` distance, creating a polished
   surface for the sliding-sleeve seals to ride against.
4. **Bottom seal bore** — same shape, positioned at the bottom end.

The two seal bores at top and bottom are what define the *travel*
range of the sliding sleeve: the sleeve can move between them while
maintaining seals.

## Parameters

| Param            | Default | Range        | Meaning                                  |
|------------------|---------|--------------|------------------------------------------|
| `od`             | 3.5 in  | 2 .. 8       | Outer diameter                           |
| `wall`           | 0.4 in  | 0.2 .. 1.0   | Wall thickness                           |
| `length`         | 5.0 in  | 3 .. 10      | Axial length                             |
| `numPorts`       | 4       | 1 .. 8       | Port count, evenly phased around Z       |
| `portWidth`      | 0.4 in  | 0.1 .. 1.0   | Port circumferential width               |
| `portHeight`     | 0.8 in  | 0.3 .. 2     | Port axial height                        |
| `sealBoreDepth`  | 0.06 in | 0.02 .. 0.15 | Seal-bore counterbore depth (radial)     |
| `sealBoreHeight` | 0.5 in  | 0.2 .. 1.0   | Seal-bore counterbore length (axial)     |

Default `3.5" OD × 5" length × 4 ports` ≈ a typical 3-1/2" tubing
sliding-sleeve sub.

## Vocabulary

- **ICV** = Interval Control Valve. Operator-controlled (hydraulic or
  electric line) version of a sliding sleeve.
- **SSD** = Sliding Side Door. Older mechanical version, shifted with
  a B-shifting tool on wireline.
- **Ports** = the radial through-holes in the body wall. When the
  inner sleeve covers them, the valve is *closed*; when uncovered,
  it's *open*.
- **Seal bore** = the polished internal cylindrical surface where the
  sliding sleeve's elastomer seals ride. Different from the
  full-component `seal_bore` primitive (that one is a complete PBR
  assembly; this is the *feature* embedded in the sliding-sleeve
  mandrel).
- **Mandrel** = the outer body of a sliding-sleeve assembly. The
  inner sliding piece is the **sleeve** (or **shifting sleeve**).

## Geometry contract for AI refinement

- Port cutter X-dimension `od * 1.2` is intentional — overshoots BOTH
  walls so ports are truly radial through-cuts. Don't reduce — the
  cube must span the full diameter, not just one wall.
- Seal bores are TUBE cuts (annular cutters from inner-bore-plus-depth
  to inner-bore-minus-overshoot), not cube cuts. This is what makes
  them counterbores instead of holes.
- Top seal bore positioned at `[0, 0, sealBoreHeight/2]` (top of the
  bore is at z=0, since the base tube is centered). Bottom at
  `[0, 0, length - sealBoreHeight * 1.5]` — the `1.5×` keeps a small
  gap between the bottom seal bore and the bottom face for the sleeve's
  end-stop. Preserve.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `wall * 2 >= od` → "wall too thick — bore collapses"
- `numPorts * portWidth > od * π` → "ports overlap circumferentially"
- `2 * sealBoreHeight + portHeight > length` → "seal bores + port
  height overflows tube"
- `sealBoreDepth >= wall` → "seal bore eats through wall"

## Planned features (out of scope today)

- **Sleeve modeling** — the inner sliding piece. Today only the body
  is geometric.
- **Port position slider** — currently fixed at z=length/2. Letting
  the user move the port band (or have multiple bands) would model
  multi-position ICVs.
- **Indicator profile** — internal landing nipple at the bottom for
  positioning indicators / open-close confirmation.
- **Wireline / hydraulic actuator type** — choice between SSD-style
  shifting profile and hydraulic-control-line passage.
- **Number of inflow control devices (ICDs)** — for ICV variants that
  have inline ICD inserts.

## References

- Field reference: Halliburton HS-ICV, Schlumberger TRFC-HM, Baker
  Hughes IsoBar.
- Related: `seal_bore` (separate PBR primitive with cone + pin —
  the *standalone* version of this primitive's seal-bore feature).
- Domain context: sliding sleeves are the canonical Flow Control
  family primitive (FAMILY_BY_ID maps it there).
