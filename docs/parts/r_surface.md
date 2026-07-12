# r_surface — the CONVERGED parametric-surface engine

> THE one fast + simple formulation (⭐ THE CONVERGENCE in
> `docs/plans/sweep-thread-engine.md`). Revolve, extrude, helix, thread, flute
> and lobe are all just **a single parametric surface** `fn(u,v) → [x,y,z]`,
> laid down as ONE welded `gridPatch` + caps. stdlib engine
> (`src/lib/graph/stdlib/r_surface.ts`), git-tracked, read-only in the GUI
> (Rule 21).

## The idea (manifold by construction)

The manifold trap in sweeps/threads is making the **path** (or each repeated
unit) the mesh-traversal axis — then every turn/copy is a separate object you
must weld to its neighbour. Drop that: **the sweep axis is the surface's OWN
parameters `(u, v)`**, and whatever varies (the helix, the ripple, the profile)
lives in the **function `fn`**. "The previous turn" is then just earlier rows of
the SAME `gridPatch` — already welded. No path frame, **no torsion** (it's a
direct surface parameterization, not a path sweep), no inter-turn weld, no CSG.
Only the two open `v`-ends need caps.

```
r_surface(fn, Nu, Nv, wrapU, capLo, capHi)
  wall = gridPatch(Nu, Nv, fn)        // fn(u,v) → [x,y,z], u,v ∈ [0,1]
  if capLo: fan the v=0 ring → its centroid
  if capHi: fan the v=1 ring → its centroid
  return weldAndBuild([wall, …caps])  // position-weld + auto-correct volume sign
```

- **`wrapU`** — the `u`-direction CLOSES (a body of revolution / a tube). When
  `fn` is 2π-periodic in `u`, `gridPatch` samples `u = 0…1` inclusive so row 0 ≡
  row `Nu` (coincident) and `weldAndBuild` merges the seam → it closes EXACTLY.
  `false` → an open strip in `u` (no wrap weld; `gridPatch` never bridges row
  `Nu` back to row 0).
- **`capLo` / `capHi`** — triangle-fan the open `v=0` / `v=1` rings shut to that
  ring's centroid. The ring verts re-use the SAME `fn` samples as the wall edge,
  so they are coincident → weld merges them (watertight join); only the centroid
  apex is a new vertex. The two caps are wound opposite handedness;
  `weldAndBuild`'s volume-sign net auto-corrects global orientation.
- **Single limitation** (inherent to a single-valued surface): NO undercut /
  overhanging flanks. That stays **Option 4** (swept band + CSG) — reserved for
  genuine undercut threads, NOT covered here.

## The one-line `fn` recipes

Every prior engine is `r_surface` with a different `fn` (`tau = 2π`):

| shape | `fn(u, v)` | flags |
|---|---|---|
| **revolve** | `[R(v)·cos(u·tau), R(v)·sin(u·tau), Z(v)]` | wrapU, capLo, capHi |
| **extrude** | `[Px(u), Py(u), v·L]` (perimeter Px,Py) | wrapU (closed perimeter), capLo, capHi |
| **helix / thread** | `r = baseR + tooth(frac(z·tpi − u))`, `z = v·L`; `[r·cos(u·tau), r·sin(u·tau), z]` | wrapU, capLo, capHi |
| **flute / lobe / knurl** | same as thread with a different `tooth`/lobe count in the radius fn | wrapU, capLo, capHi |
| **open ribbon** | any `fn` that does NOT close in `u` | `wrapU=false` |

`r_helical_surface === r_surface(threadFn, Nθ, Nz, true, true, true)` — the
thread engine now literally delegates here (see below).

## The function-arg contract (the load-bearing detail)

`r_surface`'s FIRST argument is a **function**, not a GUI dial — unusual for a
stdlib engine. Two things make a VOLUME part able to pass a closure to it:

