#!/usr/bin/env bash
# Overnight orchestrator (#49) — launches all four loops in parallel, each self-bounded (~7h) and
# staging to scripts/overnight/runs/. Non-contending by design: A→Ollama, B/D→claude --print,
# C→free fake provider. LAUNCH DETACHED so it survives the session ending:
#
#     nohup bash scripts/overnight/run-all.sh > scripts/overnight/runs/orchestrator.log 2>&1 &
#
# Monitor:   tail -f scripts/overnight/runs/*.log
#            cat scripts/overnight/runs/hillclimb-leaderboard.txt     # which RAG config wins
#            cat scripts/overnight/runs/harden-findings.md            # bug findings
#            ls  scripts/overnight/runs/corpus-candidates/            # staged goldens
#            grep FAIL scripts/overnight/runs/gate.log                # any plumbing regression
# Stop early: kill $(cat scripts/overnight/runs/pids.txt | grep -oE '[0-9]+')
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
D="scripts/overnight"; RUNDIR="$D/runs"; mkdir -p "$RUNDIR"
echo "[$(date)] launching overnight loops: A=hill-climb B=corpus C=gate D=harden"
bash "$D/rag-hillclimb.sh" > "$RUNDIR/A-hillclimb.out" 2>&1 & A=$!
bash "$D/corpus-expand.sh" > "$RUNDIR/B-corpus.out"    2>&1 & B=$!
bash "$D/rag-gate.sh"      > "$RUNDIR/C-gate.out"      2>&1 & C=$!
bash "$D/code-harden.sh"   > "$RUNDIR/D-harden.out"    2>&1 & Dp=$!
echo "A=$A B=$B C=$C D=$Dp" > "$RUNDIR/pids.txt"
echo "[$(date)] PIDs: $(cat "$RUNDIR/pids.txt")"
wait
echo "[$(date)] all overnight loops finished"
