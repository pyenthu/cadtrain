# Bake performance — coarse-during-drag + smooth normals

> Measured 2026-06-17 with the client-exec timing instrumentation (the
> `[bake-worker]`/`[bake-client]` console logs behind `__bakeTimings`). Goal:
> make interactive editing snappy without sacrificing the final look.

## The measured breakdown (the data, not a guess)

Fresh client bake of `g_dp_stand` (40,848 tris · ×3 instanced) — at **seg 220**:

| Step | Time | Scales with |
|---|---|---|
| compile | **0.3ms** (cache hit) | source (cached → ~0) |
| **build** (Manifold CSG of one joint) | **70.1ms** | seg + CSG complexity |
| **mesh** (`manifoldToGeo`) | **47.4ms** | tri count (∝ seg) |
| **cutaway** (`subtract(cutBox)` + cut mesh) | **45.4ms** | tri count (∝ seg) |
| serialize | 5.6ms | tri count |
| transfer + deserialize (worker→main→THREE) | **~117ms** | vert count |

At seg 256 the whole thing is ~**769ms**. Conclusions:
- **The compile cache already fixed the compile cost** (0.3ms on a stable source;
  see `client-side-execution.md`). Param scrubbing no longer re-fetches `/compile`.
- **Cutaway ≈ mesh (~46ms each)** — the cutaway is NOT the dominant cost; lazy-
  cutVC alone only saves ~45ms.
- **`build + mesh + cutaway` ALL scale with `seg`** (the circumferential segment
  count, default 256). That's the single biggest lever.
- Sub-division is **circumferential, not vertical** — one joint ≈ `seg(220) × ~30
  profile-edges × 2` ≈ 13.6k tris; ~30 profile edges is reasonable. Z-rings fine.
- **~117ms is transfer/deserialize** for shipping 40k verts worker→main→THREE.

## The plan

### P1 — Coarse-during-drag (the big win)
Bake at a **low seg (~64) while the user is actively dragging/scrubbing**, snap to
**full seg (256) on settle**. Cuts build+mesh+cutaway ~4× at once (the 3 biggest
items). A drag-active signal + a debounced settle re-bake at full res.
- Triggers: param `dragNumber` inputs, the `seg`/scale inputs, any held-scrub.
- Implementation: a `scene.draftSeg` / drag-active flag → `effSegments` resolves
  to the coarse value while active; on settle (debounce ~150ms) re-bake at full.
  The existing `effSegments` coarse path + the `⚡draft` work
  (`session_handoff_2026-06-14`) are the hooks.

### P1b — Smooth normals make coarse LOOK fine (the enabler)
Per the **shading-normals** technique
(scratchapixel.com/.../introduction-to-shading/shading-normals.html): smooth
(vertex-interpolated) normals **decouple shading from geometry** — a coarse mesh
shades as if round; only the SILHOUETTE stays faceted. cadtrain already bakes
this: Manifold `calculateNormals(3, creaseAngle=60°)` + the `flatShading` toggle.
So the coarse-drag mesh must bake/render with **`flatShading: false` (smooth)** so
the user barely notices the lower seg. The **crease angle** keeps genuinely-hard
edges (cube corners, hex seams) crisp — smoothing only rounds curved surfaces.
- Caveat: smooth normals can't fix the silhouette polygon at very low seg — but
  during an active drag that's acceptable; the settle re-bake restores it.

### P2 — Lazy-cutVC (smaller win)
Only bake the cutVC when the cross-section is actually being viewed AND not in a
draft frame. Saves ~45ms when Cross-section is on. Secondary to P1.

### P3 — Transfer/deserialize (~117ms)
For big parts the worker→main transfer + `deserializeComponentResult` (build
THREE.BufferGeometry) is ~117ms. Investigate: avoid the number[]→Float32 repack
(already transferable), and whether the main-thread BufferGeometry build can be
trimmed. Lower priority — P1 shrinks the mesh that's transferred.

### P0 — Cleanup
Gate the `__bakeTimings` console logs behind a flag (currently always-on in the
worker for measurement) before shipping.

## Order
P0 (gate logs) → **P1 + P1b together** (coarse-drag with smooth normals — the
win) → P2 (lazy-cutVC) → P3 (transfer). P1+P1b is the bulk of the interactive
gain.
