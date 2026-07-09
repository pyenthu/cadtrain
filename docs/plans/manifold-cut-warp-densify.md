# Manifold cut+warp densify (mirror TF) — bridging triangle fix

**Status:** SHIPPED 2026-07-10. **The 2026-07-09 diagnosis below was WRONG** — see
"Correction" before reading further.  

---

## Correction (2026-07-10) — measured, not theorised

The plan claimed `r_revolve` ignores `getAxialMaxZSpan()` and that fixing that is
the primary fix. **Both claims are false.** `r_revolve` calls `revolveProfile`,
which *already* applies the dial (`manifold-mesh.ts:178`, `subdivideProfileAxial`).
A probe on the real `bw_casing` shape, dial ON:

| stage | maxEdgeΔz | edges with Δz>3 |
|---|---|---|
| 1. hollow (`r_revolve − r_revolve`) | **1.48** | **0** |
| 2. after `sectionCut(180)` | **40.00** | **208** |
| 3. after `warpSpline` | 40.49 | 208 |

The revolve is already dense. **`solid.subtract(wedge)` is what destroys it**:
Manifold's mesh boolean RETRIANGULATES the planar cut faces it creates, throwing
away the refined wedge's z-rings and emitting a handful of full-height triangles.
Warp then bends those 40-unit edges into the bridging chord.

So the fix is the plan's *secondary* item alone — refine the CUT RESULT:

```ts
const cut = solid.subtract(wedge);
return maxZSpan > 0 ? cut.refineToLength(maxZSpan) : cut;
```

After: stage 2 → maxEdgeΔz **2.96**, 0 spanning edges; stage 3 (warped) → 3.54,
**0 edges over Δz 5** (was 104 over Δz 10). Warped volume error 3.8% → 0.03%.
Cost: 624 → 2710 verts on the test casing. `r_revolve` and `primitive-sandbox`
are UNCHANGED.

**Two caches hid this.** A `manifold-helpers` fix changes neither the part source
nor `scriptHash`, so (a) the server bake cache (`$APP_DATA_DIR/cache`, keyed on
body+dep sources) and (b) the client IndexedDB cache (keyed on `KERNEL_VERSION` +
`scriptHash`) both keep serving the pre-fix mesh. `KERNEL_VERSION` was bumped to
`+cut2`. Any future engine-internal fix needs the same bump — that is what the
`+cap1` note in `bake-worker-core.ts` was already warning about.

Tests: `sectioncut-warp-axial.test.ts` gained a `#64` block asserting SPANNING
EDGES (the old tests asserted "more verts + still manifold", which the pre-fix
build also satisfied — which is why they never caught it).

---

**TODO:** `#64` in root `TODO.md`.  
**Rule:** project **Rule 25** — segmentation / warp resolution at BUILD time, never a post-bake MeshGL rewrite.  
**Repro:** `/primitives` → `w1_oh_warp` → **3D BAKE** (not TF). Refs: `docs/plans/refs/cut-warp-3dbake-deformed.png` vs `cut-warp-tf-ok.png`.

---

## Symptom

- **`bw_casing` alone** — cutaway looks correct (no bridging triangle).
- **`w1_oh_warp`** — same casing, after `warpSpline`, Manifold 3D Bake shows a **spurious triangle connecting the cut ends** (stray badge historically ~237 → ~19 after wedge densify; residual remains).
- **TF tab** of the same graph — clean, no bridging tri.

Boundary: bug is **`sectionCut` (inside `bw_casing`) → `warpSpline` (in parent)**. Not the view-only Cross-section toggle (`cutVC`), not a cut baked into `g_shaft`.

---

## Volume facts (fetched 2026-07-09 — supersedes stale TODO notes)

| Part | Cutaway? | Body |
|------|----------|------|
| `g_shaft` | **No** | lean `r_revolve({…, zSegments: 0})` only |
| `bw_casing` | **Yes** `sectionCut(az:180)` | `A(g_shaft) − B(g_shaft)` → mv → cutaway |
| `bw_cement` | **Yes** same | hollow then cutaway |
| `bw_open_hole` | No | single `g_shaft` |
| `bw_prod_tubing` | No | hollow, no cut |

