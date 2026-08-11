#!/usr/bin/env bash
# Overnight corpus expansion (#49, loop B) — NOW a thin wrapper around the RAG factory gap-fill.
# Old behaviour (hour-bounded claude --print spray) is RETIRED: it burned the Max weekly limit
# (~41k tok harness × thousands of calls) for near-duplicate candidates.
#
# This wrapper only runs the Ollama gap-fill step (capped). For the full measure→fill→remeasure
# loop, use:  bash scripts/overnight/rag-factory.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/opt/ollama/bin:$PATH"
OUT="${RAG_FACTORY_OUT:-scripts/overnight/runs/trial-corpus}"
MAX_GAP="${MAX_GAP:-5}"
mkdir -p "$OUT"
echo "[corpus-expand] gap-fill via Ollama → $OUT (max=$MAX_GAP). Full loop: rag-factory.sh"
exec bun run scripts/overnight/gap-fill.ts \
  --out "$OUT" \
  --docType "${GAP_DOCTYPE:-dashboard}" \
  --gap "${GAP_PROMPT:-operations dashboard with KPI stats, a line chart, a data table, and named vars}" \
  --max "$MAX_GAP"
