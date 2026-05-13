# tubing_hanger_coupling — Union-Nut Coupling for Back-Pressure Valve

## What this represents

A **Tubing Hanger Coupling (THC)** — the union-nut coupling that lands
on a tubing-hanger thread. Its job: let the **back-pressure valve (BPV)**
be screwed into the tubing hanger **without rotating the entire
Christmas tree**.

Real-world geometry:
- **Union nut** at the top — a hex (or sometimes round) nut that
  rotates independently of the body below it. The nut threads onto the
  tubing hanger; the body stays still while the nut spins.
- **Body** below the nut — has internal API EUE threads for the BPV
  to screw into. The BPV is rotated through these threads to engage
  its check-valve seat.
- **Bore** through the whole part — the production flow path passes
  through here when the BPV is removed.

Pair with `tubing_hanger_spool` (the spool that carries the hanger) —
the THC + BPV combo enables service operations (removing the tree
to swap a wing valve, etc.) without bleeding off the well.

## Coordinate convention

Z-down. Stack:
- z = 0 .. nutHeight → union nut (OD `couplingOD`)
- z = nutHeight .. nutHeight + bodyHeight → body with EUE threads
  (OD `bodyOD = tubingOD + 2*wall`)

The bore is two diameters:
- z = 0 .. nutHeight → wider BPV bore `bpvBore` (where the BPV body
  sits)
- z = nutHeight .. end → tighter tubing bore `tubingOD` (where the
  production flow passes once BPV is removed)

The transition between the two bores acts as the BPV's landing
shoulder.

## Composition

1. **Union nut** — `cyl(nutHeight, couplingOD/2)`. Larger OD because
   it has wrench flats.
2. **Body** — `cyl(bodyHeight, bodyOD/2)` translated by `nutHeight`.
3. **BPV bore** — `cyl(nutHeight + 0.02, bpvBore/2)` subtracted
   through the upper section.
4. **Tubing bore** — `cyl(bodyHeight + 0.02, tubingOD/2)` subtracted
   through the lower section.
5. **Internal threads** — loop `threadCount` times, subtract a thin
   tube cutter from the tubing-bore wall outward (i.e. ANNULUS
   `tubingBoreR + threadDepth .. tubingBoreR - 0.01`) — internal
   threads suitable for a 2-3/8" or 2-7/8" API EUE BPV.

## Parameters

| Param         | Default  | Range        | Meaning                                  |
|---------------|----------|--------------|------------------------------------------|
| `couplingOD`  | 4.5 in   | 3 .. 10      | Union nut OD                             |
| `tubingOD`    | 2.375 in | 2 .. 6       | Tubing OD (production string nominal)    |
| `nutHeight`   | 1.5 in   | 0.5 .. 4     | Union-nut axial height                   |
| `bodyHeight`  | 3.0 in   | 1 .. 6       | Body axial height (thread length)        |
| `wall`        | 0.35 in  | 0.15 .. 1.0  | Body wall thickness                      |
| `threadCount` | 8        | 2 .. 20      | Internal EUE threads in body bore        |
| `threadDepth` | 0.06 in  | 0.02 .. 0.15 | Thread depth                             |
| `bpvBore`     | 1.5 in   | 0.5 .. 4     | BPV-shaped wider bore through the nut    |

Defaults match a 2-3/8" tubing × 4-1/2" coupling — the most common
THC dimension per the KB rows in
`static/kb/api/tubing-hanger.json`.

## Vocabulary

- **THC** = Tubing Hanger Coupling.
- **BPV** = Back-Pressure Valve. A spring-loaded check valve that
  seals well pressure from below while the tree is removed.
- **Union nut** = a nut that rotates independently of the body it sits
  on. Lets you spin the nut without spinning the threaded shaft below.
  Used widely in hydraulic / process / wellhead equipment.
- **API EUE** = External Upset End thread profile (see `thread_eue`).
  THC body uses the BOX side of API EUE.
- **Make-up sequence**: tubing hanger landed in spool → THC nut spun
  onto hanger external thread → BPV screwed down into THC body → tree
  removed safely.

## Geometry contract for AI refinement

- Bore is TWO sections (nut bore `bpvBore` is wider; body bore
  `tubingOD` is narrower). The step between them at z=nutHeight is the
  BPV landing shoulder — preserve.
- Thread cutter direction: cuts from inside the body bore outward
  (`tubingBoreR + threadDepth` is OUTSIDE the bore, `tubingBoreR -
  0.01` is INSIDE). This carves an inward annulus — preserve.
- The nut is a SOLID `cyl` (no wrench flats geometrically) — wrench
  flats are a future feature (real-world THC nuts are hex or round-
  with-spanner-cutouts).

## Validation rules

No `meta.validate` today. Reasonable additions:
- `bpvBore >= couplingOD - 2*0.1` → "BPV bore eats the nut wall"
- `tubingOD >= bodyOD` → "tubing bore larger than body OD"
- `threadDepth >= wall` → "thread depth exceeds wall"
- `bodyHeight < threadCount * 0.05` → "body too short for thread count"

## Planned features (out of scope today)

- **Hex flats on the union nut** — `numFlats: 6` default (hex). Add
  via `M.cube` subtraction × 6 around the nut OD.
- **Tubing-size dropdown** — picks `tubingOD` + `couplingOD` from KB
  rows. Today the user must look up the right pair manually.
- **BPV thread profile** — currently just thin-tube cuts; future
  helical pattern via NL→ManifoldCAD track.
- **Pressure-class flag** — tie the geometry to an API 6A class so
  the Inspector tooltip surfaces "10M-rated, 10,000 psi WP".

## References

- KB: `static/kb/api/tubing-hanger.json` (4 THC rows).
- Assembly: `docs/assemblies/tubing_hanger_spool_stack.md` — full
  THS + hanger + THC + BPV recipe.
- Pair: `tubing_hanger_spool` (the spool that carries the hanger).
- Vendor reference: Miracle Industries product page
  (https://miracleoilfield.com/tubing-hanger-spools-and-couplings/).
