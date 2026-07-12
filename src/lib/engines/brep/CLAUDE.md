# `src/lib/engines/brep/` — OCCT (OpenCascade) exact B-rep kernel

The exact-kernel alternate: true curves + clean annular sweep caps, ~40–100×
slower than Manifold. **Server-only today** (`/api/brep/preview`, graph → OCCT;
a client-side OCCT build is a TODO). Files: `brep-occt` (executor),
`brep-{adapter,client,audit}`.

- Where BREP wins over the mesh kernels — clean caps on a curved hollow
  subtract (the r_sweep defect-2 that TrueForm can't fix) — is documented in
  `../manifold/CLAUDE.md` (`## Manifold gotchas` → r_sweep). BREP cutaway on a
  swept-boolean solid throws un-tessellably; revolve-BREP cuts fine.
- Engine-layer overview + dependency rule → `../CLAUDE.md`.
- Multi-engine matrix (client/server routing) → `docs/architecture/geometry-engines.md`.
