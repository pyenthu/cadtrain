# graph ↔ shared overlap — architecture audit

Where `src/lib/graph/` (CAD-domain composition-graph) and `src/lib/shared/` (meant to be cross-domain reusable UI) overlap, duplicate, and violate the layering rule — with the concrete moves to fix it.

**Date:** 2026-07-12 · **Scope:** `src/lib/graph/` vs `src/lib/shared/`. The stated rule (`shared/CLAUDE.md`): *domain libs may import from `shared/`; `shared/` must not import from domain libs.*

---

## Headline

The overlap is **significant and structural, not cosmetic.** `src/lib/shared/graph-editor/` is not cross-domain UI at all — it is the CAD node-graph editor's own glue, and it imports from `$lib/graph/` **77 times**, which the rule forbids entirely. The two trees form a **directory-level import cycle** (`graph/` ⇄ `shared/graph-editor/`, and `graph/` engines ⇄ `shared/profiles/`). The single most important issue: an entire ~40-file CAD-editor module (`shared/graph-editor/`) is misfiled under `shared/`; **moving it under `graph/` erases 76 of the 77 rule violations at a stroke.** On top of that sit three genuinely duplicated abstractions (`PartAppearance`, the profile-kind registries, `ParamSchema`).

## Duplicated abstractions

