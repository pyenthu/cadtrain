# `src/lib/engines/brep/` — OCCT (OpenCascade) exact B-rep kernel

The exact-kernel alternate: true curves + clean annular sweep caps, ~40–100×
slower than Manifold. **Server-only today** (`/api/brep/preview`, graph → OCCT;
a client-side OCCT build is a TODO). Files: `brep-occt` (executor),
`brep-{adapter,client,audit}`.

- Where BREP wins over the mesh kernels — clean caps on a curved hollow
  subtract (the r_sweep defect-2 that TrueForm can't fix) — is documented in
  `../manifold/CLAUDE.md` (`## Manifold gotchas` → r_sweep). BREP cutaway on a
  swept-boolean solid throws un-tessellably; revolve-BREP cuts fine.
- **`r_sweep` MakePipeShell can THROW on a resampled spline** (e.g. `sweep_tube_demo`,
  a nearly-straight micro-wiggly spine that MF/TF sweep clean) — a `Standard_Failure`
  (bare heap pointer) that fails the WHOLE build → the tab shows a stale/partial mesh
  (the "flicker"). Fix (`666086d`): keep MakePipeShell PRIMARY, and ONLY on its throw
  recover by lofting the section through `sweepFrames` RMF stations
  (`replicad.loft`/ThruSections). Loft-FIRST regresses S-curves (20–33 % vol error) —
  recovery-only. Memory `brep_sweep_makepipeshell_throw`; deep-dive
  `docs/research/sweep-self-intersection.md`. (Sharp corners + closed loops still fold —
  genuine geometric self-intersection, still open.)
- Engine-layer overview + dependency rule → `../CLAUDE.md`.
- Multi-engine matrix (client/server routing) → `docs/architecture/geometry-engines.md`.
