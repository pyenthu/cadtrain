# drill_pipe_tool_joint — DP Tool Joint with API Identification Markings

## What this represents

A **drill-pipe tool joint** — the forged thicker section at each end of
a drill-pipe joint where the threaded connection is cut. This primitive
models the tool joint as a *plain upset tube with the API grade-
identification markings*: circumferential grooves and short axial slots
cut into the tong-area band (the middle ⅓ of the tool joint).

The markings are how the API tracks pipe grades visually in the field:
- **Grooves** in different patterns indicate steel grade (D, E, X95,
  G105, S135).
- **Wide groove** + groove count combos encode specific steel/heat-
  treat combinations.
- **Slots** (rare, but supported here) indicate special service —
  e.g. H₂S-resistant pipe.

This primitive does NOT model the threaded ends — pair with
`thread_if`, `thread_fh`, or `thread_nc` for the connection. The tool
joint here is purely the upset body with markings.

## Coordinate convention

Z-down. The tool joint is centered at z=0 (length/2 above and below).
The **tong area** — where wrench dies grip during make-up — sits in
the middle ⅓: `bandStart = length * 0.35` to `bandEnd = length * 0.65`.
That's where grooves and slots are placed.

## Composition

1. `body = tube(toolJointOD/2, id/2, length)` — the upset tube
2. **Grooves** — when `numGrooves > 0`, evenly distribute grooves in the
   tong-area band. Each groove is a thin annular cutter
   `tube(toolJointOD/2 + 0.01, toolJointOD/2 - grooveDepth, gw)` where
   `gw = grooveWidth` (or `grooveWidth * 2` when `grooveWide` is 1 —
   the API "wide groove" identification).
3. **Slots** — when `numSlots > 0`, axial slots `M.cube([slotWidth,
   toolJointOD * 1.2, slotLength], true)` cutting through one wall in
   the tong band. (Slot count is 0/1/2; rare in modern pipe.)

## Parameters

| Param           | Default  | Range         | Meaning                                  |
|-----------------|----------|---------------|------------------------------------------|
| `pipeOD`        | 5.0 in   | 2.5 .. 8      | Pipe-body OD (for context; not directly  |
|                 |          |               | used in geom — placeholder for future    |
|                 |          |               | upset/pipe transition modeling)          |
| `toolJointOD`   | 6.625 in | 3 .. 10       | Tool-joint OD (upset)                    |
| `wall`          | 0.5 in   | 0.2 .. 1.5    | Wall thickness                           |
| `length`        | 6.0 in   | 4 .. 12       | Tool joint axial length                  |
| `numGrooves`    | 1        | 0 .. 4        | Identification grooves in the tong band  |
| `numSlots`      | 0        | 0 .. 2        | Identification slots in the tong band    |
| `grooveDepth`   | 0.05 in  | 0.02 .. 0.12  | Groove depth                             |
| `grooveWidth`   | 0.2 in   | 0.1 .. 0.6    | Groove width (axial)                     |
| `grooveWide`    | 0 (off)  | 0 .. 1        | Wide-groove flag (doubles width)         |
| `slotWidth`     | 0.15 in  | 0.05 .. 0.4   | Slot width (circumferential)             |
| `slotLength`    | 0.6 in   | 0.2 .. 1.5    | Slot length (axial)                      |

Default `5.0" / 6.625"` pipe/tool-joint matches a 5" drill pipe joint
with API standard upset.

## API grade-identification table (for reference when setting params)

| Grade | Tensile (ksi) | Standard markings (per API RP 7G)                |
|-------|---------------|--------------------------------------------------|
| D     | 95            | One groove                                       |
| E     | 105           | One groove + the manufacturer's heat-color stripe |
| X95   | 95            | Two grooves                                      |
| G105  | 105           | One wide groove                                  |
| S135  | 145           | One wide groove + one regular groove             |
| Z140  | 140           | Two wide grooves                                 |
| V150  | 150           | One wide + two regular grooves                   |

User picks `numGrooves` + `grooveWide` to match the target grade visually.

## Vocabulary

- **Tool joint** = the forged thicker end of a drill-pipe joint where
  the threaded connection is cut.
- **Tong area** / **slip area** = the middle band of the tool joint
  where wrench dies / slips grip during make-up. Identification
  markings are always placed in the tong area so they survive normal
  wear on the make-up shoulders.
- **Upset** (noun) = the geometric thickening at the pipe end. Drill
  pipe is **internal-external upset** (IEU) — both bore narrows AND
  OD widens at the tool joint.
- **API grade letter** = the steel-grade designation (D, E, X, G, S, Z).

## Geometry contract for AI refinement

- Markings are confined to the `bandStart .. bandEnd` (0.35-0.65×length)
  region — preserve. This is the API-spec'd tong area.
- Wide-groove logic: `gw = grooveWide ? grooveWidth * 2 : grooveWidth`.
  Don't change the multiplier — `2×` matches the visual ratio in
  API grade tables.
- Slot Y-dimension `toolJointOD * 1.2` overshoots the +Y wall (cuts
  through) but the centered cube doesn't reach the far wall — same
  pattern as `window_cutout`.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `wall * 2 >= toolJointOD` → "wall too thick"
- `pipeOD > toolJointOD` → "pipe OD shouldn't exceed tool-joint OD"
- `numGrooves * grooveWidth > (length * 0.3)` → "marking band overflows
  tong area"

## Planned features (out of scope today)

- **Upset transition geometry** — model the taper from pipe body OD
  up to tool-joint OD at the ends of the joint. Today `pipeOD` is
  unused.
- **Grade preset dropdown** — picks `numGrooves` + `grooveWide` from
  the API table above so the user just picks "S135" and the markings
  are correct.
- **Manufacturer color stripe** — Halliburton blue, Schoeller-Bleckmann
  green, etc. — purely a visual property, surfaces in the rendered
  view as a vertex-color band.
- **Internal upset** — drill pipe is IEU (internal AND external upset);
  today only the OD upset is modeled.

## References

- Pair with: `thread_if` / `thread_fh` / `thread_nc` for the connection
  cut into the upset.
- Spec: API RP 7G § 7 (grade-identification markings).
- KB stub: `static/kb/api/drill-pipe-specs.json`.
