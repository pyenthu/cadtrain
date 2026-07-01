# Plan — AI feedback / RL database (thumbs + correction, learn-as-you-use)

**Status:** architecture (2026-07-01)
**TODO:** #27
**User intent (verbatim):** *"In SVTC I can report false/wrong prompt responses
with a message. I want a reinforcement-learning DATABASE built AS WE USE the
tool. It should contain: (a) the .md files we have, (b) SIMPLIFICATIONS of those
files into simpler prompts, and (c) APPROVED / DISAPPROVED / CORRECTED
prompts→results."*

The point is a **flywheel**: every AI turn a user judges (👍 / 👎 / a typed
correction) becomes a durable record on the volume, and those records — together
with the repo's `.md` docs and short *simplifications* of them — feed retrieval
and few-shot selection so the assistant gets better **as we use it**, with **no
model training required for the near-term win**.

---

## 0. Relationship to the existing AI plans (read first)

This plan does not replace anything — it **closes the loop** the other three
plans left open, and finally builds the `fix-errors.jsonl` seam they all name but
nobody wired.

| Existing artifact | Status | This plan |
|---|---|---|
| `docs/plans/ai-rag-system.md` (umbrella) | Phase 1 shipped | supplies the **feedback/promotion** phases §F referenced but deferred |
| `docs/plans/ai-multishot-assist.md` §H — `ai/fix-errors.jsonl` + `/api/ai/fix-errors` | **NOT built** (endpoint absent; `logFixError` is an optional dep NOT passed at `GraphEditorPane.svelte`) | **supersedes §H**: the error log is one *negative* channel of the wider feedback store here — reconcile the two so we don't build two JSONL sinks |
| `docs/plans/rag-prompt-builder.md` — `ai/rag/parts.jsonl` + BM25 (`rag-corpus.ts`/`rag-query.ts`/`rag-prompt.ts`) | shipped | we ADD two new corpora (`docs.jsonl`, `feedback/turns.jsonl`) retrieved alongside `parts.jsonl` |
| `docs/plans/ai-function-mapping.md` — tool registry + pure dispatcher (`editor-tools*.ts`) | shipped | the capture UX taps the SAME transcript the loop already emits (`AssistStep[]`) |
| `scripts/promote-to-vocab.ts` + `docs/parts/vocabulary.json` + `rule-translator.ts` | shipped | the **precedent** for the corrected→grammar promotion in Phase 3 |
| `/plan` task **905** (open) + TODO #1/#2 | open | reconcile: 905's "optional `/api/ai/fix-errors` sink" is subsumed by this plan's `POST /api/ai/feedback` |

**SVTC precedent** (`~/code/SVTC/src/lib/ai/trainingLog.js`): `markUnresolved()`
posts a `{instruction, output, type:'unresolved', note}` pair to
`/api/ai-training` on a "needs work" click; `logTrainingPair()` batches
`{instruction, output}` to `static/ai/training/captured.jsonl`. We adapt this to
the **volume** (Rule 13) and enrich it with the graph diff, verdict, and
retrieval provenance — SVTC captured for a *future MLX fine-tune*; we capture to
drive *retrieval + few-shot first*, training only much later (Phase 4).

---

## 1. Capture UX (SVTC-style 👍 / 👎 / correction)

The shipped assist loop already produces a transcript of `AssistStep[]`
(`ge-assist.ts` — `user` · `assistant_text` · `tool` ok/err · `note` · `error`)
rendered by `AiMenu.svelte` (edit mode) inside `GraphEditorPane.svelte`. We add a
verdict control on each *completed AI turn* (a `runAssistLoop` result, or a
single-shot Generate), not on every step.

- **Control:** a compact `👍 / 👎` pair + a "…" that opens a small free-text box
  ("what was wrong / what I wanted") — a FloatingPanel anchored to the trigger
  (UI-conventions memory `feedback_popup_over_inline`; keep it a popover, not an
  inline cell). Placed at the foot of the transcript in `AiMenu.svelte`, and
  (Generate path) on the freshly generated part card.