`w1_oh_warp` emitted body (simplified):

```ts
const C = bw_casing({ od: 7, wall: 0.4, length: 40, segments: 24, top: 10 });
const _mv_obj_1 = mv(C, [0, 0, 35]);
const A = bw_open_hole({ od: 9, length: 100, segments: 24 });
return [
  warpSpline(_mv_obj_1, path, { refine: 4, originZ: 0 }),
  warpSpline(A, path, { refine: 4, originZ: 0 }),
];
```

Stale claim in older TODO (“`g_shaft` bakes `sectionCut` into the leaf / double-cut”) is **wrong on current volume**.

---

## Why TF has no bridging triangle

TF does **not** warp the already-built coarse cut mesh. On `warp(cutaway(hollow tube))`:

1. `isRevolveTree` returns true through `cutaway` + `booleanDifference`  
   (`src/lib/shared/tf_examples/execute.ts` ~110–128).
2. `densifyRevolveTree` walks **through** the cutaway and densifies each **revolve profile** along the path (~138–156).
3. It **rebuilds** the whole tree: dense lathe → bore subtract → wedge cutaway → then `warpMeshJS` only moves vertex positions (topology unchanged).

Cut faces are created **after** the body already has many Z-rings; they inherit that ring structure and bend as arcs.

Key files: `execute.ts` (`isRevolveTree`, `densifyRevolveTree`, warp case ~450–505), `warp-spline.ts` (`warpMeshJS`, `densifyProfileAxial`).

---

## Why Manifold fails (and what “same as TF” means)

Bake already sets `_axialMaxZSpan` when the compiled script contains `warpSpline(`:

- `src/lib/cad/bake-worker-core.ts` ~182–185 (`WARP_AXIAL_MAX_ZSPAN = 1.5`)
- `src/routes/api/primitives/preview/+server.ts` ~261–265

That dial is the Manifold stand-in for `densifyRevolveTree` — densify at **build** time while the geom tree runs (Rule 25).

**Gap:** `r_revolve` **ignores** the dial. It only densifies when `zSegments ≥ 1` or an in-engine deviation path is set (`src/lib/cad/stdlib/r_revolve.ts` ~142–180). `g_shaft` ships `zSegments: 0`, so under a warp bake the shafts stay lean → hollow + `sectionCut` run on 2-ring bodies → cut faces get long diagonals → `warpManifoldAlongSpline` turns them into the bridging tri.

Contrast: the old helper `revolve()` in `manifold-helpers.ts` **does** call `subdivideProfileAxial(…, getAxialMaxZSpan())` — but volume parts use **`r_revolve`**, not that helper.

`sectionCut` already densifies the **wedge** via `refineToLength(maxZSpan)` when the dial is on (`manifold-helpers.ts` ~631–647; covered by `sectioncut-warp-axial.test.ts`). That helped (stray count dropped) but is **not enough**: Manifold’s mesh boolean can remesh planar cut faces and leave long diagonals; the existing test only asserts “more verts + stays manifold,” not “no spanning edges after warp.”

```mermaid
flowchart TB
  subgraph tf [TF]
    D[densifyRevolveTree through cutaway]
    B[rebuild dense revolve bore cut]
    WJ[warpMeshJS]
    D --> B --> WJ
  end
  subgraph manToday [Manifold today]
    Dial[setAxialMaxZSpan on warp bake]
    Lean[r_revolve zSegments 0 ignores dial]
    Cut[hollow then sectionCut]
    Warp[warpSpline]
    Dial -.-> Lean
    Lean --> Cut --> Warp
  end
  subgraph manFix [Manifold fix equals TF]
    Dial2[setAxialMaxZSpan on warp bake]
    Dense[r_revolve honors dial]
    Cut2[hollow then sectionCut on dense]
    Warp2[warpSpline]
    Dial2 --> Dense --> Cut2 --> Warp2
  end
```

---

## Chosen fix — mirror TF densify-then-rebuild via the axial dial

### Primary (TF-equivalent)

In `src/lib/cad/stdlib/r_revolve.ts`:

