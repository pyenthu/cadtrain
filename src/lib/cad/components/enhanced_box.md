# enhanced_box — Drill-String Box with Cone Transition + Collar with Internal Threads

## What this represents

An **enhanced** version of `conn_box` — the female (box) end of a
drill-string connection, modeled as a *body stub + tapered cone +
threaded collar*. The "enhanced" piece compared to the simpler
`conn_box`: explicit collar geometry, internal threads cut into the
collar bore, and a parametrically richer transition.

Use cases:
- Drill-pipe box with collar threads (heavy-duty variant)
- Drill-collar box (BHA member with thick collar)
- Custom rotary-shouldered box geometry where the user wants the
  collar exposed as its own visible section

Different from `conn_box`: that primitive has separate body + cone
slider groups but no explicit collar threads. `enhanced_box` adds the
collar with internal thread modeling.

For the *generic* female-thread primitive without geometry context use
`threaded_box`. For the *drill-string-tool-joint* primitive with
identification markings use `drill_pipe_tool_joint`.

## Coordinate convention

Z-down. Built going **upward** in negative-Z direction from the body
stub at z=0:

- z = 0 .. stub_len → body stub (OD `od`)
- z = -coneLength .. 0 → tapered cone (`od` at bottom, `collarOD` at top)
- z = -coneLength-collar_len .. -coneLength → collar with threads (OD `collarOD`)

This is opposite the conventional top-to-bottom build order used in most
other primitives. The geom function uses `-coneLength`, `-coneLength -
collar_len` to position the cone and collar ABOVE the build origin.

Why this convention here: when used as a sub-component in an assembly,
the box mates UP into a pin from above; placing the collar at negative
Z makes the connection point (the make-up shoulder) sit at z=0.

## Composition

1. **Body stub** — `tube(od/2, od/2 - wall, stub_len)`. The body
   section of OD `od`, hollow.
2. **Cone (upset transition)** — `taperedConeGeom({od, odTop:
   collarOD, wall, length: coneLength})` — imported from
   `./tapered_cone`. Translated by `(0, 0, -coneLength)` so it sits
   ABOVE the body stub. Goes from body OD at bottom to collar OD at
   top.
3. **Collar with threads** — `tube(collarOD/2, collarInnerR,
   collar_len)` where `collarInnerR = collarOD/2 - wall`. The collar
   is hollow at the same wall thickness as the body.
4. **Internal threads in collar** — loop `threadCount` times: subtract
   a thin tube (height 0.05") from the collar's INNER bore inward by
   `threadDepth`. This is what makes the "box": internal threads
   pointing inward.

## Parameters

| Param         | Default | Range        | Meaning                                  |
|---------------|---------|--------------|------------------------------------------|
| `od`          | 2.0 in  | 0.5 .. 6     | Body stub OD                             |
| `wall`        | 0.28 in | 0.1 .. 2     | Wall thickness, constant                 |
| `stub_len`    | 1.0 in  | 0.5 .. 15    | Body stub length                         |
| `odTop`       | 1.5 in  | 0.5 .. 6     | Currently unused (legacy? see note)      |
| `coneLength`  | 0.5 in  | 0.5 .. 10    | Tapered cone (body → collar) length      |
| `collar_mult` | 1.2     | 1 .. 10      | Collar OD as multiplier of body OD       |
| `collar_len`  | 1.0 in  | 0.1 .. 10    | Collar axial length (thread engagement)  |
| `threadCount` | 6       | 0 .. 20      | Internal threads in the collar           |
| `threadDepth` | 0.06 in | 0.02 .. 0.15 | Thread depth (inward from collar bore)   |

Derived (computed in `geom`, not via `meta.derived`):
- `collarOd = od * collar_mult` — actual collar OD
- `collarInnerR = collarOD/2 - wall` — collar bore inner radius

### Note on `odTop`

The `odTop` parameter is declared but not currently used in `geom`.
Likely a holdover from refactoring. Future feature: use `odTop` to
allow the collar OD to differ from the cone-top OD (the cone tapers
from body OD to `odTop`, then a separate collar of `od * collar_mult`
sits above). Today both are conflated to `collarOD`.

## Vocabulary

- **Collar** = the thicker section where the threads are cut. In this
  primitive, the collar has INTERNAL (female) threads — it's the box
  end. Don't confuse with `tubing_hanger_coupling` (also a "collar"
  but with INTERNAL threads sized differently).
- **Box** = female end. Universal.
- **Stub** = the body section adjacent to the connection. Short here
  by design — full-length pipe body is composed in separately.
- **Make-up shoulder** = the bottom face of the collar at z=-coneLength
  (where the mating pin's nose lands during make-up).

## Geometry contract for AI refinement

- Build direction is UPWARD (negative Z). When refining, preserve
  this; flipping to +Z breaks assembly composition assumptions.
- Internal thread cutter: `tube(collarInnerR + threadDepth,
  collarInnerR - 0.01, 0.05)` — the outer radius is INSIDE the
  collar bore (`collarInnerR + threadDepth`), the inner radius is
  smaller still. Cuts inward. Don't reverse — that would carve the
  outer collar surface instead.
- The `+0.01"` overshoot on the inner radius prevents Manifold
  tolerance closing the cut.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `wall * 2 >= od` → "wall too thick — bore collapses"
- `collar_mult <= 1` → "collar OD must be > body OD"
- `threadDepth >= wall` → "thread depth exceeds wall"
- `collar_len < threadCount * 0.05` → "collar too short to fit
  declared thread count"

## Planned features (out of scope today)

- **Wire up `odTop`** — let the user set cone-top OD separately from
  collar OD.
- **Make-up shoulder** — explicit flat seat at z=-coneLength with a
  small relief for stress.
- **Lead-in chamfer** at the top of the collar (z=-coneLength-collar_len)
  to ease stabbing.
- **Box stress-relief features** — boreback (counterbore at the box
  shoulder) for high-cycle BHA service.

## References

- Related: `conn_box` (simpler — no collar threads), `threaded_box`
  (generic — no body context), `drill_pipe_tool_joint` (DP tool
  joint with identification markings — pair with this for full DP
  geometry).
- Mating: a pin of compatible thread count + depth would compose
  via `threaded_pin_collared` or `threaded_pin`.
