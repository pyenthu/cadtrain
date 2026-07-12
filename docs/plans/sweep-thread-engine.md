# Sweep / thread engine — the progressive plan (Options 0–4)

**Status:** planning (2026-06-28). Locks the architecture for expression-driven
threads + a unified sweep engine, decided in a long design thread. Build order +
contracts below. Engines live in `src/lib/graph/stdlib/` (Rule 21); the welded-mesh
toolkit is `src/lib/graph/manifold-mesh.ts` (`gridPatch`/`capFan`/`weldAndBuild`,
Rule 25).

## The core decision (why this shape)
A thread / flute / lobe / helical ramp is **a cross-section swept along a path**.
The manifold trap is treating each turn (or each repeated tooth) as a SEPARATE
object that must be welded to its neighbour ("weld the previous turn"). That only
arises if you make the **helix the mesh-traversal axis**. Drop that:

> **Design rule:** the sweep axis is the surface's OWN parameters — `(θ, z)` for a
> body of revolution, `(arc-length, section)` for a path — and the helix lives in
> the **radius / section FUNCTION**, never in the mesh traversal. Then "the previous
> turn" is just earlier rows of the same `gridPatch` — already welded. Manifold by
> construction; only the two z-ends need caps.

Seam check (closes exactly): with `phase = frac(z·tpi − θ/2π)`, `r(θ=0) == r(θ=2π)`
because the helix advances exactly one pitch per turn — the azimuthal wrap-weld is
consistent. Single limitation: `(θ,z)→r` is single-valued, so **no undercut /
overhanging flanks** (that's Option 4's job).

## ⭐ THE CONVERGENCE — one fast + simple formulation (the end goal)
After the ladder, it all collapses to **one** idea: revolve, extrude, helix, thread,
flute, lobe are all just **a single parametric surface** `fn(u,v) → [x,y,z]`, laid
down as ONE welded `gridPatch` + caps. So the final, fast, simple engine is:

