# shoulder — Step (Landing Shoulder / Stop Ring / Upset)

## What this represents

An abrupt diameter change between two coaxial cylindrical sections —
the geometric primitive behind every **landing shoulder**, **stop
ring**, **bearing face**, or **API upset**. The step provides a
positive surface for the part above to rest against (or the part below
to push against) when the assembly is run in compression.

Examples in the field:
- Tubing hanger seats on the wellhead spool's landing shoulder.
- A no-go nipple's internal shoulder catches the matched profile of a
  plug.
- An upset on a pipe end where the box OD is larger than the body OD.

When the transition is smooth instead of abrupt, use `taper`. When it's
fully formed into a male/female pipe connection, use `enhanced_box` or
`threaded_pin_collared`.

## Coordinate convention

Z-down. The small section sits at the top (z=0 .. smallLength) and the
large section below it (z=smallLength+taperH .. smallLength+taperH+
largeLength). Optional taper sits in between.

If you need the large section ON TOP instead of the small one (e.g. a
hanger sitting *down on* a landing shoulder), build the same shoulder
upside down by swapping `odSmall`/`odLarge` and the lengths.

## Composition

Three sub-pieces joined with `.add()`:

1. **Small section** — `tube(odSmall/2, idSmall/2, smallLength)` at top
2. **Transition** — when `taperH > 0.01`, an annular cone bridging
   small→large; when `taperH == 0`, the step is mathematically abrupt
   (zero-length transition).
3. **Large section** — `tube(odLarge/2, idLarge/2, largeLength)` below

The transition uses `cyl().subtract(cyl())` to keep the bore continuous
through the step. A `+0.02"` overshoot on the inner cone closes the
CSG cleanly.

## Parameters

| Param          | Default | Range         | Meaning                                     |
|----------------|---------|---------------|---------------------------------------------|
| `odSmall`      | 2.0 in  | 0.5 .. 4.0    | OD of the upper (small) section             |
| `odLarge`      | 3.0 in  | 1.0 .. 6.0    | OD of the lower (large) section             |
| `wall`         | 0.3 in  | 0.1 .. 1.0    | Wall thickness, applied to both sections    |
| `smallLength`  | 3.0 in  | 0.5 .. 6.0    | Length of the small section                 |
| `largeLength`  | 2.0 in  | 0.5 .. 6.0    | Length of the large section                 |
| `taperH`       | 0.15 in | 0 .. 0.5      | Optional fillet height; 0 = perfectly square|

`taperH` between 0 and 0.5" lets the user fillet a sharp shoulder for
stress relief without losing the bearing function.

## Vocabulary

- *Shoulder* is the universal field term. Don't rename.
- *Step* is fine in tags but feels machinist. *Bearing face* and
  *landing shoulder* are application-specific synonyms in the tag list.

## Geometry contract for AI refinement

- Three sections must remain UNIONED, not subtracted from a single OD
  block — keeping them additive preserves edge classification (red OD
  / grey bore) per the project's vertex-color convention.
- `taperH < 0.01"` short-circuits to a single step (no transition cone)
  — preserve this branch; some assemblies depend on a literal step.

## Planned features (out of scope today)

- **Asymmetric wall** — separate small/large wall thicknesses. Today
  both use a single `wall` slider; some real shoulders thin the wall
  on the bigger end to keep weight down.
- **Annular relief groove** — a small undercut at the step OD where
  the part above lands. Reduces stress concentration.

## References

- Used in: every assembly with a landing surface (tubing hanger spool
  stack, tubing-anchor sub, profile nipple).
