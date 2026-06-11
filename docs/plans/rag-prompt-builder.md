# RAG-prompt parts builder

> Status: design — open decisions flagged with ⚠.
> Tasks: #159 (RAG layer) + #160 (refresh button).
> Pair with: [polygon-repeat-loop-architecture](../../../../.claude/projects/-Users-neerajsethi-code-cadtrain/memory/polygon_repeat_loop_architecture.md), K.69 vocabulary editor.

## Goal

User types a natural-language part description into `/primitives` →
system retrieves similar existing parts → Claude proposes a graph
(PolygonNode + PolyRepeatNodes + Calls) → editor opens with the
proposed graph ready to review + bake.

Example flow:

> **prompt:** *"flat coil disc, 2 turns, 60 segments"*
>
> 1. corpus retrieval surfaces `g_spiral` (the flat coil exemplar) and
>    `template_extrude` (the cartesian-extrude blueprint).
> 2. Claude returns a graph: polygon with two repeat-refs (outer + inner
>    spiral loops) wired into `r_weld_extrude`, params `{turns:2, NPts:60}`.
> 3. Editor opens the graph; user tweaks + saves.

## Where the corpus lives

⚠ Two routes:

| Option | Path | Pros | Cons |
|---|---|---|---|
| **A. JSONL** | `$APP_DATA_DIR/ai/rag/parts.jsonl` | Atomic append, single-source-of-truth, no embedding step required, ships via the volume proxy. | Linear scan for retrieval; no semantic similarity unless we add an embedding column. |
| **B. Vector DB** | `$APP_DATA_DIR/ai/rag/parts.jsonl` + `embeddings.bin` | Semantic retrieval out of the box. | Needs an embedding API (OpenAI / Voyage); embedding refresh per corpus update; binary blob complicates volume sync. |

**Recommendation:** Start with **A** (JSONL + keyword/tag retrieval).
The existing K.69 vocabulary already has a `tags` field per term that
covers most of the semantic surface ("flat_coil", "drill_pipe_pin",
"helical_band"); BM25 over tags + description is often within 5% of an
embedding pipeline for catalogs this small (~50 parts).
Upgrade to **B** only when the catalog grows past ~200 entries.

## Corpus record shape

```jsonc
{
  "id": "g_spiral",
  "kind": "asm",
  "description": "Flat coil disc — Archimedean spiral cross-section extruded down z.",
  "tags": ["flat_coil", "spiral", "cartesian", "cross_section_polygon"],
  "params": ["NPts", "r0", "growth", "turns", "width", "length"],
  "structure_summary": "polygon(loop·outer, loop·inner) → r_weld_extrude",
  "structure_hash": "blake3:...",
  "exemplar_path": "primitives/basic/g_spiral.prim.ts",
  "updated_at": "2026-06-11T01:23:45Z"
}
```

`structure_summary` is a one-liner the prompt template can include
verbatim — cheap retrieval signal.

## Refresh policy

⚠ Decided 2026-06-11: **manual button** next to the existing filter
button on the `/primitives` sidebar header.

* Button posts `/api/rag/rebuild`.
* Server walks `$APP_DATA_DIR/primitives/**/*.prim.ts` (+ `.asm.ts`,
  `.prvl.ts`, `.prex.ts`) → extracts meta + structure summary → writes
  `parts.jsonl` (atomic temp-file + rename per Rule 4).
* Button shows spinner during rebuild; settles to a quiet `last refreshed
  Xm ago` label.
* Auto-refresh on save can land later as a settings toggle.

## UI

Prompt input lives **below the settings ⚙ + filter buttons** on the
`/primitives` sidebar (per user note 2026-06-11). Single-line textarea
with submit-on-Enter. The response opens in a NEW editor tab with the
proposed graph hydrated; the user can review, tweak, save, or discard.

```
┌─ Sidebar ────────────────────┐
│  + ⚙ filter ↻ rebuild        │  ← rebuild button next to filter
│  ───────────────────────     │
│  Basic                       │
│    g_spiral · g_star · …     │
│  Completions                 │
│    drill_pipe · …            │
│  ───────────────────────     │
│  AI prompt                   │  ← new prompt section
│  ┌─────────────────────────┐ │
│  │ flat coil 2 turns      │ │
│  └─────────────────────────┘ │
│  [generate]                  │
└──────────────────────────────┘
```

## API endpoints

```
POST /api/rag/rebuild              → reindex parts.jsonl; returns count + duration
POST /api/rag/prompt               → { prompt, k? } → { candidates: […], graph: {…} }
GET  /api/rag/stats                → corpus size + last-refreshed
```

`/api/rag/prompt`:

1. Tokenise prompt → BM25 score against every record → top-k=5.
2. Build a Claude prompt with: catalog header + top-k records as
   exemplars + the user's prompt.
3. Ask Claude to emit a graph JSON matching the schema in
   `composition-graph.ts` (PolygonNode + PolyRepeatNode + Call).
4. Validate the response shape (Zod or hand-rolled), then return it
   alongside the candidate IDs so the user can see WHICH exemplars
   informed the answer.

## Open decisions

* ⚠ **Retrieval signal**: BM25 vs simple tag-intersection vs embedding.
  Start with BM25 (no embedding required, ~50-line implementation).
* ⚠ **LLM backend**: API vs CLI subprocess (see
  `subscription_via_cli_subprocess` memory — CLI bills against Pro/Max
  OAuth). Default to API for predictability; CLI as a toggle.
* ⚠ **Response shape**: emit a full graph JSON (more risk of invalid
  output) vs emit a `Term + params` then translate via the
  vocabulary translator (smaller surface but limited to terms already in
  `docs/parts/vocabulary.json`).

## Rollout

* **Phase 1**: rebuild button + JSONL corpus + `/api/rag/stats`.
* **Phase 2**: BM25 retrieval + Claude prompt + editor-opens-result flow.
* **Phase 3** (optional): embeddings upgrade if catalog growth warrants.
* **Phase 4** (optional): auto-rebuild on save (settings toggle).
