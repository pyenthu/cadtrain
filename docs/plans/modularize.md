# Plan — Modularize cadtrain (K.65)

> Status: planning. Author: 2026-06-16. Supersedes the targeting in memories
> `todo_modularize_k65` + `todo_modularize_grapheditorpane` (their module
> boundaries still hold). Cross-links: `/plan` id 667 (K.67 composition-arch,
> independent), `docs/plans/composition-architecture.md`.
>
> **Thesis:** the codebase grew a 9.6k-line monolith (`GraphEditorPane.svelte`)
> plus a dozen 500–1700-line files. Nearly every edit this cycle was fragile
> *because of size* (socket↔DOM Y-math buried in 1000+ CSS lines; concurrent
> worktree edits to the monolith just produced a 500). This plan does
> **mechanical extraction, zero behaviour change**, smallest-safest-first,
> one PR per phase, `bun run build` + `bun test` green at every step.

---

## 0. Guiding rules (read before touching anything)

1. **No behaviour change.** Every PR is a pure refactor. If geometry, a render,
   a socket position, or a saved file would differ, it is out of scope.
2. **Extract pure logic before stateful UI.** Pure TS modules (no `$state`, no
   DOM) are type-checked at every call site and trivially testable. Do those
   first; they de-risk the later component splits.
3. **One monolith, one editor at a time — NEVER parallel agents on
   `GraphEditorPane.svelte`.** Concurrent worktree edits to the monolith
   clobber each other on merge (this just produced a 500). Sequential PRs only.
   Rebase the next phase on the merged previous phase before starting.
4. **Verify each PR**: `bun run build` (tsc + vite) green, `bun test` green,
   then `bun run test:graph` (graph-editor e2e) for any GraphEditorPane phase.
   Record per Rule 12.
5. **Svelte-5 caveats** (memory `fresh_array_props_effect_loops`,
   `canvas_height_contract`): pass STABLE memoised refs across new component
   boundaries; never a fresh array/object literal per render → re-mount +
   auto-fit loop. Scoped `<style>` can't move to a plain `.css` without losing
   scoping; CSS shrinks as a *side-effect* of component extraction, not as a
   standalone step.
6. **Don't delete in the modularize pass.** Stale-code candidates (§3) get a
   confirm-then-remove pass AFTER extraction lands, separately, with backups
   (Rule 4 atomic-store / Rule 6 destructive-approval).

---

## 1. Census (lines, `wc -l`, 2026-06-16)

| Rank | File | Lines | Kind |
|---|---|---:|---|
| 1 | `src/lib/shared/GraphEditorPane.svelte` | **9635** | THE editor (script 4778 · markup ~3370 · style ~1460) |
| 2 | `src/routes/vocab/+page.svelte` | 1687 | route page |
| 3 | `src/lib/cad/composition-graph.ts` | 1653 | graph model |
| 4 | `src/routes/primitives/+page.svelte` | 1573 | route page (sidebar + tabs) |
| 5 | `src/lib/shared/ProfileFnEditor.svelte` | 1156 | component |
| 6 | `src/lib/cad/builder.ts` | 1048 | legacy build + live render helpers |
| 7 | `src/lib/cad/composition-tree.ts` | 798 | TreeNode model |
| 8 | `src/lib/cad/composition-emit.ts` | 699 | graph→source |
| 9 | `src/routes/design/+page.svelte` | 696 | **undocumented route** (see §3) |
| 10 | `src/lib/authoring/rule-translator.ts` | 587 | vocab translator |
| 11 | `src/lib/server/primitive-loader.ts` | 576 | resolver/loader |
| 12 | `src/lib/cad/manifold-helpers.ts` | 559 | raw shape toolkit |
| 13 | `src/lib/server/manifold-bake.ts` | 540 | bake |
| 14 | `src/lib/shared/PrimitiveDualCanvas.svelte` | 532 | dual canvas |

**Goal:** no live `src/` file > ~1000 lines without a documented reason;
`GraphEditorPane.svelte` reduced to a < ~1500-line composing shell.

---

