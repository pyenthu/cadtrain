# taper — Generic Cone Transition (Setting / Release Cone)

## What this represents

A smooth-walled hollow cone that transitions from one OD to another over
some axial length. Two distinct real-world uses, same geometry:

1. **Crossover / swage** — diameter step between two pipe sizes in a
   workstring (e.g. 4-1/2" drill pipe to 3-1/2" HWDP via a tapered sub).
2. **Setting / release cone** in a packer or anchor — the inclined ramp
   the slips ride up to expand outward and bite the casing. Also called
   a *wedge*.

If the part is the *upset transition between a pipe body and its
connection* — i.e. the geometry between body OD and box/pin OD on a
tool joint — use `tapered_cone` instead (constant wall, hollow). Use
`taper` when both ends are user-set and the part is generic.

## Coordinate convention

Z-down. `cyl(length, odTop/2, odBottom/2)` puts odTop at z=0 (top) and
odBottom at z=length (bottom). The bore is the same cone, inset by
`wall`, with a 0.01" overshoot at each end so the CSG subtract leaves
no hair-thin closing surfaces.

## Composition

Two `cyl()` cones, outer minus inner. The bore is shifted by `-0.01"`
in Z so the subtract overshoots both ends.

## Parameters

| Param      | Default | Range       | Meaning                                |
|------------|---------|-------------|----------------------------------------|
| `odTop`    | 2.0 in  | 0.5 .. 6.0  | OD at the top (z=0)                    |
| `odBottom` | 3.0 in  | 0.5 .. 6.0  | OD at the bottom (z=length)            |
| `wall`     | 0.3 in  | 0.05 .. 1.0 | Wall thickness, constant along length  |
| `length`   | 0.8 in  | 0.2 .. 4.0  | Axial length of the transition         |

Default is wider-at-bottom (3" → 2" if read top-to-bottom is misleading;
treat the slider direction as physical *odTop is the upper face*).

## Vocabulary

- *Cone* in petroleum slang almost always means the setting cone of a
  packer. *Swage* and *crossover* are the generic terms for a pipe-size
  transition.
- `taper` is OK as a primitive name because the tag list covers all the
  real-world synonyms. Don't rename the param `odTop`/`odBottom` — they
  match the Z-down geometry directly.

## Geometry contract for AI refinement

- `cyl(h, r1, r2)` (NOT two stacked tubes) — `cyl` is the only helper
  that draws a true tapered cylinder; replacing it with discrete
  segments breaks the SVG outline export.
- Bore overshoot stays at `0.4"` total (`OS = 0.4` in the file) — see
  `tapered_cone.ts` for the matching pattern.

## Planned features (out of scope today)

- **Mating-cone constraint** — when used as a packer setting cone, the
  bottom OD should snap to the casing drift ID; expose a "casing class"
  dropdown that auto-fills.
- **Cone angle readout** — derived `atan2((odBottom-odTop)/2, length)`
  in degrees. Useful for matching packer specs (most slips are 30°/45°).

## References

- Assembly: `docs/assemblies/tubing_hanger_spool_stack.md` — the
  hanger landing taper uses this primitive.
- Related: `tapered_cone` (constant-wall connection upset), `shoulder`
  (abrupt step, not smooth).