- **Three verdicts:**
  - `approved` — 👍. Record the turn as-is; it's a positive exemplar.
  - `disapproved` — 👎 (optionally with a note). Negative example.
  - `corrected` — user then edits the graph by hand (or types the fix). This is
    the **highest-value** record: it carries both the AI's output AND the graph
    the user actually ended with.
- **How `corrected` is captured without extra user work:** we already snapshot
  `editor_state_before` at turn start (`readEditorState`). On verdict, diff the
  AI-emitted graph against the *current* live graph (`getGraph()`); if they
  differ, the verdict auto-upgrades from `disapproved`→`corrected` and we store
  `corrected_graph` = the current graph (+ a compact node/arg diff). A 👍 with an
  identical graph stays `approved`. This means the "correction" is just the
  user's normal editing — no separate "teach me" step.
- **Auto-capture (no click):** tool/bake errors during a turn still auto-append a
  record with `verdict:'error'` (this is the old `logFixError` channel, folded
  in) so the negative corpus grows even when the user says nothing — mirrors
  SVTC auto-`markUnresolved` on dispatch/API error.
- **Never blocks the loop, never PII:** fire-and-forget POST, errors swallowed
  (SVTC parity). Only graph + instruction text is stored (Rule 15 — no secrets).

---

## 2. The record schema (`ai/feedback/turns.jsonl`)

One append-only JSONL file on the volume, `<volume>/ai/feedback/turns.jsonl`.
Append-only log ⇒ a single `appendFile(line + '\n')` is the durable pattern (the
same Rule-4 exception `ai-multishot-assist.md` §H.2 documents for an append log;
any future *compaction* uses temp-file + rename).

```jsonc
{
  "id": "fb_1719830400000_a1b2",   // ts + short rand; stable key
  "ts": 1719830400000,             // client Date.now() — one clock (SVTC parity)
  "part_id": "g_collar",           // ctx.partId (null for a fresh/empty tab)
  "surface": "edit" | "generate",  // which AI surface produced it
  "model": "claude-opus-4-8",      // or 'webllm:qwen2.5-1.5b'

  "prompt": "wire r to OD",        // the user instruction
  "retrieved_ids": ["g_dp_stand", "g_shaft"],  // exemplar ids RAG injected (provenance)

  // exactly one of these two, by surface:
  "tool_calls": [                  // edit surface — the applied loop
    { "tool": "wireArgToParam", "input": {…}, "ok": true }
  ],
  "emitted_graph": { … },          // generate surface — the whole proposed graph

  "editor_state_before": { … },    // readEditorState() snapshot at turn start

  "verdict": "approved" | "disapproved" | "corrected" | "error",
  "correction_message": "I wanted the OUTER radius, not r",  // free text, nullable
  "corrected_graph": { … },        // present iff verdict==='corrected' (user's end graph)
  "diff": { "added": […], "removed": […], "changed": […] },  // compact graph delta, nullable

  "error": "node not found: A"     // present iff verdict==='error' (folds in fix-errors)
}
```

- **Append-only, PII-free, regenerable-adjacent.** It's user-authored data (NOT
  regenerable like `parts.jsonl`), so it is the durable asset — treat it like
  `vocabulary.json`: never delete without backup (Rule 4/13).
- **Endpoint `POST /api/ai/feedback`** — `src/routes/api/ai/feedback/+server.ts`.
  First lines are Rule-13 plumbing (`maybeProxy` → `checkVolumeAuth` →
  `volumePath('ai/feedback/turns.jsonl')`), then `ensureDir('ai/feedback')` +
  `appendFile`. Add `'/api/ai/feedback'` to `VOLUME_PROXY_PATHS` in
  `hooks.server.ts` so dev appends to the ONE prod volume (no corpus
  fragmentation).
- **`GET /api/ai/feedback/stats`** — counts by verdict + last-N for the browse
  view (Phase 1).

> Reconcile: the planned `ai/fix-errors.jsonl` becomes `verdict:'error'` rows in
> this one store. If we prefer to keep the two files, `/api/ai/feedback` still
> owns the human verdicts and the error path writes here too — decide at build
> time, but do NOT ship two overlapping human-feedback sinks.