## 2. GraphEditorPane — extraction map

Internal structure (line ranges, 2026-06-16): `<script>` 20–4798 ·
markup 4800–8172 (canvas SVG + node cards + PARAMS/PROPERTIES cards + right
tabbed pane) · `<style>` 8173–9635. The script holds ~200 functions plus
117 `$state`, 31 `$derived`, 10 `$effect`. Below: cohesive seams, ordered
smallest-safest-first.

### 2a. The hard part (why this is not a 1-day job)

A huge shared-`$state` surface is threaded through every render arm: `graph`,
`wireFrom`, `selected*`, pan/zoom (`tx`/`ty`/`scale`), `sketchEditor`, the
~10 popover open-states. Extraction needs deliberate plumbing:

- **Pure functions** → free to move (no state captured).
- **Stateful UI** → either (a) a child component with explicit `$bindable`
  props + callbacks, or (b) a `*.svelte.ts` rune-state module imported and
  shared. Prefer (b) for cross-cutting state (wire-state), (a) for
  self-contained panels (sketch editor, right pane).
- **The socket↔DOM Y-math is the crown jewel of fragility.** `polyRowTop` /
  `polySock{R,Z,Ref}` / `sketchRowTop` / `sketchSock{R,Z,Val,X}` /
  `nodeSize` / `inlineXform*` / `outputSocketAt` / `inputSocketAt` compute SVG
  circle positions that MUST match the pixel heights of HTML rows rendered in
  `<foreignObject>`. Co-locating them in one documented module is itself a
  maintainability win (memories `entry_idx_eval_idx_gotcha`,
  `fresh_array_props_effect_loops`).

### 2b. Per-extraction table (do in this order)

