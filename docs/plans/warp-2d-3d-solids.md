# 2D + 3D warp for solids (2026-07-08)

> Status: PLANNING. Give the author TWO distinct warp operations on a built
> solid — a **2D (planar) warp** in an author-chosen plane, and a **3D (RMF)
> warp** along a genuinely out-of-plane path — instead of today's single warp
> whose mode is silently auto-picked from the control-point arity.

## Current state

One warp node, one engine, mode auto-selected — the author never chooses.

- **Engine** `src/lib/cad/warp-spline.ts`. `warpManifoldAlongSpline(m, cp, opts)`
  (`:204`) bends a built Manifold via `Manifold.warp`; `warpMeshJS(...)` (`:285`)
  is the pure-JS position+normal twin used by the client/TF warp step. Both map a
  vertex's **z → arc-length** along the spline and place its (x, y) on a local
  frame.
- **Mode is auto-selected by `is3DPath(cp)` (`:123`)** — it returns 3D iff the
  control points have out-of-plane (y) variation `> 1e-6`, else planar:
  - **PLANAR** (`splineSampler` `:74`, `frameN` `:109`): Catmull-Rom in the
    **x-z plane** with a **constant world-Y** out-of-plane axis. Vertex mapping
    (`:253-261`): `x → in-plane radial (N)`, `y → world-Y (unchanged)`,
    `z → arc-length`. The bend plane is hard-wired to x-z.
  - **3D** (`spline3DFrames` `:138`): a rotation-minimizing frame (RMF, the
    `sweepFrames` double-reflection) carried along the curve, re-derived
    right-handed (`det[N,B,T] = +1`, `:141-147`) so `warp` keeps a positive
    volume. Mapping (`:240-247`): `x → N`, `y → B`, `z → arc-length`.
- **Node** `src/lib/cad/nodes/kinds/warp.ts` + `WarpNode`
  (`composition-graph-types.ts:486`). Fields: `child` / `children[]` (multi-input
  #36b, `:493`), `path`, `refine`, `stretch`, `validate`, `originZ` (#36c b,
  `:504`). Emit (`warp.ts:26-48`): `warpSpline(child, path, { … })`; ≥2 children
  emit a bare array → the parent spreads them as SEPARATE bodies. `originZ`
  (absolute z→arc-length origin, engine `:216`) is emitted **only when set** so
  existing parts stay byte-identical; multi-input defaults `originZ: 0`.
- **Spline editor** `SplineEditorPopup.svelte` + `spline-state.svelte.ts`. Control
  points are `Vec3 [x,y,z]`. The editor already has a **plane lock**
  `SplineView = 'free' | 'xy' | 'yz' | 'xz'` (`spline-view.ts:13`, `planeAxes`
  `:26`) — but it is **VIEW-only** (an orthographic projection for editing); it
  does NOT feed the warp mode or the bend plane. Whether the resulting warp is
  planar or 3D is decided purely by `is3DPath` on the points.

**The gap.** "Planar" today means *only* x-z; the out-of-plane axis is always
world-Y. There is no way to author a planar bend in the y-z plane (deform
up/down), and no way to *force* 3D on a nearly-planar curve or *force* planar on a
curve that happens to have y-variation. The plane and the mode are implicit.

## Goal

Two authorable, distinct warp operations on a solid:

- **2D warp** — bend the part within ONE plane the author picks; the third axis is
  preserved (rigid out-of-plane). Deterministic, cheap, no torsion.
- **3D warp** — bend along a genuinely 3D path (RMF, out-of-plane), section carried
  torsion-free.

Both must compose with the just-shipped `originZ` (absolute depth placement) and
multi-input (`children[]` → separate bodies) exactly as the single warp does today.

## Proposed design

**One warp node with an explicit mode + plane, NOT two node types.** The two
operations share the entire pipeline (path spline, `originZ`, multi-input spread,
refine/validate, the emit/sockets/card machinery); forking into two node kinds
would duplicate all of it. Add two SPARSE fields to `WarpNode`:

```ts
mode?: 'auto' | '2d' | '3d';   // absent ⇒ 'auto' = today's is3DPath auto-select
plane?: 'xz' | 'yz';           // 2D bend plane; absent ⇒ 'xz' (today's behaviour)
```

- **`mode: '2d'`** forces the planar branch; **`mode: '3d'`** forces
  `spline3DFrames` regardless of arity; **absent / `'auto'`** = the current
  `is3DPath` auto-select (byte-identical). The explicit mode is *required* to
  disambiguate the two cases `is3DPath` gets wrong: a **y-z planar** spline has
  y-variation and would wrongly route to 3D, and a slightly-noisy planar curve
  can be pinned to 2D.
- **The 2D plane always contains the part's z axis** (z is invariably the
  arc-length parameter — the sweep axis). So the meaningful 2D planes are the two
  that contain z: **`xz`** (default — in-plane radial = x, preserved = y, today's
  exact behaviour) and **`yz`** (in-plane radial = y, preserved = x — the swapped
  roles). `xy` does not contain z and is therefore not a bend-along-axis; it's a
  different (lattice/FFD) operation, deferred (see below). This is a small
  generalization of the planar branch (`warp-spline.ts:248-261` + `frameN`): pick
  which of x/y is the in-plane radial and which is rigidly preserved.
- **How the plane is chosen in the UI:** reuse the spline editor's existing plane
  lock. When the author locks the editor to `xz` or `yz` (`SplineView`) and the
  node is in 2D mode, seed `WarpNode.plane` from it. A ⚙-popover on the warp card
  carries the `mode` (auto / 2D / 3D) + `plane` (xz / yz) toggles alongside the
  existing refine/stretch/validate options.