---

## 3. The three data sources the user named, unified

All three become **retrievable corpora on the volume, queried by the same BM25
path** (`rag-query.ts`) and merged before prompt render (`rag-prompt.ts`). One
retriever, three sources, tagged by origin so few-shot selection can weight them.

### (a) The `.md` docs → `ai/docs/docs.jsonl`
Index the repo/volume markdown that describes how to author parts:
`docs/CAD_AUTHORING.md`, `docs/PRIMITIVE_TEMPLATE.md`, `docs/parts/*.md`,
`docs/assemblies/*.md`, and the `docs/plans/*.md` that state conventions. A new
`ai/docs-corpus.ts` (sibling to `rag-corpus.ts`) walks these, splits each into
heading-scoped chunks, and writes one record per chunk:
`{ id, source_path, heading, text, tags }`. Rebuilt via the existing `↻`
(`/api/rag/rebuild`) — extend it to rebuild all corpora, not just `parts.jsonl`.

### (b) SIMPLIFICATIONS of those docs → few-shot seeds in `ai/docs/simplified.jsonl`
Each doc chunk is distilled into short, canonical **prompt→intent** pairs — the
"simpler prompts" the user asked for. Two strategies:
- **Deterministic first** (no tokens): pull the imperative bullet lines + the
  `export const meta` param names + the one-line `structure_summary` that
  `rag-corpus.ts` already computes → a terse "to do X, use Y" card.
- **LLM pass (optional, offline-capable):** one Claude (or web-llm) call per
  chunk that rewrites it into 1–3 short instruction/answer exemplars, cached by
  content hash so it only re-runs on doc change. Records:
  `{ id, from_doc, prompt, canonical_answer, tags }`.
These are the **few-shot seeds** the prompt builder can inject when a query has
no strong part/feedback match — they teach *phrasing*, not geometry.

### (c) Approved / disapproved / corrected turns → `ai/feedback/turns.jsonl`
The Phase-1 store (§2). Retrieval treats it as exemplars keyed on `prompt`, with
`verdict` steering polarity (below).

### How they unify at retrieval time
`rag-query.ts` gains a `sources[]` arg; the prompt builder (`rag-prompt.ts`)
composes a bounded budget:
1. **positive exemplars** — top `approved`/`corrected` feedback rows + top part
   exemplars (`parts.jsonl`), rendered as "good examples";
2. **canonical phrasing** — top `simplified.jsonl` seeds (fill when feedback is
   sparse — the cold-start bridge);
3. **doc context** — top `docs.jsonl` chunks as reference;
4. **pitfalls** — top `disapproved`/`error` rows rendered as a compact "avoid
   this" list (never as an example to copy).
