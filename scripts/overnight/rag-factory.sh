#!/usr/bin/env bash
# RAG factory (#49) — quality path, NOT token-maxxing.
#
#   measure gaps → generate FEW local candidates → atomic-stage (local corpus) → re-measure → gate
#
# Default OUT corpus is LOCAL (scripts/overnight/runs/trial-corpus). It does NOT write the shared
# prod volume. Point the eval/dev server at it with:
#   CADTRAIN_APP_CORPUS=$PWD/scripts/overnight/runs/trial-corpus bun run dev
#
# Usage:
#   bash scripts/overnight/rag-factory.sh              # full trial on partsdash+opsdash
#   APPS="partsdash" MAX_GAP=2 bash scripts/overnight/rag-factory.sh
#
# Env:
#   APPS        space-separated eval apps (default: partsdash opsdash)
#   MAX_GAP     candidates to keep (default: 3)
#   RUNS        eval repeats per measurement (default: 3 — see NOISE below; 1 = fast smoke, no gate)
#   SKIP_FILL   1 = measure only (no generation)
#   SEED        1 = (re)seed trial golden/ from eval-fixtures (default: 1 if golden/ empty)
#   BAND_SIGMA  noise band = max(BAND_FLOOR, BAND_SIGMA × pooled σ)  (default: 2)
#   BAND_FLOOR  minimum band in percentage points (default: 3.0 — matches eval GATE_TOLERANCE)
#
# NOISE — why RUNS=1 cannot gate:
#   qwen2.5:1.5b is not deterministic. Measured run-to-run spread on IDENTICAL corpora is
#   σ≈2.1pp (partsdash) and σ≈3.5pp (opsdash), and eval-app-build.ts's own header records swings
#   of 26↔49 and 38↔28. The 2026-08-03 trial ran RUNS=1 and read 42.3→38.1 / 48.0→41.1 as a
#   regression — but those four numbers are exactly the per-run min/max of the SAME config from
#   that morning's hill-climb. It was measuring the dice, not the corpus.
#   So: repeat each measurement, and only believe a delta that clears the noise band.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:/opt/homebrew/opt/ollama/bin:$PATH"

D="scripts/overnight"
RUNDIR="$D/runs"
OUT="${RAG_FACTORY_OUT:-$RUNDIR/trial-corpus}"
APPS_A=(${APPS:-partsdash opsdash})
MAX_GAP="${MAX_GAP:-3}"
RUNS="${RUNS:-3}"          # ≥2 so each measurement carries a σ; 1 disables the gate (smoke only)
BAND_SIGMA="${BAND_SIGMA:-2}"
BAND_FLOOR="${BAND_FLOOR:-3.0}"
LOG="$RUNDIR/rag-factory.log"
mkdir -p "$RUNDIR" "$OUT/golden" "$OUT/candidates"
: > "$OUT/builds.jsonl" 2>/dev/null || true
log(){ echo "[$(date '+%H:%M:%S')] $*" | tee -a "$LOG"; }

score_of(){ grep -oaE 'average( mean)?: [0-9.]+%' "$1" | tail -1 | grep -oE '[0-9.]+'; }

# ── deps ──────────────────────────────────────────────────────────────────────
curl -s -o /dev/null --max-time 2 http://localhost:11434/api/tags || { log "starting Ollama"; brew services start ollama >/dev/null 2>&1; sleep 5; }
curl -s -o /dev/null --max-time 3 http://localhost:11434/api/tags || { log "FATAL: Ollama down"; exit 1; }