| # | Extract → new module | What moves | Risk | Notes |
|---|---|---|---|---|
| **G1** | `graph-editor-geom.ts` (pure TS) | `bezier`, `intrudeBounds`, `chipWidthFor`, `paramPos`, `paramCardSize`, `paramSocketPos`, `extractParamRefs`, `nodeSize`, `polyEntryH`, `polyRowTop`, `polySock{R,Z,Ref}`, `sketchCols`, `sketchRowTop`, `sketchSock{R,Z,Val,X}`, `sketchRowVisible`, `containerSlotY`, `inlineXform{Order,Strip,Socket,Output}`, `inlineCardH`, `outputSocketAt`/`inputSocketAt`/`containerSlotInputAt` (the pos math), `evalArgValueScalar`, `entryIdxForEvalIdx`, `cardMinWidth`/`cardAutoWidth`, `miniBez`/`miniParamPos`/`miniParamSock` | **LOW** | Stateless; every call site tsc-checked; deterministic. The #1 first cut. Add a `*.test.ts` pinning `polyRowTop`/`sketchRowTop` ↔ row-height contract. Est. −500…700 script lines. Some take `node`/state as args — pass them in, don't capture. |
| **G2** | `graph-editor-args.ts` (pure TS) | `argStr`/`argFrom`/`argToDraftStr`, `evalArg`, `sketchParamScope`, `parseProfileExpr`, `kindsForSet`, `producerLabel`, `profileProducers` (the pure parts) | LOW | Pure arg/expr formatting + profile-kind lookups. |
| **G3** | `wire-state.svelte.ts` (rune-state module) | `wireFrom` state + `armWire`/`startWire`/`startParamWire` + the full `endWireOn*` family (input, callArg, polygonCoord, polyRepeatCount, polygonRepeatRef, transformAxis, sketchCoord, sketchPoint, containerSlot, repeatCount, repeatChild), `unwireTransformAxis`, `releaseImplicitCapture` | MED | Cross-cutting; touches `graph` + pointer capture. Keep the text-substitution wiring AS-IS so K.67 has one small file to rewrite (memory `todo_modularize_k65`). Touch implicit-capture gotcha applies (memory `touch_implicit_pointer_capture`). |
| **G4** | `SketchEditorPane.svelte` | the full-tab sketch editor: tools rail, 2D canvas, PARAMS+ops sidebar, all `sketch*` handlers (`sketchCanvasClick/Wheel`, `sketchAnchor*`, `sketchBar*`, `sketchCardResize*`, `sketchStage*`, `splineComp*`, `fitSketchFrame`, corner dial `cornerAtOpIdx`/`applyCornerAt`/`bindCornerParam`), the `sketchEditor` derived + frozen-frame | MED-HIGH | Largest self-contained chunk (~108-line block already moved once into `.ge-canvas-pane`). Props: the sketch node + param scope + callbacks. Verify against `sketch.test.ts` + `sketch-collayout.test.ts`. |
| **G5** | `RightPane.svelte` (tabbed) | the `<section class="ge-right-pane">` (7082+): bake / source / md / svg / glb / brep tabs, `setRightTab`, the lazy `PrimitiveDualCanvas`/`PrimitiveSvgView` imports, `brepMeta`/`brepParamValues`, `svgRes`, `generateMdWithAi`, `loadCutaway`, split-drag (`startSplitDrag`/`onSplitMove`/`endSplitDrag`) | MED | Self-contained right column. Pass `source`/`params`/`graph`-output as STABLE memoised props (canvas-height + fresh-array gotchas — memories `canvas_height_contract`, `fresh_array_props_effect_loops`). |
| **G6** | `NodeCard.svelte` dispatcher (+ one sub-component per node type) | the per-node render arms in markup 5340–6700: Call / Container / Method / Mv / Rot / Repeat / Stack / Polygon / PolyRepeat / Sketch cards. Either one dispatcher with labelled `{#if}` arms or N small components | HIGH | Most shared-state-dependent. Do LAST of the components. Each arm reads `graph`, selection, wire-state (G3), geom (G1). Enumerate leaf types explicitly — polygon/poly_repeat have no `children` (memory `autolayout_predecessors_polygon_crash`). |
| **G7** | `PropertiesCard.svelte` + `ParamsCard.svelte` | the PROPERTIES card (z-offset/color/material, 6596+) + the PARAMS card overlay + add-param pop (6679+) | MED | Both are viewport-glued overlays outside the pan/zoom group. Keep them outside the group (don't reparent). |
| **G8** | popovers → `graph-editor-popovers/` | profile picker/ref pop, arg-expr pop, sketch-expr pop, poly-expr pop, transform-axis-expr pop, container reorder pop, ai-menu, canvas-menu, call-picker. The `open*Pop`/`close*Pop`/`apply*Pop` families | LOW-MED | Many small, near-identical anchored-dropdowns. FloatingPanel z-index rules (memory `floating_panel_z_index`); portal tooltips for clipped chrome (memory `tooltip_native_title_for_clipping`). |
| **G9** | `graph-editor-bake.ts` glue | `runBake`, `setAutoBake`, `rebuildCache`, `restartDevServer`, `extractGraphFromSource`, `extractDrawingMdFromSource`, `loadExpectedParamsFor`, `refreshCallArgs`, `isCallDrifted`, the `dropX` palette handlers (`dropCsg/Mv/Rot/Stack/Pen/Polygon/Sketch/Solid/Repeat`) | MED | Orchestration; some need `graph` mutators. Pull `autoLayout`/`resetGraph` glue here too (auto-layout deps already in `composition-layout.ts`). |

After G1–G9 the residual shell is: props, top-level `$state` declarations,
the `onMount`/keydown wiring, the canvas `<svg>` host + pan/zoom group, and
slots for the extracted children. Target < ~1500 lines.

**The CSS (~1460 lines) is NOT a standalone step.** It rides along: when a
component leaves, its scoped `<style>` rules leave with it. What remains after
G4–G8 is canvas/shell chrome only.

---

## 3. Other large files — extraction notes

| File | Lines | Split suggestion | Risk |
|---|---|---|---|
| `routes/vocab/+page.svelte` | 1687 | Pull the Inferred/Topology/Bake/Promote tab bodies into `vocab/_tabs/*.svelte`; keep `+page` as the tab shell. Shares `ParamGrid`/`PrimitiveDualCanvas`/`CompJsonSilhouette` — don't fork. | MED |
| `composition-graph.ts` | 1653 | Split by concern: `composition-graph-types.ts` (discriminated unions + `ArgValue`), `composition-graph-mutators.ts` (the `addX`/`setX`/`removeX` family), `composition-graph-hydrate.ts` (hydrate + version migrations). Keep one barrel `composition-graph.ts` re-export so importers (incl. the 50+ in GraphEditorPane) don't churn. | LOW-MED — pure TS, fully test-covered (`composition-graph.test.ts`). |
| `routes/primitives/+page.svelte` | 1573 | Extract `Sidebar.svelte` (the Windows-Explorer tree — already an in-flight branch) + `TabStrip.svelte`; `+page` becomes layout glue. Grid `display:none` auto-placement gotcha (memory `grid_display_none_auto_placement`) — watch portrait. | MED |
| `ProfileFnEditor.svelte` | 1156 | Separate the 3D preview (`ProfileFn3DCanvas` already split) from the fn-source round-trip. Known lossy `composeSource` bug (memory `profile_editor_composeSource_bug`) — add a round-trip test BEFORE splitting. | MED |
| `builder.ts` | 1048 | Two unrelated concerns fused: (a) legacy `ComponentDef` builders importing `library.ts`, (b) LIVE render helpers (`finalizeManifold`, `setRenderZScale`, `manifoldToGeo`/`CutVC`) used by `/api/primitives/preview`. Split into `builder-legacy.ts` + `render-helpers.ts`. The legacy half is a stale-code candidate (§4). | MED |
| `composition-tree.ts` | 798 | Used by vocab-regenerate + rule-translator + profile-templates. Lower priority; split TreeNode model vs traversal helpers if it grows. | LOW |
| `composition-emit.ts` | 699 | Already focused (graph→source). Leave unless it crosses 1000. | — |
| `rule-translator.ts` | 587 | Leave; cohesive. Audit the JSON-meta regex extractors (memories `json_stringify_meta_regex_traps`, `parsemetaparams_nested_brace_bug`). | — |
| `primitive-loader.ts` | 576 | Leave; route all source resolution through it (memory `primitive_source_resolution_paths`). Don't fragment the resolver. | — |
| `manifold-helpers.ts` / `manifold-bake.ts` / `PrimitiveDualCanvas.svelte` | 559/540/532 | Below threshold; no action this cycle. | — |

---

## 4. Stale / dead-code candidates (confirm, don't delete yet)

**Method to confirm dead-ness (no deletion in this pass):**
1. `grep -rln "from.*<module-stem>" src/` for importers (exclude the file
   itself, `*.test.ts`, `CLAUDE.md`).
2. For runtime-injected helpers (sandbox), also grep the injection site
   (`primitive-sandbox.ts`) — a symbol can be live via injection with no static
   import.
3. Add `knip` (or `ts-prune`) as a dev-only tool: `bunx knip` for unused
   exports/files. **Not in devDeps today** — adding it is a 1-line PR and the
   single highest-leverage dead-code instrument. Run it, triage, DON'T
   auto-delete (it can't see sandbox injection or `import.meta.glob`).
4. Confirm against `archive/CADTRAIN_CLEANUP.md` revival notes before removing
   anything tracked.

| Candidate | Evidence | Verdict |
|---|---|---|
| `cad/library.ts` (`COMPONENTS` catalog) | imported ONLY by `builder.ts` (legacy `ComponentDef` build path); CLAUDE.md cad map says "kept only because builder.ts imports it" | **Likely dead-chain.** Lives only to feed `buildPrimitiveManifold`'s legacy `ComponentDef` fallback. Confirm no active volume part resolves through `COMPONENTS`; if none, library.ts + the legacy half of builder.ts retire together (a vertical slice). HIGH-value, MED-risk — do AFTER builder.ts split (§3). |
| `routes/design/+page.svelte` (696) | **Not in the CLAUDE.md route table.** No `href="/design"` found from `/` or `/plan`. Self-describes as a "what is this project" page; references stdstale by name | **Undocumented orphan.** Either (a) link it + document in CLAUDE.md route table, or (b) move to `archive/`. Ask the user — don't silently remove a route. |
| `shared/warp.ts` `subdivideAlongZ` + `warpSubdividedGeo` | The 2026-06-16 merge "bake warp as a real Manifold deformation (edges follow geometry)" moved warp into the kernel. `subdivideAlongZ` is the OLD render-time stopgap (still called in `PrimitiveDualScene` + `ComponentSceneGlb`); `manifold-mesh.ts` comment already calls it a "render-time stopgap" | **Reverted-remnant candidate.** Now that warp bakes into geometry, the per-frame subdivide may be redundant. Verify edges still follow with it removed (the whole point of the merge) — if so, retire `subdivideAlongZ` + both call sites. MED-risk; needs a visual e2e. |
| `cad/stdstale/` engines (`r_revolve`, `r_extrude`, `r_weld_extrude`) | Deliberately kept "resolvable so legacy parts bake" (Rule 21). TODO.md item 12 asks "r_weld_extrude in stale but is it not used?" | **Keep — intentional.** Confirm via `grep -rl "r_weld_extrude\|r_revolve\|r_extrude" <volume>/primitives` whether any volume part's `meta.uses` still references them. If zero references, they can `git mv` out — but that's a separate decision (Rule 21), not modularize scope. Answer TODO #12: needed only while a part's `meta.uses` names it. |
| `archive/` tree | TRACKED but invisible to vite/tsc/router | **Not dead — frozen.** Confirm no live `src/` import reaches into `archive/` (should be zero). Leave as-is. |
| Loaded-but-unrendered profiles | `primitive-loader.ts` fetches every `meta.uses` dep even if the body never calls it (memory `permanent_delete_audit_meta_uses_2026-06-02`) | Not dead code — a *correctness* note for the delete-audit. Keep in mind during the library.ts slice. |

---

## 5. Failure modes / fragility hotspots to harden

These are the sharp edges that made edits dangerous. Hardening here is the
*point* of the exercise — extraction gives each a home + a test.

| Hotspot | Where it lives | Symptom | Hardening idea |
|---|---|---|---|
| **WASM-singleton corruption** | local dev `:3333`, `/api/primitives/preview` (+ `bake-preview`, `profiles/resolve`) — the ONLY locally-run endpoints | A `400`/`500` on EVERY part ("memory access out of bounds (WASM Manifold core)") = corrupted local WASM singleton, NOT bad data | After G5/G9, add a tiny `wasm-health.ts` guard: detect the all-parts-fail signature, surface a "restart `:3333` cleanly (NOT the in-app button)" banner. The in-app restart button WEDGES the server (memory `source_404_flood_2026-06-13`) — consider removing `restartDevServer` (G9) or gating it behind a confirm. |
| **Dependency-blind bake-cache** | `server/bake-cache.ts` — hash = part BODY + params + options, NOT the bodies of `meta.uses` deps | A dep engine/part changes, consumer body unchanged → cache serves STALE geometry ("deja-vu") | Fold a hash of each resolved `meta.uses` dependency's body into the cache key (or a deps-manifest version). Add a unit test: change a dep, assert consumer cache invalidates. Plan: `docs/plans/bake-cache.md`. |
| **Monolith merge-base hazard** | `GraphEditorPane.svelte` | Two worktree agents editing it → merge clobber → 500 (just happened) | §0 rule 3: sequential PRs, rebase-before-start, never parallel agents on the monolith. Smaller files after extraction shrink the blast radius structurally. |
| **Socket↔DOM Y-math** | `polyRowTop`/`sketchRowTop`/`polySock*`/`sketchSock*` ↔ `<foreignObject>` row heights | A row-height CSS tweak silently misaligns SVG sockets | G1 co-locates them in `graph-editor-geom.ts` + a `*.test.ts` that pins the row-height contract (entry-idx vs eval-idx — memory `entry_idx_eval_idx_gotcha`). |
| **Fresh-array props → effect loops** | any new child boundary (G5/G6 especially) | Identity-tracked `$effect` re-fires every render; auto-fit loop; DualCanvas cache loop | Pass STABLE memoised `$derived.by` refs; JSON content-key guard before sync writes (memory `fresh_array_props_effect_loops`). Lint rule idea: flag array/object literals in `<Child prop={...}>`. |
| **Canvas height contract** | `PrimitiveDualCanvas`/`PrimitiveDualScene` (G5 boundary) | `.pd-stage` parent collapses (`display:block`) → auto-fit loop | Keep the defined-parent-height contract when RightPane becomes its own component (memory `canvas_height_contract`). |
| **Grid `display:none` auto-placement** | `routes/primitives/+page.svelte` (§3 split) | A `display:none` child leaves the grid → shifts next pane onto a phantom track → blank pane (bit twice) | Track count must match VISIBLE children; test portrait + landscape after the Sidebar/TabStrip split (memory `grid_display_none_auto_placement`). |
| **Server-module HMR staleness** | any `src/lib/server/*` or large-component edit | Vite HMR silently skips → stale geometry, no error | Process note (already in CLAUDE.md): restart `:3333` after server-module / large-component edits. Each modularize PR that touches `server/` ends with a clean restart in the verify step. |
| **Touch implicit pointer capture** | wire drag (G3) | Drag-to-target dies on mobile w/o `touch-action:none` + `releasePointerCapture` at drag start | Preserve both when `endWireOn*` moves into `wire-state.svelte.ts` (memory `touch_implicit_pointer_capture`). |
| **`/source` 404 flood** | client `loadExpectedParamsFor` (G9) | A 404ing Call dep loops ~1000/s, saturates PROD (local proxies volume to prod) | Keep the attempted-once `Set` guard when G9 moves `loadExpectedParamsFor` (memory `source_404_flood_2026-06-13`). |

---

## 6. Edge cases to pin with tests during extraction

Add/extend `*.test.ts` so the refactor can't regress these silently:

- **Empty graph** — newGraph() with only the root Output container; no nodes.
  G6 dispatcher must render nothing without throwing.
- **Polygon / poly_repeat leaf types** — they have NO `children`; predecessor /
  traversal helpers must list leaf types explicitly (memory
  `autolayout_predecessors_polygon_crash`). Covered partly by
  `composition-layout.test.ts` — extend for G1/G6.
- **Inline-wrapper hiding** — a Call wrapped by inline mv/rot hides its own
  output socket; `inlineXformOutput`/`outputSocketAt` must agree (G1 test).
- **Instanced stacks** — `×N` + z-offset graded-delta semantics
  (0=flush/+=gap/−=overlap); covered by `stack.test.ts`, keep green through G6.
- **Profile resolution** — inline profile `resolveProfile` + NaN guard
  (`inline-profile.ts`); node-ref profile producers (`__POLY__<id>` sentinel,
  producer-before-consumer ordering). Pin in G2/G8.
- **Z-down convention** — top = LOWER z; any geom helper that moves into
  `graph-editor-geom.ts` keeps the sign (memory + cad/CLAUDE.md).
- **Sketch round-trip** — `compileSketch(ops)` abs/rel coord accumulation;
  `sketch.test.ts` + `sketch-collayout.test.ts` must pass through G4.
- **ProfileFnEditor composeSource** — lossy on multi-`Array.from` bodies; add a
  round-trip assertion BEFORE the §3 split.

---

## 7. Phased PR sequence

Each phase = ONE PR on its own branch off the latest `main`. Gate every PR on:
`bun run build` green · `bun test` green · (GraphEditorPane phases also)
`bun run test:graph` green + recorded run (Rule 12). Rebase the next phase on
the merged previous one. **No parallel agents on the monolith.**

| PR | Scope | Files touched | Risk | Verify |
|---|---|---|---|---|
| **P0** | Add `knip` (or `ts-prune`) dev tooling + a `bun run deadcode` script. No code removed. Produce a triaged candidate list (feeds §4). | `package.json` | LOW | `bunx knip` runs; list reviewed by hand. |
| **P1** | **G1** `graph-editor-geom.ts` + its `*.test.ts`. | new file + GEP imports | LOW | build + graph e2e; new unit test. |
| **P2** | **G2** `graph-editor-args.ts`. | new file + GEP imports | LOW | build + test. |
| **P3** | **G3** `wire-state.svelte.ts`. | new file + GEP | MED | build + graph e2e; manual wire-drag + touch check. |
| **P4** | `composition-graph.ts` → types/mutators/hydrate + barrel re-export. | cad/ split | LOW-MED | `composition-graph.test.ts` green; build. |
| **P5** | **G5** `RightPane.svelte`. | new component + GEP | MED | build + graph e2e; tab-switch + cutaway + brep + svg + glb. |
| **P6** | **G4** `SketchEditorPane.svelte`. | new component + GEP | MED-HIGH | sketch e2e; `sketch*.test.ts`. |
| **P7** | **G8** popovers → `graph-editor-popovers/`. | new components + GEP | LOW-MED | each popover opens/applies/closes. |
| **P8** | **G7** `ParamsCard` + `PropertiesCard`. | new components + GEP | MED | param edit + color/material round-trip. |
| **P9** | **G6** `NodeCard` dispatcher (+ per-type arms). | new components + GEP | HIGH | full graph e2e; every node type renders + wires. |
| **P10** | **G9** `graph-editor-bake.ts` glue + shell cleanup; add the module-map header comment. | GEP residual | MED | full build + graph e2e; bake/auto-bake/auto-layout. |
| **P11** | `routes/primitives/+page.svelte` → Sidebar + TabStrip. | route split | MED | portrait+landscape; grid auto-placement. |
| **P12** | `routes/vocab/+page.svelte` → tab bodies. | route split | MED | vocab tabs. |
| **P13** | `builder.ts` → `builder-legacy.ts` + `render-helpers.ts`; **then** confirm-and-retire `library.ts` + legacy builder chain IF dead (§4) — separate commit, Rule 6 approval. | cad/ + preview server | MED-HIGH | preview bakes 19/19 parts; curl prod parity. |
| **P14** | Hardening pass: bake-cache dependency hash (§5) + WASM-health guard + `subdivideAlongZ` retire-if-redundant (§4). Each its own commit with a test. | server/ + shared/ | MED | dep-change invalidation test; warp visual e2e. |
| **P15** | `ProfileFnEditor.svelte` split (round-trip test first). | shared/ | MED | composeSource round-trip green. |

P1–P3 are pure-logic, near-zero-risk, and unlock the rest — land them first.
P9 (NodeCard) is the riskiest; it goes late, on top of G1/G3 so its render arms
already pull from extracted, tested helpers. The stale-code removals (P13/P14)
trail the extractions so deletion happens against a clean, navigable tree.

---

## 8. Out of scope (explicitly)

- **K.67 composition-architecture** (graph promotion → typed `meta.bindings`):
  independent model change; don't block on it. P3 keeps the text-substitution
  wiring as-is so K.67 has one small `wire-state.svelte.ts` to rewrite.
- **Client-side execution** (TODO.md "Redesign Thought"): a separate kernel
  decision (`docs/plans/client-side-execution.md`), not a refactor.
- **Behaviour/feature changes** of any kind — by §0 rule 1.
- **CSS-as-plain-`.css`** — scoping loss; CSS shrinks only as a side-effect.

---

## 9. Done-when

- No live `src/` file > ~1000 lines without a documented reason.
- `GraphEditorPane.svelte` < ~1500 lines (composing shell) with a module-map
  header comment mirroring the subtree CLAUDE.md maps.
- `bunx knip` triaged; confirmed-dead chains removed with backups; `/design`
  resolved (linked+documented OR archived).
- bake-cache dependency-aware; WASM-health banner; warp-subdivide resolved.
- New `*.test.ts` pin the socket↔DOM contract + the §6 edge cases.
- This plan reconciled INTO `/plan` (Rule 19) as the K.65 lane.
