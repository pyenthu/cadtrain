# Repo Cleanup — Investigation + Recommendation Plan

> **Status: INVESTIGATION ONLY.** Nothing in this doc has been deleted or
> moved. Every row is a recommendation for a human to approve (root CLAUDE.md
> Rule 6: destructive ops need approval). Evidence captured 2026-06-16 on
> branch `worktree-agent-a46a12af22f81facf`.

Method: `ls -R` each area, `git log -1` for last-touch dates, and
`grep -rIl <name>` across the repo (excluding `node_modules/.git/scripts`) to
find references in `package.json`, `Dockerfile`/`railway.toml`, active
`src/routes/**/+server.ts`, docs, and the `/plan` Gantt. A reference *only* in
`docs/HISTORY.md`, `docs/plans/*`, `archive/`, or `src/routes/plan/details.ts`
is **historical**, not an active consumer.

---

## 1. `scripts/` — prune

37 entries (35 files + `kb/` + `prompts/`). Recommended actions use **archive**
(move under `archive/scripts/` — the repo already keeps a tracked `archive/`
tree, CLAUDE.md Rule 2) rather than hard `rm`, except for untracked scratch.

### KEEP — referenced by an active workflow

| File | Reference (active) | Reason |
|---|---|---|
| `seed_cache.ts` | `package.json:seed`, `README.md` | bake-cache seeder |
| `extract_figures.ts` | `package.json:extract:figures`, `.gitignore` | figure extraction → volume |
| `overnight_extract.ts` | `package.json:extract:generate` | extraction generate cmd |
| `harvest_e2e_videos.ts` | `package.json:record:task`, `/plan` | e2e WEBM harvest (Rule 12) |
| `promote-to-vocab.ts` | CLAUDE.md Rule 24, `api/vocab/CLAUDE.md` | vocab promotion pipeline |
| `regenerate-from-vocab.ts` | **`src/routes/api/vocab/regenerate/+server.ts`** | invoked by a live endpoint |
| `render-vocab-graph.ts` | CLAUDE.md Rule 24, `vocab/+page.svelte` | regenerates `vocabulary-graph.mmd` |
| `scan-stale-arg-keys.ts` | newest (2026-06-15), CLAUDE.md "loader unknown-arg-key scan" | current diagnostic for the open `dt_sub`/`g_dp_pin` bugs |
| `cadtrain-mcp.ts` | `docs/EXTERNAL_API.md`, `docs/api/README.md`, `docs/plans/external-api.md` | external MCP API surface (recent, 2026-06-13) |
| `build_g_parts.ts` | `docs/plans/part-editor-window.md`, `/plan` | active `g_*` part generation (Round 2 queued) |
| `_volume.ts` | imported by extract_figures / overnight_extract / harvest_e2e_videos / kb | **shared lib** — do not remove; KEEP specials depend on it |
| `volume2onedrive.sh` | **`src/routes/api/volume/onedrive/+server.ts`** spawns it | invoked by a live (dev-only) endpoint |
| `kb/build_casing_tubing_data.ts` | `.gitignore` (kb-sources feed), uses `_volume.ts` | KB table extractor, active workflow |

### STALE — recommend ARCHIVE (move to `archive/scripts/`)

