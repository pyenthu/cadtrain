# Findings — out-of-scope research notes

Research findings that inform future work but aren't day-to-day rules. Moved
out of the root `CLAUDE.md` to keep it instruction-only. Several are also in the
session memory (`~/.claude/projects/.../memory/`).

## Default-param primitive renders collapse for pHash AND CLIP

Originally discovered 2026-04-13 with pHash; confirmed for CLIP on 2026-05-09.
Four primitives (`seal_bore_polished`, `packer_element`,
`nc_numbered_connection`, `grooved_cylinder`) share a 64-bit pHash. CLIP
collapses even more — cosine = 1.000 between **12 of 18** primitives on the
synthetic render set because default-param renders strip away every visual cue
CLIP was trained on (colour, shading, texture, 3D form).

CLIP infrastructure stays in place: it likely still helps for real photo uploads
to `/api/identify` (different domain), and the embeddings are on every cache
record.

**Counter-finding (2026-05-09):** CLI/Opus cold classification (no RAG, no
embeddings, no retrieval — just the catalog text + image) hit **17/18 (94.4%)**
on `var_1.png` per primitive. The single miss (`taper_cone` → `thread_eue`) came
in at 0.6 confidence — the model knew it was uncertain. This contradicts the
assumption that the retrieval scaffolding is load-bearing; for the rendered
synthetic domain at least, raw VLM is enough. Before investing in CLIP
fine-tuning or pipeline changes, run the multi-variant ablation (`var_1..var_20`
× CLI/Opus, no RAG vs API/Sonnet with RAG). See
`~/.claude/plans/components-cli-recognition.md` for the deferred queue.

Memory: `clip_silhouette_collapse`, `cold_classification_baseline`.
