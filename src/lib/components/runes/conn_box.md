# conn_box — Box Connection (female end of a downhole tool joint)

## What this represents

The **female / "box"** half of a rotary-shouldered tool joint (the mating
half of a pin connection). Used between two pipe joints in a drill string,
or as the female end of a sub/crossover. Distinguishing geometry:

- An **upset flange** at the top — the connection OD is larger than the
  pipe-body OD so there's enough wall thickness to cut threads + carry
  torque without weakening the pipe.
- A **tapered transition** from the upset OD down to the pipe-body OD.
- The pipe-body **tube** below, with a through bore (eventually housing
  the internal box threads and torque shoulder).

Target standards eventually: NC50, 4-1/2 IF, 5-1/2 FH, etc. For now the
geometry is dimensionally driven by sliders; later iterations will snap
to API spec tables.

## Coordinate convention (project-wide rule)

**Z-down**: top = LOWER z, bottom = HIGHER z. `mv(part, [0, 0, +N])` moves
DOWN the hole. This conn_box has:

- Cone occupying z = 0 .. cone_length (top = z=0, wide upset OD).
- Body cylinder translated to start at z = cone_length, extending DOWN
  to z = cone_length + body_length.

Any future feature (torque shoulder, lead-in chamfer, thread relief)
must respect this convention.

## Composition

Built from two sub-primitives, unioned together:

1. **Cone** — imported from `./tapered_cone` as `taperedConeGeom`. Wide
   at the top (the upset OD), narrow at the bottom (matches body OD for
   a flush join). Hollow with constant wall thickness.
2. **Body** — `tube(outerR, innerR, height)` from `../manifold-helpers`,
   translated by `mv(...)` so its top face sits exactly at the bottom
   face of the cone.

A small overlap (`0.01"`) is added at the cone/body interface so the
CSG union closes cleanly under Manifold's tolerance. Without it, a
coplanar boundary can leave a hair-thin gap that renders as a seam.

## Parameter groups

Sliders are organized into two sub-tabs in the Inspector. Each group
maps to one physical component.

### Body (the pipe-body section)

| Param         | Default | Range          | Meaning                          |
|---------------|---------|----------------|----------------------------------|
| `body_od`     | 2.0 in  | 0.5 .. 6.0     | Pipe-body outer diameter         |
| `body_wall`   | 0.2 in  | 0.05 .. 1.0    | Wall thickness                   |
| `body_length` | 4.0 in  | 0.5 .. 15.0    | Length of the straight-OD body   |

### Cone (the upset transition)

| Param         | Default | Range          | Meaning                          |
|---------------|---------|----------------|----------------------------------|
| `cone_top_od` | 2.9 in  | 0.5 .. 8.0     | Outer diameter at the TOP (upset)|
| `cone_wall`   | 0.2 in  | 0.05 .. 1.0    | Wall thickness in the cone       |
| `cone_length` | 1.5 in  | 0.2 .. 6.0     | Length of the tapered transition |

## Derived params (read-only — computed from sliders)

These are NOT sliders; they're computed in `meta.derived` and merged
into `p` before geom() runs. Logic for the AI: prefer derived over
hardcoded literals whenever a value is a pure function of other params.

| Derived          | Formula                              | Why derived                                              |
|------------------|--------------------------------------|----------------------------------------------------------|
| `body_id`        | `body_od - 2 * body_wall`            | Bore diameter — purely geometric, no separate slider     |
| `cone_bottom_od` | `body_od`                            | The cone bottom MUST match body OD (flush join)          |
| `upset_ratio`    | `cone_top_od / body_od`              | Convenience metric; surfaced for spec-matching readouts  |
| `total_length`   | `body_length + cone_length`          | Total stack height                                       |

## Validation rules

Surface as errors in the Inspector (not exceptions — the user is
mid-drag and we want feedback, not crashes):

- `body_wall * 2 >= body_od` → "body wall too thick"
- `cone_wall * 2 >= cone_top_od` → "cone wall too thick at top"
- `cone_top_od < body_od` → "cone top OD should be ≥ body OD"
  (otherwise there's no upset — the "cone" tapers the wrong way)

## Geometry contract for AI refinement

When refining this file:

- The exports MUST stay `meta` + `geom`. Don't move them, don't rename them.
- Keep `id: 'conn_box'` unchanged.
- Use the existing param names; introduce new ones only when the change
  requires them.
- New computed values that depend purely on sliders → add to `derived`,
  not literals in geom.
- Helpers stay imported from `../manifold-helpers`. Other runes primitives
  come from `./<id>`. No other imports.
- Geom returns a single Manifold. Use `.add()` / `.subtract()` / `.intersect()`
  to compose, `mv()` / `rot()` to position.

## Planned features (out of scope today, signpost for the AI)

- Internal **torque shoulder** at z = cone_length (a flat seat where the
  mating pin's nose lands during make-up).
- **Lead-in chamfer** on the box's upper outer edge (0.1" × 45°) to ease
  stabbing.
- **Internal thread profile** — modeled as a counterbore for now, real
  thread form deferred until the WASM/AI authoring track lands.
- **API spec snapping**: dropdown to select NC50 / 4-1/2 IF / etc., which
  fills the sliders from a KB table (analogous to `/static/kb/api/…`).
