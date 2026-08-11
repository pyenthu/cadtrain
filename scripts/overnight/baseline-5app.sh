#!/usr/bin/env bash
# scripts/overnight/baseline-5app.sh (#49) — the 5-app × N-k baseline, resumably.
#
# Written after two runs were lost to the same two flaws in an ad-hoc runner:
#
#   1. IT SWALLOWED ERRORS. The old loop piped each eval through
#      `grep -E "^  score:|facets:|built kinds"`, so any line that wasn't one of those —
#      including the stack trace — was DISCARDED. `design` printed no score for two runs and the
#      reason was invisible; it turned out to be a bare `DOMException TimeoutError`. Same
#      swallow-the-signal mistake as the silent num_ctx truncation that invalidated every headless
#      number before ab5f4ae. Here the FULL output of every cell is kept in its own file, and the
#      summary is derived from those files afterwards.
#
#   2. IT WASN'T RESUMABLE. A kill part-way through lost every completed cell. Each cell now
#      writes cells/<app>-k<k>.out and is SKIPPED if that file already holds a score, so a
#      re-run continues rather than restarts. Delete a cell file to force it.
#
# The path is temperature-0 deterministic (see runs/ab-ground-n3.out: σ=0.00 over 3 runs × 4
# configs), so runs=1 per cell is EXACT, not a sample — 10 cells, not 30.
#
#   bash scripts/overnight/baseline-5app.sh              # apps × k=3,12
#   KS="3 9 12" APPS="plan design" bash scripts/overnight/baseline-5app.sh
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/opt/ollama/bin:$PATH"

RUNDIR="scripts/overnight/runs"
CELLS="$RUNDIR/cells"
OUT="$RUNDIR/baseline-5app.md"
APPS_A=(${APPS:-plan design ewell partsdash opsdash})
KS_A=(${KS:-3 12})
URL="${CADTRAIN_DEV_URL:-http://localhost:3334}"
export CADTRAIN_DEV_URL="$URL"
mkdir -p "$CELLS"
log(){ echo "[$(date '+%H:%M:%S')] $*"; }

# preflight — a missing dep silently zeroes every cell, so fail loudly up front
curl -s -o /dev/null --max-time 4 http://localhost:11434/api/tags || { log "FATAL: Ollama down"; exit 1; }
curl -s -o /dev/null --max-time 4 "$URL/api/cache/stats" || { log "FATAL: grounding server $URL down"; exit 1; }
log "deps up · apps=${APPS_A[*]} · k=${KS_A[*]} · grounding=$URL"

score_of(){ grep -oaE '^  score: [0-9.]+%' "$1" 2>/dev/null | tail -1 | grep -oE '[0-9.]+'; }

total=$(( ${#APPS_A[@]} * ${#KS_A[@]} )); n=0
for k in "${KS_A[@]}"; do
  for app in "${APPS_A[@]}"; do
    n=$((n+1))
    f="$CELLS/$app-k$k.out"
    if [ -n "$(score_of "$f")" ]; then
      log "[$n/$total] skip $app k=$k → $(score_of "$f")% (cached; rm $f to redo)"
      continue
    fi
    log "[$n/$total] run  $app k=$k …"
    # FULL output — stdout AND stderr — so a failure is diagnosable instead of filtered away.
    APP_RAG_K=$k bun run scripts/eval-app-build.ts \
      --provider local --incremental --ground --runs 1 --app "$app" > "$f" 2>&1
    rc=$?
    s=$(score_of "$f")
    if [ -n "$s" ]; then
      log "[$n/$total]      $app k=$k → ${s}%"
    else
      log "[$n/$total]      $app k=$k → NO SCORE (exit $rc) — first error line:"
      grep -m1 -iE "error|exception|timeout|failed" "$f" | head -c 160 | sed 's/^/            /'
      echo
    fi
  done
done

# ── summary, derived from the cell files (so it's correct after a resume too) ──
{
  echo "# 5-app baseline — $(date '+%F %H:%M')"
  echo
  echo "grounded · num_ctx=${OLLAMA_NUM_CTX:-8192} · temperature 0 (deterministic → runs=1 is exact)"
  echo "grounding server: $URL"
  echo
  printf '| app | %s |\n' "$(printf 'k=%s | ' "${KS_A[@]}" | sed 's/ | $//')"
  printf '|---|%s\n' "$(for _ in "${KS_A[@]}"; do printf -- '---|'; done)"
  for app in "${APPS_A[@]}"; do
    row="| $app |"
    for k in "${KS_A[@]}"; do
      s=$(score_of "$CELLS/$app-k$k.out"); row="$row ${s:-—}${s:+%} |"
    done
    echo "$row"
  done
  echo
  echo "## facets"
  for k in "${KS_A[@]}"; do
    for app in "${APPS_A[@]}"; do
      f="$CELLS/$app-k$k.out"
      [ -n "$(score_of "$f")" ] || { echo "- **$app k=$k** — NO SCORE, see \`${f#scripts/overnight/}\`"; continue; }
      echo "- **$app k=$k** — $(grep -m1 -oaE 'facets:.*' "$f")"
      echo "  - built: $(grep -m1 -oaE 'built kinds:.*' "$f" | cut -c1-150)"
    done
  done
} > "$OUT"

log "DONE → $OUT   (per-cell output in ${CELLS#scripts/overnight/}/)"
cat "$OUT"
