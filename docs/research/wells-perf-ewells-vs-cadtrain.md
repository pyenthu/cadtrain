# Why ewells renders a well FAST while cadtrain `/wells` is SLOW

*Evidence-based root-cause analysis. Companion to `wells-build-architecture.md`
(the FIX) and `svtc-wson-deep-dive.md` (the port map). This doc is the **WHY**.*

Sources read (real code, not the browser):
- ewells/SVTC: `~/code/SVTC/src/lib/apps/wson/` — `WsonApp.svelte`,
  `Wson2DRenderer.svelte`, `wsonRender.js`, `Wson3DScene.svelte`.
- cadtrain: `src/routes/wells/{+page,WellViewPlaceholder,view-settings}.svelte`,
  `src/lib/wells/WellSchematic3D.svelte`, `src/lib/wells/threeD/manifoldCut.ts`.

---

## TL;DR — the ranked root cause

**#1 (dominant): ewells' DEFAULT view is a pure 2D SVG schematic; cadtrain's
`/wells` DEFAULT (and only) view is a 3D Manifold-CSG half-section cutaway.**
They are not the same workload rendered two ways — they are two *different
render models*, and the two apps ship *different defaults*:

- ewells `WsonApp.svelte:212` → `let activeView = $state(cached.viewMode ?? '2d')`
  (also the documented default `viewMode: '2d'` at line 18). The 2D view is a
  synchronous string-builder: it emits `<rect>`/`<path>` SVG elements, O(#components),
  **no WASM, no CSG booleans, no GPU mesh**. The 3D view is opt-in and only
  *mounted* when the user first clicks the 3D tab (`mounted3D` sticky-latch,
  `WsonApp.svelte:217`).
- cadtrain `/wells` has **no 2D view at all**. Every tab mounts
  `WellViewPlaceholder → WellSchematic3D` (`WellViewPlaceholder.svelte:14,61`),
  and the default settings turn on the expensive path:
  `view-settings.ts:56-60` → `cutaway: true, directional: true, dtx: true`.

So ewells is fast because on first paint it does **~0 CSG booleans and touches
no WASM**; cadtrain does **~15-25 Manifold boolean solids + mesh extraction +
per-vertex warp + EdgesGeometry, all synchronously on the main thread**, before
the first frame.

**#2: cadtrain runs all that CSG synchronously on the main thread** (inside
`$derived.by`), so it blocks the frame / input. There is **no Web Worker** in the
wells path (`grep` for `Worker` in `src/lib/wells` + `src/routes/wells` → none),
even though cadtrain already has a bake-worker pipeline for `/primitives`.

**#3: cadtrain uses a REAL boolean cut (`solid.subtract(halfSpaceBox)`), not a
clip plane or a material trick** — and rebuilds ALL of it on every dial change
via `{#key geomKey}`. ewells' 3D view *also* does CSG, but you rarely pay for it
because you're in 2D by default; and even its 2D "cutaway" is just two SVG rects.

Everything below quantifies these three.

---

## 1. Side-by-side render model

| | **ewells / SVTC (default 2D)** | **cadtrain `/wells` (only view: 3D cutaway)** |
|---|---|---|
| Primary surface | SVG (`Wson2DRenderer.svelte`) | WebGL via Threlte/three (`WellSchematic3D.svelte`) |
| Geometry per component | one/two `<rect>` or one `<path>` string | one watertight Manifold solid + boolean cut + mesh extraction |
| Booleans / CSG | **none** | `subtract(cutterBox)` (vertical) or half-section extrude + warp (deviated) per component |
| WASM | **none** on the 2D path | Manifold WASM per component, synchronous |
| GPU | **none** (SVG DOM) | full three scene: N meshes, DoubleSide, `<Edges>` per mesh |
| Cutaway technique | draw only the visible half as SVG rects (`buildDirSide`) | genuine solid − half-space **boolean** (`manifoldCut.ts:290-327`) |
| Depth warp (deviated) | 2D arc-slerp of ~30 path points (`buildDirPath`, `wsonRender.js:117`) | per-vertex parallel-transport loop over EVERY vertex of EVERY shell (`manifoldCut.ts:220-244`) |
| Thread | main thread, but trivial (string concat) | main thread, heavy (CSG + mesh loops) — **no worker** |
| Rebuild trigger | `geo = $derived.by(computeGeo)` — pure JS, cheap | `{#key geomKey}` full remount on cutaway/axis/diaScale/azimuth/directional change (`WellSchematic3D.svelte:142,362`) |

### The cheap ewells operations (quote)

