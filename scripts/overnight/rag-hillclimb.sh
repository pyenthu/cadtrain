#!/usr/bin/env bash
# Overnight RAG hill-climb (#49, loop A) — measure which retrieval config lifts the LOCAL small model.
#
# Each round evaluates ONE app (rotating) on qwen2.5:1.5b (Ollama, headless — no browser) under 3
# configs, appending the score to a leaderboard. Per-app-per-round (not all-apps-at-once) so one app
# crashing can't sink the whole config, and rounds stay ~1-2 min. By morning the leaderboard says
# whether grounding, the docType filter, and VECTOR retrieval actually help the small model.
#
#   configs:  ungrounded  (no RAG — the floor) · lexical (--ground) · vector (--ground APP_RAG_VECTOR=1)
#
# SAFE unattended: no git/volume writes, time-bounded, brings up its own deps (Ollama + :3333), stages
# to scripts/overnight/runs/. Launch DETACHED so it survives the session (see run-all.sh).
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/opt/ollama/bin:$PATH"

HOURS="${HILLCLIMB_HOURS:-7}"
RUNS="${HILLCLIMB_RUNS:-1}"
APPS_A=(${HILLCLIMB_APPS:-plan partsdash opsdash design})   # ewell omitted — it destabilizes the tiny local model
RUNDIR="scripts/overnight/runs"; CSV="$RUNDIR/hillclimb.csv"; BOARD="$RUNDIR/hillclimb-leaderboard.txt"
mkdir -p "$RUNDIR"; [ -f "$CSV" ] || echo "round,app,config,avg_score,ts" > "$CSV"
log(){ echo "[$(date '+%H:%M:%S')] $*"; }

# preflight — bring up deps, never kill anything
curl -s -o /dev/null --max-time 2 http://localhost:11434/api/tags || { log "Ollama down — starting"; brew services start ollama >/dev/null 2>&1; sleep 5; }
curl -s -o /dev/null --max-time 3 http://localhost:11434/api/tags || { log "FATAL: Ollama unreachable"; exit 1; }
if ! curl -s -o /dev/null --max-time 3 http://localhost:3333/api/cache/stats; then
  log ":3333 down — starting dev server detached"; nohup bun run dev > "$RUNDIR/dev-server.log" 2>&1 &
  for i in $(seq 1 30); do sleep 2; curl -s -o /dev/null --max-time 2 http://localhost:3333/api/cache/stats && break; done
fi
curl -s -o /dev/null --max-time 3 http://localhost:3333/api/cache/stats || { log "FATAL: :3333 unreachable"; exit 1; }
log "deps up. budget ${HOURS}h, ${RUNS} run(s)/config, apps: ${APPS_A[*]}"

score_of(){ grep -oaE 'average( mean)?: [0-9.]+%' "$1" | tail -1 | grep -oE '[0-9.]+'; }

run_config(){  # $1=name $2=flags $3=env-assignment $4=app
  local name="$1" flags="$2" envset="$3" app="$4"
  local out="$RUNDIR/last-$name.out"
  env $envset bun run scripts/eval-app-build.ts --provider local --incremental --runs "$RUNS" --app "$app" $flags > "$out" 2>&1
  local s; s=$(score_of "$out"); echo "${s:-NA}"
}

END=$(( $(date +%s) + HOURS*3600 )); round=0
while [ "$(date +%s)" -lt "$END" ]; do
  round=$((round+1)); rstart=$(date +%s)
  app="${APPS_A[$(( (round-1) % ${#APPS_A[@]} ))]}"
  log "=== round $round · app=$app ==="
  u=$(run_config ungrounded ""        ""                  "$app"); echo "$round,$app,ungrounded,$u,$(date +%s)" >> "$CSV"; log "  ungrounded -> $u%"
  l=$(run_config lexical    "--ground" ""                  "$app"); echo "$round,$app,lexical,$l,$(date +%s)"    >> "$CSV"; log "  lexical    -> $l%"
  v=$(run_config vector     "--ground" "APP_RAG_VECTOR=1"  "$app"); echo "$round,$app,vector,$v,$(date +%s)"     >> "$CSV"; log "  vector     -> $v%"
  if [ $(( $(date +%s) - rstart )) -lt 15 ]; then log "WARN: round <15s — deps failing? backing off 60s"; sleep 60; fi
  # refresh leaderboard: per-config mean across all apps+rounds
  python3 - "$CSV" > "$BOARD" 2>/dev/null <<'PY'
import csv,sys,statistics
from collections import defaultdict
d=defaultdict(list)
for r in csv.DictReader(open(sys.argv[1])):
    try: d[r['config']].append(float(r['avg_score']))
    except: pass
print("RAG hill-climb leaderboard — qwen2.5:1.5b (mean score per retrieval config, higher=better)")
print(f"{'config':12}{'n':>4}{'mean':>8}{'sd':>6}{'best':>7}")
for cfg in sorted(d, key=lambda c:-statistics.mean(d[c]) if d[c] else 0):
    v=d[cfg]
    if v: print(f"{cfg:12}{len(v):>4}{statistics.mean(v):>7.1f}%{(statistics.pstdev(v) if len(v)>1 else 0):>5.1f}{max(v):>6.1f}%")
PY
done
log "DONE — $round rounds"
