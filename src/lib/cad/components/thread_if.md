# thread_if — Internal Flush (IF) Drill-String Connection

## What this represents

The **Internal Flush (IF)** drill-string connection — one of three
classic API rotary-shouldered thread forms used on drill pipe and
small drill collars. The defining feature: **constant bore ID through
the body AND the pin** so there is no flow-area restriction at the
connection (mud/cuttings move through without choking).

Sizes referenced by drill-pipe nominal OD: 2-3/8 IF, 2-7/8 IF, 3-1/2 IF,
4 IF, 4-1/2 IF, 5-1/2 IF. The IF designation pairs with a specific
thread profile (TPI, taper) per API RP 7G.

Compared to siblings:
- `thread_fh` (Full Hole) — slightly larger bore, moderate upset, used
  on drill collars.
- `thread_nc` (Numbered Connection) — heavy-duty, wide shoulder, thick
  wall (BHA / collar-grade).

## Coordinate convention

Z-down. Stack:
- z=0 .. bodyLength → body (no threads, just OD `bodyOD`)
- z=bodyLength .. +pinLength → pin section with threads (OD `pinOD`)

Body and pin share the same bore ID `(bodyOD - 2*wall)`. There's no
upset transition — the pin is just a smaller-OD continuation; the
shoulder where body OD meets pin OD acts as the torque shoulder.

## Composition

1. `body = tube(bodyOD/2, id/2, bodyLength)` — straight body section
2. `pin = tube(pinOD/2, id/2, pinLength)` translated to `[0, 0, bodyLength]`
3. **Threads** — loop `threadCount` times, subtract a thin tube
   (height 0.03") at evenly-spaced Z positions along the pin

No taper transition is modeled — the IF connection's geometry is "thick
body to thin pin" with a square shoulder between. Real IF has a slight
chamfer at the body-to-pin step; future feature.

## Parameters

| Param         | Default | Range        | Meaning                              |
|---------------|---------|--------------|--------------------------------------|
| `bodyOD`      | 3.2 in  | 1 .. 6       | Drill-pipe body OD                   |
| `pinOD`       | 3.0 in  | 0.8 .. 5     | Pin OD (smaller than body — no upset)|
| `wall`        | 0.3 in  | 0.1 .. 1.0   | Wall thickness                       |
| `bodyLength`  | 3.5 in  | 1 .. 8       | Body length                          |
| `pinLength`   | 2.5 in  | 0.5 .. 4     | Pin length                           |
| `threadCount` | 14      | 4 .. 20      | Thread count (IF has many fine threads)|
| `threadDepth` | 0.05 in | 0.02 .. 0.10 | Thread depth                         |

Default `3.2" / 3.0"` ≈ a 4-1/2 IF connection at common drill-pipe
sizing.

## Vocabulary

- **IF** = Internal Flush. The "flush" refers to the BORE being
  unobstructed at the connection.
- **Rotary-shouldered** = the family of API drill-pipe connections
  with a torque shoulder (vs. casing threads which seal on thread
  taper alone). IF, FH, NC are all rotary-shouldered.
- **API RP 7G** = the spec governing these threads.
- **Tool joint** = the upset section of drill pipe where threads are
  cut. See `drill_pipe_tool_joint` for the tool-joint primitive with
  identification markings.

## Geometry contract for AI refinement

- Constant bore is the defining feature — preserve `id = bodyOD - 2*wall`
  on BOTH body and pin. Don't introduce a separate `pinID`.
- Body and pin are separate `tube()` calls unioned via `.add()` —
  preserve so the SVG export reads them as distinct geometry pieces.
- The square shoulder at z=bodyLength is geometrically implicit (the
  OD step). Don't add an explicit shoulder primitive — see
  `thread_fh` and `thread_nc` for connections that DO model the
  shoulder explicitly.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `pinOD >= bodyOD` → "pin OD must be < body OD (IF has a smaller pin)"
- `wall * 2 >= pinOD` → "wall too thick — pin bore collapses"

## Planned features (out of scope today)

- **IF size dropdown** — 2-3/8 IF / 2-7/8 IF / 3-1/2 IF / 4 IF /
  4-1/2 IF / 5-1/2 IF, picking matched body/pin OD pairs.
- **Lead-in chamfer** at the pin tip — eases stabbing.
- **Bore taper** — IF technically tapers slightly in the make-up
  region; today it's straight.
- **Internal thread profile** — currently representative; future
  helical via NL→ManifoldCAD track.

## References

- Related: `thread_fh` (FH — bigger bore, drill collar), `thread_nc`
  (NC — heaviest, BHA-grade).
- KB: drill-pipe thread data should land at
  `static/kb/api/drill-pipe-specs.json` (today: empty stub).
- Spec: API RP 7G — "Recommended Practice for Drill Stem Design and
  Operating Limits."