> **`r_surface(fn, Nu, Nv, wrapU, capLo, capHi)`** — weld one parametric surface.
> `fn(u,v)` (u,v ∈ [0,1]) returns the 3D point; `wrapU` merges a closed seam (θ);
> `capLo/capHi` fan the open v-ends shut. Manifold by construction — no path frame,
> **no torsion** (it's a direct surface parameterization, not a path sweep), no CSG.

Every prior engine is a one-liner `fn`:
- **revolve:** `fn(u,v) = [profile_r(v)·cos(u·2π), …·sin(u·2π), profile_z(v)]`
- **extrude:** `fn(u,v) = [perimeter_x(u), perimeter_y(u), v·L]`
- **helix / thread:** `fn(u,v) = r(θ=u·2π, z=v·L)` with `r = baseR + tooth(frac(z·tpi−u))`
  → **`r_helical_surface` is exactly `r_surface` with the thread `fn`.**

The expression system supplies `fn` (a section/surface that is a FUNCTION of the
parameters — the generalization of "a fixed `list<point>`"). That's the *one fast and
simple formulation*: **expression → `fn(u,v)` → one welded grid.** `r_sweep`
(section-along-an-arbitrary-path, Option 3) is the only case `r_surface` doesn't
cover directly — and it's exactly the case that reintroduces frame torsion (#12), so
it stays the *general* tool, not the *simple* one. Undercuts (Option 4) stay CSG.

## The ladder
Each rung is a shippable superset of the one below; the axis is *how much of the
geometry the expression owns* and *how manifoldness is guaranteed*.

### Option 0 — restore `r_threads` (use what exists)
- Hand-wound helical band (Square/V60/ACME · NPT taper · API NC presets), welded,
  then `body.subtract/add(band)` (CSG join). It's only in `src/volume_backup/
  primitives/basic/r_threads.prim.ts` — **restore it to the live volume** so a
  thread is on screen today. No expression. *Effort: minutes.*

### Option 1 — expression-authored tooth, hand-coded helix
- Feed an expression `list<point>` 2D tooth section where `r_threads`'s enum
  profile is. Helix still baked; still band+CSG. *Effort: small.* **Subsumed by
  Option 2** (it's 2's first sub-step), so build it only if 2 slips.

### Option 2 — displacement surface `r(θ,z)` → one welded grid ⭐ KEYSTONE
- New engine **`r_helical_surface(section, params)`** (working name): lower an
  expression `r(θ, z)` (or `tooth(phase)`) into ONE `gridPatch(Nθ, Nz, fn)`, welded.
  - **Contract:** `fn(u,v)` with `u=θ/2π`, `v=z/L`; `r = baseR + tooth(frac(v·L·tpi − u))`;
    return `[r·cos θ, r·sin θ, z]`. Azimuthal wrap-weld (col `Nθ` == col 0). Two
    `capFan` ends. Thread RUNOUT (partial first/last turn) handled by tapering the
    tooth amplitude over the first/last `1/tpi` of `z`.
  - Makes: threads, flutes, lobes, knurls, helical ramps — each a SINGLE watertight
    mesh, **no inter-turn weld, no CSG**. *Effort: medium.* This is the real
    expression-driven thread.
- **Expression wiring:** the expr supplies `tooth(phase)` (a 1-arg section function)
  — extends the list/expr system from "a fixed `[r,z]` list" to "a section that is a
  FUNCTION of the sweep parameter" (the generalization of the revolve/extrude work).

### Option 3 — unified `r_sweep(section, path, segments)` — the general engine
- Generalize Option 2 from `(θ,z)` to an arbitrary expression-driven PATH (a
  `list<point>`/`list<transform>`) with a section that can vary along it. Subsumes
  `r_weld_extrude` (straight), `r_revolve` (circular), `r_helical_surface` (helix)
  into one engine — the #11 `list → sweep` payoff. Grid in `(arc-length, section)`;
  same weld rules. *Effort: larger.* **Ceiling:** tight inner turns reintroduce
  frame-torsion / self-intersection (#12's open problems) for non-trivial paths.

### Option 4 — undercut threads: swept band + CSG (the hard tail)
- For TRUE undercut/overhanging flanks a single-valued surface can't represent:
  build the tooth as one continuous swept ribbon (helix-following sweep — ONE
  ribbon, so no inter-turn weld inside it) and `body.subtract/add(ribbon)`. The join
  is CSG (robust). This is repeat-as-sweep / loft-between-copies territory (#12:
  torsion, self-intersection at inner turns, caps). *Effort: high; reserve for genuine undercuts.*

## Build order (dependencies)
1. **0** (restore `r_threads`) — standalone, do first (a thread now).
2. **2** (`r_helical_surface` displacement engine + a thread demo part in
   `basic/spirals/`) — the keystone; everything practical rides on it.
3. **1** — only if 2 slips (else skip; 2 covers it).
4. **3** (`r_sweep` general) — 2 with an arbitrary path; the builder vision.
5. **4** (undercut band + CSG) — reserved tail; only for overhanging flanks.

## Where things live (user, 2026-06-28)
- **Engines** → `src/lib/graph/stdlib/` (git-tracked, read-only in the GUI, Rule 21):
  the new `r_helical_surface` (Option 2) + later `r_sweep` (Option 3).
- **Example parts** → a NEW `basic/thread_grooves/` group on the volume.

## Example parts to build (the deliverable)
**Threaded CONNECTIONS** in `basic/thread_grooves/` — keep them **visually simple +
readable**, built with **expressions + the sketch** for the base profile and the
**new engine** for the helical thread:
- an **EXTERNAL** thread (a pin — ridge on the OD), and
- an **INTERNAL** thread (a box — groove in the bore), ideally a mating pin+box pair
  so the connection reads at a glance.
Each: a sketch/expression profile for the body (revolve or extrude) + the helical
displacement (Option 2) for the thread, composed into one part. Coarse, legible
thread counts (a few turns, chunky pitch) — these are DEMOS, not spec threads.

## Verification (each engine)
Bake-verify via `/api/primitives/preview` (verts · z-extent · manifold? · seam
closed?). Check `manifold.volume()` SIGN (memory `welded_orientation_volume_sign`).
A thread demo must (a) bake watertight, (b) round-trip in the expression builder.
