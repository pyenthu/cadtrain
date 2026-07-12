// ─────────────────────────────────────────────────────────────────────────
// bake-badge — pure timing math for the MF_CLIENT bake badge (#987).
//
// The badge USED to sum `bake._t` (the server /preview phase breakdown) minus
// `fetch_total`. When runBake switched to /api/primitives/compile — which only
// returns `_t.fetch_total`, exactly the field the badge EXCLUDED — the sum ran
// over an empty set → the badge always printed "fresh · 0 ms" for a bake that
// really took seconds. The fix threads the REAL per-phase worker timings from
// bake-worker-core through PrimitiveDualCanvas.onBakeTimings → RightPane. This
// module is the tiny, unit-testable core of that math: "sum the phases" and the
// cached-vs-fresh split the badge renders.
// ─────────────────────────────────────────────────────────────────────────

/** Per-phase worker bake timings, exactly as `bake-worker-core` attaches them
 *  to the result (`out.timings = { build, mesh, cutaway, finalize, serialize }`,
 *  ms). Every field is optional so a partial / legacy payload sums safely. */
export interface BakePhases {
  build?: number;
  mesh?: number;
  cutaway?: number;
  finalize?: number;
  serialize?: number;
}

/** What `PrimitiveDualCanvas` reports to the badge (via `onBakeTimings`) after
 *  each MF_CLIENT bake. */
export interface ClientBakeMeta {
  /** IndexedDB bake-cache hit (scriptHash) — NOT a compile-cache hit. */
  cached: boolean;
  /** `/api/primitives/compile` round-trip (ms). 0 on a cache hit (compile skipped). */
  compileMs: number;
  /** Wall time of the worker bake + transfer + main-thread decode (ms). */
  bakeMs: number;
  /** In-worker per-phase breakdown; absent on a cache hit (no bake ran). */
  phases?: BakePhases | null;
}

/** Sum the five worker bake phases (build + mesh + cutaway + finalize +
 *  serialize), treating any missing phase as 0. This is the in-worker geometry
 *  cost — it is ≤ the headline `bakeMs`, which also covers the postMessage
 *  transfer + main-thread deserialize the phases don't include. */
export function sumBakeTimings(phases?: BakePhases | null): number {
  if (!phases) return 0;
  return (phases.build ?? 0)
    + (phases.mesh ?? 0)
    + (phases.cutaway ?? 0)
    + (phases.finalize ?? 0)
    + (phases.serialize ?? 0);
}

/** The numbers the badge renders, derived purely from the canvas-reported meta
 *  so the cached-vs-fresh branching is unit-testable without a browser:
 *   - cached (IndexedDB bake hit): compile is skipped → `compileMs` forced to 0,
 *     no phases exist → `phaseSum` is 0; only `bakeMs` (decode + paint) is real.
 *   - fresh: compile + wall bake shown separately, plus the in-worker phase sum. */
export interface BakeBadgeTotals {
  cached: boolean;
  compileMs: number;
  bakeMs: number;
  phaseSum: number;
}

export function bakeBadgeTotals(meta: ClientBakeMeta): BakeBadgeTotals {
  return {
    cached: meta.cached,
    compileMs: meta.cached ? 0 : meta.compileMs,
    bakeMs: meta.bakeMs,
    phaseSum: sumBakeTimings(meta.phases),
  };
}
