# `src/routes/fem/` — FEM UI

The UI half of the FEM domain. Pages here import the engine from
`$lib/fem/*`. Stage 1 ships an index + per-primitive stress page.

## Layout

```
src/routes/fem/
├── CLAUDE.md           — this file
├── +page.svelte        — index. Lists tubular primitives (drill-pipe,
│                         tubing, joints). Links to /fem/[id].
└── [id]/
    ├── +page.svelte    — per-primitive stress page. Inputs (axial F,
    │                     torque T, bending M, material grade);
    │                     outputs (σ_a, σ_b, τ, σ_vm, SF, verdict);
    │                     color-coded stress bar.
    └── tension/
        ├── +page.svelte    — Stage 2 (Track B). 3D tension-test viewer:
        │                     equal axial F at each end, GLB rendered
        │                     in Threlte, σ_vm color overlay + ε-driven
        │                     z-stretch (× user-amplified slider).
        │                     Method dropdown for future FEA backends.
        └── TensionScene.svelte — Threlte scene used by the page above.
```

## Patterns

- **Engine imports**: `import { ... } from '$lib/fem/closed-form-stress'`. NEVER duplicate equations in the route — formulas live in the engine module.
- **Primitive data**: fetch from existing endpoints (`/api/primitives/list`, `/api/primitives/source`). No new server endpoints for Stage 1.
- **Unit display**: ksi for stress, lbf for axial, ft-lbf for torque/moment, inches for section dimensions. Drill-pipe engineers read these directly.
- **Material grades**: pull from `MATERIAL_GRADES` in the engine module. Default = G-105.
- **Verdict colors**: tie to the engine's `stressColor()` helper so the bar + the verdict pill agree.

## Future routes

When Stage 2-4 land, add:
- `/fem/[id]/beam` — pure-JS linear beam FEA (Stage 2).
- `/fem/[id]/elastic-3d` — WASM linear elastic 3D (Stage 3).
- `/fem/[id]/ccx` — CalculiX results panel (Stage 4).

Each stage gets its own sub-route, NOT a tab on the same page. Keeps
the URL state simple and makes it obvious which stage the user is in.

## 3D viewer (deferred)

Stage 1 doesn't render a 3D viewer — σ_vm is uniform across the section
in the closed-form model, so a color overlay adds little. Stage 2+ ship
the 3D viewer with per-element stress because the variation is real.

## When working on FEM UI

Use a `FEM-` subagent (per root `CLAUDE.md` Rule 22) for substantial
changes (new stage page, new visualization, new input flow). The
encapsulated module + route are designed so a worktree-isolated agent
can build entirely within `src/lib/fem/` and `src/routes/fem/`.
