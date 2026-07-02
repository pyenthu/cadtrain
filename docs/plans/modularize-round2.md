# Plan — Modularize cadtrain, Round 2 (K.65 continuation)

> **ACTIVE FOCUS 2026-07-02:** the GraphEditorPane modularization reorg is the
> current priority (/plan #940). GEP has drifted back to ~5,328 lines; an audit
> was just completed and the next cut is the layout-actions extraction, following
> the R6/R2–R10 sequence here + in `docs/plans/graph-editor-pane.md`. This unblocks
> the deferred warp NODE + editor card (`docs/plans/warp-part-along-spline.md` items 1 & 5).
>
> **Status:** PARTIAL — R1 (bake-cache deja-vu fix) + R5 (GEP E+F) shipped;
> R2/R3/R4/R6/R7/R8/R9/R10 remain. Author: 2026-06-16. Re-verified 2026-06-23.
> **Builds on** (does not replace)
> `docs/plans/modularize.md` (round-1 thesis + rules) and
> `docs/plans/graph-editor-pane.md` (the GEP phase ledger). Read those first —
> this doc re-censuses against the *current* tree, folds in the `knip` run,
> resequences the remaining work around the E/F entanglement, and adds the
> hardening items the round-1 plan only sketched.
>
> **What changed since round-1 was written (at GEP=9635):**
> - GEP A–F extracted + the file **moved** to `src/lib/shared/graph-editor/`.
>   GEP is now **6191 lines / 85 `$state`**; `NodeCard.svelte` (2015 lines) at
>   `graph-editor/NodeCard.svelte` (flat path, not `node-cards/` subfolder).
> - Phase F post-ship bugfix: `onDeleteNode` prop pass-through in NodeCard sketch
>   arm — see `graph-editor-pane.md` §2 Phase F post-mortem.
> - `composition-graph.ts` (was 1653) is **already split** →
>   `composition-graph-mutate.ts` (1192) + `composition-graph-types.ts` (268)
>   (+ `composition-emit*.ts`). Round-1 P4 is **partially done**; only a
>   mutate-file thinning remains (below).
> - `knip` is wired (`bun run deadcode`, `knip.json`) — round-1 P0 is **done**.
> - `primitives/+page.svelte` **grew** 1573 → 1836 (sidebar tree landed).

---

## 0. Binding lessons (carry forward verbatim — these are paid-for)

1. **GEP: INLINE only.** Every background subagent that attempted a large GEP
   extraction this cycle **stalled at the watchdog mid-write**. The ones that
   landed were inline (A/B/D) or a short ≤20-min subagent (RightPane). Do GEP
   phases inline, one at a time. (`graph-editor-pane.md` §0.1.)
2. **`bun run build` green ≠ working, for Svelte.** Vite/rollup tsc-checks
   importers (real safety net for pure TS), but **Svelte treats unknown markup
   identifiers as runtime-resolved** — Phase E built clean yet threw two
   `ReferenceError`s on mount. **Every component phase MUST browser-mount-verify**
   against the same parts: `g_dp_box` (sketch+sockets), `g_mule_shoe` (inline
   strips), a polygon part.
3. **grep moved FUNCTIONS' usages, not just `$state`.** Phase E broke because a
   markup range over-grabbed an `{#if svgTip}` arm and because
   `toggleSketchOpMode`/`sketchExprPop` were *shared* across the node card and
   the full-tab editor. Before moving any handler, grep its name across markup +
   script + the sibling extracted files.
4. **Split pure ↔ rune.** A `.svelte.ts` rune module can't be imported by a
   plain vitest (`$state` won't compile there). When a unit has testable pure
   logic, split it: pure `.ts` (tested) + `.svelte.ts` rune wrapper. (This is
   why Phase B is two files.)
5. **Per-instance reactive state = class, not module singleton.** `/primitives`
   mounts every tab pane at once; a module-level `$state` singleton leaks across
   panes (drag-state bleed). `WireState` is a `new`-per-pane class — follow that
   pattern for any future cross-cutting GEP state (the sketch editor included).
6. **No behaviour change; don't delete during extraction.** Stale-code removal
   is a *separate*, post-extraction pass with backups (Rule 4 / Rule 6).
7. **Stable props across new boundaries.** Memoised `$derived` refs only — never
   a fresh `[...]`/`{...}` literal per render (auto-fit / DualCanvas cache loops:
   memories `fresh_array_props_effect_loops`, `canvas_height_contract`).

---

## 1. Re-census — biggest live files (`wc -l`, 2026-06-23)

| Rank | File | Lines | Round-1 plan? | This-round target |
|---|---|---:|---|---|
| 1 | `shared/graph-editor/GraphEditorPane.svelte` | **6191** | GEP A–F | **shell cleanup (R6)** — ≤~1500 lines |
| 2 | `shared/graph-editor/NodeCard.svelte` | **2015** | G6 | extracted ✓ (Phase F) |
| 3 | `routes/primitives/+page.svelte` | **1836** ↑ | P11 | Sidebar + TabStrip (§3) |
| 4 | `routes/vocab/+page.svelte` | 1687 | P12 | tab bodies (§3) |
| 5 | `cad/composition-graph-mutate.ts` | 1482 ↑ | P4 (partial) | thin the mutate family (§3) |
| 6 | `shared/ProfileFnEditor.svelte` | 1156 | P15 | preview ↔ round-trip split (§3) |
| 7 | `cad/builder.ts` | 1163 ↑ | P13 | legacy ↔ render-helpers split + retire (§3,§4) |
| 8 | `routes/plan/details.ts` | 929 | — | data file, leave (documented exception) |
| 9 | `cad/composition-tree.ts` | 798 | low pri | leave unless >1000 |
| 10 | `routes/plan/+page.svelte` | 720 | — | Gantt; leave |
| 11 | `cad/composition-emit.ts` | 699 | — | leave (focused) |
| 12 | `routes/design/+page.svelte` | 696 | §3 orphan | **resolve: link+doc OR archive (§4)** |
| 13 | `shared/graph-editor/geom.ts` | 644 | (extracted ✓) | — |
| 14 | `routes/volume/+page.svelte` | 623 | — | leave |
| 15 | `cad/library.ts` | 566 | §4 dead-chain | retire-if-dead with builder.ts (§4) |

**Goal unchanged:** no live `src/` file > ~1000 lines without a documented
reason; GEP → a ≤~1500-line composing shell.

Files >1000 lines after this round, with reasons, will be: `details.ts` (pure
Gantt data, not logic) — acceptable; everything else gets carved or retired.

---

## 2. GraphEditorPane — E+F carve (DONE 2026-06-23)

**Already done (do NOT redo):** A Popovers · B bake parsers+expected-params cache ·
C `WireState` per-instance class · D Properties/Params cards · E SketchState +
SketchNodeCard + SketchEditorPane · F `NodeCard.svelte` — plus pre-existing
geom.ts/args.ts/RightPane.

**E + F shipped 2026-06-23.** SketchState class (approach 2a.1) → SketchNodeCard +
SketchEditorPane (E) → NodeCard dispatcher (F). `polyExprPop` + coord ƒ-popover stay
in the GEP shell (as designed). Post-ship bugfix: NodeCard sketch arm must pass
`{onDeleteNode}` not `deleteNode` — see `graph-editor-pane.md` §2.

The entanglement that blocked the 2026-06-16 E revert (historical — resolved by
SketchState + shell-owned popovers):

- `sketchExprPop` is **one popover** shared by the full-tab sketch editor AND
  the in-graph Sketch *node card*. One popover can't render in two components.
- `toggleSketchOpMode` (node card) reads the editor's `sketchEditor` `$derived`.
- `sketchAxisLabel` / `openSketchExprPop` are read from both sides.
- `polyExprPop` (vertex/loop/binding/count + transform-axis ƒ-editor) is fused
  with `hlVertex`/`hoverVertex`/`svgTip`, which the node arms AND canvas SVGs read.

### 2a. Approach used (shipped — matches 2a.1 SketchState pattern)

Historical design rationale for the E+F consolidation:

1. **Lift the shared sketch surface into a per-instance rune class first**
   (`sketch-state.svelte.ts`, mirroring `WireState`): owns `sketchExprPop`,
   `sketchAxisLabel`, the `sketchEditor` derived + frozen-frame, and the
   `toggleSketchOpMode`/`openSketchExprPop`/`cornerAt*` helpers. Both the
   node-card arm and the full-tab editor read from the **same instance** passed
   as a prop → the "can't render in two components" problem dissolves (the
   popover renders once, in whichever component owns the markup; the other gets
   callbacks). **Risk: MED-HIGH** — this is the crux; build + browser-verify the
   sketch node card AND the tab BEFORE moving any markup.
2. **`SketchEditorPane.svelte`** — the full-tab editor markup + the 21 `sketch*`
   handlers, taking the `sketch-state` instance + `wire` instance + param scope
   as props. Drops GEP's duplicated `.ge-param-chip`/`.ge-params-card-*` CSS
   (the sketch mini-card moves with it). ~1100–1400 lines out of GEP.
3. **`graph-editor/NodeCard.svelte` dispatcher** — the per-node render arms
   (shipped at flat `graph-editor/NodeCard.svelte`, not `node-cards/` subfolder):
   Call / Container(list|stack|group) / Method / Mv / Rot / Repeat / Polygon /
   PolyRepeat / Sketch (delegates to SketchNodeCard) + resize grip. `polyExprPop`
   + `hlVertex`/`svgTip` stay in GEP shell.

> **Fallback if (1) proves too entangled:** keep `sketchExprPop` + the shared
> helpers in GEP and give `SketchEditorPane` an `onOpenSketchExprPop` callback +
> read-only `sketchEditor` prop. Less clean (GEP keeps a sketch tendril) but
> unblocks **M.5 sketch-repeat** sooner. Decide after attempting (1) for ≤1 session.

### 2b. After E+F — **NEXT (R6)**

Residual shell = props + the `$state` (many move with their feature) +
`onMount`/keydown + the `<svg>` canvas host + pan/zoom group + child slots +
`clientToGraph` (stays — needs `canvasEl`/pan/zoom). Add a module-map header
comment mirroring the subtree CLAUDE.md style. CSS rides out with each
component (NOT a standalone phase).

> **Reality check (2026-06-23): GEP is still 6191 lines** (3342 script L20–3362
> + 1504 markup + 1323 CSS). The ≤~1500 target is **NOT reachable by a
> module-map header + `$state` audit alone** — those are genuinely-low-risk but
> only trim the margins. The biggest feature still inline is the
> **Polygon / PolyRepeat editor**: poly-preview overlay (resize/drag/zoom
> ~L365–530), vertex drag + SVG insert (~L657–871), and the poly-expr-pop family
> (~L2722–2845) — ~700 script lines plus its markup + CSS. R6 realistically =
> **one more feature carve (a `PolygonNodeCard` + poly-preview overlay, same
> pattern as the Sketch carve) → THEN** the residual header/`$state` cleanup.
> Split R6 into **R6a (Polygon carve, HIGH-touch GEP, inline)** + **R6b (header
> + `$state` audit + confirm the new line count, LOW)**. If ≤1500 still isn't
> hit after R6a, set an honest target (~2500–3000) rather than carrying a stale
> number.

---

## 3. Other large files — extraction notes (current state)

| File | Lines | Split | Risk | Note vs round-1 |
|---|---|---:|---|---|
| `routes/primitives/+page.svelte` | 1836 | `Sidebar.svelte` (the Windows-Explorer tree — already merged) + `TabStrip.svelte`; `+page` = layout glue | MED | **Grew** since round-1; now the #2 file. Grid `display:none` auto-placement gotcha — test **portrait + landscape** (memory `grid_display_none_auto_placement`, bit twice). |
| `routes/vocab/+page.svelte` | 1687 | Inferred/Topology/Bake/Promote tab bodies → `vocab/_tabs/*.svelte`; `+page` = tab shell | MED | Shares `CompJsonSilhouette` (dynamic-imported) + `PrimitiveDualCanvas` — don't fork. |
| `cad/composition-graph-mutate.ts` | 1192 | Already separated from types; if it keeps growing, split the `add*`/`set*`/`remove*` families by node kind. **Lower priority** — it's pure + test-covered. | LOW | Round-1 P4 mostly done (types extracted). |
| `shared/ProfileFnEditor.svelte` | 1156 | Separate 3D preview (already `ProfileFn3DCanvas`) from the fn-source round-trip | MED | **Add a `composeSource` round-trip test BEFORE splitting** — known lossy on multi-`Array.from` bodies (memory `profile_editor_composeSource_bug`). |
| `cad/builder.ts` | 1048 | `builder-legacy.ts` (ComponentDef builders + `library.ts`) + `render-helpers.ts` (`finalizeManifold`/`setRenderZScale`/`manifoldToGeo`/`CutVC` used by `/preview`) | MED-HIGH | knip flags ~10 builder exports unused (§4); the legacy half is the retire candidate. |

---

## 4. Dead-code report (`bun run deadcode` = knip, 2026-06-16)

> **CRITICAL CAVEAT — knip's "Unused files (7)" list is mostly FALSE POSITIVES.**
> knip cannot follow: dynamic `await import()`, `import.meta.glob('?raw')`
> build-time inlining, or sandbox runtime injection. Verified by hand:
>
> | knip "unused file" | Actually | Evidence |
> |---|---|---|
> | `shared/CompJsonSilhouette.svelte` | **LIVE** | `await import()` in `vocab/+page.svelte:464` |
> | `shared/ComponentSceneGlb.svelte` | **LIVE** | imported by `PrimitiveDualScene.svelte` + `TensionScene.svelte` |
> | `cad/inline-profile.ts` | **LIVE** | imported by `primitive-loader.ts`, `profile-templates.ts`, both builders; sandbox-injects `resolveProfile` |
> | `cad/builders/ExtrudePartBuilder.svelte` · `RevolvePartBuilder.svelte` | **LIVE** | imported by `ProfileFnEditor.svelte` + `api/primitives/source` |
> | `shared/mime.ts` · `shared/temp-file.ts` | **suspect — verify** | no importer found in the grep; likely genuinely dead, confirm before removing |
>
> **Lesson: never bulk-delete knip's file list.** Hand-verify each. The
> higher-signal lists are **unused exports** and **unused dependencies**.

### 4a. Genuinely actionable

**Unused dependencies (12 + 4 dev)** — knip flags `@codemirror/*`, `codemirror`,
`@lezer/highlight`, `marked`, `mermaid`, `prettier`, `svelte-tweakpane-ui`,
`three-svg-renderer`, `@xenova/transformers`, `flowbite`, `flowbite-svelte`,
`tailwindcss`, `@vitest/expect`. **Verify each before removing** — some are used
via plugin config (`tailwindcss` in PostCSS/`app.css`), CLI-only, or transitively.
`three-svg-renderer` is named in the SVG-tab "Route 2" upgrade lead (keep). Each
removal is its own commit; `bun run build` + the SVG/vocab/profile pages must
stay green. **Est. meaningful node_modules + bundle savings.**

**Unused exports (90)** — the high-leverage cluster:
- `cad/builder.ts`: `buildPrimitiveManifold`, `buildComponent`, `builders`,
  `DEFAULT_OUTER_HEX`/`DEFAULT_INNER_HEX`, `CIRCULAR_SEGMENTS_*` — confirms the
  **legacy ComponentDef build path is dead-chain** → retires with `library.ts`
  (`CATEGORIES`, `COMPONENTS`) as one vertical slice after the §3 builder split.
- `cad/composition-tree.ts`: ~18 exports flagged unused (`walkTree`, `findNode`,
  `replaceNode`, `deleteNode`, `emitImports`, `parseImports`, …) — **suspect
  partial false-positive** (these may be used by `composition-bake`/vocab via
  paths knip mis-roots). Triage individually; this file is the biggest
  unused-export concentration and worth a focused audit.
- `server/rag-*.ts`, `forge/pipeline.ts`, `rate_limit.ts`, `profile-templates.ts`,
  `manifold-helpers.ts` (`GeomAcc`, `Mesh`) — mix of genuinely-unused and
  injected/test-only. `GeomAcc`/`Mesh` are sandbox-injected (memory
  `welded_mesh_toolkit_shared`) → **NOT dead**, knip can't see injection.

**Unlisted binaries / unresolved imports** — the `./$types` "unresolved" entries
are SvelteKit-generated (benign; tune `knip.json` to ignore). The
`scripts/.../training/*` unresolved imports point at the **archived** training
chain — confirm those scripts are themselves archive-era before acting.

### 4b. Non-knip stale candidates

| Candidate | Evidence | Verdict |
|---|---|---|
| `routes/design/+page.svelte` (696) | **Zero inbound links** anywhere (grep of `src/` + `scripts/` clean); not in CLAUDE.md route table. Self-contained, SSR-safe, accurate "what is this project" page | **Undocumented orphan — ASK USER.** Either (a) add a link from `/` + a route-table row, or (b) `git mv` to `archive/`. Don't silently remove a route (Rule 6). |
| `shared/warp.ts` `subdivideAlongZ` | Still called in `PrimitiveDualScene.svelte:180` + `ComponentSceneGlb.svelte:54` as the **render-time warp stopgap**; the 2026-06-16 merge baked warp into the Manifold geometry (edges follow). `manifold-mesh.ts:79` comment calls it a stopgap | **Retire-if-redundant.** Now that warp bakes into geometry, the per-frame subdivide may be dead weight. **Needs a visual e2e**: confirm warped edges still follow with both call sites removed. MED-risk. |
| `cad/stdstale/` (`r_revolve`, `r_extrude`, `r_weld_extrude`) | Kept "resolvable so legacy parts bake" (Rule 21); TODO.md #12 questions `r_weld_extrude` | **Keep — intentional.** `grep -rl "r_weld_extrude\|r_revolve\|r_extrude" <volume>/primitives` to answer #12; zero refs → a separate Rule-21 `git mv` decision, NOT modularize scope. |
| `shared/mime.ts`, `shared/temp-file.ts` | knip unused-file + no grep importer | **Probably dead — confirm + remove with backup.** Low-risk small utilities. |

---

## 5. Failure-mode / edge-case hardening (the *point* of the exercise)

### 5a. The deja-vu stale-bake bug — ✓ FIXED 2026-06-23 (R1, commit `8edfb05`)

**Near-term fix SHIPPED.** `bake-cache.ts` `BakeCacheOptions` now carries a
`depSourcesHash` that folds the transitively-resolved `meta.uses` dependency
bodies into the key. `primitive-loader.ts` exposes `collectDepSources` +
`hashDepSources` (walks deps, sorts by id, hashes); `api/primitives/preview`
computes it and passes it into the cache opts (`preview/+server.ts:146`).
Tests in `bake-cache.test.ts`: a changed dep ⇒ different `depSourcesHash` ⇒
different key; an undefined hash drops out so existing leaf-part entries still
hit. So fixing a shared child (`g_tube`) now busts the composed parent's cache
(`g_dp_joint`/`g_dp_stand`) — the deja-vu recurrence is gone.

**Was:** `hashBakeKey` hashed only the part's own body + params + options, never
the `meta.uses` dependency bodies → a fixed child kept the parent serving
yesterday's mesh. (Historical context retained for the structural path below.)

- **Structural (separate, large — still open):** the compiler/executor split in
  `docs/plans/client-side-execution.md` caches *dep-inlined scripts* (text)
  instead of meshes → the key literally contains the resolved dep code → bug
  impossible by construction. **Out of scope for modularize**, but the near-term
  dep-hash fix is forward-compatible with it.

### 5b. Other hardening items (extraction gives each a home + a test)

| Hotspot | Symptom | Hardening |
|---|---|---|
| **WASM-singleton corruption** (local `:3333` `/preview`+`bake-preview`+`profiles/resolve`) | `400`/`500` on EVERY part = corrupted local WASM singleton, NOT bad data; the in-app restart button **wedges** the server | After §2/§3, add `wasm-health.ts`: detect the all-parts-fail signature → banner "restart `:3333` from terminal (NOT the in-app button)". Consider removing/confirm-gating `restartDevServer` (memory `source_404_flood_2026-06-13`). |
| **Socket↔DOM Y-math** | a row-height CSS tweak silently misaligns SVG sockets | Already co-located in `graph-editor/geom.ts` with `geom.test.ts`. **Extend the test** to pin the entry-idx↔eval-idx contract through F (memory `entry_idx_eval_idx_gotcha`). |
| **Fresh-array props → effect loops** | identity-tracked `$effect` re-fires every render (esp. new F/Sketch boundaries) | Stable memoised `$derived.by` refs; JSON content-key guard before sync writes (memory `fresh_array_props_effect_loops`). |
| **Canvas height contract** | `.pd-stage` parent collapses → auto-fit loop | Preserve defined-parent-height when canvases cross the new boundaries (memory `canvas_height_contract`). |
| **Grid `display:none` auto-placement** | a hidden child leaves the grid → next pane onto a phantom track → blank pane | Test portrait + landscape after the `primitives/+page` Sidebar/TabStrip split (memory `grid_display_none_auto_placement`, bit twice). |
| **Touch implicit pointer capture** | wire/sketch drag-to-target dies on mobile | `WireState` already owns this; preserve `touch-action:none` + `releasePointerCapture` when the sketch drags move into `sketch-state` (memory `touch_implicit_pointer_capture`). |
| **`/source` 404 flood** | a 404ing Call dep loops ~1000/s, saturates PROD (local proxies volume to prod) | Keep the attempted-once `Set` guard + server flood guard — `loadExpectedParamsFor` already lives in `graph-editor-bake.svelte.ts` (Phase B); don't regress it. |
| **Server-module HMR staleness** | Vite silently skips → stale geometry, no error | Each PR touching `src/lib/server/*` ends with a clean `:3333` restart in verify. |
| **Monolith merge clobber** | two edits to GEP in flight → 500 | Sequential PRs only; rebase before each phase (already a binding rule). |

### 5c. Edge cases to pin with tests during §2/§3

Empty graph (root-only, F renders nothing) · polygon/poly_repeat leaf types
(no `children`) · inline-wrapper output-socket hiding (`inlineXformOutput` ↔
`outputSocketAt`) · instanced stacks (`×N` + graded-delta z-offset:
0=flush/+=gap/−=overlap — `stack.test.ts`) · profile resolution (inline
`resolveProfile` NaN guard; `__POLY__<id>` producer-before-consumer ordering) ·
Z-down sign preservation · sketch round-trip (`compileSketch` abs/rel
accumulation — `sketch.test.ts` + `sketch-collayout.test.ts`) · ProfileFnEditor
`composeSource` round-trip (before §3 split).

---

## 6. Sequenced execution order

Each = ONE PR on its own branch off latest `main`; gate: `bun run build` green ·
`bun test` green · component/route phases also browser-mount-verify (Rule 2
above) + a recorded graph e2e (Rule 12). Rebase the next phase on the merged
previous one. **No parallel agents on GEP.**

| # | PR | Risk | Independent of GEP? | Verify |
|---|---|---|---|---|
| **R1** | ~~**bake-cache dep-hash** (§5a near-term) + unit test~~ ✓ DONE 2026-06-23 (`8edfb05`) — `depSourcesHash` folded into the key; `collectDepSources`/`hashDepSources` in the loader; `bake-cache.test.ts` green. | MED | ✓ yes | — |
| **R2** | **knip triage commit**: remove confirmed-dead deps (§4a) + `mime.ts`/`temp-file.ts` if dead; tune `knip.json` (`$types`/script-archive noise). **No file from the false-positive list.** | LOW-MED | ✓ yes | build green; vocab/profile/SVG pages load |
| **R3** | **`/design` decision** (§4b) — link+document OR `git mv` to archive. **Ask user first.** | LOW | ✓ yes | route loads or is gone from router |
| **R4** | **`primitives/+page` → Sidebar + TabStrip** (§3) | MED | ✓ yes | portrait + landscape; grid auto-placement |
| **R5** | ~~**GEP E+F consolidation**~~ ✓ DONE 2026-06-23 — SketchState → SketchNodeCard + SketchEditorPane → NodeCard; browser-verified; `onDeleteNode` bugfix. | HIGH | — (GEP) | — |
| **R6a** | **Polygon / PolyRepeat carve — NEXT** — `PolygonNodeCard` + poly-preview overlay out of GEP (~700 script lines + markup + CSS), same pattern as the Sketch carve | HIGH | — (GEP) | browser-mount-verify a polygon + poly_repeat part; full build + graph e2e |
| **R6b** | **GEP shell cleanup** — module-map header, residual `$state` audit, record the honest post-carve line count (≤~1500 if reached, else set a real target) | LOW | — (GEP) | full build + graph e2e |
| **R7** | **`builder.ts` split** → `builder-legacy.ts` + `render-helpers.ts`; **then** retire `library.ts` + legacy chain IF dead (§4a) — separate commit, Rule 6 approval | MED-HIGH | ✓ yes | `/preview` bakes the full g_* corpus; curl-prod parity |
| **R8** | **`vocab/+page` → `_tabs/*`** (§3) | MED | ✓ yes | each vocab tab |
| **R9** | **`ProfileFnEditor` split** — round-trip test FIRST, then preview ↔ source split | MED | ✓ yes | `composeSource` round-trip green |
| **R10** | **warp-subdivide retire-if-redundant** (§4b) + **WASM-health banner** (§5b) | MED | ✓ yes | warp visual e2e (edges follow without `subdivideAlongZ`) |

**Parallelism note:** R2–R4 + R7–R10 are all GEP-independent and can be done by
isolated-worktree subagents (they don't touch GEP). **R6 touches GEP → inline,
sequential.** R1 (bake-cache) + R5 (E+F) are done. The remaining
highest-leverage independent items are R2 (knip prune) and R7 (builder.ts split
+ legacy retire); R6 (GEP shell) is the only must-be-inline piece left.

---

## 7. Done-when

- No live `src/` file > ~1000 lines except documented data files (`plan/details.ts`).
- GEP ≤ ~1500 lines, composing shell, module-map header.
- `bun run deadcode` triaged: confirmed-dead deps/exports removed with backups;
  `/design` resolved; `subdivideAlongZ` resolved; knip false-positives documented
  in `knip.json` ignores so future runs are signal-only.
- ✓ `bake-cache` dependency-aware (dep-edit invalidates consumer) — deja-vu gone (R1, `8edfb05`).
- New/extended tests pin §5c edge cases + the socket↔DOM contract.
- This plan reconciled INTO `/plan` (Rule 19) as the K.65-round-2 lane.

## 8. Explicitly out of scope

- Client-side compiler/executor split (`docs/plans/client-side-execution.md`) —
  the structural deja-vu fix; large kernel decision, not a refactor.
- K.67 composition-architecture (graph→`meta.bindings` promotion) — independent
  model change; `WireState` just relocated the text-substitution wiring for it.
- Behaviour/feature changes of any kind; CSS-as-plain-`.css` (scoping loss).