| Concept | `graph/` location | `shared/` location | Verdict |
|---|---|---|---|
| **`PartAppearance`** | `composition-graph-types.ts:783` — `type` with 5 optional fields (`colorOuter/colorInner/material/opacity/texture`) | `viewer/part-appearance.ts:2` — `interface`, same 5 fields (**canonical**; imported by `graph/part-lut-types.ts:5` + `graph/glb-client.ts:28`) | **True duplicate, structurally identical.** Delete the graph copy, import from viewer. Zero-risk (TS structural typing already makes them interchangeable). |
| **Profile-kind registry** | `profile-templates.ts` — `CARTESIAN_TEMPLATES`/`REVOLVE_TEMPLATES`, each a **source-code `body` string** + `partParams`; scaffolds new part files | `profiles/profile-presets.ts` — `PROFILE_REGISTRY`, each a **runtime `build:(p)=>Pt[]` fn** + `resolveProfile()`; injected into the sandbox, imported by 4 engines + `primitive-sandbox` + `brep-occt` + `graph-to-tf` | **Two parallel registries, same catalog encoded twice, DRIFTED.** `PROFILE_REGISTRY` is the source of truth. Not a simple delete (runtime fns vs source strings). |
| **`ParamSchema`** | `composition-graph-types.ts:655` — discriminated union `NumberParam \| RecordParam \| ListParam` (the #38 typed-ports model) | `ui/ParamGrid.svelte:21` — flat render type (`type?: 'number'\|'boolean'\|'polygon'\|'enum'` + display fields) | **Name collision, drifted shapes.** The grid's type silently ignores `record`/`list`. Rename to `ParamCardSchema` (or consume `NumberParam`). Low priority. |

**Profile-registry drift (concrete):**
- Cartesian: presets has `t` (T-section) that templates lacks; templates has `gear` that presets lacks. Both share rect/ngon/ellipse/star/l/plus.
- Revolve: presets has 4 drill-pipe kinds (`drill_pipe_pin/box`, `dp_spec_pin/box`) that templates lacks entirely.
- Param specs diverge (e.g. `ngon` radius `min` 0.02 in presets vs 0.05 in templates), and the polygon shape math is written **twice** — once as a function (`ngonPts`, `rect`), once as a source string (`Array.from({length:n}…)`).

## Dependency-rule violations

**77 `shared → graph` import lines:**

| Subdir | Import lines | Assessment |
|---|---|---|
| `shared/graph-editor/` (incl. `expr/`) | **76** | **All misfiled** — CAD-graph-specific editor glue, not cross-domain. |
| `shared/types/TypeDefinerPanel.svelte` → `graph/port-types` | **1** | Domain-coupled (typed-ports is a graph concept). Move with the cluster. |

**Worst offenders (per file):** `GraphEditorPane.svelte` (7), `expr/ExpressionBuilderPopup.svelte` (6), `sketch-state.svelte.ts` (5), `NodeCard.svelte` (4), `geom.ts` (4), then `wire-state`/`spline-state`/`node-palette`/`ExprImperativeBlocks`/`AutoWireSuggestPanel` (3 each).

None of `shared/graph-editor/` is genuinely cross-domain — its own docblocks give it away (`geom.ts:2` "geometry helpers for the node-graph CAD editor"; `controller.svelte.ts:2` "the per-pane TRUNK of the editor"; the `*-state` files operate directly on `Graph`).

**The reverse direction (`graph → shared`, 8 lines) closes a second cycle:**
- `graph/{part-lut-types,glb-client}.ts` → `shared/viewer/part-appearance` (the dup above).
- `graph/primitive-sandbox.ts` + `graph/stdlib/{r_loft,r_revolve,r_weld_extrude,stale/r_extrude}.ts` → `shared/profiles/profile-presets` (`resolveProfile`). **6 engines reaching UP into `shared/` for a domain runtime** → `profile-presets.ts` is *also* misfiled.
- `graph/nodes/emit-golden.test.ts` → `shared/graph-editor/graph-editor-bake`.

## Literal duplication

Mostly negligible. The one real instance: the profile **shape math is written twice** — rect/ngon/star polygons as runtime functions in `profile-presets.ts` *and* as equivalent source-code strings in `profile-templates.ts` (drifts, see above). No copy-pasted vector-math / id-hashing / formatting helpers span the two trees (hashing lives only in `graph/`; vector math in `engines/manifold`).

## Recommendations (ordered by value)

1. **Move `shared/graph-editor/` → `graph/editor/`** (or a dedicated `src/lib/cad-editor/`). **The headline fix** — 76 of 77 violations become intra-module imports; the cycle disappears. Already a cohesive, tested unit (the modularize K.65 decomposition). Mechanical `git mv` + path rewrite. **Risk: wide import-path churn** (routes `/graph-editor`, `/primitives`, + `graph/nodes/emit-golden.test.ts`). Land as its own commit with a green build; don't fold other changes in.
2. **Delete `PartAppearance` at `graph/composition-graph-types.ts:783`; import from `shared/viewer/part-appearance`.** Standalone, zero-risk — do immediately.
3. **Move `shared/profiles/profile-presets.ts` into `graph/` (or `engines/`).** It's the profile runtime imported by 4 engines + sandbox + brep + graph-to-tf — domain code, not cross-domain UI. Converts 6 `graph → shared` imports to internal; kills the second cycle.
4. **Reconcile the two profile registries.** Minimum: align the kind lists + param specs. Better: derive scaffold `partParams` from the single `PROFILE_REGISTRY`. **Flag:** they encode different artifacts (runtime fn vs source string), so a full merge is non-trivial — scope deliberately, not inside the move commits.
5. **Rename `ParamGrid.svelte`'s local `ParamSchema`** → `ParamCardSchema`. Cosmetic; low priority.
6. **Move `shared/types/TypeDefinerPanel.svelte` with the step-1 cluster** (imports `graph/port-types`).

**Net effect:** steps 1–3 eliminate every `shared → graph` violation and both directory-level cycles, leaving `shared/` as what its CLAUDE.md claims — genuinely cross-domain UI (`viewer/`, `svg/`, `ui/`, `volume/`, and the profile *editor* components once the profile *runtime* moves out).

**Key files:** `src/lib/shared/graph-editor/` (whole dir) · `src/lib/shared/profiles/profile-presets.ts` · `src/lib/graph/profile-templates.ts` · `src/lib/graph/composition-graph-types.ts:783` + `:655` · `src/lib/shared/viewer/part-appearance.ts` · `src/lib/shared/ui/ParamGrid.svelte:21`.
