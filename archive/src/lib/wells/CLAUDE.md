# `src/lib/wells/` — Wells domain code

The Wells half of the two-product split. Must NOT cross-import with
`src/lib/cad/*`. Free to import from `src/lib/shared/*`.

```
src/lib/wells/
├── backend.ts   # dispatch (API + CLI) — uses src/lib/shared/*
├── prompt.ts    # WSON system + user prompts
└── schema.ts    # WSON TypeScript types + validateWson()
```

## Backend dispatch

`backend.ts` dispatches `/api/wells/extract` between the API and CLI
backends based on `WELLS_BACKEND` (`api` | `cli`). Both return the
same `WellsExtractResponse` shape so the route handler is unified.
See `src/lib/shared/CLAUDE.md` for the dual-backend pattern.

## WSON schema — `schema.ts`

`validateWson()` is the layer-1 validator: structure/type checks
only. Catches malformed extraction output before any rule layer runs.

## 5-layer validation (cheapest → most expensive)

For extraction pipelines (wells today; planned for CAD ingestion next):

1. **Schema** — `validateWson()` (hand-rolled here, zod-equivalent).
   Auto-rejects malformed structure. ~30% of errors caught here.
2. **Domain rules** — petroleum-engineering invariants: casings
   nest, depths monotonic, formation tops in stratigraphic order.
   ~50% of remaining errors caught.
3. **Cross-document consistency** — same well's deviation survey vs
   cross section vs program text agree on TD, casing depths,
   formation depths.
4. **Visual roundtrip** — render the extraction back as a synthetic
   drawing, SSIM-diff against the original. Catches subtle errors
   the rule-based layers miss.
5. **Confidence-driven human review** — only review when score < 0.80
   OR critical doc type OR new operator. ~10% of volume.

Layers 1 + 2 live here. Layers 3–5 are not yet implemented; capture
them at the same layer boundaries when adding (don't collapse rule
checking into the schema validator).

## Adding a new field to WSON

1. Add the field + type to `schema.ts`.
2. Extend `validateWson()` to check it.
3. Update `prompt.ts` so the model is told to emit it (with an
   example).
4. If the field has a domain rule (monotonic, sorted, foreign-key,
   etc.), add the rule to whatever module owns layer-2 checks (today
   this is shared with `schema.ts` — separate the moment a rule layer
   gets non-trivial).
5. Re-run the eval at `/archive/tests/wells` to see whether
   extraction quality changes on the 8-case dataset.
