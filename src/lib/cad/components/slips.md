# slips — Segmented Gripping Ring (Packer / Anchor Slips)

## What this represents

The **slip assembly** of a packer, bridge plug, or tubing anchor — the
ring of segmented metal wedges that bite into the casing wall to hold
the tool in position against pressure differential and axial load.

Real-world geometry:
- **Slip body** — a tubular ring split into circumferential **sectors**
  (typically 6) so it can flare outward when forced up the setting
  cone.
- **Sawtooth grooves (wickers)** on the outer face — the teeth that
  bite into the casing ID. Real slips have 8-15 wickers depending on
  H₂S service and casing grade.
- **Axial splits** between sectors so they can spread apart. The
  splits start either from the top or bottom — see `splitStart` below.
- **Smooth band** at one end with no grooves — the area that rides on
  the setting cone or stop ring.

Used in:
- Production packers (HHC, Retrievable, Mechanical Set)
- Bridge plugs
- Tubing anchors / latches
- Whipstock anchors (one-shot slips)

## Coordinate convention

Z-down. The slip body is centered at z=0 like other tubes (length/2
above, length/2 below).

- **Smooth band** (no grooves) sits at the bottom (`z = bandH`)
- **Groove band** stretches up from `bandH` for `grooveBandLength`
- **Splits** anchor either at top or bottom based on `splitStart`

## Composition

1. Base `tube(slipR, bodyR, height)` — the slip ring blank
2. **Smooth band cutout** — if `smoothBand > 0`, subtract a thin tube
   at the bottom to leave a slick band (the cone-ride surface)
3. **Sector splits** — for each of `numSectors`, subtract a rotated
   `M.cube` that spans the full diameter, with `splitWidth` thickness
   and `height * splitLengthPct` axial length. Anchored at top or
   bottom based on `splitStart >= 0.5`.
4. **Sawtooth grooves** — loop over `numGrooves`, each groove is a
   ring of metal removed by subtracting `(cutOuter - keep)`:
   - `cutOuter = cyl(cutH, slipR + 0.5, slipR + 0.5)` — outer solid
   - `keep = cyl(cutH + 0.01, slipR, slipR - grooveDepth)` — protected
     bite tip
   - net: removes the *valley* of each tooth, leaving sharp wickers

The `grooveBandLength` parameter constrains the total Z extent of the
groove pattern, independent of `height`. This is the wicker zone.

## Parameters

| Param              | Default | Range          | Meaning                                  |
|--------------------|---------|----------------|------------------------------------------|
| `slipOD`           | 2.4 in  | 1.0 .. 6.0     | Slip OD when running (against the cone)  |
| `bodyOD`           | 2.0 in  | 0.5 .. 4.0     | Inner mandrel / body OD                  |
| `height`           | 2.0 in  | 0.5 .. 4.0     | Total slip height                        |
| `numSectors`       | 6       | 2 .. 8         | Sector count (splits around the ring)    |
| `numGrooves`       | 10      | 4 .. 20        | Wicker / tooth count                     |
| `grooveDepth`      | 0.08 in | 0.02 .. 0.15   | Tooth depth (radial)                     |
| `grooveLengthPct`  | 0.85    | 0.1 .. 1.0     | Per-groove axial coverage % within band  |
| `grooveBandLength` | 1.2 in  | 0.1 .. 4.0     | Total Z extent of the groove pattern     |
| `splitWidth`       | 0.05 in | 0.05 .. 0.3    | Width of each sector split (gap)         |
| `splitLengthPct`   | 0.75    | 0.05 .. 1.0    | Split axial length, fraction of height   |
| `splitStart`       | 1 (top) | 0/1            | 0=bottom, 1=top (choices lookup)         |
| `smoothBand`       | 0.1     | 0 .. 0.3       | Smooth-band length, fraction of height   |

### `splitStart` choices

| Value | Label  | Meaning                                                     |
|-------|--------|-------------------------------------------------------------|
| 0     | bottom | Splits open from the bottom (slips fan upward) — pull style |
| 1     | top    | Splits open from the top (slips fan downward) — push style  |

## Vocabulary

This primitive went through a significant **vocabulary cleanup** —
the previous param names were generic. Don't drift back to them:

| Old name             | New name              | Why                                       |
|----------------------|-----------------------|-------------------------------------------|
| `gapWidth`           | `splitWidth`          | Vendor catalogs say "split", not "gap"    |
| `gapLengthPct`       | `splitLengthPct`      | Same                                      |
| `grooveLength`       | `grooveBandLength`    | "Band" makes the Z-axis extent explicit   |
| `cutRegion`          | (replaced by band)    | "Cut" is too generic for a wicker zone    |

Industry terms to know:
- **Wicker** — slang for a single sawtooth groove/tooth.
- **Bite** — the act of digging into the casing.
- **Setting cone** / **release cone** — the matched cone the slips ride
  up/down to flare or relax.
- **Hold-down** — slip type for upward force.
- **Anchor** — slip type for both directions.

## Geometry contract for AI refinement

- `M.cube([slipOD + 1, splitWidth, splitH], true)` — the split cutter
  must be CENTERED (`true`) and at least `slipOD + 1` in diameter to
  pass through both walls. Don't tighten this.
- Groove pattern uses `cutOuter.subtract(keep)` — a "valley removal"
  shape. Preserve this two-cyl pattern; it's what gives the wickers
  their sharp triangular profile under Manifold's tolerance.
- `splitStart` is a discrete choice (`choices: { bottom: 0, top: 1 }`)
  — the geom branches on `splitStart >= 0.5`. Preserve the branch;
  the choices schema lets the Inspector render a dropdown instead of
  a meaningless 0..1 slider.

## Validation rules

No `meta.validate` today. Reasonable rules to add:
- `slipOD <= bodyOD` → "slip OD must be > body OD"
- `grooveBandLength + smoothBand*height > height` → "groove band +
  smooth band exceeds slip height"
- `numSectors < 2` → "at least 2 sectors required"

## Planned features (out of scope today)

- **Wicker profile** — today the wickers are triangular (cyl-from-cyl
  subtract). Real slips often have asymmetric teeth that resist load
  in one direction. Expose a "tooth rake angle" slider.
- **Material hardness preset** — H₂S sour service uses 13Cr slips;
  display the corresponding wicker depth/spacing recommendation.
- **Set / unset animation** — angular spread of sectors as a function
  of axial position on the setting cone.
- **Pump-around port** — small radial port at the smooth band for
  pressure equalization.

## References

- Always paired with: `taper` (the setting cone the slips ride up),
  `packer_element` (the rubber that seals once the slips are set).
- Field reference: Halliburton HHC Packer specs; the production-packer
  recipe in `docs/assemblies/` (when it lands).
