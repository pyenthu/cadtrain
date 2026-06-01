# Cadtrain Cleanup — 2026-06-01

Moved stale code out of the active codebase to shrink the surface area the
AI + the user need to think about. Everything here is preserved in tree (so
git history + future revival is intact) but is invisible to vite, tsc, and
the SvelteKit router.

Active products after the cut:

- `/primitives` (parametric CAD editor)
- `/fem` (finite element analysis)
- `/forge` (image → 3D scaffold)
- `/wells` (stub) + `/plan` + `/volume`
- the supporting `src/lib/{shared,server,cad,fem,forge,test-stubs}` machinery
- `/api/primitives/*`, `/api/volume`, `/api/forge/*`

Build verified green after every move:
- `bun run build` → 485 client modules + full server bundle.
- `bun run test` (vitest) → 33 passing (was 33 before).

## What was moved + why

| Path moved | Reason |
|---|---|
| `src/routes/archive/*` → `archive/src/routes/archive/` | Reference-only legacy UI (reverse, training, tools, wells, tests, archive sub-routes). Only consumed by itself + nav links in landing/layout, which were updated. |
| `src/routes/api/identify/` → `archive/src/routes/api/identify/` | Sole consumers were `/archive/reverse` + `/archive/tests`. No active route or lib hits `/api/identify`. |
| `src/routes/api/refine/` → `archive/` | Same — only `/archive/reverse` used it. |
| `src/routes/api/accept/` → `archive/` | Same — only `/archive/reverse`. |
| `src/routes/api/feedback/` → `archive/` | Same — only `/archive/reverse`. |
| `src/routes/api/cache/` → `archive/` | Only `/archive/tests` consumed `/api/cache/stats`. |
| `src/routes/api/wells/` → `archive/` | Only `/archive/wells` + `/archive/tests/wells` consumed `/api/wells/extract`. |
| `src/routes/api/kb/` → `archive/` | Zero active consumers (the KB tab in `/primitives` doesn't fetch from `/api/kb`; it reads `/api/volume` directly). |
| `src/lib/identify/` → `archive/src/lib/identify/` | Only `src/routes/api/identify/+server.ts` + the moved archive routes imported `backend.ts`. |
| `src/lib/training/` → `archive/src/lib/training/` | Only `/api/{identify,refine,accept,feedback,cache}` consumed it. All five endpoints moved. |
| `src/lib/wells/` → `archive/src/lib/wells/` | Only `/api/wells/extract` + the archive wells UI consumed it. |
| `src/lib/viewer/` → `archive/src/lib/viewer/` | Only `/archive/training/+page.svelte` consumed `viewer/builder.ts`. |
| `src/lib/tools/` → `archive/src/lib/tools/` | Only `/archive/tools/{ratch-latch,bottom-sub}` consumed these. |
| `src/lib/authoring/` → `archive/src/lib/authoring/` | The AuthoredComponent schema + compose interpreter. Only consumed by `cad/builder.ts` (dead-code paths buildPrimitiveManifold/buildComponent that are NOT called from `/api/primitives/preview`) + the now-moved archive routes + plan/details narration. |
| `src/lib/cad/assemblies-l4.ts` → `archive/` | Zero imports — confirmed by grep. |
| `src/lib/cad/file-kinds.ts` (+ test) → `archive/` | Zero imports from anywhere except its own test. |
| `src/lib/cad/exporter.ts` → `archive/` | Zero imports — only referenced in `cad/CLAUDE.md` notes. |
| `src/lib/cad/pipe/` → `archive/src/lib/cad/pipe/` | Imports `$lib/authoring/schema` and is only consumed by the authoring chain (now archived). Plan-page narration references it but only as a string. |
| `src/lib/cad/rules/` → `archive/src/lib/cad/rules/` | Same — `$lib/authoring/schema` consumer only. |

## What was considered but NOT moved

| Path | Why kept active |
|---|---|
| `src/lib/cad/math-lib.ts` | Imported by `src/lib/server/profile-fn.ts` AND `src/lib/cad/primitive-sandbox.ts` — both active. Initial attempt to move broke the build; reverted. |
| `src/lib/cad/builder.ts` | `finalizeManifold` + `setRenderZScale` + `initManifold` + `setCircularSegmentMode` + `CIRCULAR_SEGMENTS_*` are all imported by `src/routes/api/primitives/preview/+server.ts`. The file's `buildPrimitiveManifold` / `buildComponent` / `builders` map / `COMPONENTS` consumer paths ARE dead, but extracting just the live exports would be brittle (~250 LOC of internal helpers tangled with the dead `builders` map). Leaving in place; tagging it as a `K.*` cleanup todo. |
| `src/lib/cad/library.ts` | Only consumed by `cad/builder.ts` (above) + `cad/pipe/archetypes.ts` (now archived) + `lib/authoring/schema.ts` (now archived). Kept solely because `builder.ts` still imports `COMPONENTS` at module top level. |
| `src/lib/cad/assembly-deps.ts` | Imported by `src/lib/shared/PrimitiveView.svelte` (active — `parseDependencies`, `diffDependencies`, `buildSnapshots`, `writeDependencies`, `parseUses`, `DependencyDiff`). |
| `src/lib/forge/`, `src/lib/fem/` | Active products per the brief. |
| `src/routes/plan/details.ts` narrative refs to identify/wells/authoring | These are description strings, not imports — they don't break anything. |

## Active-code adjustments made to land the moves

1. `src/routes/+layout.svelte` — dropped `/archive` + `/archive/tests` items from the Meta nav section.
2. `src/routes/+page.svelte` — landing page now links `/primitives`, `/forge`, `/wells`, `/fem`, `/plan`. Removed `/archive/tests` + `/archive` cards.
3. `src/hooks.server.ts` — `RATE_LIMITED_PREFIXES` was `['/api/identify', '/api/refine', '/api/wells/extract']`. All three endpoints moved, so the list is now `[]` (kept as an empty stable extension point with an explanatory comment).
4. `.gitignore` — the previous `/archive/` rule (which targeted root-level raw legacy assets like `BOTTOM_SUB_legacy/`) was REPLACED with a comment explaining that `/archive` is now a tracked committed directory holding the archived `src/`. Narrow per-subdir ignores are noted but commented out.

## LOC summary

| Bucket | Lines |
|---|---|
| Moved into `archive/` | 8,004 |
| Remaining active in `src/` | 26,302 |
| Reduction | ~23% of the pre-cleanup `src/` body |

The biggest items by file:

- `src/lib/cad/library.ts` — 566 LOC — **NOT moved** (entangled with builder.ts; see above).
- `src/lib/cad/builder.ts` — 741 LOC — **NOT moved** (live preview endpoint depends on it).
- `src/lib/training/*` — 5 files, ~970 LOC — moved.
- `src/routes/archive/*` — ~2,043 LOC across page.svelte files — moved.
- `src/lib/cad/{pipe,rules,assemblies-l4,file-kinds,exporter}` — ~947 LOC — moved.
- `src/lib/authoring/*` — ~640 LOC — moved.
- `src/lib/tools/*` (bottom-sub + ratch-latch) — ~1,533 LOC — moved.
- `src/lib/wells/*` — ~429 LOC — moved.

## How to revive any archived module

Everything is in git history at its original `src/...` path AND at its new
`archive/src/...` path. To resurrect:

```sh
git mv archive/src/lib/training src/lib/training
# update any consumers that were also archived; rebuild
```

Or, since the moves are simple `git mv`s, `git log --follow` on any moved
file shows the full pre-move history.

## Follow-up cleanup candidates (deferred — would require surgery)

- Extract the live surface of `cad/builder.ts` (`finalizeManifold`,
  `setRenderZScale`, `initManifold`, `setCircularSegmentMode`,
  `CIRCULAR_SEGMENTS_*`, `ComponentResult` type, `RenderMaterial` types,
  `PartColorLUT` type) into a slim `cad/manifold-finalize.ts`. Then drop
  `cad/builder.ts` + `cad/library.ts` into archive. ~700 LOC savings.
- The Dockerfile + docker-entrypoint.sh may have stale COPY/symlink lines
  pointing at `training_data/`. Not touched in this pass to keep the
  deploy path unchanged.
- `static/training_data` symlink + the root-level `training_data/` /
  `kb-sources/` data directories were NOT moved (they're data, not code).
  If the identify chain stays archived, these can be moved next pass.
- The `eval/`, `kb/`, `library/`, `figures/`, `primitives/` directories at
  repo root are local-dev mirrors of the prod volume; they're already
  outside the build path. Leaving alone.