- When `getAxialMaxZSpan()` is set **and** effective `zSegments` is still 0, densify the `(r,z)` profile with that max Z-span (same math as the inlined `zSegments` block / `subdivideProfileAxial` in `manifold-mesh.ts`).
- Import `getAxialMaxZSpan` from `$lib/cad/manifold-mesh` (stdlib engine modules can import; the old “sandbox can’t inject” comment does not apply here).
- Dial off + `zSegments: 0` → **byte-identical** lean bake (non-warp parts unchanged).
- Dial on (warp bake) → dense rings **before** hollow / cut / warp — same structural order as TF.

### Secondary (keep + tighten)

In `src/lib/cad/manifold-helpers.ts` `sectionCut`:

- Keep existing wedge `refineToLength(maxZSpan)`.
- After `solid.subtract(wedge)`, also `refineToLength(maxZSpan)` when dial on — catches boolean remesh leftovers on cut faces.

**Do not** use `extrude(zlen, nDiv, 0)` — manifold-3d degenerate-slice bug (`nDivisions > 0 && twist === 0` → `"Not manifold"`; see `src/lib/cad/CLAUDE.md`).

No TF changes. No volume edits to `bw_casing` (engine fix covers all consumers).

---

## Implementation checklist

1. **`r_revolve` dial hook** — densify when `getAxialMaxZSpan()` set and `zSegments` effectively 0.
2. **`sectionCut` post-subtract refine** — `refineToLength(maxZSpan)` on the cut result when dial on.
3. **Unit test** — `r_revolve` dial ON + `zSegments: 0` → more verts than dial OFF; volume unchanged (`r_revolve.test.ts`).
4. **Integration test** — `bw_casing`-shaped hollow `(revolve − revolve)` → `sectionCut(180)` → `warpManifoldAlongSpline` under dial ON → near-zero spanning / stray tris (edge Δz ≫ maxZSpan, or near-zero area after bend). Extend `sectioncut-warp-axial.test.ts`. Dial OFF / bare path may still show spanners (documents the bug).
5. **Headless** — `bun run test` on those files.
6. **Browser** — `w1_oh_warp` on `/primitives` → 3D BAKE: stray ~0, no bridging tri on casing; TF still clean.

---

## Key files

| File | Role |
|------|------|
| `src/lib/cad/stdlib/r_revolve.ts` | **Primary fix** — honor axial dial |
| `src/lib/cad/manifold-mesh.ts` | `getAxialMaxZSpan` / `subdivideProfileAxial` |
| `src/lib/cad/manifold-helpers.ts` | `sectionCut` wedge + post-subtract refine |
| `src/lib/cad/bake-worker-core.ts` | sets dial when `warpSpline(` in script |
| `src/routes/api/primitives/preview/+server.ts` | same dial on server bake |
| `src/lib/cad/warp-spline.ts` | `warpManifoldAlongSpline` |
| `src/lib/shared/tf_examples/execute.ts` | TF reference (`densifyRevolveTree`) |
| `src/lib/cad/sectioncut-warp-axial.test.ts` | existing wedge densify tests — extend |
| `src/lib/cad/stdlib/r_revolve.test.ts` | dial ON lean densify unit |

---

## Out of scope

- View-only `cutVC` / scene sine-warp (`finalizeManifold` warp-then-cut).
- Client Manifold worker trap / no-fallback (already removed in `PrimitiveDualCanvas.svelte`).
- Curvature-adaptive `planAxialStations` — separate plan `docs/plans/curvature-adaptive-warp-subdivision.md`; dial stays fixed `WARP_AXIAL_MAX_ZSPAN=1.5` for this fix.
- Moving cut ownership between `bw_*` and `g_shaft`.
- TF changes (already correct for this graph).

---

## Related

- Audit: `docs/findings/manifold-vs-tf-audit.md` § Warp densification divergence.
- Older investigation notes in `TODO.md` (cut-then-warp / 237 stray) — this plan is the durable handoff; mark those done when #64 ships.
- Wells ladder: cut-then-warp primitives first (`wells` skill) — this bug blocks clean Manifold warps of half-sectioned `bw_*` elements.