Each block sits **after** the `cache_control` breakpoint if it's query-volatile
(same caching discipline as task 905's system-prompt split).

---

## 4. Closing the loop — the "reinforcement" WITHOUT fine-tuning first

The near-term win is entirely **retrieval + few-shot + promotion**. No gradient
step, no training infra. Reinforcement = *the corpus that shapes the next prompt
grows from judged outcomes.*

- **approved → positive few-shot.** Injected verbatim as "good examples" at
  retrieval; a high-scoring `approved` row for a similar prompt is the strongest
  signal the builder can give the model.
- **disapproved → demotion / avoid-list.** Rendered as bounded "known pitfalls
  ({prompt, what went wrong})"; also *demotes* any exemplar that recurs in
  disapproved rows (a part/exemplar the model keeps misusing loses retrieval
  weight). Never injected as a copy-me example.
- **corrected → the gold pairs (bad→good).** The highest value. Two consumers:
  1. **Promote to vocabulary** via the `scripts/promote-to-vocab.ts` precedent —
     a recurring `{prompt → corrected_graph}` that matches a vocab shape becomes
     a synonym/param patch or a new `compose` rule (deterministic translator
     path, Rule 24), so the *Generate* path produces it with zero model calls
     next time.
  2. **Self-repair corpus** — `{prompt, bad_output, error?, corrected_graph}`
     feeds the "how to fix" context (the role `fix-errors.jsonl` was meant to
     play), so the *Edit* loop recovers from the same mistake.
- **Later, OPTIONAL tier (Phase 4).** Once the volume of `corrected`/`approved`
  vs `disapproved` is large enough, the SAME records are already shaped as
  **preference pairs** (chosen = corrected/approved, rejected = disapproved) for
  a DPO-style step or a local-SLM (web-llm/MLX) fine-tune — SVTC's original
  intent. Explicitly deferred: measure retrieval/promotion lift first; only train
  if a held-out eval says retrieval has plateaued.

---

## 5. Phasing (small first)

**Phase 1 — capture + store + browse (no retrieval change).**
- `POST /api/ai/feedback` + `VOLUME_PROXY_PATHS` entry + `GET …/stats`.
- 👍/👎/correction control in `AiMenu.svelte`; wire `editor_state_before` snapshot
  + graph-diff → verdict; fold the `verdict:'error'` auto-capture (replaces the
  never-built `logFixError` sink; pass the dep at `GraphEditorPane.svelte`).
- A minimal browse/stats view (counts by verdict + last-N table) — under an
  existing route (e.g. a `/vocab` or `/plan`-adjacent panel; NEVER a new
  top-level route — memory `feedback_demos_under_primitives`).
- *Ships alone; nothing downstream depends on it. Smallest-first (SVTC parity).*

**Phase 2 — md ingest + simplification into the corpus.**
- `ai/docs-corpus.ts` → `docs.jsonl`; deterministic simplifier → `simplified.jsonl`;
  optional cached LLM simplifier pass.
- Extend `/api/rag/rebuild` (the `↻`) to rebuild all corpora; stats card shows
  per-corpus counts + last-rebuilt.

**Phase 3 — feedback → few-shot / promotion loop (the reinforcement).**
- `rag-query.ts` multi-source retrieval + `rag-prompt.ts` positive/pitfall
  blocks (§3, §4).
- `corrected`→vocab promotion (extend `promote-to-vocab.ts`) + self-repair
  context injection.
- A small eval: replay held-out prompts, measure approve-rate lift before/after.

**Phase 4 (optional) — preference / fine-tune.**
- Only if Phase 3 eval plateaus. Export preference pairs (DPO) or a local-SLM
  fine-tune set from the same JSONL. Gated, not scheduled.

### Reconciliation checklist (do before Phase 1 lands)
- Mark `ai-multishot-assist.md` §H (`fix-errors.jsonl`/`/api/ai/fix-errors`) as
  **superseded here**; either drop it or route its writes into `/api/ai/feedback`.
- Update `/plan` task **905** ("optional `/api/ai/fix-errors` sink") + TODO #1 to
  point at this plan for the sink.
- Register `/api/ai/feedback` in `src/routes/api/CLAUDE.md`.

---

## Files (new / touched — for the eventual build, NOT this PR)
- NEW `src/routes/api/ai/feedback/+server.ts` (+ `/stats`) — JSONL appender + reader.
- NEW `src/lib/server/ai-docs-corpus.ts` — md walk + chunk + simplify.
- EDIT `src/lib/shared/graph-editor/AiMenu.svelte` — verdict control + free-text.
- EDIT `src/lib/shared/graph-editor/ge-assist.svelte.ts` — feedback POST + verdict/diff helpers; pass `logFixError`-style dep.
- EDIT `src/lib/shared/graph-editor/GraphEditorPane.svelte` — wire the dep + editor-state snapshot.
- EDIT `src/lib/server/rag-query.ts` + `rag-prompt.ts` — multi-source retrieval + polarity blocks.
- EDIT `src/routes/api/rag/rebuild/+server.ts` — rebuild all corpora.
- EDIT `scripts/promote-to-vocab.ts` — accept a `corrected` feedback row.
- EDIT `src/hooks.server.ts` — `VOLUME_PROXY_PATHS += '/api/ai/feedback'`.
- EDIT `src/routes/api/CLAUDE.md`, `docs/plans/ai-multishot-assist.md`, `docs/plans/ai-rag-system.md`, `src/routes/plan/+page.svelte` (task 905) — reconcile.
