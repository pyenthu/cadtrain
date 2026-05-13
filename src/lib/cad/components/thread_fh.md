# thread_fh — Full Hole (FH) Drill-String Connection

## What this represents

The **Full Hole (FH)** drill-string connection — the *moderate-upset*
member of the API rotary-shouldered family. Bigger pin and matching
larger bore than IF; not as massive as NC. Common on **drill collar
to drill pipe crossovers** and on heavy-weight drill pipe (HWDP) where
torque demands are higher than standard DP but the BHA grade is overkill.

Geometry features vs siblings:
- **vs IF**: explicit **shoulder ring** between body and pin (the
  `shoulderWidth` slider). FH has visible torque shoulder geometry.
- **vs NC**: shorter shoulder, thinner wall — less mass, less torque
  capacity, but more efficient for non-extreme service.

## Coordinate convention

Z-down. Stack:
- z=0 .. bodyLength → body (OD `bodyOD`)
- z=bodyLength .. +shoulderWidth → shoulder ring (full bodyOD, narrows
  bore? — see Composition note)
- z=bodyLength+shoulderWidth .. +pinLength → pin (OD `pinOD`) with threads

## Composition

1. `body = tube(bodyOD/2, id/2, bodyLength)` — straight body
2. **Shoulder ring** — `body.add(mv(cyl(shoulderWidth, bodyOD/2), [0, 0, bodyLength]))`.
   This adds a SOLID cylinder of height `shoulderWidth` and OD `bodyOD`
   — initially the bore is filled. Then:
3. **Bore re-cut** — `body.subtract(cyl(bodyLength + shoulderWidth + 0.1, id/2))`.
   This drives the bore through the whole stack (body + shoulder),
   restoring the through-bore. Net: the shoulder is a *plate* of
   full-OD material with the bore drilled through it. That's the
   torque shoulder.
4. `pin = tube(pinOD/2, id/2, pinLength)` translated above the shoulder
5. **Threads** — loop `threadCount` times, subtract a thin tube
   (height 0.04") at evenly-spaced Z positions along the pin

The shoulder is wider than IF's implicit OD-step shoulder, but
narrower than NC's. The width is the user's tuning lever for
how much torque-bearing face is exposed.

## Parameters

| Param           | Default | Range        | Meaning                              |
|-----------------|---------|--------------|--------------------------------------|
| `bodyOD`        | 3.8 in  | 1 .. 6       | Body OD                              |
| `pinOD`         | 3.0 in  | 0.8 .. 5     | Pin OD                               |
| `wall`          | 0.4 in  | 0.15 .. 1.0  | Wall thickness                       |
| `bodyLength`    | 3.0 in  | 1 .. 8       | Body length                          |
| `pinLength`     | 1.8 in  | 0.5 .. 3     | Pin length                           |
| `threadCount`   | 10      | 4 .. 16      | Thread count                         |
| `threadDepth`   | 0.06 in | 0.02 .. 0.10 | Thread depth                         |
| `shoulderWidth` | 0.3 in  | 0.1 .. 0.6   | Torque-shoulder thickness            |

Default `3.8" / 3.0"` ≈ 4-1/2 FH at common drill-pipe sizing.

## Vocabulary

- **FH** = Full Hole. Distinct from IF (Internal Flush) — both have
  unrestricted bore, but FH has a larger pin and matching wider bore
  in the pin section.
- **Shoulder** = the flat ring of metal between body and pin OD that
  the make-up torque acts on. **Torque shoulder** is the same thing.
- **HWDP** = Heavy-Weight Drill Pipe. Often uses FH connections.
- **Crossover** = sub joining two different connection types (e.g.
  4-1/2 FH box to NC50 pin).

## Geometry contract for AI refinement

- The shoulder is built via ADD-then-SUBTRACT (add a solid cyl, then
  drill the bore through the aggregate). Preserve this pattern —
  trying to make the shoulder a `tube()` directly causes Manifold
  CSG to leave a thin film at the body/shoulder interface.
- Bore re-cut uses `cyl(bodyLength + shoulderWidth + 0.1, …)` — the
  `+0.1` overshoot ensures the bore passes cleanly through both faces.
- Threads are on the pin, NOT on the shoulder.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `pinOD > bodyOD` → "FH has pin OD < body OD"
- `wall * 2 >= pinOD` → "wall too thick for pin"
- `shoulderWidth > pinLength` → "shoulder wider than pin section is awkward"

## Planned features (out of scope today)

- **FH size dropdown** — 3-1/2 FH, 4 FH, 4-1/2 FH, 5-1/2 FH per
  API RP 7G.
- **Shoulder chamfer** — small relief at the OD edge to prevent
  damage during make-up.
- **Lead-in chamfer** at the pin tip.

## References

- Related: `thread_if` (smaller pin, no shoulder), `thread_nc`
  (massive shoulder, BHA grade).
- KB stub: `static/kb/api/drill-pipe-specs.json`.
- Spec: API RP 7G.
