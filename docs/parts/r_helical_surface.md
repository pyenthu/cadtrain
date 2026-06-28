# r_helical_surface — engine note

> KEYSTONE thread engine (Option 2 of `docs/plans/sweep-thread-engine.md`).
> A helical thread as ONE welded displacement surface `r(θ, z)` — manifold
> **by construction**: no separate band, no inter-turn weld, no CSG.
> stdlib engine (`src/lib/cad/stdlib/r_helical_surface.ts`), git-tracked,
> read-only in the GUI (Rule 21).

## The idea (why it can't crack)

A thread is a cross-section swept along a helix. The manifold trap is making
the **helix** the mesh-traversal axis — then every turn is a separate ribbon
you must weld to its neighbour. Drop that: the sweep axis is the cylinder's
OWN coordinates `(θ, z)`, and the helix lives ONLY in the radius FUNCTION.
"The previous turn" is then just earlier rows of the SAME `gridPatch` —
already welded.

```
gridPatch(Nθ, Nz, fn):  u = i/Nθ → θ = u·2π,   v = j/Nz → z = v·length
  phase = frac(z·tpi − u)                       // position within ONE pitch
  bump  = runout(z) · tooth(phase, profile, depth, halfFrac)   // 0 in the valley
  r     = baseR + (external ? +bump : −bump)
  return [r·cos θ, r·sin θ, z]
```

- **Seam closes EXACTLY.** Row `i = Nθ` is `u = 1` → `θ = 2π` (= `θ = 0`) and
  `phase = frac(z·tpi − 1) == frac(z·tpi − 0)`. So row Nθ is byte-identical to
  row 0; `weldAndBuild` merges the coincident seam → no crack.
- **Caps.** Two triangle-fan end caps over the wall's end rings (z=0, z=length),
  using the SAME `radius()`/θ samples so the ring verts are coincident and weld
  to the wall. The two caps are wound opposite handedness; `weldAndBuild`'s
  volume-sign net auto-corrects global orientation (→ positive volume).
- **Runout.** Tooth amplitude tapers 0→1 over the first/last `1/tpi` of z so the
  thread fades in/out cleanly (no abrupt end wall).
- **Single limitation** (inherent to a single-valued `r(θ,z)`): NO undercut /
  overhanging flanks. That is Option 4's swept-band-+-CSG job.

## `tooth(phase)` — the three profiles

`phase ∈ [0,1)`; tooth centred at `phase = 0.5` (the seam/valley at 0/1 is clear
of the ridge). `halfFrac = axialHalf · tpi` is the tooth's half-width as a
fraction of one pitch. Returns 0 in the valley.

| `profile` | shape | height(d = \|phase−0.5\|) |
|---|---|---|
| 0 Square | step | `depth` for `d < halfFrac`, else 0 |
| 1 V60 | triangular | `depth·(1 − d/halfFrac)` |
| 2 ACME | trapezoid | `depth` for `d < 0.4·halfFrac`, ramp to 0 over the outer 60% |

## Params (positional, in `meta.params` order)

| Name | Default | Notes |
|---|---|---|
| `od` | 3.2 | Base Ø → `baseR = od/2`. For `side=internal` this is the nominal BORE Ø. |
| `length` | 5 | Z-extent (Z-down: z=0 top). |
| `tpi` | 1 | Turns per unit length → pitch = `1/tpi`. |
| `threadDepth` | 0.25 | Radial tooth height (clamped to `baseR·0.9`). |
| `axialHalf` | 0.2 | Tooth half-width in Z (z-units). |
| `profile` | 1 (V60) | enum 0=Square / 1=V60 / 2=ACME. |
| `segmentsPerTurn` | 96 | Circumferential resolution (one full circle; single-start thread). |
| `side` | 0 (External) | enum 0=external (pin rod) / 1=internal (bore plug). |
| `taper` | 0 | Optional linear radial taper of the base radius along z (NPT-ish). |

Axial resolution `Nz` is computed at build time from `tpi·length` (≈24
samples/pitch, ≥8 across the ridge), capped at 900 (Rule 25 — segmentation lives
at BUILD time, never a post-bake mesh rewrite).

## How `side` is consumed

- **External (pin)** → `r = baseR + bump`: a solid threaded ROD whose OD
  undulates outward (`crest = baseR + depth`, `valley = baseR`). Union with a
  shoulder → a pin. Used directly. See [`pin_thread`](pin_thread.md).
- **Internal (bore)** → `r = baseR − bump`: a solid plug of radius `baseR` with
  ridges pointing INWARD (`valley = baseR`, `ridge tip = baseR − depth`).
  **SUBTRACT** it from a sketched tube (bore < `baseR − depth`) → carves a
  helical thread into the bore wall. See [`box_thread`](box_thread.md).

## Verification (bake, 2026-06-28)

All cases bake WATERTIGHT — a non-manifold weld throws `"Not manifold"` and
fails the preview, so a clean bake IS the watertight proof; `weldAndBuild`
guarantees positive volume.

| case | verts | z-extent | rmax | watertight |
|---|---|---|---|---|
| V60 external (od 3.2, depth 0.25) | 47 472 | [0, 5] | 1.850 (= baseR 1.6 + depth) | ✓ seam closed, cutaway OK |
| Square internal | 60 343 | [0, 5] | 1.600 (ridges point inward) | ✓ |
| ACME external, taper 0.1 | 54 906 | [0, 5] | 1.818 | ✓ |

Cutaway (a CSG half-section subtract) produces a clean ~43k-tri section — an
inverted/negative-volume solid would make `.subtract` ADD instead of carve, so
the valid cutaway confirms correct orientation.

## Reference

- Plan: `docs/plans/sweep-thread-engine.md` (§Option 2 — KEYSTONE).
- Band+sweep predecessor (helix-as-traversal-axis): `r_threads`
  (`src/volume_backup/primitives/basic/r_threads.prim.ts`) — borrowed its tooth
  profiles + cap winding.
- Welded toolkit: `src/lib/cad/manifold-mesh.ts` (`gridPatch`/`capFan`/
  `weldAndBuild`); Rule 25 + `src/lib/cad/CLAUDE.md` (volume-sign check).