| File | Last touch | Only reference(s) | Reason |
|---|---|---|---|
| `gen_synthetic.ts` | 2026-05-09 | `archive/src/lib/training/*` | synthetic data gen for the **archived** identify/RAG training stack |
| `migrate_to_clip.ts` | 2026-05-09 | `archive/src/lib/training/*` | one-off migration (done); consumer archived |
| `migrate_to_file_kinds.py` | 2026-05-26 | `docs/plans/file-based-architecture.md` | one-off migration, completed |
| `generate_authored_library.ts` | 2026-05-13 | `archive/CADTRAIN_CLEANUP.md` | old authoring stack (archived) |
| `prompts/generate_authored.{system,user}.md` | — | consumed by `generate_authored_library.ts` | dead with their script |
| `ingest-comp-list.ts` | 2026-06-06 | `docs/HISTORY.md`, `/plan` | one-off SVTC component ingest (historical) |
| `sync-svtc-compjson.ts` | 2026-06-06 | `docs/HISTORY.md`, `/plan` | one-off sync (historical) |
| `demo-composition-graph.ts` | 2026-06-06 | `docs/plans/composition-architecture.md` | demo / proof-of-concept |
| `spike_makerjs.ts` | 2026-06-12 | comment in `src/lib/graph/sketch.ts` | spike; sketch shipped |
| `spike_sketch.ts` / `spike_sketch_node.ts` | 2026-06-12 | none | spikes; sketch shipped |
| `spike_csg_originalid.ts` | 2026-05-27 | source comments + HISTORY + plan | spike that informed `part-id.ts`; result captured, script not needed |
| `bench_helix.ts` / `test_raw_helix.ts` | 2026-05-20 | `docs/CAD_AUTHORING.md` | benchmark/experiment; findings in memory `bench_extrude_findings` |
| `overnight_assembly_gen.ts` | 2026-05-18 | none | overnight one-off |
| `snap_dev.mjs` | 2026-05-11 | `docs/plans/overnight-2026-05-23.md` | stale dev-snapshot helper |
| `dump-vocab-source.ts` | 2026-06-05 | none | ad-hoc debug dump |
| `index_hal_catalog.ts` | 2026-04-13 (oldest) | none | catalog indexer one-off |
| `inspect_catalog_pdf.py` | 2026-05-14 | `/plan` details (historical) | PDF inspection one-off |
| `gen_primitive_csg_tests.py` | 2026-05-22 | none | one-off test generator |
| `volume_walk.py` | 2026-05-26 | none | one-off volume audit |

> The 4 Python scripts are all one-off migration/inspection helpers. Removing
> them also aligns the repo with Rule 1 (no Python in the JS/Bun toolchain).

### DELETE outright (untracked scratch)

| File | Reason |
|---|---|
| `scripts/_poll_tpb_tmp.mjs` | untracked; matches `.gitignore` `/scripts/_*tmp*.mjs`; 0 refs |
| `scripts/_pollgpc_tmp.mjs` | untracked scratch; same |

Plain `rm` — they are not in git, so no commit needed.

---

## 2. `tests/` — prune

### `tests/e2e/` specs

| Spec | Last touch | Verdict | Reason |
|---|---|---|---|
| `graph-editor.spec.ts` | 2026-06-16 | **KEEP** | the active editor; `package.json:test:graph`. NOTE: carries the documented prod-volume blocker (CLAUDE.md "Current focus") — needs an isolated seeded test volume before it's safe to run |
| `volume.spec.ts` | 2026-05-14 | **KEEP** | `package.json:test:volume`; volume round-trip |
| `primitives-create.spec.ts` | 2026-05-27 | **KEEP** (verify) | current create flow; already isolates via `X-Volume-Local: 1`. May need a UI refresh but conceptually current |
| `routes.spec.ts` | 2026-05-27 | **STALE** | asserts `/archive/*` routes return 200 and navbar-era URLs — but `src/routes/archive/` no longer exists (moved to `archive/src/` 2026-06-01). Would fail today |
| `navbar.spec.ts` | 2026-05-27 | **STALE** | tests a corner-button nav in `+layout.svelte`; navbar was removed 2026-06-09 (no nav markup remains in the layout) |
| `archive-links.spec.ts` | 2026-05-27 | **STALE** | crawls intra-`/archive` links; those routes are gone |
| `backend.spec.ts` | 2026-05-11 | **STALE** | tests `/api/identify` + `/api/wells` — both deleted/archived 2026-06-01 (dirs do not exist) |
| `inner-threaded-debug.spec.ts` | 2026-05-19 | **STALE** | self-described "ad-hoc visual debug" of `inner_threaded_pipe` |
| `primitives-debug.spec.ts` | 2026-05-19 | **STALE** | self-described "ad-hoc visual debug" of `profile_extrude_v2` |

