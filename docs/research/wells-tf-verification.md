# Wells library — TrueForm (TF) native-build verification

**Date:** 2026-07-04 · **Scope:** confirm the WELL primitives + assemblies compile
to a **fully native** TrueForm recipe (graph → TF) with **no Manifold mesh-import
fallback**.

**Method (headless, read-only):** for each part, fetched `meta.graph` via
`/api/primitives/source` (parsed with `extractMetaFromSource`), POSTed
`{graph, params:{}, id}` to `/api/tf/compile` (server graph→TF translator that
recursively inlines composite `Call`s), then scanned the returned `recipe.instrs`
tree for any `UNSUPPORTED` op and summarized the op mix. Executor coverage
checked against `src/lib/shared/tf_examples/execute.ts` (`buildInstr`).

## Results

| Part | kind | Root node types | Recipe ops (`/api/tf/compile`) | Native? |
|---|---|---|---|---|
| `bw_casing` | asm | list · 2× call `g_shaft` · subtract | `diff(revolve(4pt),revolve(4pt))` | **NATIVE ✓** |
| `bw_tubing` | asm | list · 2× call `g_shaft` · subtract | `diff(revolve,revolve)` | **NATIVE ✓** |
| `bw_open_hole` | asm | list · 2× call `g_shaft` · subtract | `diff(revolve,revolve)` | **NATIVE ✓** |
| `bw_cement` | asm | list · 2× call `g_shaft` · subtract | `diff(revolve,revolve)` | **NATIVE ✓** |
| `bw_hanger` | asm | list · polygon · call `r_revolve` | `revolve(5pt,seg32)` | **NATIVE ✓** |
| `w_cased_hole` | asm | list · call `bw_open_hole` · `bw_cement` · `bw_casing` | 3 roots, each `diff(revolve,revolve)` (6 revolves) | **NATIVE ✓** |
| `w_multi_string` | asm | list · 3×(`bw_open_hole`+`bw_cement`+`bw_casing`) | 9 roots, each `diff(revolve,revolve)` (18 revolves) | **NATIVE ✓** |

**All 7 parts: `notes=[]`, zero `UNSUPPORTED` instrs anywhere in the tree.**

## What this confirms

- **`bw_*` bored tubes** are exactly the predicted shape: `g_tube`-style
  `subtract(g_shaft, g_shaft)` → `booleanDifference(revolve, revolve)`. Each
  `g_shaft` lowers to a closed half-section `revolve` (4 profile pts ≥
  `MIN_PROFILE_PTS`=3), so the native lathe (`tfRevolveProfile`) has a valid
  section. `bw_hanger` is a `polygon → r_revolve` (5-pt section) → single native
  `revolve`.
- **Composite recursion works.** `w_cased_hole` / `w_multi_string` are a `list`
  of composite `bw_*` `Call`s. The compile endpoint's `buildCompositeMap` BFS
  fetched each `bw_*` source, parsed its `meta.graph`, and `graphToTf` inlined it
  — so the assemblies lower to 3 and 9 native `booleanDifference(revolve,revolve)`
  root outputs respectively, NOT `UNSUPPORTED` composite Calls. (Segment count is
  48 in the assembly context vs 24 standalone — the assembly passes a higher
  `segments`.)
- **Executor (`execute.ts`) has a builder for every op these recipes use:**
  - `revolve` → `tfRevolveProfile` (lathe) ✓
  - `booleanDifference` → `t.booleanDifference(obj, arg).mesh` ✓
  - the multi-root `union` (assemblies emit N root instrs) → `executeTfRecipe`
    folds them with `t.booleanUnion` ✓
  - `recipeHasUnsupported` returns **false** for all 7 (every revolve section has
    ≥3 pts), so none hits the `tfImportMesh` fallback.
  - **No executor gap.** The full op set `buildInstr` supports (revolve, profile,
    box, cylinder, sweep, boolean{Difference,Union,Intersection}, union[+mated],
    translate, rotate, repeat) is a superset of what the well library emits.

## Verdict

**The well library is TF-READY.** All 5 `bw_*` primitives and both `w_*`
assemblies compile to a **fully native** TrueForm recipe (revolve +
booleanDifference, with composite Calls recursively inlined) — none falls back to
importing a baked Manifold mesh. The executor implements every op in these
recipes.

**Caveat (not a fallback):** this verifies the *compile* half is native + the
*executor* has the builders. The actual native TF *render* (running the recipe
against the live 31 MB WASM kernel) is the parent's `:3333`/TF-tab job and was not
executed here (headless, no browser). Also note the `w_*` assemblies carry no
`translate`/`rotate` in the recipe — the concentric strings are positioned purely
by param (OD/length) differences, which is correct for nested casing/cement/hole;
if future well authoring needs axial offset between strings, that positioning
would need `Mv` nodes in the graph (they'd lower to native `translate`, already
supported).