`Wson2DRenderer.svelte` emits plain SVG. The whole "cutaway" for cement is two
rectangles filled with a dotted pattern (deep-dive §201): `<rect fill="url(#…-cement-fill)">`.
A warped section is ~30 sampled points turned into one path string:

```js
// wsonRender.js:117 — buildDirPath: an SVG polygon for a warped section
for (let i = 0; i <= steps; i++) {           // steps = 30
  const md = top + (bot - top) * i / steps;
  L.push(txPoint(-rL, md, wellDir, …));       // pure arithmetic
  R.push(txPoint( rR, md, wellDir, …));
}
return pts.map(p => `L${p[0]},${p[1]}`).join(' ') + ' Z';
```

`computeGeo` (`wsonRender.js:197`) — the entire 2D "build" — is one pure function
of arrays and closures. No `await`, no WASM, no `Manifold.*`. Cost ≈ a few
hundred float ops per well.

### The expensive cadtrain operations (quote)

Every layer is a `$derived.by` that builds a Manifold solid per entry. Casing
(the common case) — `WellSchematic3D.svelte:211-221` → `cutTube` →
`manifoldCut.ts:312-327`:

```ts
// vertical-well fast path — still 2 solids + 2 booleans + a full mesh loop
const outer = Manifold.cylinder(len, outerR, outerR, 64);
const inner = Manifold.cylinder(len + 0.02, innerR, innerR, 64).translate([0,0,-0.01]);
const ring  = outer.subtract(inner).translate([0,0,top]);   // boolean #1
const result = ring.subtract(cutterBox(cutAxis));            // boolean #2 (the cutaway)
return manifoldToColoredGeo(result, …);                      // per-triangle Float32 loop
```

`manifoldToColoredGeo` (`manifoldCut.ts:64-120`) walks **every triangle** of the
result, writing `nt*9` position + `nt*9` color floats and calling
`computeVertexNormals()`. For deviated wells you additionally run
`warpGeometry` (`manifoldCut.ts:144-248`), a loop over **every vertex** doing a
Rodrigues-rotated frame interpolation, plus a second `computeVertexNormals()`.

And in the template each shell also gets an `<Edges thresholdAngle={20}>` child
(`WellSchematic3D.svelte:372` etc.) — that's an EdgesGeometry pass per mesh, also
main-thread.

---

## 2. Root causes, ranked, with a cost model

Take a representative sample well (`samples/*.wson`, measured): **~3 OH + 3 CH +
3 cement + 1 tubing + 1-5 perf + 5-10 completions ≈ 15-25 components.**

Let **N** = component count (~20). Per-component 3D cost = build solids +
booleans + mesh-color loop (+ warp + edges). Call one such unit **C_csg**
(milliseconds-scale WASM boolean + JS mesh loops). Per-component 2D cost =
string concat, call it **C_svg** (microseconds).

| Rank | Root cause | Cost model | Evidence |
|---|---|---|---|
| **1** | **Default view is CSG 3D, not SVG 2D** | ewells first paint ≈ `N · C_svg` ≈ **~0 ms of CSG**. cadtrain first paint ≈ `N · C_csg` ≈ **20 · (2 Manifold builds + 2 booleans + 1 tri-loop)**. Ratio is ~1000× per component *and* ewells' `C_csg` term is multiplied by **0** because 3D isn't mounted. | `WsonApp.svelte:18,212,217` (2D default, 3D lazy) vs `WellViewPlaceholder.svelte:61` + `view-settings.ts:56` (3D only, cutaway on) |
| **2** | **All CSG is synchronous on the main thread** (no worker) | Even if 3D is the right default, `N · C_csg` runs inside `$derived.by` → blocks the frame + input for the whole build; on a long/deviated string this is the visible "hang". Super-linear because deviated warp is `O(verts)` and verts grow with segment counts. | no `Worker` in `src/lib/wells/**`; `$derived.by` at `WellSchematic3D.svelte:202,211,223,238,250,277`; memory `stack_cutaway_perf_root_cause` (cutaway CSG super-linear, 15k skip) |
| **3** | **Cutaway is a real boolean, not a clip plane / material** | Each visible half costs a full `subtract(cutterBox)` boolean + re-mesh, when the same look is a `clippingPlanes` render-state (0 geometry cost) or drawing only the half shell. Doubles the boolean count (ring subtract + cutter subtract). | `manifoldCut.ts:52-58` (`cutterBox` = 1e5 half-space cube), `:293,326,360` (`.subtract(cutterBox)`) |
| **4** | **Full rebuild on every view-dial change** | Changing diaScale / cutAxis / azimuth / directional bumps `geomKey` → `{#key}` remounts and re-runs *all* N CSG builds + re-derives every `$derived.by`. A slider drag can trigger many `N · C_csg` rebuilds. | `WellSchematic3D.svelte:142` (`geomKey`), `:362` (`{#key geomKey}`); dials in `view-settings.ts` |
| **5** | **Redundant mesh passes per component** | `manifoldToColoredGeo` tri-loop + `computeVertexNormals()` (×2 when warped) + an `<Edges>` EdgesGeometry per mesh. Adds a constant multiplier on top of C_csg. | `manifoldCut.ts:64-120,246`; `<Edges>` at `WellSchematic3D.svelte:372,385,397,406,416,435,448` |

