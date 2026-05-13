# thread_nc — Numbered Connection (NC) BHA-Grade Drill-String Joint

## What this represents

The **Numbered Connection (NC)** drill-string connection — the
heaviest-duty member of the API rotary-shouldered family. Designed for
**bottom-hole assembly (BHA)** use: drill collars, stabilizers, MWD
collars, motor adapters. The geometry sacrifices flow area for
strength: thick wall, wide torque shoulder, fewer-but-deeper threads.

The "Numbered" in NC refers to the numerical designation: NC23, NC26,
NC31, NC35, NC38, NC40, NC44, NC46, NC50, NC56, NC61, NC70, NC77. The
number is the **major-thread diameter × 10** in inches (e.g. NC50 has
a 5.0" major OD on the pin).

Compared to siblings:
- **vs IF / FH** — larger overall, thicker wall, wider shoulder,
  fewer threads per inch (8 threads default vs IF's 14).
- **vs casing connections (LTC, BTC)** — rotary-shouldered, not
  thread-sealed. NC seals on the torque shoulder; casing seals on
  thread interference.

## Coordinate convention

Z-down. Same stack as `thread_fh`:
- z=0 .. bodyLength → body (OD `bodyOD`)
- z=bodyLength .. +shoulderWidth → torque shoulder
- z=bodyLength+shoulderWidth .. +pinLength → pin with threads

## Composition

Identical pattern to `thread_fh` — just heavier defaults:
1. `tube` body
2. Add solid shoulder cylinder at body-OD
3. Subtract through-bore from the aggregate
4. Add pin tube above the shoulder
5. Subtract thin-tube thread cutters along the pin (height 0.05" —
   thicker per thread than FH/IF because NC has fewer, deeper threads)

## Parameters

| Param           | Default | Range        | Meaning                              |
|-----------------|---------|--------------|--------------------------------------|
| `bodyOD`        | 4.5 in  | 2 .. 8       | Body OD                              |
| `pinOD`         | 3.2 in  | 1 .. 6       | Pin OD                               |
| `wall`          | 0.5 in  | 0.2 .. 1.5   | Wall thickness                       |
| `bodyLength`    | 2.5 in  | 1 .. 6       | Body length                          |
| `pinLength`     | 1.5 in  | 0.5 .. 3     | Pin length                           |
| `threadCount`   | 8       | 4 .. 14      | Thread count (fewer than IF/FH)      |
| `threadDepth`   | 0.08 in | 0.03 .. 0.12 | Thread depth (deeper than IF/FH)     |
| `shoulderWidth` | 0.45 in | 0.15 .. 0.8  | Torque-shoulder thickness (widest)   |

Default `4.5" / 3.2"` ≈ NC38 (3.875 major OD, body 4-1/2" or 5"
depending on grade). Pure NC50 would be `bodyOD ≈ 6.5", pinOD = 5.0`.

## Vocabulary

- **NC** = Numbered Connection. Numbering is per API RP 7G; the number
  approximates the pin major diameter × 10.
- **BHA** = Bottom-Hole Assembly. The rotating drill collars +
  stabilizers + MWD tools just above the bit. NC connections live here.
- **API RP 7G** = the parent spec.
- **MUT** = Make-Up Torque. NC connections have the highest MUT in the
  rotary-shouldered family (often 20,000-100,000 ft-lbs).

## Geometry contract for AI refinement

- Same ADD-then-SUBTRACT shoulder pattern as `thread_fh` — preserve.
- Defaults are deliberately heavier (deeper threads, fewer of them) —
  if the user is sweeping toward NC the geom shouldn't auto-thin to
  FH-style values.
- Thread cutter height `0.05"` (vs FH's `0.04"`, IF's `0.03"`) is
  intentional — NC has more material between threads.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `pinOD >= bodyOD` → "NC has pin OD < body OD"
- `wall * 2 >= pinOD` → "wall too thick for pin"
- `shoulderWidth > pinLength` → warning
- `threadDepth >= wall` → "thread depth exceeds wall"

## Planned features (out of scope today)

- **NC size dropdown** — NC23 through NC77.
- **Make-up torque readout** — derived from threadCount × threadDepth
  × pinOD via API RP 7G tables.
- **Stress-relief features** — boreback box (counterbore at the box
  shoulder) for high-cycle fatigue applications.
- **Bore taper** — NC pins have a slight bore taper near the make-up
  shoulder for stress distribution; today the bore is straight.

## References

- Related: `thread_if`, `thread_fh` (less-heavy rotary-shouldered);
  `drill_pipe_tool_joint` (DP tool joint with NC-grade thread + grade
  identification markings).
- KB stub: `static/kb/api/drill-pipe-specs.json`.
- Spec: API RP 7G.
