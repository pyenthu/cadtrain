# tubing_hanger_spool — Wellhead Spool Carrying the Tubing Hanger

## What this represents

A **Tubing Hanger Spool (THS)** — the flanged section of the wellhead
that sits between the **casing head** (below) and the **Christmas tree**
(above) and carries the **tubing hanger** that suspends the production
tubing string in the well.

Real-world geometry:
- **Top flange** — pressure-rated API 6A flange that bolts to the
  Christmas tree base. Smaller OD because it mates only to the tubing
  flow path (typically 2-3" bore).
- **Bottom flange** — larger pressure-rated API 6A flange that bolts to
  the casing head. Sized for the casing string (typically 7-13").
- **Neck** — the cylindrical body between the flanges. Carries the
  tubing hanger landing surfaces.
- **Bore** — vertical bore through the whole spool. Constant ID =
  tubing OD + clearance.
- **Bottom-prep counterbore** — a wider opening at the bottom face where
  the tubing hanger lands (the hanger's outer surface sits in this
  counterbore on a landing shoulder formed by the step).

## Coordinate convention

Z-down. Top flange at z=0 .. topFlangeThk, neck below it, bottom flange
at z=length-bottomFlangeThk .. length. Bottom-prep counterbore cut from
the bottom face upward by `bottomPrepDepth`.

## Composition

1. **Top flange** — `cyl(topFlangeThk, topFlangeOD/2)` at z=0.
2. **Neck** — `cyl(neckLen, neckOD/2)` translated `topFlangeThk` below
   the top flange. `neckLen = length - topFlangeThk - bottomFlangeThk`.
3. **Bottom flange** — `cyl(bottomFlangeThk, bottomFlangeOD/2)`
   translated to `length - bottomFlangeThk`.
4. **Bore** — `cyl(length + 0.02, bore/2)` subtracted full-length with
   small overshoot.
5. **Bottom-prep counterbore** — `cyl(bottomPrepDepth + 0.01,
   bottomPrepOD/2)` subtracted from the bottom face inward.

The shoulder between the bore and the bottom-prep counterbore is the
**landing shoulder** where the tubing hanger sits.

## Parameters

| Param             | Default   | Range          | Meaning                                  |
|-------------------|-----------|----------------|------------------------------------------|
| `length`          | 12.0 in   | 6 .. 24        | Total spool height                       |
| `topFlangeOD`     | 2.5625 in | 1.5 .. 8       | Top flange OD (small — to tree base)     |
| `topFlangeThk`    | 1.5 in    | 0.5 .. 3       | Top flange thickness                     |
| `bottomFlangeOD`  | 7.0625 in | 4 .. 14        | Bottom flange OD (large — to casing head)|
| `bottomFlangeThk` | 1.75 in   | 0.5 .. 3       | Bottom flange thickness                  |
| `neckOD`          | 4.5 in    | 2 .. 10        | Spool body OD between flanges            |
| `bore`            | 2.5625 in | 1 .. 6         | Vertical bore through the spool          |
| `bottomPrepOD`    | 4.5 in    | 2 .. 8         | Bottom counterbore diameter              |
| `bottomPrepDepth` | 1.75 in   | 0.5 .. 4       | Bottom counterbore axial depth           |

Defaults match the `THS-7x2.5625-2k` row in
`static/kb/api/tubing-hanger.json` — a 2M-class spool for 4-1/2"
tubing with 2-9/16" top bore.

## API 6A pressure classes

The pressure rating of each flange is encoded in the model number
(e.g. `THS-7x2.5625-2k`):

| Class | Pressure (psi) | Common use                                  |
|-------|----------------|---------------------------------------------|
| 2M    | 2,000          | Shallow / low-pressure wells                |
| 3M    | 3,000          | Standard onshore production                 |
| 5M    | 5,000          | Most common production rating               |
| 10M   | 10,000         | Deep wells, sour service                    |
| 15M   | 15,000         | HPHT and offshore                           |

Top and bottom flanges can be **mixed-class** (e.g. 3M bottom × 5M
top — used when retrofitting newer high-pressure trees onto existing
casing heads). The geom doesn't represent pressure rating geometrically
— it's metadata you'd surface in the Inspector tooltip / KB readout.

## Vocabulary

- **THS** = Tubing Hanger Spool. Industry-universal three-letter abbreviation.
- **Christmas tree** = the surface valve assembly that bolts on top.
  Master valve, swab valve, wing valves — see future `christmas_tree`
  recipe in `docs/assemblies/`.
- **Casing head** = the wellhead base below the spool. Bolts to surface
  casing via slip lock or threaded connection.
- **Tubing hanger** = the part that *hangs* the tubing in the spool.
  Different primitive (not yet modeled).
- **Bottom prep** = the counterbore at the bottom face. Sometimes
  called "hanger prep" or "landing prep" — the machined feature where
  the hanger seats.
- **Back-pressure valve (BPV)** = the check valve installed through
  the tubing hanger to seal off well pressure during make-up of the
  Christmas tree. Threaded into the hanger via `tubing_hanger_coupling`.

## Geometry contract for AI refinement

- Build order: top flange first, then neck, then bottom flange — and
  THEN subtract bore + bottom-prep. This order means the bore is cut
  through the AGGREGATE (which is correct: a single bore through all
  three sections). Don't subtract per-section.
- `neckLen = Math.max(0.01, length - topFlangeThk - bottomFlangeThk)`
  — the `Math.max` guards against negative length when flange
  thicknesses sum to more than `length`. Preserve.
- Bore overshoot `+0.02` and bottom-prep overshoot `+0.01` are
  intentional for clean CSG. Preserve.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `topFlangeThk + bottomFlangeThk >= length` → "flanges fill the
  spool — no neck"
- `bore >= neckOD - 2*0.1` → "bore eats the neck wall"
- `bottomPrepOD >= bottomFlangeOD` → "counterbore overflows flange OD"
- `bottomPrepDepth + topFlangeThk >= length` → "counterbore reaches
  top flange"

## Planned features (out of scope today)

- **API 6A pressure-class dropdown** — picks `topFlangeOD` /
  `topFlangeThk` / `bottomFlangeOD` / `bottomFlangeThk` defaults from
  the KB rows by class.
- **Bolt-circle pattern** — circumferential holes through the flange
  faces for studs. Real API 6A flanges have 8/12/16/20 studs by
  rating.
- **Ring-gasket groove** — the API ring-gasket sealing surface on each
  flange face. Currently not modeled.
- **Side outlets** — many spools have lateral ports for kill-line /
  flow-line connection. Add `numSideOutlets` + `sideOutletOD` +
  `sideOutletAngle`.

## References

- KB: `static/kb/api/tubing-hanger.json` — 7 THS rows + 4 coupling rows.
- Assembly: `docs/assemblies/tubing_hanger_spool_stack.md` — worked
  example of THS + hanger + coupling + BPV.
- Related: `tubing_hanger_coupling` (the union-nut coupling that
  carries the BPV).
- Vendor reference: Miracle Industries product page
  (https://miracleoilfield.com/tubing-hanger-spools-and-couplings/).
