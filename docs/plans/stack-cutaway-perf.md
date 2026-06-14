# Plan — repeated-stack bake perf + long-string cutaway (one root cause)

**Investigated 2026-06-14** (two parallel read-only agents). The user asked two
questions that turn out to share ONE root cause:
1. "Why does stacking 3 joints take so long — could instanced mesh help?"
2. "A long string doesn't get the cutaway."

## Root cause (both): the cutaway CSG is super-linear

The stack **geometry** is already optimal — no fix needed there:
- `composition-emit.ts` (repeat/stack case): the child geom fn runs **ONCE**
  (`const A = g_dp_joint(...)`), then N **references** are translated +
  `place()`d. `place()` = `M.compose(ms)` (`manifold-helpers.ts:286-291`),
  topological, NOT a boolean union — "build once, place N translated copies."
- So the child is NOT rebuilt per copy. Geom build + compose are cheap/linear.

The dominant cost is **`finalizeManifold`'s cutaway** (`builder.ts:516-561`):
`manifoldToCutVC(scaled.subtract(cutBox), …)` does a CSG subtract over the
WHOLE composed manifold, and Manifold CSG scales **super-linearly**:
```
36k verts → 163 ms · 73k → 853 ms · 121k → 2.9 s · 181k → 5.9 s
```
A single joint ≈ 4–5k tris; 3 joints ≈ 12–15k; 15 joints ≈ 75k → ~850 ms cut.

### The 15k-tri skip (why long strings show no cutaway)
To cap that cost, `builder.ts:552-554` AUTO-SKIPS the cutaway when
`numTri() > 15_000` (returns an EMPTY `cutVC`). A long stack exceeds 15k →
cutaway skipped → toggling cutaway in the viewer renders nothing. This is
server-side; there is no client cutaway path. The decision is plumbed as:
`/api/primitives/preview` `cutaway` flag → `skipCutaway` (`preview/+server.ts:181`):
`cutaway:true → skipCutaway:false` (force), `undefined → 'auto'` (threshold).

### The override already exists (discoverability gap)
When skipped, the bake panel shows a "cutaway off (perf)" badge + a **Load**
button (`GraphEditorPane.svelte:6973-6980`) that re-bakes with `cutaway:true`.
It works — but it's buried, and toggling cutaway in the live canvas on a big
part silently shows nothing instead of pointing at Load.

## Recommendations (ranked)

### P1 — Per-part cutaway (the real fix, MEDIUM effort, fixes BOTH)
Apply the cutaway to the CHILD manifold ONCE (small, fast), then compose N
cut copies — instead of one CSG subtract over the N× composed result. Turns the
super-linear cost ≈ linear:
- 3 joints: ~150 ms → ~30 ms · 15 joints: ~850 ms → ~150 ms.
With per-part cutaway cheap, the 15k skip can be raised or dropped, so **long
strings get their cutaway for free**. Where: detect the repeat/stack pattern in
the bake (or `Manifold.decompose` the final manifold per-body, which exists)
and run `manifoldToCutVC` per body before/at compose. Watch: the empty-child
guard, `_stackRef/_refHead/_refTail` stamping, the graded-delta cursor, and the
red/grey vertex-colour convention must survive.

### P2 — Discoverability stopgap (LOW effort, ship now)
When the user toggles cutaway ON in the live canvas and `cutVC` is empty
(skipped), surface an inline "Cutaway skipped for performance — [Force]" button
(reusing the existing Load re-bake) instead of rendering blank. Optionally bump
the threshold 15k→25k after measuring a real 3-joint count.

### P3 — Render-level InstancedMesh (HIGH effort, does NOT help bake)
`THREE.InstancedMesh` would cut client GPU memory for N copies but requires
rewriting `mesh-serial.ts`, the bake `{full,cutVC}` format, the cache schema,
and `PrimitiveDualScene`. It does NOT address the bake-time CSG bottleneck.
Not recommended for the perf complaint; revisit only for GPU-memory at scale.

## P1 concrete plan — decompose → per-body cut → merge (Route A)

Deep-dived 2026-06-14. **The cut is distributive over `compose`**: composed
bodies occupy disjoint regions and `M.compose` is non-destructive (merges meshes,
no fusion), so
`(A ∪ B).subtract(cutBox)  ≡  A.subtract(cutBox) ∪ B.subtract(cutBox)`
for the GLOBAL cutBox (`getCutBox` = `M.cube([20,20,100],false).translate([0,0,-50])`,
`manifold-helpers.ts:485-488`). That equivalence is the whole fix.

- `Manifold.decompose(): Manifold[]` exists (`manifold-3d/manifold.d.ts:985`,
  used in `scripts/spike_csg_originalid.ts:134`) and **preserves `runOriginalID`**,
  so color-by-source survives decompose→cut→recompose.
- Change ONLY `finalizeManifold` (`builder.ts:516-561`): when NOT skipping,
  `bodies = scaled.decompose()`; if `>1` body, cut each by `cutBox` via the
  existing `manifoldToCutVC` path and **merge the BufferGeometries** (new
  `mergeBufferGeometries` helper — manual position/normal/color attribute concat;
  no THREE merge util in repo). Single body → cut directly. `decompose`
  missing/throws/empty → **fall back to `manifoldToCutVC(scaled.subtract(cutBox))`**
  (bulletproof try/catch). Cost: super-linear O(N_total) → ~linear Σ O(N_body).
- ONE code path: live preview, composition-bake, and GLB bake ALL call
  `finalizeManifold` → one change fixes all three. `cutawaySkipped` flag, the
  bake-cache `cutaway` bucketing, and the `/preview` signature are unchanged.
- Keep the 15k skip as a safety valve initially; once per-body cut is cheap,
  raise/drop it so long strings get cutaway by default.
- **Preserve**: `_stackRef/_refHead/_refTail` (manifold props, survive decompose),
  the empty-child guard, the graded-delta cursor, the SECTION_ID cut-box tag
  (`builder.ts:542`) that the color-by-source path keys on.
- **Test**: a single part's `cutVC` must be byte-identical via the new path
  (decompose()[0] == the whole); a 3-joint stack must render the cut (badge gone);
  color-by-source keeps per-body colours.

**SEQUENCING (2026-06-14):** the per-part inside/outside COLOUR feature (running)
also edits `finalizeManifold`/`manifoldToCutVC`/the colour LUT. Land the colour
refactor FIRST, then build per-part cutaway on top so `manifoldToCutVCSingleBody`
passes the colour params — avoids a builder.ts conflict.

## Reconcile
Add a `/plan` lane when scoped (Rule 19). P1 is the high-leverage item; P2 is a
cheap immediate UX win.