Recommend: archive the 4 stale route/backend specs and 2 debug specs to
`archive/tests-e2e/` (or `rm`). They test surfaces that no longer exist; left
in place they break a full `bun run test:e2e` run.

### `tests/results/` — regenerable artifacts (~105 MB, **gitignored**)

| Dir | Size | Action |
|---|---|---|
| `tests/results/playwright-output/` | 72 MB | `rm -rf` — Playwright traces/videos, regenerable |
| `tests/results/playwright-report/` | 26 MB | `rm -rf` — last HTML report, regenerable |
| `tests/results/components_eval/` | 7.4 MB | `rm -rf` — eval renders from the **deleted `/components`** product |

All of `tests/results/` is in `.gitignore` (not tracked), so removal is a local
disk reclaim only — safe, no commit.

### `tests/CLAUDE.md` is itself stale (update, don't delete)

It documents unit tests under `src/lib/training/*.test.ts` (that tree is now in
`archive/`), a `runes.spec.ts` and `backend.spec.ts` for identify/wells, and a
navbar spec — none of which match the current app. Recommend rewriting the spec
table to the KEEP set above as part of this cleanup.

---

## 3. Consolidate `ai/` and `training_data/`

### Current state

- **No top-level `ai/` directory exists in the repo** (`test -d ai` → NO). Per
  Rule 13 the canonical `ai/` namespace (`training_data/`, `kb/`, `kb-sources/`,
  `eval/`, `rag/parts.jsonl`) lives **only on the persistent volume** (`/app_data`
  on Railway, `./.dev-volume/` locally). Local-dev mirrors land at bare root
  paths (`./kb/`, `./eval/`, `./figures/`, …) — all **gitignored**.
- **`training_data/` IS tracked** — 212 files, ~175 MB committed. It is the
  local-dev seed/mirror of the legacy **identify** training data. Its consumer
  (`src/lib/training/*`, the identify/RAG retrieval chain) was **archived**
  2026-06-01 (`archive/src/lib/training/`). `.gitignore` already excludes the
  iterative images (`iter_/refine_/model_*.png`), `synthetic/`, and `*.bak.*`.

### The confusion to fix

1. **Namespace asymmetry**: on the volume everything is under `ai/`
   (`ai/training_data`, `ai/kb`, …); locally the mirrors drop the `ai/` prefix
   (`./training_data`, `./kb`). Same data, two layouts — undocumented.
2. **`training_data/` is committed source weight (175 MB) feeding an archived
   feature**, while its siblings (`kb/`, `eval/`) are correctly gitignored
   volume mirrors. Inconsistent treatment.

### Plan (does NOT touch the volume — preserves the Rule 13 contract)

1. **Decide the role of committed `training_data/`.** It is the only piece of
   the `ai/` corpus checked into git. Two clean options:
   - **(A, recommended) Move `git mv training_data/ archive/training_data/`** so
     it sits beside its archived consumer (`archive/src/lib/training/`). This
     drops ~175 MB out of the active tree's mental footprint while keeping it
     recoverable, and matches the existing "archive holds soft-deleted/legacy
     things" convention. The canonical live copy stays on the volume under
     `ai/training_data/` — untouched.
   - **(B) Keep in place but gitignore the heavy seed images/jsonl** and leave a
     small `training_data/README.md` pointer to the volume canonical. Lighter
     change, but leaves a legacy-feature seed in the active root.
2. **Do NOT create a top-level `ai/` dir in the repo.** The volume is canonical;
   adding a tracked `ai/` would fork the corpus and break the single-store
   contract (Rule 13). The only thing the repo needs is *documentation* of the
   mapping.
