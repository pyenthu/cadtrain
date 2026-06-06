# `src/lib/shared/` — cross-domain infrastructure

Both `src/lib/cad/*` and `src/lib/wells/*` may import from here.
They must NOT import from each other (Rule 2).

```
src/lib/shared/
├── anthropic-api.ts        # SDK key check + client factory
├── claude-cli.ts           # `claude --print` args + spawn + envelope parse
├── temp-file.ts            # withTempFile(prefix, ext, buf, fn) wrapper
├── mime.ts                 # guessImageExt(mime)
├── instance-colors.ts      # INSTANCE_PALETTE + colorForInstance(name) FNV-1a hash
├── scene-state.svelte.ts   # shared scene state (zScale, etc.)
├── ComponentScene.svelte   # shared Threlte scene for component viewer
├── PrimitiveDualCanvas.svelte  # mesh + GLB dual canvas (mounted by /primitives + /vocab)
├── PrimitiveView.svelte    # primitive editor (Build/Parts tabs, used by /primitives)
├── ParamGrid.svelte        # ParamSchema-driven param card grid (Parameters accordion body)
└── CompJsonSilhouette.svelte  # K.69 — render an SVTC compjson half-section as inline SVG
```

## Pattern: shared components rendered in two routes

The `/primitives` and `/vocab` pages SHARE the same chrome where
possible (`PrimitiveDualCanvas` for the 3D bake, `ParamGrid` inside
`.pg-acc-wrap` for parameters). When you restyle one, restyle the
other so a user fluent in one is fluent in the other.

`CompJsonSilhouette` is `/vocab`-specific today (Inferred tab), but
lives here so any future page that wants to render SVTC's vector
drawings can mount it.

## Pattern: Dual-backend dispatch (API vs CLI)

Every Claude-vision-driven endpoint exposes **two interchangeable
backends** behind one request/response shape, selected at runtime via
env var:

- **API backend** — `@anthropic-ai/sdk` + `ANTHROPIC_API_KEY`.
  Per-token billed. Works in dev and Railway production.
- **CLI backend** — spawns `claude --print --output-format json`
  subprocess. Bills against the user's Pro/Max OAuth subscription.
  Local-only (Railway has no `claude` binary). ~5–7× slower than
  API per call, but doesn't burn API tokens.

**Subscription billing only works through the CLI subprocess.** The
Agent SDK does NOT bill against Pro/Max OAuth despite docs/intuition.

Primitives in this directory:

- `anthropic-api.ts` — SDK client factory + key-required check
- `claude-cli.ts` — args builder, subprocess spawn, envelope parser
- `temp-file.ts` — write input buffer, run callback, finally-unlink

Domain backends (`src/lib/identify/backend.ts`,
`src/lib/wells/backend.ts`) compose these primitives with their own
prompts, content-block assembly, and (for identify) RAG retrieval.

## Pattern: Cold-classification baseline first, retrieval second

Before investing in CLIP / RAG / embedding pipelines, run the **cold
classification** test: just the catalog text + the target image, no
retrieval, no few-shot, just Claude's vision. If accuracy is already
90%+ on the realistic input distribution, the retrieval scaffolding
is not load-bearing and the engineering investment is misallocated.

For the cadtrain CAD primitives this hit 17/18 (94.4%) on synthetic
renders — see root CLAUDE.md "Open TODOs" for the implications.
Always re-run this baseline before optimising retrieval.

## Pattern: Cache grows with use (compounding loop)

The training cache (`training_data/cache.jsonl`) is structured so
every accepted user-validated identification appends a new record,
which gets retrieved as a few-shot example for the next similar
query. Quality compounds.

Atomic JSONL append (temp file + rename) keeps writes durable under
concurrent load. Records carry
`source: 'seed' | 'refined' | 'manual' | 'synthetic'` so provenance
is queryable.

## Pattern: `cad/*` ↮ `wells/*` no cross-import

`src/lib/cad/*` and `src/lib/wells/*` MUST NOT import from each
other. Both may freely import from here. This keeps domain coupling
explicit and lets either side eventually move to its own deploy
without a refactor PR. Enforce in code review; consider an ESLint
rule once both directories materially grow.
