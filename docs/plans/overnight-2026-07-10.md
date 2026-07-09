# Overnight execution plan — 2026-07-10

Every task below is **headless-verifiable** (`bun run build` + `bun run test`, no
browser) and **writes nothing to the shared prod volume**. Each runs in its own
isolated git worktree, commits to its own branch, and **does NOT merge to `main`**.
You review and merge in the morning.

Ordering is by value, not by size. N1–N4 are independent. N5/N6 both touch the
Manifold engine and should be merged one at a time.

---

**Scope note (user, 2026-07-10): skip all BREP work tonight.** No `#19`
`casing_schematic` "BREP is deleted", no BREP cutaway, no client-side BREP. None
of N1–N7 touches BREP; keep it that way.

## Guardrails — apply to EVERY task

These are not suggestions. An unattended agent that breaks one of these costs real
data or real trust.

1. **NEVER call `/api/primitives/save`.** It writes the shared **prod** volume
   (dev proxies to prod). An isolated worktree isolates *code, not the volume*
   (memory `subagent_shared_volume_2026-06-14`). Do not drive `GraphEditorPane`'s
   Save, its save keymap, or any endpoint under `/api/primitives/{save,delete,rename}`.
   Authoring `bw_*` parts (#42c) is therefore **excluded from overnight work**.
2. **Tests are vitest**: `bun run test`. Bare `bun test` ignores the `$lib` alias
   and produces false "Cannot find module" failures (memory
   `test_runner_vitest_not_bun_test`). Baseline is **fully green**: 110 files /
   1171 tests.
3. **Do not start a dev server.** Nothing here needs one. If you think you do, you
   have drifted out of scope — stop and write down why.
4. **Rule 25 — segmentation happens at BUILD time.** Never rewrite a baked
   Manifold's `MeshGL`. Subdividing a finished welded Manifold OOB-crashes the
   WASM core and poisons the singleton so every *later* bake fails.
5. **If you change `manifold-helpers.ts` or `manifold-mesh.ts`, you MUST bump
   `KERNEL_VERSION`** in `src/lib/cad/bake-worker-core.ts`. Those modules are
   transitive engine imports: they change neither the part source nor `scriptHash`,
   so both the server bake cache and the client IndexedDB cache keep serving the
   pre-fix mesh and your fix looks broken. This has now bitten twice (`+cap1`,
   `+cut2`). N4 exists to kill this class of bug permanently.
6. **Assert the property, not a proxy.** The #64 bug survived for weeks because its
   test asserted "more verts + still manifold" — which the *broken* build also
   satisfied. Assert the thing that is actually wrong (spanning edges, genus,
   volume error), and include a measured before/after table in the commit body.
7. **Commit to your own branch. Do not merge to `main`. Do not `git push`.**
8. If a plan doc contradicts the code, **the code wins** — say so explicitly in
   your report rather than implementing the doc. (The #64 plan named the wrong
   root cause; a probe found the real one in ten minutes.)

---

## N1 — Extend `wson-to-graph` to emit completions, tubing, perforations
**Value: highest.** Today the GRAPH tab renders a *body-only* well.
**Headless. No volume write.**

`src/lib/wells/wson-to-graph.ts` emits only `bw_open_hole` (`:311`), `bw_cement`
(`:320`), `bw_casing` (`:330`). `resolveStructural` already supports
`tubing → bw_prod_tubing` but `wsonToGraph` never calls it. Completions are
explicitly deferred at `:20`.

- Emit tubing (`bw_prod_tubing`) and completion jewelry. The parts
  `bw_packer`, `bw_nipple`, `bw_mule_shoe`, `bw_hanger`, `bw_tubing` appear in the
  local bake cache, so they have baked at least once — but **verify each id
  resolves via `/api/primitives/source` (a READ) before emitting a Call to it.**
  If an id does not resolve, do not invent it: report it.
- The `tool_comp` codes you must actually resolve, ranked by real-world frequency
  across the sample corpus: `MISC.TUBING` (41), `MISC.TUBING_PUP` (17),
  `tbgHanger` (11), `FLOW_CONTROL.NIPPLE_R_LANDING` (10), `MISC.MULE_SHOE` (10),
  `PACKERS.PACKER_BAKER_PERMANENT` (6), `MISC.SIDE_POCKET_MANDREL` (6).
  Note `tool_comp` is a **free string**, not an enum (SVTC infers render style by
  substring). Build an explicit `tool_comp → bw_*` map; an unmapped code must
  **throw**, not fall back.
- A completion's depth must be resolved through the `autoTop` chain (N2b) **before**
  it becomes an `Mv`. Do N2b first, or assume `top`/`bot` are already absolute and
  say so.
- Perforations too, if a `bw_*` element exists for them; otherwise report and skip.
- Keep the emit order **outer → inner** (oh, cement, casing, tubing, completions)
  so transparency reads correctly.
- **NO FALLBACK** (wells skill): an element that cannot be expressed must
  `throw WsonTranslateError`, never render a stand-in.
- Extend `wson-to-graph.test.ts` with the existing pattern: translate → `emitGraph`
  → `hydrateGraph` → assert it compiles. Determinism + float-rounding assertions
  already exist; keep them green.

## N2 — Wells sample ladder (TODO #42e)
**Headless. Writes only `src/lib/wells/samples/`, never the volume.**

**Do not hand-author the two middle rungs — SVTC already has them**, and copying
real fixtures beats inventing plausible ones. Source repo: `~/code/SVTC/.dev-volume/samples/schematics/`.

| rung | file | source | exercises |
|---|---|---|---|
| S1 | `10-three-open-holes.wson` | author | 3 telescoping open holes, vertical. Hole nesting + `Mv` depth placement alone. |
| S2 | `11-vertical-land-producer.wson` | **copy** `01-vertical-land-producer.wson` | Exactly 3 OH + 3 casing + 3 cement, vertical, no `profile[]`. The reference vertical well. |
| S3 | — | (S2 already carries cement) | Add a **negative** test instead: a hole narrower than its casing must make `cementDims` **throw** `WsonTranslateError`. That guard is the point. |
| S4 | `13-vertical-land-producer-deviated.wson` | **copy** `deviated/01-vertical-land-producer-J-medium.wson` | The **identical** well plus an 11-station `profile[]` (J-shape, 38°). Isolates vertical-vs-deviated to the presence of one key — nothing else differs. |
| S5 | `14-vertical-producer-completions.wson` | S2 + its `completions[]` | **The completion string** — tubing/nipple/packer jewelry. See below. |

**S5 — the completion string.** `01-vertical-land-producer.wson` already carries a
real 7-item string whose depths are contiguous (`0→0.5→1025→1025.3→1028→1028.5→1030`)
— i.e. the `autoTop` chain of N2b, in the wild:

| # | `tool_comp` | od | maps to |
|---|---|---|---|
| 1 | `tbgHanger` | 8.681 | `bw_hanger` |
| 2 | `MISC.TUBING` | 2.875 | `bw_prod_tubing` / `bw_tubing` |
| 3 | `FLOW_CONTROL.NIPPLE_R_LANDING` | 2.875 | `bw_nipple` |
| 4 | `MISC.TUBING_PUP` | 2.875 | short-body tubing (`pipe_assembly_convention`) |
| 5 | `PACKERS.PACKER_BAKER_PERMANENT` | 8.681 | `bw_packer` |
| 6 | `MISC.TUBING_PUP` | 2.875 | short-body tubing |
| 7 | `MISC.MULE_SHOE` | 2.875 | `bw_mule_shoe` |

Start with **tubing + nipple + pup + mule shoe** (the simple concentric ones);
`tbgHanger` and the packer set the OD to the casing bore (8.681) and are the ones
most likely to reveal a clearance bug — do them second.

**Sample corpus** (read-only; copy files OUT, never run git there —
`~/Desktop` is iCloud-synced and corrupts `.git`, memory `icloud_desktop_unsafe`):
- `~/code/SVTC/.dev-volume/samples/schematics/` — the numbered 01–10 set plus 70
  deviated variants.
- `~/Desktop/SAMPLE/` — 23 `.wson` files, incl. `schematics/xlsxtowson/` = **7
  paired PNG + WSON** real-report cases (memory `wells_eval_dataset`).

**⚠ The two `01-vertical-land-producer.wson` files are DIFFERENT.** SVTC's has no
`profile` (truly vertical). The Desktop copy has an **11-station `profile[]`** —
it is deviated. **S2 must use the SVTC file**; using the Desktop one silently makes
the "vertical" rung deviated and destroys the S2↔S4 isolation.

**The real-report cases are the interesting ones**, because they violate the shape
the synthetic samples assume:

| case | oh | ch | cem | comp | perf | prof |
|---|---|---|---|---|---|---|
| `Ananas-13-Rig109-Workover…` | **0** | 1 | 0 | 11 | 6 | 11 |
| `Ananas-13_Completion_Report` | **0** | 2 | 0 | 1 | 6 | 4 |
| `Hammal-19_New_well_ESP…` | **0** | 2 | 0 | 1 | 9 | 4 |
| `Hammal-5_Workover_Report` | **0** | 2 | 0 | 11 | 2 | 4 |
| `Hammal_-20…gravel_packer_ESP` | 2 | 2 | 1 | 1 | 9 | 11 |
| `Ananas_W-6…Convert_to_Disposal` | 2 | 2 | 5 | 3 | 6 | 4 |
| `Mooz_S-3_PCM_PCP…` | 2 | 2 | 2 | 7 | 1 | 6 |

Four of the seven have **zero open holes** — casing-only wells. That is not an
error; it exercises `cementDims`' no-hole path (`CEMENT_NO_HOLE_RATIO = 1.15`) and
proves the translator does not assume every casing sits inside a logged hole. Use
these as translator fixtures; do NOT "fix" them.

**Data hazard:** across the corpus, **7 completions have a missing/empty
`tool_comp`**. Per the wells skill's NO-FALLBACK rule the translator must
`throw WsonTranslateError` naming the offending index — never silently skip or
substitute a default part. Add a test for exactly that.

S4 is unblocked by #64: half-sectioned `bw_*` elements now warp without the
bridging triangle. Assert it: after warp, **zero triangle edges with Δz > 5** on a
40-long casing (pre-fix this was 104 edges over Δz 10).

**Canonical on-disk WSON keys**, as SVTC writes them (cadtrain must read these
exactly — note `ch` not `casing`, `cementing` not `cement`, `dev` not `inc`):

```jsonc
"meta":        { "wellName","rkbToGl","td","pbtd","location":{"x","y","crs","lon","lat"} }
"oh":          [ { "bitSize","top","bot" } ]                 // inches / m
"ch":          [ { "od","id","top","bot","grade","weight","type" } ]
"cementing":   [ { "od","top","bot" } ]
"completions": [ { "description","tool_comp","od","top","bot" } ]
"perforations":[ { "top","bot","label" } ]
"profile":     [ { "md","dev","az" } ]                       // deviated only; dev = inclination
"strata":      [ { "strata","top","color" } ]                // optional
```

cadtrain currently bundles 5 samples and **zero deviated** variants.

## N2b — `autoTop` completion-anchor model + fix a misnamed component
**Headless. No volume write.** Pure model + a rename; no UI.

Two things the SVTC survey exposed:

1. **`src/lib/wells/CompletionsEditor.svelte` is MISNAMED.** It edits **`ch[]`
   (casing strings)**, not `completions[]`. There is no completions-array table in
   cadtrain at all. Rename it to `CasingStringsEditor.svelte` (it is imported by
   nothing, so the rename is free) and leave a one-line note saying a real
   completions worksheet does not exist yet. Do NOT build the worksheet — that is
   UI and needs a browser.

2. **`autoTop` is absent from cadtrain's model.** It is the load-bearing concept
   for authoring a completion string top-to-bottom. In SVTC each completion is
   either **auto** (`autoTop !== false`, the default → `top = previous.bot`) or
   **manual** (`autoTop === false` → absolute MD, for SSSVs/nipples at fixed depth).
   `recomputeAutoTops(comps)` walks the list, keeps each item's length, and
   re-pins tops.
   - Add `autoTop?: boolean` to the `Completion` type (`wson.ts:52-59`), plus the
     render fields cadtrain lacks: `od_multiplier?`, `noJoints?`, `avgJointLength?`.
     (`length?` already exists — verified; do not re-add it.)
   - Implement `recomputeAutoTops` as a **pure function** with tests: an auto item
     follows its predecessor's `bot`; a manual item holds its MD and the chain
     resumes after it; editing a length drives `bot = top + len`.
   - This is a prerequisite for both a completions worksheet and N1's completion
     emission (a completion's depth must be resolved before it becomes an `Mv`).

## N3 — Radial scale + Z scale as build-time params (TODO #65)
**Headless. No volume write.**

`xScale`/`zScale` are today **render-time scene dials** (`scene-state.svelte.ts:43,49`;
`setRenderZScale`, `render-helpers.ts:78`) applied last, to the whole scene. Make
them real parameters so exaggeration is part of the geometry and survives
bake/export (`feedback_expose_dont_hide` — the slider IS the product).

**The subtlety is the whole task.** Under a warp, Z scale must apply **along the
spline's arc length, not world Z**. `warpManifoldAlongSpline` maps a vertex's z to
an arc-length station, then places its (x,y) on the local frame
(`warp-spline.ts:11-12,196`). Scale the **arc-length coordinate `s`** before the
frame lookup. Scaling world z instead stretches a horizontal lateral by *zero* and
shears the trajectory.

- Radial scale is the clean case: multiply the in-frame (x,y) offsets.
- Apply to both engines: `warpManifoldAlongSpline` **and** its JS twin `warpMeshJS`
  (used by the client/TF warp step). They must agree.
- Verify headless: bbox; arc-length monotonicity; and that a **vertical section and
  a horizontal section stretch by the same factor along the path** — that assertion
  is the one that catches the world-Z mistake.
- Serves `/wells` #42g (autoscale becomes a param, not a scene hack).

## N3b — Spline node: TWO input methods (survey table **and** xyz)
**Headless. No volume write.** User request, 2026-07-10.

The spline that drives a warp must accept **either**:
1. **A survey table** — `(md, dev, az)` stations, converted to xyz by **minimum
   curvature**. This is how a real well is specified.
2. **xyz control points** — what we have today.

An implementation already exists but is **stranded in the wells 3D path**:
`src/lib/wells/threeD/profile.ts` (`WellProfile`, `RawSurveyStation`, `Segment`).
`wson-to-graph.ts`'s `buildSurveyWarp` also walks `(md, dev, az)` itself. The CAD
spline node knows nothing about either.

- **Extract ONE pure `surveyToXYZ(stations) → [x,y,z][]`** (minimum curvature,
  dogleg-severity aware) into a shared module. Both `/wells` and the graph spline
  node must call the same function — do not leave two implementations to drift.
  (That drift is exactly what `docs/findings/manifold-vs-tf-audit.md` documents
  elsewhere.)
- Give the spline node an explicit `mode: 'xyz' | 'survey'` — **do not auto-detect
  from the input shape.** Auto-detection is what `is3DPath()` does today
  (`warp-spline.ts:123`, planar-vs-3D chosen by y-variation `> 1e-6`), and
  `docs/plans/warp-2d-3d-solids.md` exists precisely because the author never gets
  to choose. Make the choice explicit (`feedback_expose_dont_hide`).
- Reference for quality: SVTC's `WellDirection.dirWarp3D` — quaternion-slerp
  minimum-curvature, twist-minimized (memory `svtc_warp_3d_function`). It is better
  than cadtrain's warp-spline/axisPath for real MD/inc/az wells.
- Verify headless: a vertical survey (`dev=0`) → a straight z-axis path; a known
  build-up section reproduces its textbook TVD/northing/easting; monotonic MD →
  monotonic arc length; and `surveyToXYZ` of `01-vertical-land-producer-J-medium`'s
  11 stations round-trips to the same trajectory the wells 3D path draws today.
- Composes with **N3**: the Z scale applies along **arc length** of whichever path
  the mode produced.

## N4 — Kill the engine-fix cache hazard
**Headless. No volume write.** Highest structural value.

A fix inside `manifold-helpers.ts` / `manifold-mesh.ts` changes neither the part
source nor `scriptHash`, so **both** bake caches serve stale geometry until someone
remembers to hand-bump `KERNEL_VERSION`. It has bitten twice (`+cap1`, `+cut2`) and
on 2026-07-10 it cost an hour chasing a fix that was already working.

- Fold the engine-module content hashes into `scriptHash` (or derive a
  build-stamped kernel id from them) so an engine edit invalidates automatically.
- Both caches: the server bake cache (`src/lib/server/bake-cache.ts`, keyed on
  body + dep sources) and the client IndexedDB cache (`bakeCacheKey`,
  `bake-worker-core.ts:285`, keyed on `KERNEL_VERSION` + `scriptHash` + params).
- **Expect a one-time full cache invalidation.** Say so plainly in the report.
- Test: mutate an engine source fixture → assert the key moves. Assert an unrelated
  edit does *not* move it.

## N5 — Curvature-adaptive warp subdivision
**Headless. No volume write.** Plan: `docs/plans/curvature-adaptive-warp-subdivision.md`.

Replace Manifold's constant `WARP_AXIAL_MAX_ZSPAN = 1.5` with a `planAxialStations`
pass (stations by local curvature), converging on what TF already does.

- **Land it behind the existing dial. Do NOT change the default.** Adaptive
  subdivision is a quality/cost tradeoff that wants a human eye on a render.
- Deliver a measured before/after table: verts, tris, spanning edges, warped volume
  error, bake ms — for a straight part, a gentle curve, and a tight dogleg.
- Touches `manifold-mesh` → **bump `KERNEL_VERSION`** (guardrail 5).

## N6 — Port bore-extend (defect-2 prevention) to Manifold hollow sweeps
**Headless. No volume write.**

A hollow swept tube compiles to `booleanDifference(sweep(outerR), sweep(innerR))`.
Same path for both → **coincident tilted end caps** → the mesh boolean stitches
phantom handles (wrong genus, degenerate fan). TF already prevents this by
extending the subtrahend's path past both ends (`tf_examples/execute.ts`,
`01b75d7`); Manifold does not.

- Prevention, never post-hoc removal: dropping degenerate tris cannot fix genus
  (proven — `simplify`/`setTolerance` preserve topology by design).
- Assert **χ / genus**, not triangle counts. Same-path was χ=-16; extended is χ=0.
- Touches the engine → **bump `KERNEL_VERSION`**.

## N7 — Doc + skill hygiene (small, zero risk)
**Headless. No volume write.** Do this LAST; it depends on nothing.

Everything here is a claim that is now known to be false:

- `~/.claude/skills/wells/SKILL.md` "KEY FILES" (`:46-51`) omits the entire Track-B
  editing island (`well-edit-core/store`, `WellInspectorDock`, `CompletionsEditor`,
  `SurveyEditor`, `WellToolRail`), the `WellBakePool` stack, `wson-to-graph.ts`, and
  the GRAPH tab. Add them.
- SKILL.md `:13,34` says the `WellSchematic3D`/`manifoldCut.ts` path "is being
  REPLACED". It is **not** — it is still the only thing the 3D button renders. The
  replacement (`WellBakePool`) is built, headless-tested, and mounted by nothing.
  Reword to state the truth.
- `src/lib/wells/CLAUDE.md:15` says "4 real SVTC sample wells". There are 5 in
  `src/lib/wells/samples/`.
- `TODO.md` #42d references `docs/plans/wells-cad-parts-browser.md`, which **does
  not exist**. Either write it or drop the reference.
- `src/lib/wells/threeD/parametric/registry.ts:19` claims "Every partId below is a
  real volume part (verified via `/api/primitives/source`)". ~45 `g_*` ids are
  registered; only ~10 appear in the local cache. **Verify by READ-ONLY GET** to
  `/api/primitives/source?name=<id>` and correct the comment with the real count.
  Read only — never save.

---

## Explicitly NOT overnight (needs a browser, or writes the volume)

Build-green ≠ visually correct, and nobody is watching.

- **Wire the Track-B editing island** (`WellEditStore` + `WellInspectorDock` +
  inspector-on-select + `SurveyEditor`). The core logic is already headless-tested
  and passing; what is missing is the mount and the selection plumbing — Svelte
  reactivity across 2D/3D, which must be seen.
  **This is the single highest-value wells task, and it is a daytime task.**
  Note the live edit path today is `WellSchematic2D` dblclick → `WellCompPopup` →
  `+page.svelte` → `wson-mutate`, mutating the working doc **directly, with no
  undo**. `WellEditStore` *has* undo; the wired popup bypasses it. So "wiring" is
  really "route the existing popup through the store", not new machinery.
- **A real `completions[]` worksheet + catalog picker.** cadtrain can only edit and
  delete existing completions — **there is no way to add one**. SVTC has an inline
  catalog search (`queryCatalog` → `catalogItemToComp`) backed by a `filtercomps`
  endpoint; cadtrain has the data (`registry.ts`, 45 keys) but no picker UI and no
  endpoint. Needs the WSON-vs-graph source-of-truth decision first.
- **Perforation editing on the diagram.** Perfs are drawn but not double-click
  editable; only completions are. No perf add.
- **OH / casing / cement / strata worksheet** (SVTC's `SchematicEditor`, 4 tabs).
  cadtrain has no live structural-editing UI at all.
- **Wire `WellBakePool` into `WellSchematic3D`** (#42h) — real Workers + Manifold
  do not run headless.
- **Clip-plane cutaway** (Track A) — visual.
- **#42f popovers that mutate the graph** — needs the WSON-vs-graph
  source-of-truth decision made with the user first. Round-tripping both directions
  is the trap.
- **#42g autoscale + directional toggle promotion** — visual.
- **#42c `bw_*` part authoring** — writes the shared prod volume.
- **`#18` `feat/surface-grid-expr`** — its single commit is titled
  *"WIP (UNVERIFIED — agent stalled)"*. Do not merge it blind. A separate task can
  *evaluate* it and write a verdict, but must not merge.

---

## Morning review checklist

For each branch: read the measured before/after table in the commit body; confirm
`bun run build` + `bun run test` green; confirm `KERNEL_VERSION` bumped iff an
engine module changed; confirm nothing under `/api/primitives/save` was called
(`git log -p | grep -i "primitives/save"` → empty). Merge one at a time — N5 and N6
both touch the Manifold engine.