3. **Document the mapping once.** Add a short table to Rule 13 / a
   `docs/VOLUME_TRANSFER.md` note: `volume:ai/<x>` ⇄ `local:./<x>` (prefix
   dropped), and that `training_data/` is the lone tracked seed (or, post-step-1,
   that it now lives in `archive/`).
4. **Verify before moving** (Rule "verify before ship"): confirm nothing under
   active `src/` imports `training_data/` (grep showed refs only in
   `archive/src/lib/training/retrieval.test.ts`) so a move is safe.

---

## 4. Do we need FEM and forge?

### FEM — **KEEP** (low cost, encapsulated, linked, working)

- Footprint: `src/lib/fem/{closed-form-stress,tension-stress-3d}.ts` (+ CLAUDE.md,
  FEM.md) and `src/routes/fem/` (`+page.svelte`, `[id]/+page.svelte`,
  `[id]/tension/`). That's it — **Stage 1 only** has landed (closed-form
  analytical stress + a tension-visualization layer).
- It is **linked from the landing page** (`/` → "FEM — finite element analysis")
  and self-contained: pure JS, **no external API key, no runtime cost, no
  WASM/Python** (later stages are planned, not present). Rule 22 deliberately
  encapsulates it so it stays out of the way.
- Verdict: **keep as-is.** Removing it saves almost nothing and discards a
  working, linked feature with a documented roadmap. No action needed beyond
  leaving it encapsulated.

### forge — **KEEP but flag as DEFERRED/experimental** (decision pending)

- Footprint: `src/lib/forge/{pipeline,types}.ts`, route `src/routes/forge/`, and
  endpoint `src/routes/api/forge/generate/+server.ts`. Small and self-contained.
- It is **linked from the landing page** ("Forge — image → 3D") but is a
  **scaffold gated behind `FAL_API_KEY`** (FAL Hunyuan3D). Without the key it is
  a no-op; there is no evidence of active use beyond the scaffold, and a plan
  exists at `docs/plans/forge.md`.
- Verdict: **keep, but flag.** Blast radius is tiny (2 lib files + 1 route + 1
  endpoint), so it costs little to retain, and it gates cleanly on the absent
  key. Recommend: leave the code, but either (a) mark the landing tile
  "experimental", or (b) if the image→3D direction is shelved (cf. memory
  `todo_image_to_mesh_blaster`, "parked until go-ahead + keys"), archive the
  route to `archive/` to remove a dead-ended tile from the main menu. **Defer the
  archive decision to product direction** — do not remove unilaterally.

> Side note (out of scope but observed): `src/routes/design/` is an orphan — a
> descriptive page **not linked from the landing menu** (0 refs in
> `+page.svelte`). Flag for a keep/link/archive decision in a follow-up.

---

## Summary

1. **scripts/**: 13 KEEP (package.json / live endpoints / shared `_volume.ts`);
   ~19 STALE one-offs & spikes → archive to `archive/scripts/`; 2 untracked
   `_*tmp*.mjs` → `rm`.
2. **tests/**: KEEP graph-editor / volume / primitives-create; 6 specs are STALE
   (route/navbar/archive/backend tests for surfaces deleted 2026-06-01..06-09,
   plus 2 ad-hoc debug specs) → archive; `tests/results/` (~105 MB, gitignored)
   → `rm -rf`; rewrite the stale `tests/CLAUDE.md` spec table.
3. **ai/ + training_data/**: no repo `ai/` exists (volume is canonical — keep it
   that way); the lone tracked seed `training_data/` (~175 MB) feeds an archived
   feature → `git mv` it into `archive/`, and document the `volume:ai/x ⇄ local:x`
   mapping. Never fork the corpus into a tracked `ai/`.
4. **FEM**: KEEP — small, encapsulated, linked, working Stage 1, zero runtime
   cost. **forge**: KEEP but flag experimental (gated on `FAL_API_KEY`); archive
   only if the image→3D direction is formally shelved.
5. All recommendations are non-destructive proposals; await approval (Rule 6)
   before any `git mv`/`rm`, and verify no active `src/` import breaks first.
