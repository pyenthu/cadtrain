#!/usr/bin/env bash
# Overnight RAG hill-climb (#49) — measure which retrieval config lifts the LOCAL small model.
#
# For each round it evaluates 3 configs on qwen2.5:1.5b (Ollama, headless — no browser) across all 5
# apps and appends the overall mean to a leaderboard, so by morning we know whether grounding, the
# docType filter, and VECTOR retrieval actually help the small model — the thing the browser blocks.
#
#   configs:  ungrounded            (no RAG — the floor)
#             lexical   (--ground)  (docType-scoped lexical retrieval)
#             vector    (--ground, APP_RAG_VECTOR=1)  (docType-scoped semantic retrieval)
#
# SAFE for unattended runs: no git writes, no volume writes, time-bounded, ensures its own deps are
# up (Ollama service + :3333 dev server), and every result is staged to scripts/overnight/runs/ for
# your morning review. LAUNCH DETACHED so it survives the session:
#   nohup bash scripts/overnight/rag-hillclimb.sh > scripts/overnight/runs/hillclimb.out 2>&1 &
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
# pin the toolchain onto PATH — a detached/nohup shell may not inherit ~/.bun/bin or brew bins
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/opt/ollama/bin:$PATH"

HOURS="${HILLCLIMB_HOURS:-7}"          # wall-clock budget
RUNS="${HILLCLIMB_RUNS:-2}"            # eval runs per config per round (variance)
RUNDIR="scripts/overnight/runs"
CSV="$RUNDIR/hillclimb.csv"
BOARD="$RUNDIR/hillclimb-leaderboard.txt"
mkdir -p "$RUNDIR"
[ -f "$CSV" ] || echo "round,config,avg_score,ts" > "$CSV"
log() { echo "[$(date '+%H:%M:%S')] $*"; }

# ── preflight: bring up deps (never kill anything) ──────────────────────────────────────────────
if ! curl -s -o /dev/null --max-time 2 http://localhost:11434/api/tags; then
  log "Ollama down — starting service"; brew services start ollama >/dev/null 2>&1; sleep 5
fi
curl -s -o /dev/null --max-time 3 http://localhost:11434/api/tags || { log "FATAL: Ollama unreachable"; exit 1; }
if ! curl -s -o /dev/null --max-time 3 http://localhost:3333/api/cache/stats; then
  log ":3333 down — starting dev server detached"; nohup bun run dev > "$RUNDIR/dev-server.log" 2>&1 &
  for i in $(seq 1 30); do sleep 2; curl -s -o /dev/null --max-time 2 http://localhost:3333/api/cache/stats && break; done
fi
curl -s -o /dev/null --max-time 3 http://localhost:3333/api/cache/stats || { log "FATAL: :3333 unreachable"; exit 1; }
log "deps up — Ollama + :3333. budget ${HOURS}h, ${RUNS} runs/config."

# grep the eval's overall score ("average mean: X%" for N>1, "average: X%" for N=1)
score_of() { grep -oaE 'average( mean)?: [0-9.]+%' "$1" | tail -1 | grep -oE '[0-9.]+'; }

run_config() {  # $1=name  $2=extra-flags  $3=env-assignment
  local name="$1" flags="$2" envset="$3"
  local out="$RUNDIR/last-$name.out"  # separate stmt: $name isn't set within its own `local` under set -u (bash 3.2)
  env $envset bun run scripts/eval-app-build.ts --provider local --incremental --runs "$RUNS" $flags > "$out" 2>&1
  local s; s=$(score_of "$out")
  echo "${s:-NA}"
}

END=$(( $(date +%s) + HOURS*3600 ))
round=0
while [ "$(date +%s)" -lt "$END" ]; do
  round=$((round+1)); rstart=$(date +%s)
  log "=== round $round ==="
  u=$(run_config ungrounded ""        "")                    ; echo "$round,ungrounded,$u,$(date +%s)" >> "$CSV"; log "  ungrounded -> $u%"
  l=$(run_config lexical    "--ground" "")                   ; echo "$round,lexical,$l,$(date +%s)"    >> "$CSV"; log "  lexical    -> $l%"
  v=$(run_config vector     "--ground" "APP_RAG_VECTOR=1")   ; echo "$round,vector,$v,$(date +%s)"     >> "$CSV"; log "  vector     -> $v%"
  # runaway guard: a real round is minutes; <20s means the eval is failing fast (deps down) — back off
  if [ $(( $(date +%s) - rstart )) -lt 20 ]; then log "WARN: round <20s — deps failing? backing off 60s"; sleep 60; fi
  # refresh the leaderboard (mean ± n per config) after every round
  python3 - "$CSV" > "$BOARD" <<'PY'
import csv,sys,statistics
from collections import defaultdict
d=defaultdict(list)
for r in csv.DictReader(open(sys.argv[1])):
    try: d[r['config']].append(float(r['avg_score']))
    except: pass
print("RAG hill-climb leaderboard (qwen2.5:1.5b, overall mean across 5 apps)")
print(f"{'config':12} {'n':>3} {'mean':>7} {'sd':>6} {'best':>6}")
for cfg in sorted(d, key=lambda c: -statistics.mean(d[c])):
    v=d[cfg]; sd=statistics.pstdev(v) if len(v)>1 else 0.0
    print(f"{cfg:12} {len(v):>3} {statistics.mean(v):>6.1f}% {sd:>5.1f} {max(v):>5.1f}%")
PY
  cat "$BOARD"
done
log "DONE — $round rounds. Leaderboard: $BOARD"
