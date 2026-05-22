# Overnight plan — /primitives polish (2026-05-23)

Autonomous run. Orchestrator (main session) spawns subprocesses, verifies, commits+pushes each phase, advances. All specs below are complete — no user decisions required. Gate every commit on a GREEN build; if a phase fails verification, DO NOT commit it — leave it for morning review and continue independent phases.

## Collision map (why the phasing)
- `src/lib/shared/PrimitiveView.svelte` + `src/lib/shared/PrimitiveDualScene.svelte` → **Phase 1A** (one worker).
- `src/routes/primitives/+page.svelte` + `src/routes/api/primitives/list/+server.ts` → **Phase 1B** (one worker). Different files from 1A → parallel-safe.
- Tooltips touch many files incl. PrimitiveView → **Phase 2**, AFTER 1A.
- CSG tree touches PrimitiveView + recognize-composite → **Phase 3**, AFTER 2.

## Phase 1A — inspector + canvas  (PrimitiveView.svelte + PrimitiveDualScene.svelte)
1. **Title in canvas.** Remove the primitive name + description from the header. Render the primitive **name as a title INSIDE the canvas** via a Threlte `<HTML>` element (top-left), and the **description at the BOTTOM of the canvas** in a second Threlte `<HTML>` span. (`@threlte/extras` `HTML`.)
2. **Canvas up, no padding.** Remove the padding above the canvas pane; move the canvas to the top of the split.
3. **Exclusive accordion.** Only ONE accordion row open at a time, UNLESS pinned: add a per-row 📌 pin; opening a non-pinned row closes other non-pinned rows; pinned rows stay open. Keep the 220px body scroll-cap.
4. **2-column param layout.** Reduce `.pr-card` padding and narrow the grid `minmax` column width so params flow into 2 columns in the inspector width.
5. **Profile shape-icon.** For leaf polygon params + composite profiles: a small **icon that draws the profile shape**; hover shows a tooltip "profile" (+ a larger shape preview); click opens the existing ✎ popup. In the popup, add a **coordinates section (top or bottom) listing the points, each formatted to MAX 2 decimal places**.

## Phase 1B — sidebar  (primitives/+page.svelte + list endpoint)
6. **Basic folder.** Move the raw `r_*` volume primitives → `primitives/basic/` (on the prod volume, via the move mechanism aca54 used). List endpoint recurses `basic/` → a `basic` group. Sidebar renders a **"Basic" folder** (collapsible) → completes Basic / Industrial / Completions / Archive. (Leave the 3 stray `t_*` clone dirs at root alone.)
7. **Reduce sidebar spacing.** Tighten padding/line-height in the sidebar content (rows + group headers) — content-sized, denser.

## Phase 2 — tooltips (codebase-wide)  [after 1A]
8. Unify ALL tooltips on ONE prominent style: **black bg, white text**, via the `floatingTip` action (body-portaled). Sweep native `title=` + ad-hoc tips. No `?` cursor. (`todo_tooltips_codebase`.)

## Phase 3 — visual CSG / BODMAS composition tree (K.7)  [after 2]
9. The `return <expr>` becomes an editable boolean TREE: operands = instances, nodes = union/subtract/intersect. Recognizer (`recognize-composite.ts`) parses the composition into a tree; tree-editor UI in PrimitiveView; round-trip tree → expr string → splice at compStart/compEnd.

## Per-phase verification (orchestrator)
- If dev server wedged (HTTP 000 / stale): kill + `rm -rf .svelte-kit node_modules/.vite` + `bun run dev` + retry-curl.
- `bun run build` green · `curl /api/primitives/list` (1B: shows `basic`) · `snap_dev.mjs /primitives` (read the PNG).
- On green: commit (one logical commit per task-group) + push. On fail: skip the commit, note it, continue independent phases.

## Status (orchestrator updates this)
- [ ] 1A spawned · [ ] 1A verified+committed
- [ ] 1B spawned · [ ] 1B verified+committed
- [ ] Phase 2 · [ ] Phase 3
- Morning report: list commits + any phase that failed verification.
