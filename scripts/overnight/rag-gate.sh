#!/usr/bin/env bash
# Overnight regression GATE (#49, loop C) — a cheap, deterministic guard. Runs the FAKE-provider eval
# (the score CEILING — no model, no network) with --gate against a baseline every INTERVAL; if any
# app's ceiling drops below baseline, a corpus/code change broke the build plumbing → flagged. Free +
# contention-free (no Ollama, no claude), so it runs happily alongside A/B/D.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"  # detached shells may lack bun on PATH
RUNDIR="scripts/overnight/runs"; mkdir -p "$RUNDIR"
BASE="$RUNDIR/gate-baseline.json"; LOG="$RUNDIR/gate.log"
INTERVAL="${GATE_INTERVAL:-900}"; HOURS="${GATE_HOURS:-7}"
log(){ echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }
[ -f "$BASE" ] || bun run scripts/eval-app-build.ts --provider fake --write-baseline "$BASE" >/dev/null 2>&1
log "baseline established: $(cat "$BASE" 2>/dev/null)"
END=$(( $(date +%s) + HOURS*3600 ))
while [ "$(date +%s)" -lt "$END" ]; do
  if bun run scripts/eval-app-build.ts --provider fake --gate "$BASE" > "$RUNDIR/gate-last.out" 2>&1; then
    log "PASS"
  else
    log "FAIL — plumbing regression, saved gate-FAIL-$(date +%s).out"; cp "$RUNDIR/gate-last.out" "$RUNDIR/gate-FAIL-$(date +%s).out"
  fi
  sleep "$INTERVAL"
done
log "DONE"
