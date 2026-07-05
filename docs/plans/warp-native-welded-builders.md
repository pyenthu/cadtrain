# Warp-native welded builders — geometry BORN bent along a spline

**Status:** DEEP EXPLORATION (design, 2026-07-05). Sibling of
`docs/plans/curvature-adaptive-warp-subdivision.md` (the *post-warp* approach).
**Rule:** extends **Rule 25** (warp/segmentation is a BUILD-TIME axial concern,
never a post-bake MeshGL rewrite). This doc is the *deeper* alternative to the
sibling: instead of building a straight solid and bending it afterward, the
welded builder emits rings that are **already** on the curve — smooth-normaled
and curvature-segmented by construction.

> **One-line thesis.** cadtrain already owns 90 % of this. `sweepAlongPath`
> (behind `r_sweep`) *is* a native warp — it plants a section into a
> per-station RMF frame along a path and lofts the rings. `r_revolve`'s
> `axisPath` is a *lite* native warp (planar shear, caps kept perpendicular).
> The missing 10 % is: (a) drive station density by **curvature**, not uniform
> length; (b) let the section be a **revolve profile** (so a lathe part can be
> born bent without becoming a hand-authored sweep); (c) decide the **cutaway**
> for a natively-bent Manifold. This doc specifies that 10 %.

---

## 1. The core idea — a station walker in the spline frame

Every welded solid in `manifold-mesh.ts` is built by walking **axial stations**
and welding the wall between them:

| Builder | station = | placed how (today) | caps |
|---|---|---|---|
| `revolveProfile` | one `[r,z]` edge revolved 360° | ring in the **flat local frame** (`x=r·cosθ, y=r·sinθ, z=z`) | fan to axis |
| `loftStations` | a list of positioned 3D rings | caller pre-positions them | `fanCap3D` |
| `sweepAlongPath` | `placeLoop(frame_i, section)` | **spline FRAME** `o + a·side + b·up` | `fanCap3D` at ±tangent |
| `r_revolve` axisPath | revolved ring, then `v.xy += path(z)` | **planar shear** (translate centre, no rotation) | axis-perpendicular |

The native-warp recipe is the third row generalized: for a solid whose local
geometry is a *stack of rings* `ring(s)` parameterized by axial coordinate `s`,
place each ring by the **spline frame at arc-length s**:

```
p(s, θ) = spline.pos(s) + local_x(s,θ)·N(s) + local_y(s,θ)·B(s)
```

where `[N(s), B(s), T(s)]` is the rotation-minimizing frame (`sweepFrames`,
double-reflection parallel transport, already in `manifold-mesh.ts`). Because
each ring's vertices live in *its own* slowly-rotating frame, the surface
**normals come out smooth by construction** — no `calculateNormals(crease)`
re-derive, no faceting, no post-warp. This is exactly what `sweepAlongPath`
already does; the generalization is only *what supplies the ring* (a fixed 2D
section today; a revolve profile or a varying section tomorrow) and *how the
stations are spaced* (uniform today; curvature-adaptive tomorrow).

**Relationship to r_revolve's shear.** `axisPath` translates each ring centre
by `path(z)` but does **not** rotate the ring — the section stays in the world
`x-y` plane. That is deliberate (keeps caps axis-perpendicular → clean CSG cut,
dodges defect-2), and it is correct for *gentle* deviations where the tangent
stays near-vertical. It is **wrong for tight bends / horizontal runs**: an
un-rotated circular section on a horizontal tangent projects to an ellipse of
the wall (the tube looks pinched). The frame-based placement above is the
faithful generalization — `axisPath` is the "planar-only, no-tilt" special case
of it. **Upgrade path:** `axisPath` gains an opt-in `frame:true` that rotates
the ring into `[N,B,T]` instead of shearing (planar shear stays the default for
back-compat + clean caps).

---

## 2. Curvature-adaptive station density

Today density is **uniform + length-based** everywhere:

