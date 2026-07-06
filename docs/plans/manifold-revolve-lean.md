# Lean Manifold revolve for straight parts (Route C — ✅ SHIPPED 2026-07-06)

**STATUS: SHIPPED** (commit f85f52d). `g_shaft` `zSegments 10→0` on the volume
(backup `.route-c-backup/`); warp-gated `_axialMaxZSpan=1.5` dial in
`bake-worker-core.ts` + `preview/+server.ts`. Verified: straight well 528→96
tris (5.5×), warped 8448→2640 (3.2×, smooth = spike ref maxTurn 11.9°). Non-warp
byte-identical. **REMAINING (open): upgrade the constant span 1.5 → curvature-adaptive
via `planAxialStations`** so long/gently-curved wells aren't over-tessellated.

---
_Original spike write-up below (retained for the design rationale)._

Question: can the Manifold 3D-bake be as lean as TF on STRAIGHT parts? (bw_open_hole:
Manifold 528 tris vs TF 96.) Spike verdict: **YES, and it's a small, low-risk,
proven change** (now shipped, see above).

## Key findings (measured on the live Manifold kernel)
- Win is real: straight `bw_open_hole` **528 → 96 tris (5.5×)** with `g_shaft` zSegments 10→0.
- **Blast radius = ONE line.** Only `g_shaft` hardcodes `zSegments: 10`; every other
  revolve consumer already uses `r_revolve`'s lean default (`zSegments: 0`). So
  `r_revolve` is already lean; the tax is g_shaft's single hardcoded arg, which
  exists only so the warp-node part `w1_oh_warp` bends smoothly. g_shaft feeds BOTH
  the straight (`w1_oh_vert`) and warped (`w1_oh_warp`) wells → can't lean it
  without re-supplying density at warp time.
- **Route A (`warpSpline` `refine`) — NOT viable.** `refine:N` = native `Manifold.refine`
  (safe, pre-warp, not a Rule-25 post-bake rewrite) BUT it subdivides EVERY edge →
  couples axial+circumferential (n² bloat) and is skipped above 1200 tris. Lean+refine4
  collapses the warp to **1 ring → kink (FAILS smoothness gate)**; matching the
  reference needs refine 16–24 = 24k–55k tris. Wrong density source.
- **Route B (warp-emit injects zSegments down into the child revolve) — PLAN, cross-cutting.**
  Threading a density hint across `warp → bw_open_hole → g_shaft → r_revolve` needs a
  new param through every intermediate part with a silent-collapse footgun. Not spike-safe.

## Route C — RECOMMENDED (proven with numbers)
`revolveProfile` (manifold-mesh.ts:178) already honors a module-global `_axialMaxZSpan`
dial (`subdivideProfileAxial`) — set it for the duration of a warp bake and a LEAN
revolve auto-densifies its PROFILE at build time (Rule-25 clean: 2D profile, no post-bake
MeshGL rewrite). This mirrors EXACTLY what the sine-warp path already does in
`bake-worker-core.ts` + `preview/+server.ts` (`setAxialMaxZSpan((2π/freq)/16)`), and both
already text-detect `warpSpline(`.

Smoothness proof (lean g_shaft, refine stripped, dial set during the bake):
| config | tris | rings | maxTurn |
|---|---|---|---|
| CURRENT (zSeg10+refine4) | 8448 | 26 | 11.9° (reference) |
| LEAN + dial maxZSpan=1.5 | **2640** | 20 | **11.90°** (matches) |
| straight, dial OFF | **96** | — | (lean) |

→ warped part **3.2× lighter** at matching smoothness; straight part **5.5× lighter**.

## Precise implementation plan
1. **`g_shaft`** volume-data edit (`/api/primitives/save`): `zSegments: 10 → 0`.
2. **`bake-worker-core.ts`** (client) + **`preview/+server.ts`** (server): where they
   already compute `smoothWarp`/`warpedSrc` from `script.includes('warpSpline(')`, add a
   race-safe `setAxialMaxZSpan(span)` + restore around the SYNC geom call — identical to
   the existing sine-warp block (~lines 176 / 257-258). Guard so it doesn't fight the
   sine-`warpArg` dial when that's already active.
3. **Span heuristic**: start absolute `maxZSpan ≈ 1.5` (proven), then upgrade to
   curvature-adaptive via `planAxialStations`/`densifyProfileAxial` (the TF path's
   approach) so tight bends get more rings, straight runs fewer.
4. **Gate**: re-run the smoothness harness on `w1_oh_warp` (+ any `warpSpline` consumer):
   require ≥~20 interior rings and maxTurn ≤ ~12°.

## Caveats before doing it
- Touches volume-data `g_shaft` (durable store — back up / verify).
- `bake-worker-core.ts` is worker-adjacent (the TF-worker work touched nearby) — confirm
  no collision.
- `setAxialMaxZSpan` is NOT sandbox-injected, so an emit-body can't set it — the hook must
  live in the bake drivers (client core + server preview), as in the sine-warp precedent.

Risk: low-moderate. Mechanism (dial), `warpSpline(` detection, and set/restore discipline
all already ship; change is additive + gated by warp-detection so non-warped parts stay
byte-identical. Only real design call = the span heuristic.
