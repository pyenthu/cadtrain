# threaded_box — Generic Internal Threads (Female End)

## What this represents

A **generic threaded box** — the female end of any threaded pipe
connection. This is a *primitive*, not a specific connection: it has
no upset, no shoulder, no taper transition built in. Compose it with
other primitives (e.g. `tapered_cone` for an upset, `shoulder` for a
torque shoulder) to build a specific connection form.

When you need a fully-formed connection use `conn_box` (drill-string
box) or `enhanced_box` (box with collar). When you need the casing/
tubing variants use `thread_ltc` (with coupling) or `thread_eue`
(with upset). Use `threaded_box` here for:

- The female half of any custom connection you're sketching from
  scratch.
- A coupling barrel internal (just the threaded section).
- The base of a more complex assembly that needs box threads as one
  of its sub-parts.

## Coordinate convention

Z-down. The body is positioned by Manifold's `cyl()` convention —
starts at z=0 and extends to z=length. (Note this differs from `tube()`
in manifold-helpers which centers at z=0; `threaded_box` uses raw
`cyl` for both the outer body and the bore.)

## Composition

1. **Outer body** — `cyl(length, od/2, od/2)` — a straight-walled
   cylinder with constant OD.
2. **Tapered bore** — `cyl(length + 0.02, rStart, rEnd)` shifted by
   `-0.01` in Z. The bore can be parallel (`taper = 0`) or tapered
   (`taper > 0`). When tapered: `rStart = id/2` (top), `rEnd = id/2 +
   taper * length` (bottom), so the bore widens going down. This
   matches API connections where the box bore is tapered to receive
   a matching pin taper.
3. **Threads** — loop `threadCount` times, subtract a thin tube
   (height 0.05") at each evenly-spaced Z. The cutter radius is
   computed *per-thread* by interpolating between `rStart` and `rEnd`
   so threads follow the bore taper. The cutter is sized to start
   `threadDepth` into the wall and extend just past the bore — leaves
   the OD intact, the bore lightly grooved.

## Parameters

| Param         | Default | Range        | Meaning                                  |
|---------------|---------|--------------|------------------------------------------|
| `od`          | 3.0 in  | 0.5 .. 14    | Outer diameter (constant along length)   |
| `wall`        | 0.5 in  | 0.1 .. 1.0   | Nominal wall thickness                   |
| `length`      | 2.5 in  | 0.5 .. 6     | Axial length of the threaded section     |
| `threadCount` | 8       | 2 .. 40      | Threads in the bore                      |
| `threadDepth` | 0.08 in | 0.02 .. 0.15 | Radial thread depth (into the wall)      |
| `taper`       | 0       | 0 .. 0.2     | Bore taper per unit length (1:N rate)    |

`taper = 0` → parallel bore (premium / radial-shoulder connections).
`taper = 0.0625` → 1:16 taper, typical API rotary-shouldered (NC, IF).
`taper = 0.0833` → 1:12 taper, typical EUE/LTC.

## Vocabulary

- **Box** = female end (universal in oilfield, never call it "female")
- **Pin** = male end
- **Make-up** = thread the two together
- **Make-up torque** = the spec torque to fully engage
- **Stab** = first inserting the pin into the box before rotating
- **Thread shoulder / torque shoulder** = the flat sealing/torque-
  bearing face where the make-up bottoms out

## Geometry contract for AI refinement

- The body is a SOLID `cyl(length, od/2, od/2)` minus a tapered bore —
  not a `tube()`. This is because the bore is the geometric
  signature: a tapered bore would not be expressible as `tube()`
  (which takes constant inner radius).
- Thread cutters have `+0.01` outer overshoot (`localR + 0.01`) so they
  reliably cut across Manifold's tolerance — preserve.
- The `taper` parameter is applied to the bore (which widens going
  DOWN). If a future refinement asks for the bore to narrow going
  down, swap to `rEnd = id/2 - taper * length`.

## Validation rules

No `meta.validate` today. Reasonable additions:
- `wall * 2 >= od` → "wall too thick — no room for the bore"
- `id/2 + taper * length >= od/2` → "tapered bore eats through OD"
- `threadDepth >= wall` → "thread depth exceeds wall"

## Planned features (out of scope today)

- **Pre-set taper choices** — dropdown for the standard taper rates
  (1:6, 1:8, 1:12, 1:16, 1:32, parallel).
- **Torque shoulder add-on** — internal flat shoulder at top or
  bottom of the threaded zone. Today must be added as a separate
  primitive composition.
- **Thread profile** — V, square, buttress, ACME, API 8-round, NC.
  Today the cutter is a thin tube — i.e. it represents the *envelope*
  of the thread, not its profile.
- **Bore relief** — small undercut at the top of the threads (entry
  chamfer + lead-in clearance). Standard on premium connections.

## References

- Composable into: `conn_box` (with cone), `enhanced_box` (with
  cone + collar threads).
- Related: `threaded_pin` (male counterpart), `threaded_pin_collared`
  (pin with collar — analogous to box with upset).
