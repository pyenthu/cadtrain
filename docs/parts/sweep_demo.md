# sweep_demo

> Bent-tube SWEEP demo for the [`r_sweep`](r_sweep.md) engine (Option 3). A
> round cross-section ridden along a gentle 90° elbow path → one welded,
> watertight tube — no CSG. Hand-authored `.asm.ts` on the volume
> (`basic/thread_grooves/`), `meta.uses: ['r_sweep']`.

## Summary

A round (n-gon) cross-section swept along a planar 90° elbow path:

- **lead-in** straight along +X up to the origin,
- a **quarter arc** (centre `(0, bendR)`, θ from −π/2 → 0) that turns the
  heading from +X to +Y, then
- a **lead-out** straight along +Y.

The whole path lies in the XY plane, so with the engine's default
`up = world-Z` the per-station frame stays torsion-free (`side` horizontal,
`up'` vertical) — a clean flat-lying bent pipe. The section is a closed circle,
so `r_sweep` lofts the placed rings into a tube and fan-caps both open ends into
a watertight solid. Routes `r_sweep → sweepAlongPath → loftStations →
weldAndBuild` (the welded-mesh toolkit — same welder `r_revolve`/`r_surface`
use; no CSG).

Companion to [`surf_revolve`](../parts) (an `r_surface(fn)` solid of
revolution): `surf_revolve` parameterizes the surface by its own (u,v) and is
torsion-free by construction; `sweep_demo` follows a real path and so is the
general (path-frame) tool.

## Params

| Name | Default | Step | Notes |
|---|---|---|---|
| `tubeR` | 0.6 | 0.05 | Cross-section (tube) radius. |
| `bendR` | 3 | 0.25 | Elbow arc radius. Keep ≫ `tubeR` so the inner turn never self-intersects. |
| `lead` | 2 | 0.25 | Length of the straight lead-in / lead-out runs (0 = pure arc). |
| `nSec` | 20 | 1 | Cross-section segments (round-ness of the tube). |
| `nArc` | 16 | 1 | Samples along the quarter arc (smoothness of the bend). |

## Build

```
section (closed circle, nSec pts)  ──┐
                                     ├─►  r_sweep(path, section, false, true)
path  = lead-in(+X) ▸ arc(−π/2→0) ▸ lead-out(+Y)  (XY plane)
                                     └─►  sweepAlongPath → loftStations → weldAndBuild
```

## Bake verification (defaults: 0.6 / 3 / 2 / 20 / 16)

- `/api/primitives/preview`: **2,508 verts · 836 tris**, cutaway ran
  (`cutawaySkipped: false`) → watertight.
- bbox **5.60 × 5.60 × 1.20** — a flat-lying elbow, thickness = 2·tubeR.
- direct `sweepAlongPath` toolkit check: **volume = +9.68** (positive →
  outward-oriented solid, memory `welded_orientation_volume_sign`), **genus 0**,
  status `NoError`.
- Rendered in the graph editor (Call → output): a clean bent tube, round bore
  (grey) + outer wall (red) in cutaway.

## Caveat

The fixed-`up` frame is torsion-free only for gentle / planar-ish paths. A
tighter `bendR` (approaching `tubeR`), a sharper turn, or a genuinely 3D path
that doubles back along `up` can twist or self-intersect the swept tube — the
Option 3 ceiling in `docs/plans/sweep-thread-engine.md` (the eventual fix is a
rotation-minimizing / parallel-transport frame). Keep demo paths gentle.