# Seed local corpus from committed fixtures when empty / asked.
#
# A golden is RETRIEVABLE only via its `.md` key (loadGolden enumerates *.md, then reads the pair),
# so the two globs are not equivalent: `.app` files are scoring targets and cost nothing, while each
# `.md` is a live competitor for one of rankGolden()'s THREE slots.
#
# The full-app keys (plan/design/ewell/partsdash/opsdash .md) were deliberately REMOVED from the prod
# volume on 2026-08-02 — showing a 1.5B model an entire app as the exemplar for one atomic prompt
# makes it copy the skeleton and drop the atomic intent. They were kept in git as backup, and this
# seed step was copying the backups straight back in, so every factory measurement ran against a
# corpus configured the known-harmful way AND unlike production.
#
# Measured 2026-08-06 (retrieval-check.ts, opsdash prompts): with the full-app keys seeded, `opsdash`
# held a top-3 slot on 5 of 6 probes and only 1/6 reached a newly generated atom.
# Set SEED_FULLAPP_KEYS=1 to restore the old behaviour for an A/B.
n_gold=$(find "$OUT/golden" -name '*.app' 2>/dev/null | wc -l | tr -d ' ')
if [ "${SEED:-}" = "1" ] || [ "$n_gold" -eq 0 ]; then
  log "seeding $OUT/golden from scripts/eval-fixtures/golden (atomic keys${SEED_FULLAPP_KEYS:+ + full-app keys})"
  mkdir -p "$OUT/golden"
  # scoring targets / pairs — always
  cp -f scripts/eval-fixtures/golden/*.app "$OUT/golden/" 2>/dev/null || true
  cp -f scripts/eval-fixtures/golden/atomic/*.app "$OUT/golden/" 2>/dev/null || true
  # retrieval keys — atomic always; full-app only on request
  cp -f scripts/eval-fixtures/golden/atomic/*.md "$OUT/golden/" 2>/dev/null || true
  if [ "${SEED_FULLAPP_KEYS:-0}" = "1" ]; then
    cp -f scripts/eval-fixtures/golden/*.md "$OUT/golden/" 2>/dev/null || true
  else
    for k in plan design ewell partsdash opsdash; do rm -f "$OUT/golden/$k.md"; done
  fi
fi

# Dedicated trial server on :3334 so we never fight a :3333 that lacks CADTRAIN_APP_CORPUS.
TRIAL_PORT="${TRIAL_PORT:-3334}"
export CADTRAIN_DEV_URL="http://localhost:$TRIAL_PORT"
if ! curl -s -o /dev/null --max-time 2 "$CADTRAIN_DEV_URL/api/cache/stats"; then
  if [ -f "$RUNDIR/dev-server-trial.pid" ]; then
    kill "$(cat "$RUNDIR/dev-server-trial.pid")" 2>/dev/null || true
    rm -f "$RUNDIR/dev-server-trial.pid"
  fi
  log "starting :$TRIAL_PORT with CADTRAIN_APP_CORPUS=$OUT"
  nohup env CADTRAIN_APP_CORPUS="$PWD/$OUT" node_modules/.bin/vite dev --port "$TRIAL_PORT" --strictPort \
    > "$RUNDIR/dev-server-trial.log" 2>&1 &
  echo $! > "$RUNDIR/dev-server-trial.pid"
  for i in $(seq 1 45); do
    sleep 2
    curl -s -o /dev/null --max-time 2 "$CADTRAIN_DEV_URL/api/cache/stats" && break
  done
fi
curl -s -o /dev/null --max-time 3 "$CADTRAIN_DEV_URL/api/cache/stats" || {
  log "FATAL: trial server $CADTRAIN_DEV_URL unreachable — see $RUNDIR/dev-server-trial.log"
  exit 1
}
log "deps up. apps=${APPS_A[*]} max_gap=$MAX_GAP runs=$RUNS out=$OUT url=$CADTRAIN_DEV_URL"

# ── 1. baseline measure ───────────────────────────────────────────────────────
BASE_JSON="$RUNDIR/factory-baseline.json"
BEFORE_OUT="$RUNDIR/factory-before.out"
: > "$BEFORE_OUT"
log "=== BASELINE (local + ground, runs=$RUNS) ==="
means_before=()
for app in "${APPS_A[@]}"; do
  out="$RUNDIR/factory-before-$app.out"
  bun run scripts/eval-app-build.ts --provider local --incremental --ground --runs "$RUNS" --app "$app" > "$out" 2>&1 || true
  cat "$out" >> "$BEFORE_OUT"
  s=$(score_of "$out"); s=${s:-0}
  means_before+=("$app:$s")
  log "  before $app -> ${s}%"
done
# write a simple baseline map for --gate (scores as 0..1)
python3 - "$BASE_JSON" "${means_before[@]}" <<'PY'
import json,sys
path=sys.argv[1]; d={}
for a in sys.argv[2:]:
  k,v=a.split(':',1)
  try: d[k]=float(v)/100.0
  except: d[k]=0.0
json.dump(d, open(path,'w'), indent=2); print(path, d)
PY

# ── 2. gap-fill (Ollama, capped) ──────────────────────────────────────────────
if [ "${SKIP_FILL:-0}" != "1" ]; then
  log "=== GAP-FILL (Ollama, max=$MAX_GAP) ==="
  bun run scripts/overnight/gap-fill.ts \
    --out "$OUT" \
    --docType dashboard \
    --gap "operations / sales dashboard with KPI stats, chart, datatable, and named vars" \
    --max "$MAX_GAP" | tee -a "$LOG"
else
  log "SKIP_FILL=1 — not generating"
fi

# ── 2.5 reachability: can the model actually SEE what we just staged? ─────────
# rankGolden() hands over only its top 3, so staged atoms that never crack it are invisible and any
# before/after delta measures nothing. Assert reachability BEFORE spending the "after" evals.
REACH=1
if [ "${SKIP_FILL:-0}" != "1" ]; then
  log "=== REACHABILITY (do the new atoms get retrieved?) ==="
  RC_OUT="$RUNDIR/factory-retrieval.out"
  bun run scripts/overnight/retrieval-check.ts \
    --corpus "$OUT" --url "$CADTRAIN_DEV_URL" --docType dashboard --match "trial-" > "$RC_OUT" 2>&1 || true
  rc_line=$(grep -oE 'RETRIEVAL_CHECK hits=[0-9]+/[0-9]+ files=[0-9]+' "$RC_OUT" | tail -1)
  rc_hits=$(printf '%s' "$rc_line" | grep -oE 'hits=[0-9]+' | cut -d= -f2)
  log "  ${rc_line:-(no result — see $RC_OUT)}"
  if [ "${rc_hits:-0}" = "0" ]; then
    REACH=0
    log "  NO EFFECT EXPECTED — the staged atoms are never retrieved for the eval's prompts."
    log "  Any before/after delta below is noise, NOT evidence. Fix retrieval, not corpus volume."
  fi
fi

# ── 3. re-measure + gate ──────────────────────────────────────────────────────
AFTER_OUT="$RUNDIR/factory-after.out"
: > "$AFTER_OUT"
log "=== AFTER (local + ground, runs=$RUNS) ==="
# Restart note: if the server was already up WITHOUT CADTRAIN_APP_CORPUS, grounding still hits
# the old store. Prefer killing/restarting with the env (best-effort).
if [ -f "$RUNDIR/dev-server-trial.pid" ]; then
  log "(trial server already on CADTRAIN_APP_CORPUS)"
fi
fail=0
for app in "${APPS_A[@]}"; do
  out="$RUNDIR/factory-after-$app.out"
  bun run scripts/eval-app-build.ts --provider local --incremental --ground --runs "$RUNS" --app "$app" > "$out" 2>&1 || true
  cat "$out" >> "$AFTER_OUT"
  s=$(score_of "$out"); s=${s:-0}
  log "  after  $app -> ${s}%"
done

# ── 4. gate: compare the BEFORE/AFTER we already measured ─────────────────────
# NOT a third eval run. The old gate re-invoked eval-app-build --gate, which drew a FRESH
# sample and compared THAT to the baseline — so the number it judged was never the number it
# printed above. Now we parse both existing outputs and test the delta against a noise band
# derived from the runs themselves: band = max(BAND_FLOOR, BAND_SIGMA × pooled σ).
# A delta inside the band is INCONCLUSIVE, not a regression — the honest verdict at this noise.
log "=== GATE (before vs after, noise-aware) ==="
GATE_OUT="$RUNDIR/factory-gate.out"
: > "$GATE_OUT"
for app in "${APPS_A[@]}"; do
  verdict=$(python3 - "$RUNDIR/factory-before-$app.out" "$RUNDIR/factory-after-$app.out" \
                      "$app" "$BAND_SIGMA" "$BAND_FLOOR" <<'PY'
import re, statistics, sys

def scores(path):
    """Per-run percentages. runs>=2 prints 'per-run: a% · b%'; runs==1 prints 'score: a%'."""
    try:
        t = open(path, encoding='utf-8', errors='replace').read()
    except OSError:
        return []
    m = re.search(r'per-run:\s*(.+)', t)
    if m:
        return [float(x) for x in re.findall(r'([0-9.]+)%', m.group(1))]
    m = re.findall(r'^\s*score:\s*([0-9.]+)%', t, re.M)
    return [float(x) for x in m]

before, after = scores(sys.argv[1]), scores(sys.argv[2])
app, k, floor = sys.argv[3], float(sys.argv[4]), float(sys.argv[5])

if not before or not after:
    print(f"ERROR|{app}|could not parse scores (before={len(before)} after={len(after)})")
    raise SystemExit

mb, ma = statistics.mean(before), statistics.mean(after)
sb = statistics.pstdev(before) if len(before) > 1 else 0.0
sa = statistics.pstdev(after) if len(after) > 1 else 0.0
pooled = ((sb**2 + sa**2) / 2) ** 0.5           # equal n → plain RMS of the two σ
band = max(floor, k * pooled)
delta = ma - mb

if len(before) < 2 or len(after) < 2:
    v = "NOGATE"                                 # single sample carries no σ — cannot judge
elif delta > band:
    v = "WIN"
elif delta < -band:
    v = "REGRESSION"
else:
    v = "INCONCLUSIVE"

print(f"{v}|{app}|before {mb:.1f}% (σ{sb:.2f}, n={len(before)})  "
      f"after {ma:.1f}% (σ{sa:.2f}, n={len(after)})  "
      f"Δ{delta:+.1f}pp  band ±{band:.1f}pp")
PY
)
  echo "$verdict" >> "$GATE_OUT"
  v="${verdict%%|*}"; rest="${verdict#*|}"; rest="${rest#*|}"
  # Reachability outranks the delta: if the atoms were never retrieved, the eval compared a corpus
  # to itself. Reporting that as WIN/REGRESSION would be reading noise as a result.
  if [ "$REACH" = "0" ] && [ "$v" != "NOGATE" ]; then
    log "  NO EFFECT    $app — $rest  → atoms unreachable; delta is noise, not a verdict"
    continue
  fi
  case "$v" in
    WIN)          log "  WIN          $app — $rest  → promote these atoms" ;;
    REGRESSION)   log "  REGRESSION   $app — $rest  → discard these atoms"; fail=1 ;;
    INCONCLUSIVE) log "  INCONCLUSIVE $app — $rest  → delta inside noise; raise RUNS or keep quarantined" ;;
    NOGATE)       log "  NOGATE       $app — $rest  → RUNS=$RUNS gives no σ; re-run with RUNS>=3" ;;
    *)            log "  GATE ERROR   $app — $rest"; fail=1 ;;
  esac
done

log "DONE. before=${means_before[*]}  candidates=$(ls "$OUT/candidates" 2>/dev/null | wc -l | tr -d ' ')  goldens=$(ls "$OUT/golden"/*.app 2>/dev/null | wc -l | tr -d ' ')"
log "Review atoms in $OUT/golden (trial-*); promote to prod volume ONLY after a clear win."
exit 0
