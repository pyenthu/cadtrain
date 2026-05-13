# seal_bore — Polished Bore Receptacle (PBR) with Internal Seal Grooves + Top Cone + Bottom Pin

## What this represents

A **polished bore receptacle (PBR)** — the upper female-bore element of
a seal-stack assembly in a completion. The seal-stack mandrel slides
INTO this bore; the elastomer seals on the mandrel engage the seal
grooves cut into this bore's internal wall.

Geometry features:
- **Top cone** — a tapered upper end leading into the bore (lead-in
  chamfer for stabbing the seal mandrel).
- **Polished-bore body** — the long parallel-bore section, with
  internal grooves for elastomer seals.
- **Cross-holes** — radial ports through the body (for pressure
  equalization or fluid passage during stinger entry).
- **Bottom pin** — a threaded male connection at the bottom for
  connecting to the production string below.

This is the most composite primitive in the basic family — it's
arguably a small *assembly* on its own. Kept as a primitive because
PBRs are extremely standard components in tubing-conveyed completions.

## Coordinate convention

Z-down. Stack from top to bottom:
- `z = 0 .. coneLength` — top cone
- `z = coneLength .. coneLength + length` — bore body with grooves +
  cross-holes
- `z = coneLength + length .. + pinLength` — bottom threaded pin

Crosshole Z is parameterized as a normalized `crossHoleZ ∈ [0, 1]`
relative to the body length, then resolved by `meta.derived.crossHoleZAbs`
into absolute inches. Cross-hole stays positioned correctly when
`length` changes.

## Composition

Top to bottom:

1. **Cone** — `cyl(coneLength, coneTopOD/2, od/2)` minus a `cyl()` bore.
2. **Body tube** — `tube(od/2, boreID/2, length)`, translated by
   `[0, 0, coneLength]`.
3. **Seal grooves** (internal) — loop over `numGrooves`, subtract a
   `tube(boreID/2 + grooveDepth, boreID/2 - 0.01, grooveWidth)` at each
   evenly-spaced Z position. Note: grooves cut OUTWARD from the bore
   (the primitive `grooved_cylinder` does the opposite — OD inward).
4. **Cross-holes** — for each of `numCrossSections`, a horizontal cyl
   cutter rotated 90° around Y, then phased circumferentially by
   `crossPhaseAngle`. Cuts a clean through-hole.
5. **Axial through-hole** — full-length `cyl(length+0.1, holeD/2)`
   cutter. (Note: this overlaps the existing bore — see Validation /
   future work below.)
6. **Bottom pin** — imported `threaded_pinGeom` with `pinOD`, `pinWall`,
   `pinLength`, `pinThreadCount`, `pinThreadDepth`, `pinTaper`,
   translated to `[0, 0, coneLength + length]`.

## Parameters

| Param                | Default | Meaning                                              |
|----------------------|---------|------------------------------------------------------|
| `od`                 | 2.8 in  | Outer diameter of the body                           |
| `boreID`             | 2.0 in  | Internal polished-bore diameter (the seal-engaged ID)|
| `length`             | 3.0 in  | Length of the polished-bore section                  |
| `numGrooves`         | 3       | Internal seal grooves                                |
| `grooveDepth`        | 0.05 in | Groove depth from boreID outward                     |
| `grooveWidth`        | 0.1 in  | Groove axial width                                   |
| `crossHoleD`         | 0.5 in  | Cross-hole diameter                                  |
| `numCrossSections`   | 4       | Cross-hole circumferential count                     |
| `crossPhaseAngle`    | 60°     | Azimuth between successive cross-holes               |
| `holeD`              | 0.5 in  | Diameter of the axial through-hole                   |
| `crossHoleZ`         | 0.5     | Normalized Z position of cross-holes (0=top, 1=bot)  |
| `coneLength`         | 1.0 in  | Top cone length                                      |
| `coneTopOD`          | 1.5 in  | OD at the top of the cone (narrow end)               |
| `pinOD`              | 2.4 in  | Pin OD at the major thread                           |
| `pinLength`          | 2.0 in  | Pin length                                           |
| `pinWall`            | 0.4 in  | Pin wall thickness                                   |
| `pinThreadCount`     | 8       | Pin thread count                                     |
| `pinThreadDepth`     | 0.05 in | Pin thread depth                                     |
| `pinTaper`           | 0.0625  | Pin thread taper (in/in)                             |

### Derived

| Derived         | Formula                  | Why                                  |
|-----------------|--------------------------|--------------------------------------|
| `crossHoleZAbs` | `crossHoleZ * length`    | Absolute Z of cross-holes, scales with `length` so the user-visible ratio stays stable. |

## Vocabulary

- **PBR** = Polished Bore Receptacle. Universal industry abbreviation.
- **Seal stack / Seal assembly** = the male-bore element with stacked
  elastomer seals that slides INTO the PBR.
- **Stinger** = the section of the seal assembly that enters the PBR.
- **Sealbore extension** = a pup-joint-length PBR used to extend total
  seal travel when the production string moves with temperature.

## Geometry contract for AI refinement

- Don't switch the import of `threaded_pinGeom` to a local builder —
  the pin must match other primitives' thread form for assemblies to
  look consistent.
- Cross-hole rotation: `rot(baseCyl, [0, 90, 0])` first (lays the
  cyl horizontal), then translate `-cutLen/2` in X (centers it), then
  `mv` to Z position, then `rot([0,0,azimuthDeg])` for phasing.
  Order matters — preserve.
- This is the LAST primitive in basic that's still hand-typed `(p) =>`
  rather than `defineGeom(meta, …)`. Migrating it requires careful
  TS typing because the params bag is large.

## Validation rules

No `meta.validate` today. Reasonable rules to add:
- `boreID >= od - 2*wall` → "bore too wide for the body"
- `pinOD > od` → "pin OD shouldn't exceed body OD"
- `coneTopOD > od` → "cone top OD must be ≤ body OD" (cone tapers UP
  to narrower, not wider)
- `numCrossSections * crossPhaseAngle > 360` → "cross-holes overlap"
  (caveat: real PBRs sometimes intentionally overlap to form a
  partial-circumferential cut — make this a warning, not an error)

## Planned features (out of scope today)

- **No-go shoulder** — an internal step at the top of the bore that
  catches the seal mandrel at full insertion. Today the mandrel is
  free to bottom-out.
- **Travel readout** — derived "max seal travel" = `length - sealStackLen`,
  surfaced as a non-editable readout.
- **Migrate to `defineGeom`** — currently the only `(p) => …` shape
  in the basic family; harmonize with the rest of the migration.
- **Multi-zone PBR** — some real PBRs have two parallel bore sections
  separated by a no-go shoulder for redundant sealing.

## References

- Related: `packer_element` (the elastomer ring that seals against
  the bore in a packer; analogous role on the other side).
- Pulls in: `threaded_pin` (bottom pin connection).
- Used in any tubing-conveyed completion assembly with seal travel
  compensation.