The single biggest reason ewells is fast: **root cause #1 — its canonical,
default-rendered view is vector SVG with zero CSG**, so it never pays `C_csg` on
load. cadtrain's 3D-first stance (correct as a product principle per
`wells/CLAUDE.md`) means it pays `N · C_csg` up front, on the main thread, every
time — root causes #2-#5 are what make that payment *hurt*.

---

## 3. Levers for cadtrain, ranked by impact ÷ effort

Two families: **"match ewells"** (add the cheap 2D path / drop the boolean) vs
**"make our 3D fast"** (keep the CSG cutaway but stop it blocking).

| Lever | Family | Impact | Effort | Notes |
|---|---|---|---|---|
| **(a) Clip-plane cutaway instead of a boolean cut** | make-3D-fast | **High** — removes the `subtract(cutterBox)` boolean AND the deviated half-section extrude; build plain closed tubes once, hide the half with `renderer.clippingPlanes` / `material.clippingPlanes`. Cuts booleans ~2× and lets the *same* geometry serve any cut angle with **no rebuild** (kills lever #4 for cut changes). | Med | Three's `MeshStandardMaterial.clippingPlanes` + `localClippingEnabled`. Lose the grey cut-face vertex-color (`manifoldToColoredGeo`) — reproduce with a capping/stencil pass or `clipShadows`, or accept an open cross-section. |
| **(b) Draw nested tubes, don't subtract** | make-3D-fast / match-ewells | **High** — a casing is a `TubeGeometry`/`CylinderGeometry` annulus; nesting translucent tubes gives the "see inside" read with **zero booleans**. This is essentially what ewells' 3D decoy does and what its 2D does (nested rects). Combine with (a) for the half-section look. | Med | Removes Manifold from the hot path entirely for straight wells; warp stays as a vertex transform on plain geometry. |
| **(c) Move CSG off the main thread (Web Worker)** | make-3D-fast | **High for responsiveness**, neutral for total time | Med-High | cadtrain already ships `bake-worker.ts`/`bake-client.ts` for `/primitives`. Reuse it so the scene paints an immediate low-cost placeholder (plain tubes) and swaps in cut geometry when the worker returns. Doesn't reduce work; stops it blocking input. |
| **(d) Fast 2D SVG track view as the default** | match-ewells | **Highest impact-per-effort** — it IS ewells' speed, and the port is nearly free: `wsonRender.js` (`computeGeo`/`computeAnnotations`/`buildDirPath`/`perfArrows`/`cementRects`) + `Wson2DRenderer.svelte` are pure and unported (deep-dive §124-125). Add a 2D/3D toggle, default 2D, lazy-mount 3D like ewells. | **Low-Med** | Direct port; only gotcha is per-instance SVG `<defs>` id namespacing (`svgNs`) — cadtrain already learned this (`svg_gradient_id_collision`). Preserves the 3D-first *model* while making the *default paint* cheap. |
| **(e) Don't full-remount on dial changes** | make-3D-fast | Med — a slider stops triggering `N · C_csg` rebuilds | Low | Split `geomKey` so diaScale/azimuth (view-only, or handled by (a)) don't invalidate solids; only topology-affecting inputs rebuild. |
| **(f) Memoize / cache built shells** | make-3D-fast | Low-Med | Low | Key cut geometry by `(top,bot,r,cutAxis,profileFingerprint)` like the parametric `buildCached` LRU already does (`WellSchematic3D.svelte:302-319`) so tab-switches and unrelated edits don't rebuild everything. |

### Recommended order

1. **(d) 2D SVG default** — cheapest win, and it literally reproduces ewells'
   speed profile (it is the same code). Ships the fast first-paint immediately.
2. **(a)+(b) clip-plane + nested tubes** — the durable "make our 3D fast" fix:
   drop the boolean cutaway, keep the visual. Removes Manifold from the straight-
   well hot path and makes cut-angle changes free.
3. **(c) worker + (e)/(f)** — polish: never block input, never rebuild what
   didn't change.

Levers (d) and (b) are "match ewells' approach"; (a), (c), (e), (f) are "make our
3D fast" while keeping the 3D-first product principle intact.
