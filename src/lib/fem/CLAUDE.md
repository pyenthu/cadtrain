# `src/lib/fem/` — FEM engine module

The engine half of the FEM domain. Pure logic — no Svelte, no DOM, no
component code. Stage 1 = closed-form analytical stress; future stages
add pure-JS linear FEA, then WASM tet meshing + linear solver, then
CalculiX (server-side or WASM-ported subset).

The UI sits in `src/routes/fem/` and imports from here.

## Layout

```
src/lib/fem/
├── CLAUDE.md                 — this file
├── FEM.md                    — research dossier (FreeCAD, PrePoMax, CalculiX, browser-WASM options + dual-track recommendation)
├── closed-form-stress.ts     — Stage 1: axial + torsion + bending + von Mises on annular sections
└── (future)
    ├── beam-1d.ts            — Stage 2 pure-JS linear beam FEA
    ├── linear-elastic-3d.ts  — Stage 3 sparse-CG linear elastic
    ├── tet-mesh.ts           — Stage 3 fTetWild-WASM wrapper
    ├── inp-builder.ts        — Stage 4 CalculiX .inp deck emitter (server or WASM)
    └── frd-parser.ts         — Stage 4 CalculiX .frd result-file parser
```

## Stage roadmap (mirrors `FEM.md`)

| Stage | Module(s) | Bundle | Max DOF | Ships |
|---|---|---|---|---|
| 1 — closed-form analytical | `closed-form-stress.ts` | 0 | n/a | LANDED |
| 2 — pure-JS 1D/2D linear FEA | `beam-1d.ts` + `plane-stress.ts` | ~50 KB | < 10k | pending |
| 3 — WASM linear elastic 3D | `tet-mesh.ts` + `linear-elastic-3d.ts` | 2-5 MB | ~100k | pending |
| 4 — CalculiX subset port (WASM) OR server-side `ccx` subprocess | `inp-builder.ts` + `frd-parser.ts` | 5-10 MB | ~50k | pending |

## Conventions

- **Units = oilfield (lbf, ft-lbf, in, ksi)**. Drill-pipe engineers read ksi. Internal conversions to in-lbf / psi happen inside each formula; output to the UI is ksi.
- **No Three / Threlte / Svelte dependencies here** — engine code only. Keeps the module testable + portable to a Web Worker if any solver needs one.
- **Pure functions where possible**. State + reactivity live in the UI layer.
- **Document the equations inline**. Drill engineers reading the source should see the API 5C3 / 7-2 formulas in the comments next to the code.

## Sources / further reading

See `FEM.md` for the full research dossier. Update sections C/D when a new stage ships or a new candidate library is evaluated.

## When working on FEM

Use a `FEM-` subagent (per root `CLAUDE.md` Rule 22) when the change is
substantial — multiple files, new stage, library port. The encapsulated
module + route are designed so a worktree-isolated agent can build
within `src/lib/fem/` and `src/routes/fem/` without touching the
rest of the project.
