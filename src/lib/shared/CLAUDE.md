# `src/lib/shared/` — cross-domain UI + infrastructure

Components and helpers shared by the routes (`/graph-editor`,
`/primitives`, `/vocab`, `/fem`, `/forge`) and by `src/lib/cad/*`.
Domain libs may import from here; this directory must not import from
domain libs.

```
src/lib/shared/
├── GraphEditorPane.svelte      # THE CAD editor (node-graph canvas + sidebar + bake). Mounted by /graph-editor (full-screen) and /primitives (one per tab)
├── PrimitiveView.svelte        # DORMANT — old primitive editor (Build/Parts tabs); no active mounts since the graph editor took over. K.65 queues its split/strip
├── CompositionEditor.svelte    # DORMANT — K.63 .asm.ts composition editor (docs/COMPOSITION.md); superseded by the graph editor
├── ConstructionTree.svelte     # DORMANT — CSG/BODMAS construction-tree view
├── PrimitiveDualCanvas.svelte  # mesh + GLB dual canvas (+ PrimitiveDualScene; smoothShade gate)
├── PrimitiveCanvas.svelte / PrimitiveGlbCanvas.svelte / ProfileFn3DCanvas.svelte
├── ComponentScene.svelte / ComponentSceneGlb.svelte  # Threlte scenes (flatShading rules — see cad/CLAUDE.md)
├── ProfileEditor.svelte / ProfileFnEditor.svelte / ProfilePalette.svelte
├── ParamGrid.svelte            # ParamSchema-driven param card grid (shared by /primitives + /vocab)
├── CompJsonSilhouette.svelte   # K.69 — SVTC compjson half-section as inline SVG (/vocab Inferred tab)
├── CodeEditor.svelte / MarkdownView.svelte / KbTableViewer.svelte
├── FloatingPanel.svelte        # anchored popup (viewport-clamped); floating-tip.ts portal tooltip
├── scene-state.svelte.ts       # shared scene state (zScale, zFocus, …)
├── parse-build-source.ts / format-ts.ts / profile-presets.ts
├── instance-colors.ts          # INSTANCE_PALETTE + colorForInstance(name)
├── dragNumber.ts / warp.ts / mime.ts / temp-file.ts
├── anthropic-api.ts            # SDK key check + client factory
└── claude-cli.ts               # `claude --print` args + spawn + envelope parse
```

## Pattern: shared components rendered in multiple routes

`/primitives` and `/vocab` SHARE chrome where possible
(`PrimitiveDualCanvas`, `ParamGrid` in `.pg-acc-wrap`, the vertical
trapezoidal rail styling). When you restyle one, restyle the other.
Don't fork shared components into a route — keep one source of truth.

## Pattern: dual-backend dispatch (API vs CLI)

Claude-driven endpoints expose **two interchangeable backends** behind one
request/response shape, selected via env var:

- **API backend** — `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`. Per-token
  billed. Works in dev and Railway production.
- **CLI backend** — spawns `claude --print --output-format json`
  subprocess. Bills the user's Pro/Max OAuth subscription. Local-only
  (Railway has no `claude` binary). ~5–7× slower per call.

**Subscription billing only works through the CLI subprocess.** The Agent
SDK does NOT bill against Pro/Max OAuth despite docs/intuition.

Primitives here: `anthropic-api.ts`, `claude-cli.ts`, `temp-file.ts`.
Active consumer: `/api/primitives/refine`. The archived identify/wells
backends (`archive/src/lib/{identify,wells}/backend.ts`) used the same
pattern.

## Pattern: cold-classification baseline first, retrieval second

Before investing in CLIP / RAG / embedding pipelines, run the **cold
classification** test: catalog text + target image, no retrieval. If
accuracy is already 90%+ on the realistic input distribution, retrieval
scaffolding is not load-bearing. The cadtrain CAD primitives hit 17/18
(94.4%) cold — see `docs/FINDINGS.md`. Always re-run this baseline before
optimising retrieval (relevant again for RAG Phase 2,
`docs/plans/rag-prompt-builder.md`).