- `r_revolve`: `zSegEff = max(32, min(256, ceil(pathLen)))`, even `maxZSpan`.
- `sweepAlongPath`: one station per path point (the caller's polyline).
- SVTC `boreNDivisions(len) = max(20, ceil(len/5))` — one ring / 5 MD.

Replace with the **sagitta rule** from the sibling doc. For a centreline
`c(s)` with local curvature `κ(s) = |c′ × c″| / |c′|³` (radius `R = 1/κ`), a
chord over arc-step `Δs` has sagitta `≈ Δs²·κ/8`. Hold sagitta ≤ ε:

```
Δs(s) ≤ sqrt( 8·ε / κ(s) )        // tight bend ⇒ small Δs ⇒ dense rings
Δs ∈ [minSpacing, maxSpacing]      // clamp: straights get a baseline, cusps can't → ∞
ε   = 0.02 · sectionRadius         // tolerance auto-scales with part size
```

Two fidelity levels (same as the sibling):

1. **Curvature-driven COUNT** (5-line change): keep even spacing but set the
   count from total turning angle `Σ|Δθ| / Δθ_max` + a length baseline. A curvy
   path gets many uniform rings, a straight one few. Cheapest win.
2. **Curvature-driven PLACEMENT** (the real ask): walk `s` from `0→total`
   accumulating turning angle and applying `Δs(s)`; drop a station whenever the
   accumulated angle ≥ `Δθ_max` **or** spacing ≥ `maxSpacing`. Rings **cluster
   at the kink**, sparse on straights.

Prototype sampler (pure, no Manifold — belongs beside `sweepFrames`; sketch
only, not committed here to avoid colliding with the in-flight `warp-spline.ts`
/ `render-helpers.ts` edits):

```ts
/** Arc-length stations spaced by local curvature: dense where c(s) bends. */
function curvatureAdaptiveStations(
  dense: V3[], cum: number[], total: number,
  eps: number, minSpan: number, maxSpan: number,
): number[] {
  const stations = [0];
  let s = 0;
  while (s < total) {
    const k = curvatureAt(dense, cum, s);           // finite-diff c′×c″/|c′|³
    const span = Math.min(maxSpan, Math.max(minSpan, Math.sqrt((8 * eps) / Math.max(k, 1e-9))));
    s = Math.min(total, s + span);
    stations.push(s);
  }
  return stations;                                   // → sampleAt(s) per station
}
```

`κ` from a **piecewise-linear** `axisPath` is impulses at the knots → smooth it
first (the spline sampler already Catmull-Rom-densifies, so evaluate κ on the
dense polyline, not the raw knots).

---

## 3. How each builder plugs in

### r_sweep — ALREADY the native warp (for a fixed section)
`sweepAlongPath` *is* born-bent geometry: RMF frames + `placeLoop` + `loftStations`
with smooth normals. What it lacks:
- **Curvature-adaptive stations** — it consumes the caller's raw path points
  1:1. Add: resample the path to `curvatureAdaptiveStations` before framing
  (opt-in `adaptive:true`, or auto when the path is a spline descriptor).
- **A varying section** — the section is constant along the path. A
  born-bent *revolve* (variable radius down its length) needs the ring to come
  from the profile at `z=s`, not a fixed loop → §"revolve-as-sweep" below.
- **Curvature-adaptive circumferential** — probably unnecessary; the section
  stays a true circle under a rigid frame placement, only axial chords facet.

**Verdict: r_sweep is the reference implementation of the native warp.** The
native-warp builder is essentially "r_sweep whose section is the part's own
revolve profile, swept along the warp spline, with curvature-adaptive stations."

### r_revolve — has `axisPath` (planar-shear native warp)
Upgrades, all back-compat (a null path → byte-identical revolve):
1. **shear → frame** (opt-in `frame:true`): rotate each ring into `[N,B,T]`
   instead of translating the centre. Faithful for tight bends; planar shear
   stays the default (clean axis-perpendicular caps).
2. **curvature density**: replace the uniform `zSegEff`/`maxZSpan` with the
   §2 placement, driven by the smoothed `dev` path's κ.
3. **revolve-as-sweep interop**: internally, a deviated revolve *is* a sweep of
   the profile's `[r,z]` loop along the spline — factor the shared station
   walker so r_revolve(axisPath) and r_sweep call the same code.

### r_weld_extrude — add an optional path
Today `CrossSection.extrude(h, divs, twist, scaleTop)` is a Manifold morph along
a **straight** z (twist + taper). It cannot bend. Add an optional `path` arg:
when present, **bypass the CS.extrude morph** and route to the shared station
walker — build the (possibly twisting/tapering) section at each curvature-
adaptive station and loft. Straight/absent path → unchanged CS.extrude (keep the
fast native morph; the sibling's `bench_extrude_findings` shows CS-morph is
4× faster than refine+warp, so don't route straight extrudes through the walker).

### Shared kernel — `buildAlongPath`
Factor a single `manifold-mesh.ts` export the three engines call:

```ts
buildAlongPath(
  path: V3[] | SplineDesc,
  sectionAt: (s: number) => [number, number][],   // ring in local frame at arc-length s
  opts: { adaptive?: boolean; eps?: number; caps?: boolean; closedPath?: boolean; frame?: boolean },
): Manifold
```

- `path` → Catmull-Rom densify + arc-length table (reuse `catmullRomDense`).
- stations = `curvatureAdaptiveStations` (or uniform when `!adaptive`).
- for each `s`: `frame = sampleAt(s)`; `ring = placeLoop(frame, sectionAt(s))`.
- `loftStations(rings, { caps, closedPath })` (fan caps live in the end frames).

`r_sweep` → `buildAlongPath(path, () => section, …)`.
`r_revolve(axisPath, frame:true)` → `buildAlongPath(axisPath, () => profileLoop, …)`.
`r_weld_extrude(path)` → `buildAlongPath(path, s => sectionWithTwistTaperAt(s), …)`.

---

## 4. The interface — does the warp NODE lower into this?

The graph warp node emits `warpSpline(child, path, opts)`
(`composition-emit.ts` → sandbox `warpManifoldAlongSpline`). Two ways it can
reach the native builder instead of post-warping a built solid:

- **Lower warp-over-revolve → `r_revolve(axisPath, frame:true)`.** When the
  node's child is a *single* `r_revolve` Call, the emitter rewrites the warp as
  the child's `axisPath` + a curvature-derived density (the sibling doc's
  "lower warp into axisPath" note, now generalized to the frame form). No
  separate warp step — the tube is *built* bent. This couples warp → child param
  (the warp's spline becomes the revolve's path), which is exactly what a
  deviated well tube wants.
- **Lower warp-over-anything-weldable → `buildAlongPath`.** Broader: any child
  that is itself a station-stack (revolve / sweep / weld_extrude) can be
  re-expressed as `buildAlongPath` with the warp spline. A child that is a
  **boolean / import / composition** cannot — it has no profile to re-station →
  stays on the post-warp path (§5).

**Recommendation:** the warp node keeps `warpSpline` as its *general* emit, but
gains a lowering pass: *if the child is a lone recognizable station-builder,
emit the native form; otherwise emit `warpMeshJS` post-warp.* This is a compile-
time rewrite in `composition-emit.ts` / `graph-to-tf.ts`, invisible to the user
— they wire a spline into a warp node either way.

---

## 5. Native vs post-warp — the split, and which to use

| | **Native** (`buildAlongPath`) | **Post-warp** (`warpMeshJS`) |
|---|---|---|
| where | build time, in the welded builder | after bake, on the extracted mesh |
| normals | smooth by construction (ring in its frame) | rotated by the same frame (also smooth) |
| density | curvature-adaptive stations up front | curvature-adaptive axial *re-subdivision* of the baked mesh |
| speed | one build pass, no refine | build + extract + JS remap (SVTC-fast, no Manifold) |
| output | a **Manifold** (CSG-able) | a **plain mesh** (clip-plane cutaway) |
| works for | only welded-builder parts (revolve/sweep/weld_extrude) | **any** solid — booleans, imports, compositions |
| tight bends | faithful (frame-placed rings) | faithful (frame-placed verts) if input is dense enough |

**Recommendation — use both, by case:**
- **Primary geometry that is a lathe/sweep** (well tubes, casing, pipe joints,
  the `bw_*` / `g_*` parts): **native**. It is smooth, fast, stays a Manifold
  (CSG cutaway keeps working), and needs no post step. This is the durable
  Rule-25 answer for the parts that dominate `/wells`.
- **Bent compositions / booleaned / imported solids** (a warp node over a
  subtract, an assembly, an arbitrary mesh): **post-warp `warpMeshJS`** — the
  general fallback the sibling doc already chose. It returns a plain mesh, so
  the cutaway becomes a clip-plane (§6).

They are not competitors — native is the *specialization* the emitter picks when
it can prove the child is a station-stack; `warpMeshJS` is the *general* path.
The two share `catmullRomDense` / `sweepFrames` / `spline3DFrames`, so the frame
math is identical and a part looks the same whichever route it takes.

---

## 6. Caps, cutaway, and the "is sweep the native warp?" question

**Caps at the bent ends.** `loftStations` already fan-caps the two ends in the
*start/end frames* (`fanCap3D(stations[0], true)` / `…[nS-1], false)`), so a
natively-bent tube gets watertight caps perpendicular to the local tangent — no
special handling. The annular (hollow) case reuses `sweepAnnular`'s 2D-region
cap (avoids the defect-2 tilted-coincident-cap boolean entirely — a hollow
*native* bent tube should build its bore as an annular section, **never** as
`sweep(outer) − sweep(inner)`; memory `r_sweep_normals_and_twist` / the
BORE-EXTEND note).

**Cutaway.** This is the one genuine tension:
- A **native** bend returns a Manifold → the half-section cutaway *can* stay a
  CSG boolean, **but** the cut plane is now world-fixed while the tube curves,
  so a single planar cutter slices the bend at one angle only. SVTC's fix
  (`cutCylinder`/`cutTube`): build the **half-section in straight local space**
  (`CrossSection.circle ∩ left-half-plane`, extruded with `boreNDivisions`
  rings) and warp *that* — the pre-cut `X=0` plane maps onto the centreline, so
  the cut face follows the tangent automatically. The native builder should do
  the same: **bake the half/annular cut into the 2D `sectionAt(s)`** (a
  half-disc / half-annulus section) rather than CSG-cutting the bent 3D solid.
  This is why `r_revolve.axisPath` keeps caps axis-perpendicular — so the
  straight-space cut survives the bend.
- A **post-warp** bend returns a plain mesh → CSG is impossible → **clip-plane**
  cutaway (the sibling doc's decision, `docs/plans/svtc-section-cutaway.md` /
  wells `manifoldCut` direction).

So: **native + cut-baked-into-section** (Manifold, CSG-free cut that follows the
curve) OR **post-warp + clip-plane**. Both avoid a world-planar CSG cut of a
curved solid.

**Is r_sweep already the native warp?** **Yes — it is the canonical instance.**
A section swept along a path with RMF frames is geometry born bent, with smooth
normals, no post step. It is missing only (a) curvature-adaptive station density
and (b) a *varying* (profile-driven) section, and it doesn't yet bake the cut
into the section. The work in this doc is therefore not "build a native warp
from scratch" — it is "generalize `sweepAlongPath` into the shared
`buildAlongPath` kernel, give it curvature stations + a section-provider, and
teach `r_revolve.axisPath` / `r_weld_extrude` + the warp-node emitter to call
it."

---

## 7. Feasibility + recommended sequencing

**Feasible and clean** — most of it exists; the risk is low because every piece
routes through the same welded `loftStations`/`weldAndBuild` pipeline (Rule 25,
crash-safe: no post-bake MeshGL rewrite ever).

1. **`curvatureAdaptiveStations`** (pure, testable in Node headless) beside
   `sweepFrames`. Unit-test the sagitta spacing on a known arc.
2. **`buildAlongPath` kernel** — extract the `sweepAlongPath` body around a
   `sectionAt(s)` provider + the adaptive stations. `r_sweep` becomes a 3-line
   caller; verify byte-identical output on `sweep_demo` (regression gate).
3. **`r_revolve.axisPath` `frame:true` + curvature density** — opt-in, planar
   shear stays default. Verify the deviated-well tube on `/wells`.
4. **warp-node lowering** in the emitter — child-is-lone-station-builder →
   native, else `warpMeshJS`.
5. **`r_weld_extrude(path)`** — last, lowest demand.
6. **Cut-into-section** for the hollow/half cases (native cutaway) — coordinate
   with the wells clip-plane work so `/wells` picks one cutaway story.

Steps 1–2 are pure geometry → **headless (build + vitest)**, no browser
(Rule 26). Step 3+ want a `/wells` or `/primitives` visual check.

---

## References
- `docs/plans/curvature-adaptive-warp-subdivision.md` — the *post-warp* sibling
  (sagitta math, the pure-JS `warpMeshJS` decision, clip-plane cutaway).
- `src/lib/cad/manifold-mesh.ts` — `sweepAlongPath` / `sweepFrames` /
  `loftStations` / `revolveProfile` / `subdivideProfileAxial` / `sweepAnnular`.
- `src/lib/cad/stdlib/r_revolve.ts` (lines ~92–210, the `axisPath` shear) ·
  `r_sweep.ts` · `r_weld_extrude.ts`.
- `src/lib/cad/warp-spline.ts` — `warpMeshJS` (post-warp, positions+normals) ·
  `spline3DFrames` · `catmullRomDense`. **READ-ONLY (in-flight edits).**
- SVTC `~/code/SVTC/src/lib/apps/wson/threeD/manifoldCut.js` — `warpGeometry`
  (PT frame, pure-JS vertex warp) · `boreNDivisions` (uniform 1 ring/5 MD) ·
  `cutCylinder`/`cutTube` (half-section baked into the 2D section, then warped —
  the cut-follows-tangent trick) · `buildWarpedHalfCylinder`.
- Rules 21 (stdlib) + 25 (build-time segmentation). Memories:
  `svtc_warp_3d_function`, `r_sweep_normals_and_twist`, `bench_extrude_findings`,
  `stack_cutaway_perf_root_cause`.
