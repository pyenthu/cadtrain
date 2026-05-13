# packer_element — Elastomer Sealing Element (Packer Rubber)

## What this represents

The **elastomer sealing element** of a downhole packer or bridge plug —
the rubber rings that compress radially outward to seal the annulus
between the packer body (mandrel) and the casing wall.

Real-world geometry:
- **Compressed (running) state** — element OD is slightly less than the
  casing drift, slips on the mandrel.
- **Set (expanded) state** — element is axially compressed by setting
  load; rubber bulges radially out to contact the casing ID and form
  a pressure-tight seal.

This primitive models the **expanded / mid-set** silhouette as a stack
of subtly bulging rings, parameterized by both compressed and expanded
OD so the user can sweep between the two states visually.

Used as a component in:
- Production packers (HHC, RTTS, mechanical-set packers)
- Bridge plugs (cast-iron-bridge-plug, retrievable plugs)
- Swell packers (parameterize for non-uniform expansion)

## Coordinate convention

Z-down. The element is built upward from `z = 0` (top) with each ring
at `i * ringH` where `ringH = length / numRings`. The whole element
sits within `z = 0 .. length`.

## Composition

Loop over `numRings` rings. Each ring's mid-OD is:

```
midOD = odCompressed + (odExpanded - odCompressed) * sin(t * π) * 0.3
```

where `t = (i + 0.5) / numRings` (the normalized center of the ring).

The `sin(t·π)` term creates a **fuller bulge in the middle of the stack
and tapered ends** — matches how a real elastomer element behaves when
axially compressed (the middle rings bulge most because the end rings
are constrained against the gauge rings). The 0.3 multiplier limits the
visible bulge to 30% of the compressed→expanded range so the geometry
stays recognizable.

Each ring is a `tube(midOD/2, mandrelOD/2, ringH * 0.9)` — the 0.9
factor leaves a thin gap between adjacent rings so each is visually
distinct (rather than fusing into a smooth column).

Built up from a tiny seed cube (0.001³) to satisfy Manifold's
`.add()` chain requirement on the first iteration.

## Parameters

| Param           | Default | Range        | Meaning                            |
|-----------------|---------|--------------|------------------------------------|
| `odCompressed`  | 2.5 in  | 1.0 .. 6.0   | Element OD in running state        |
| `odExpanded`    | 4.0 in  | 2.0 .. 8.0   | Element OD when fully set          |
| `mandrelOD`     | 1.5 in  | 0.5 .. 3.0   | Mandrel OD the element rides on    |
| `length`        | 2.0 in  | 0.5 .. 4.0   | Total axial length of the element  |
| `numRings`      | 3       | 1 .. 5       | Discrete ring count in the stack   |

## Vocabulary

- **Element** — universal field term for the elastomer body of a
  packer. Don't rename.
- **Mandrel** = the central pipe the element rides on.
- **Gauge ring** = the metal end-cap above/below the element that
  prevents extrusion. Not modeled here; would be its own primitive.
- **Set / Setting** = the process of compressing the element to seal.
  Element is "set" when expanded against the casing.

## Geometry contract for AI refinement

- The `sin(t·π) * 0.3` bulge profile is intentional. Don't replace
  with a flat midOD constant — the visual cue that this is an
  *element under compression* is the bulge.
- Tiny seed cube at start of the geom is to satisfy Manifold's
  `.add` chain — don't remove without restructuring the loop.
- Per-ring height `ringH * 0.9` leaves visible inter-ring gaps —
  preserve.

## Validation rules

No `meta.validate` today. Reasonable rules to add:
- `odExpanded < odCompressed` → "expanded OD must be > compressed OD"
- `mandrelOD >= odCompressed` → "mandrel OD must be < element OD"
- `numRings < 1` → "at least 1 ring required"

## Planned features (out of scope today)

- **Set / unset slider** — a 0..1 slider that interpolates between
  `odCompressed` and `odExpanded` for the whole element. The user
  could then "watch the packer set" by sweeping the slider.
- **Gauge ring + back-up ring** — model the metal end-caps above and
  below the element. Today the element appears free-floating.
- **Non-uniform bulge** — swell packers expand differentially based on
  oil/water contact. Allow per-ring `bulgeMultiplier` array.
- **Element profile presets** — *V-block*, *molded barrel*, *step* —
  different rubber-element shapes from major vendors.

## References

- Used in: any production-packer or bridge-plug assembly.
- Related: `slips` (the metal grippers that hold the packer in place;
  paired with the element on opposite sides of the setting stack).
- Field reference: Halliburton HHC Packer, Baker Hughes SAB Bridge
  Plug — both use similar element-stack geometry.
