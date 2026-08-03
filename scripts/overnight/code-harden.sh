#!/usr/bin/env bash
# Overnight code-hardening (#49, loop D) — claude reviews source files for correctness bugs, one at a
# time, appending findings to a report. READ-ONLY (findings only, NO edits) so it's safe unattended;
# you triage + fix in the morning. Rotates through the RAG/app code we've been changing; time-bounded.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"  # detached shells may lack claude/bun on PATH
. "$(dirname "$0")/limit-guard.sh"   # circuit-breaker: a rate-limited `claude --print` returns
                                     # refusal prose instantly — without this the loop spins on it
RUNDIR="scripts/overnight/runs"; mkdir -p "$RUNDIR"
REPORT="$RUNDIR/harden-findings.md"; LOG="$RUNDIR/harden.log"; HOURS="${HARDEN_HOURS:-7}"
log(){ echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }
[ -f "$REPORT" ] || echo "# Overnight code-hardening findings ($(date '+%Y-%m-%d'))" > "$REPORT"
# bash 3.2 (macOS default) has no `mapfile` — fill the array the portable way
FILES=(); while IFS= read -r line; do FILES+=("$line"); done < <(find src/lib/appkit src/lib/server src/routes/api/app -name '*.ts' ! -name '*.test.ts' | sort)
log "reviewing ${#FILES[@]} files"
END=$(( $(date +%s) + HOURS*3600 )); i=0
while [ "$(date +%s)" -lt "$END" ] && [ "${#FILES[@]}" -gt 0 ]; do
  f="${FILES[$(( i % ${#FILES[@]} ))]}"
  out=$({ echo "Review this TypeScript file for CORRECTNESS bugs, race conditions, or unhandled edge cases only (not style). Be concrete: cite the line and why it fails. If you find nothing real, reply with exactly: CLEAN"; echo; echo "// FILE: $f"; cat "$f"; } | claude --print 2>/dev/null)
  # Blocked → sleep it out and RETRY THE SAME FILE. Advancing `i` here would let the limit
  # window silently skip files, so a "full pass" could report files it never reviewed.
  if guard_blocked "$out"; then guard_backoff "$out" || break; continue; fi
  guard_ok; i=$((i+1))
  if ! printf '%s' "$out" | grep -qx "CLEAN"; then
    { echo; echo "## \`$f\` — $(date '+%H:%M')"; echo "$out"; } >> "$REPORT"; log "FINDINGS: $f"
  else
    log "clean: $f"
  fi
  [ $(( i % ${#FILES[@]} )) -eq 0 ] && log "=== completed a full pass ($i files reviewed) ==="
done
log "DONE ($i reviews)"