1. The part declares `meta.uses: ['r_surface']` and calls
   `r_surface((u,v) => […], Nu, Nv, …)` in its body. The loader
   (`primitive-loader.ts`) resolves `r_surface` and injects it by name; the
   closure rides through as positional arg 0 — closures keep their definition
   scope, so `Math`/`sin`/… resolve in the part's sandbox.
2. `r_surface` has an **EMPTY `meta.params` block ON PURPOSE**. The loader
   canonicalises a part's signature to its `meta.params` key order; an empty
   block makes `paramKeysOf → []`, so that rewrite is a NO-OP and the
   `(fn, Nu, Nv, wrapU, capLo, capHi)` signature passes through untouched. A
   non-empty params block would reorder/drop the un-dial-able `fn` arg. The
   GUI-facing dials live on the *demo parts* (`surf_revolve`, `surf_thread`),
   not on the engine.

## Subsumption demos (volume, `basic/thread_grooves/`)

Two parts prove the same engine makes different shapes via a different `fn`.
Bake-verified via `/api/primitives/preview` (2026-06-28); both round-trip from
the volume (saved, re-fetched, re-baked).

| part | `fn` | params (defaults) | verts | z-extent | r-range | watertight |
|---|---|---|---|---|---|---|
| `surf_revolve` | `R(v)=r0+amp·sin(turns·tau·v)`; `[R cos, R sin, v·H]` | r0 1.5, amp 0.5, turns 3, height 4, seg 96, vSegs 120 | 23 232 tris | [0, 4] | [0, 2.0] | ✓ cutaway OK |
| `surf_thread` | `r=baseR+dir·runout(z)·tooth(frac(z·tpi−u))` | od 3.2, len 5, tpi 1, depth 0.25, V60, seg 96, external | 23 232 tris | [0, 5] | [0, 1.85] | ✓ cutaway OK |

`surf_thread` reproduces `r_helical_surface`'s exact shape (z [0,5], r [0,1.85]).
The DE-RISK part (a plain cylinder closure) baked watertight first — confirming a
volume part CAN pass a function to a stdlib engine.

## r_helical_surface now delegates

`src/lib/graph/stdlib/r_helical_surface.ts` builds its `threadFn` (tooth / runout /
seam / taper — the thread's IDENTITY) and calls
`r_surface(threadFn, Nθ, Nz, true, true, true)` instead of hand-rolling the
`gridPatch` + cap fans + `weldAndBuild`. Verified **byte-identical**: the
delegated engine produces the SAME vertex multiset as the pre-delegation engine
across param sets (external V60, internal ACME-taper), and the same pre-existing
"Not manifold" failure on a degenerate coarse-pitch/deep-square combo — so the
delegation is regression-free. The caps stay watertight because **runout zeros
the tooth amplitude at z=0 and z=L**, making the end rings exact `baseR` circles
whose centroid is the axis — exactly what the old axis-apex cap fan produced.

## Z-down

`v → z` with z=0 the TOP and larger z DEEPER (down-hole), consistent with every
other engine (`src/lib/graph/CLAUDE.md`).

## Reference

- Plan: `docs/plans/sweep-thread-engine.md` (⭐ THE CONVERGENCE; Options 0–4).
- Thread engine that delegates here: `docs/parts/r_helical_surface.md`.
- Welded toolkit: `src/lib/graph/manifold-mesh.ts` (`gridPatch` / `weldAndBuild`);
  Rule 25 + `src/lib/graph/CLAUDE.md` (volume-sign check — `weldAndBuild` flips a
  negative-volume solid so the caller never has to wind triangles perfectly).
- **Option 4 (undercut) stays reserved** — a single-valued surface can't make
  overhanging flanks; build the tooth as one swept ribbon + `body.subtract(ribbon)`
  (CSG). `r_sweep` (Option 3, arbitrary path) is the only case `r_surface` doesn't
  cover directly — and it reintroduces frame torsion, so it stays the *general*
  tool, not the *simple* one.
