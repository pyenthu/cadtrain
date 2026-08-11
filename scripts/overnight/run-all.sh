#!/usr/bin/env bash
# Overnight / RAG orchestrator (#49) — QUALITY path (no token-maxxing).
#
# Default: run the RAG factory only (measure → Ollama gap-fill → re-measure).
# Optional extras via env:
#   WITH_HILLCLIMB=1  also run A (Ollama retrieval A/B)
#   WITH_GATE=1       also run C (fake plumbing gate, once)
#   WITH_HARDEN=1     also run D (≤HARDEN_MAX slim CLI reviews) — off by default; does not grow RAG
#
#     bash scripts/overnight/run-all.sh
#     nohup bash scripts/overnight/run-all.sh > scripts/overnight/runs/orchestrator.log 2>&1 &
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
D="scripts/overnight"; RUNDIR="$D/runs"; mkdir -p "$RUNDIR"
echo "[$(date)] RAG factory (quality path)"
bash "$D/rag-factory.sh" 2>&1 | tee "$RUNDIR/factory.out"
ec=${PIPESTATUS[0]}

if [ "${WITH_GATE:-0}" = "1" ]; then
  echo "[$(date)] C gate (once)"
  bun run scripts/eval-app-build.ts --provider fake --gate "$RUNDIR/gate-baseline.json" > "$RUNDIR/C-gate.out" 2>&1 \
    || bun run scripts/eval-app-build.ts --provider fake --write-baseline "$RUNDIR/gate-baseline.json" >/dev/null
fi
if [ "${WITH_HILLCLIMB:-0}" = "1" ]; then
  echo "[$(date)] A hill-climb (background)"
  HILLCLIMB_HOURS="${HILLCLIMB_HOURS:-1}" bash "$D/rag-hillclimb.sh" > "$RUNDIR/A-hillclimb.out" 2>&1 &
fi
if [ "${WITH_HARDEN:-0}" = "1" ]; then
  echo "[$(date)] D harden (capped)"
  HARDEN_MAX="${HARDEN_MAX:-5}" bash "$D/code-harden.sh" > "$RUNDIR/D-harden.out" 2>&1 &
fi
wait
echo "[$(date)] done (factory exit=$ec)"
exit "$ec"
