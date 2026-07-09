# STATUS — current focus + in-flight architecture

Moved out of the root `CLAUDE.md` (2026-07-10) so it stops costing context in
every session. Shipped detail → `docs/HISTORY.md` + session-handoff memories;
roadmap → `/plan` (Rule 19). Read this at the start of a working session.

> **Launch `claude --chrome` for fast visual iteration on /primitives + /vocab.**

## Current focus (2026-07-06 — resume point)

- **Latest session**: memory `session_handoff_2026-07-07` — READ IT FIRST.
- **TF tab is now a real engine surface** (2026-07-06): runs in a **Web Worker**
  (`tf-worker*.ts`), **native-only** (no Manifold fallback → blank+reason), per-part
  **material** on full+cut views, `r_weld_extrude` builds natively (g_cube/star/
  spiral/barrel), cutaway = view-switch (no blank), and **only the ACTIVE /primitives
  pane bakes** (shared TF worker supersede was blanking all-but-one on open). Compile
  caches: `/api/tf/compile` + `resolveDepColors` (302/940ms → ~1/0.1ms); 🔄 = true fresh.
- **⚠ Route C lean revolve**: `g_shaft` `zSegments 10→0` edited on the VOLUME (backup
  `.route-c-backup/`); warp re-densifies at build time via `_axialMaxZSpan` dial (span
  1.5) in `bake-worker-core.ts` + `preview/+server.ts`. Straight 528→96, warped 8448→2640
  smooth. Rule-25 clean. NEXT: curvature-adaptive span. `docs/plans/manifold-revolve-lean.md`.
- Open follow-ups: `docs/plans/{tf-compile-perf (BFS-parallelize + save-invalidation),
  tf-wasm-tab, manifold-revolve-lean}.md`; per-SUBPART material needs color-by-source.
- **GraphEditorPane modularization** (#940) still open; **typed expression outputs** (#926);
  **/wells** re-plan (`session_handoff_2026-07-04-wells`). Plans in `docs/plans/`.

## Client-side execution (in progress)

Geometry **execution** is moving off the server into a browser **Web Worker**
(`src/lib/cad/bake-worker.ts` + `bake-client.ts`): the server stays the COMPILER
(`/api/primitives/compile` → dep-inlined Manifold script + `scriptHash`), the
client EXECUTOR bakes the script. **Toggle:** 💻/☁ button in the graph-editor
left rail (or `localStorage.cad-client-bake`) → `scene.clientBake`; the bake pane
shows a `⚡client`/`☁server` badge, and the SRC tab has a `⚡compiled` subtab.

Client-first is the DEFAULT. **The silent client→server fallback was REMOVED
2026-07-10** — a client-bake failure now surfaces as an error instead of quietly
retrying on the server. That fallback was masking a browser Manifold WASM trap as
a *server* 400, and the retry poisoned the server's Manifold singleton; three
apparently unrelated bugs, one cause. A deliberate server route remains only for
parts the client kernel cannot express (e.g. a BREP source), logged as a
capability gap, not a masked failure.

The prod COOP/COEP + static-asset headers that unblock client bake shipped
2026-07-02. Kills the deja-vu stale-bake bug structurally. PR1–3 shipped; plan
`docs/plans/client-side-execution.md`; memory `client_side_execution`.