- **Composition with `originZ` + multi-input** is orthogonal — `mode`/`plane`
  select the frame, `originZ` sets the z→arc-length origin, `children[]` spreads
  separate bodies. All four ride the same `warpSpline(child, path, { … })` opts
  object; a multi-input 2D warp bends each child in the same plane, a 3D one along
  the same RMF path.

**Emit (golden-safe).** Emit `mode`/`plane` into the opts object **only when set
and non-default** (mirrors the `originZ` gate, `warp.ts:40`): `mode: 'auto'`
absent, `plane: 'xz'` absent. So every existing warp part emits byte-for-byte
identically. `warpManifoldAlongSpline` / `warpMeshJS` gain matching `opts.mode` /
`opts.plane`, defaulting to the current auto/x-z behaviour.

**Possible generalization — lattice / free-form deform (note only).** Path-bending
is one warp family; a **2D lattice** (grid FFD in a plane) and a **3D lattice**
(cage FFD) are the natural "2D vs 3D" generalization beyond bending. Promising for
non-axial deformation (bulge, taper-by-region), but it needs a NEW cage editor +
trilinear-interp engine — out of scope for this plan, which stays grounded in the
existing spline-warp engine. Track as a separate node kind if a concrete use case
lands.

## Phases (each shippable + golden-safe)

- **P0 — schema + default (no behaviour change).** Add `mode?` / `plane?` to
  `WarpNode`; hydrate/serialize round-trip; emit unchanged when absent. Golden
  byte-gate: existing warp parts emit identical source (extend
  `nodes/emit-golden.test.ts`). Ship: types compile, nothing renders differently.
- **P1 — engine.** Generalize the planar branch of `warpManifoldAlongSpline` +
  `warpMeshJS` to honour `opts.plane` (xz | yz — swap the in-plane radial vs the
  preserved axis in `frameN` + the mapping), and let `opts.mode` override
  `is3DPath` (`'2d'`⇒planar, `'3d'`⇒RMF, `'auto'`⇒today). Emit `mode`/`plane` in
  the warp node opts only when non-default. Unit-test bbox + volume-sign for xz /
  yz / forced-3d against the existing `warp-spline.test.ts`.
- **P2 — editor.** Warp card ⚙-popover gains the mode (auto/2D/3D) + plane
  (xz/yz) toggles; wire the spline editor's plane lock to seed `node.plane` in 2D
  mode. Verify in the live `/primitives` multi-tab surface (per Rule 26 do this
  inline / self-verify, not a worktree browser agent).
- **P3 (optional, future).** Lattice / FFD warp as a separate node kind (2D grid
  vs 3D cage) if a real non-axial-deform need appears.

## Risks

- **`is3DPath` ambiguity** — a y-z planar spline has y-variation and auto-routes to
  3D; the explicit `mode: '2d'` + `plane: 'yz'` is exactly what resolves it. Keep
  `'auto'` as the default so unset parts are unaffected.
- **Left-handed frame → inverted volume** — the yz swap must stay right-handed
  (`det[N,B,T] = +1`) or `Manifold.warp` emits a negative-volume solid that
  silently breaks later CSG (the reason 3D re-derives the basis, `:141-147`;
  memory `welded_orientation_volume_sign`). Guard with the existing
  `warpValidity` (`:181`) volume-sign check on the new plane.
- **Golden byte-identity** — any always-emitted field breaks every warp part's
  golden hash; the emit gate (only-when-non-default) is load-bearing.
- **Curvature-adaptive densification interplay** — the build-time Z-densify
  (`_axialMaxZSpan`, Route C, memory `session_handoff_2026-07-06`) and
  `subdivideAxialAdaptive` measure the part's z axis, which stays the arc-length
  axis under both planes — should be unaffected, but re-check the yz path.
- **Refine cost** — planar `yz` keeps the same n²-ish refine caveat as `xz`
  (`:225-228`); no new cost, just verify the auto-skip still triggers.

## Test strategy

- **Golden emit byte-gate** (`nodes/emit-golden.test.ts`) — every existing warp
  part emits identical source with the new fields absent. The primary regression
  guard.
- **Engine unit tests** (`warp-spline.test.ts`) — `warpManifoldAlongSpline` on a
  known box for `plane:'xz'` (== today), `plane:'yz'` (bbox mirrors x↔y),
  `mode:'3d'` forced on a planar curve, `mode:'2d'` forced on a y-varying curve;
  assert **positive volume** (no inversion) and expected bbox extents in each.
- **Node validate/emit** — `warp.ts` emits `mode`/`plane` only when non-default;
  multi-input + `originZ` still compose (array producer unchanged).
- **Live UI** (P2, inline per Rule 26) — author a 2D-yz and a 3D warp on a volume
  part in `/primitives`, confirm the bend plane + the mode toggle drive the bake.

## Critical files

`src/lib/cad/warp-spline.ts` (engine — `warpManifoldAlongSpline` `:204`,
`warpMeshJS` `:285`, `is3DPath` `:123`, `frameN` `:109`, planar mapping
`:248-261`) · `src/lib/cad/nodes/kinds/warp.ts` (emit/validate/sockets) ·
`src/lib/cad/composition-graph-types.ts:486` (`WarpNode`) ·
`src/lib/shared/graph-editor/SplineEditorPopup.svelte` +
`spline-state.svelte.ts` + `spline-view.ts:13` (plane lock) ·
`src/lib/cad/nodes/emit-golden.test.ts` + `warp-spline.test.ts` (gates).
