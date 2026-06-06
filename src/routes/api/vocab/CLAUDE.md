# `src/routes/api/vocab/` — vocabulary endpoint catalog (K.68 / K.69)

Endpoints that back the `/vocab` UI and the offline scripts
(`scripts/regenerate-from-vocab.ts`, `scripts/promote-to-vocab.ts`).
All routes are URL-stable.

## Endpoints

| Route | Method | Purpose |
|---|---|---|
| `/api/vocab/regenerate` | POST | Re-run the K.68 rule-translator pipeline for one or all curated terms. `?term=<slug>` (single) or `?all=1`. Saves the generated source via `/api/primitives/save` + bake-verifies via `/api/primitives/preview`. Returns `{ ok, regenerated[], failures[] }`. |
| `/api/vocab/infer` | POST | K.69 deterministic 2D→3D inference for a seed. Reads `docs/parts/vocabulary.seeds.json` (for `od_in` calibration), fetches the compjson_ref from `static/svtc-compjson/`, runs `inferProfile()`, returns `{ polygon, source, bake, internal_features, warnings, axisymmetric, scale_in_per_px }`. |
| `/api/vocab/bake-proposed` | POST | Translate a `docs/parts/proposed-vocab-entries.json` entry via `proposal-translator.ts` + bake-verify via `/api/primitives/preview`. Body `{ params?: number[] }` lets sliders drive a live re-bake without saving. Returns `{ ok, exemplar, source, bake }`. |
| `/api/vocab/promote` | POST | Promote a SEED's INFERRED polygon (cheap path). Writes the polygon as a `rule:{kind:'primitive', template:'polygon_inline'}` block back into `vocabulary.seeds.json` + flips `status` to `'promoted'`. Body `{ polygon, source?, expose_params? }`. Atomic write (temp + rename per Rule 4). |
| `/api/vocab/promote-proposed` | POST | Promote a PROPOSED rich entry (canonical path). Lifts the full proposal — definition + synonyms + function + form + variants + references + rule — into `docs/parts/vocabulary.json`, bumps the patch version, saves `dt_<term>.prim.ts` to the volume via `/api/primitives/save`, flips the seed's `status` to `'promoted'`. Returns `{ ok, new_vocab_version, exemplar, exemplar_saved, seed_marked }`. |

## Sources of truth

```
docs/parts/
├── vocabulary.json                    # CURATED — promoted terms (translator targets)
├── vocabulary.seeds.json              # SEEDS — 41 catalogue rows (status: 'seed' | 'promoted')
├── proposed-vocab-entries.json        # PROPOSALS — hand-drafted rich entries pending promotion
├── vocabulary.lock.json               # bake-numbers regression net
├── vocabulary-graph.mmd               # Mermaid topology (rendered by scripts/render-vocab-graph.ts)
└── vocabulary.schema.json             # JSON schema for vocabulary.json + seeds + proposals
```

## Two promotion paths — cheap vs canonical

The `promote` (cheap) and `promote-proposed` (canonical) endpoints exist
side-by-side on purpose:

- **`promote`** — writes the auto-derived polygon from `inferCache[term]`
  into `vocabulary.seeds.json`. Use when the inferred shape is good
  enough and rich tagging isn't needed. Stays in seeds; doesn't reach
  `vocabulary.json`.

- **`promote-proposed`** — lifts the hand-drafted entry from
  `proposed-vocab-entries.json` into `vocabulary.json` (canonical
  curated form), saves the baked exemplar to the volume, and marks the
  seed as promoted. This is the path that grows the RAG knowledge base.

The `/vocab` UI's **green ✓ Promote button** wires to
`promote-proposed`. The older `promote` button (writes inferred polygon
back into seeds) still exists in the Inferred tab body as a quick path.

## Common request shape

All POST endpoints accept JSON; all return JSON. Errors throw via
SvelteKit's `error(status, message)` so the UI gets a proper non-200
status with a readable message. Atomic file writes (Rule 4) go through
`writeFileSync(tmp) + renameSync(tmp, real)`.

## Adding a new endpoint

1. New folder under `src/routes/api/vocab/<name>/` with `+server.ts`.
2. Import shared compilers from `$lib/authoring/`.
3. Use `localFetch` (from the SvelteKit `event.fetch`) when calling
   `/api/primitives/*` — that respects the
   `CADTRAIN_VOLUME_REMOTE_URL` proxy for cross-environment volume
   reads/writes. Don't `fetch()` directly with a hardcoded host.
4. If the endpoint mutates `docs/parts/*.json`, write atomically (Rule 4)
   and bump the version field when semantically appropriate.
5. Add a row to the table above + update `src/routes/vocab/CLAUDE.md` if
   the endpoint becomes user-visible.
