# window_cutout — Pre-Milled Window in Casing (Multilateral Lateral Exit)

## What this represents

A **pre-milled window** in a casing joint — the lateral exit point for
a multilateral well. Used at the junction where a horizontal or
deviated lateral departs from the parent (main) wellbore.

Multilateral classification (per TAML — Technology Advancement of
Multi-Laterals):
- **Level 1**: Open hole, no junction
- **Level 2**: Cased main, open lateral
- **Level 3+**: Junction support increasing in complexity (window
  + liner, hangoff, sealing).

This primitive models the **window itself** — a rectangular cutout
through one wall of a casing joint, leaving the other wall intact.

Pair with a `whipstock` (the deflection tool that ramps the BHA into
the casing wall during milling) to model a full mill-and-set operation.

## Coordinate convention

Z-down. The casing joint is centered at z=0. The window cuts through
ONE wall (cube cutter dimensioned `od * 1.2` in Y, so it passes
through the +Y wall fully but doesn't reach the -Y wall when properly
sized).

- Window vertical extent: z = `windowOffset .. windowOffset + windowHeight`
  (measured from the build origin — the user controls where along the
  joint the window sits).
- Window circumferential extent: `windowWidth` (the cube's X
  dimension) — this is the arc length on the casing OD where the
  window opens.

## Composition

1. `body = tube(od/2, id/2, length)` — the casing joint
2. `cut = M.cube([windowWidth, od * 1.2, windowHeight], true)` —
   rectangular cutter, CENTERED. The Y dimension (`od * 1.2`) is
   intentionally oversize so the cutter passes through the +Y wall
   entirely; the -Y wall is protected because the cube doesn't reach
   that far (it's centered, so it only goes `0.6 * od` past origin).
3. Translate cutter by `[0, 0, windowOffset + windowHeight/2]` to
   put its center at the user-specified Z.
4. `body.subtract(cut)` — leaves the joint with a rectangular hole
   on one side.

Note: the cutter is centered, so half of it sits below the joint
origin. Since `od * 1.2 / 2 > od/2`, the cube extends past the OD on
both sides (+Y all the way through, -Y past origin but stops before
the far wall). Net: one wall is cut, the other isn't.

## Parameters

| Param          | Default | Range       | Meaning                                |
|----------------|---------|-------------|----------------------------------------|
| `od`           | 7.0 in  | 4 .. 14     | Casing OD (7" default — common)        |
| `wall`         | 0.4 in  | 0.2 .. 1.0  | Casing wall thickness                  |
| `length`       | 5.0 in  | 3 .. 8      | Joint length                           |
| `windowWidth`  | 2.0 in  | 0.5 .. 4    | Window circumferential width           |
| `windowHeight` | 3.0 in  | 1 .. 5      | Window axial height (along the joint)  |
| `windowOffset` | 1.0 in  | 0.5 .. 5    | Z offset of the bottom of the window   |

Default `7" OD × 5" length × 2" × 3" window @ 1" offset` is a typical
short window sub for laboratory or demonstration; real downhole
windows in 7" casing are usually 4-8" wide × 12-30" tall.

## Vocabulary

- **Window** — universal field term for the lateral exit.
- **TAML levels** — see top. The Technology Advancement of Multi-
  Laterals classification system is the standard.
- **Whipstock** = the deflection tool that's set on top of the window
  before milling, ramping the cutting tool to the casing wall.
- **Lateral** = the secondary wellbore branching off through the
  window.
- **Junction** = the geometric meeting point of main and lateral
  wellbores at the window depth.

## Geometry contract for AI refinement

- The cutter Y dimension `od * 1.2` is intentional — it overshoots the
  +Y wall (cut through) but doesn't reach the -Y wall (protected).
  Don't reduce below `od` or the cut won't reliably pass through the
  wall under Manifold's tolerance. Don't increase past `od * 2.0` or
  both walls get cut.
- Cutter is centered (`M.cube([…], true)`) — preserve. Translation
  formula `windowOffset + windowHeight/2` puts the cube CENTER at
  the user-specified mid-window Z; subtracting `windowHeight/2`
  gives the bottom edge at `windowOffset`.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `windowOffset + windowHeight > length` → "window overflows joint"
- `windowWidth > od` → "window width exceeds joint OD"
- `windowHeight <= 0 || windowWidth <= 0` → "window must have positive
  extent"

## Planned features (out of scope today)

- **Window orientation slider** — today the window always cuts in
  the +Y direction. Add a rotation slider for arbitrary azimuth.
- **Pre-installed liner stub** in the window — a 7" cased main with
  the lateral liner partially exposed in the window opening. The
  next-tier modeling (TAML level 3+).
- **Beveled window edges** — real pre-milled windows have chamfered
  edges to prevent BHA hangup during lateral entry.
- **Multiple windows** — for multi-lateral assemblies with N lateral
  branches at staggered depths.

## References

- Pair with: `whipstock` (the ramp tool that deflects the BHA into
  the window during milling).
- Field reference: Halliburton "Pre-Milled Lateral Window Sub"
  catalog page — typical dimensions for 7" casing windows.
- TAML reference: https://www.spe.org/en/disciplines/drilling/
  (multilateral classification).
