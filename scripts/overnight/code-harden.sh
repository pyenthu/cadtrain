#!/usr/bin/env bash
# Overnight code-hardening (#49, loop D) — ONE PASS, count-capped. Optional; does NOT grow the RAG DB.
# Prefer Cursor Option-3 one-shots for files you just changed. Kept for unattended smoke only.
set -uo pipefail
cd "$(dirname "$0")/../.." || exit 1
export PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH"
. "$(dirname "$0")/limit-guard.sh"
RUNDIR="scripts/overnight/runs"; mkdir -p "$RUNDIR"
REPORT="$RUNDIR/harden-findings.md"; LOG="$RUNDIR/harden.log"
HARDEN_MAX="${HARDEN_MAX:-10}"   # hard cap — never hour-spray
log(){ echo "[$(date '+%H:%M:%S')] $*" >> "$LOG"; }
[ -f "$REPORT" ] || echo "# Code-hardening findings ($(date '+%Y-%m-%d')) — one-pass cap=$HARDEN_MAX" > "$REPORT"
FILES=(); while IFS= read -r line; do FILES+=("$line"); done < <(find src/lib/appkit src/lib/server src/routes/api/app -name '*.ts' ! -name '*.test.ts' | sort)
# Prefer recently touched when git is available
if command -v git >/dev/null 2>&1; then
  RECENT=(); while IFS= read -r line; do RECENT+=("$line"); done < <(git log --since='14 days ago' --name-only --pretty=format: -- src/lib/appkit src/lib/server src/routes/api/app 2>/dev/null | grep '\.ts$' | grep -v '\.test\.ts$' | sort -u)
  [ ${#RECENT[@]} -gt 0 ] && FILES=("${RECENT[@]}")
fi
log "one-pass review of up to $HARDEN_MAX / ${#FILES[@]} files (CLAUDE slim: --safe-mode)"
n=0
for f in "${FILES[@]}"; do
  [ "$n" -ge "$HARDEN_MAX" ] && break
  [ -f "$f" ] || continue
  out=$({ echo "Review this TypeScript file for CORRECTNESS bugs, race conditions, or unhandled edge cases only (not style). Be concrete: cite the line and why it fails. If you find nothing real, reply with exactly: CLEAN"; echo; echo "// FILE: $f"; cat "$f"; } | claude --print --safe-mode 2>/dev/null)
  if guard_blocked "$out"; then guard_backoff "$out" || break; continue; fi
  guard_ok; n=$((n+1))
  if ! printf '%s' "$out" | grep -qx "CLEAN"; then
    { echo; echo "## \`$f\` — $(date '+%H:%M')"; echo "$out"; } >> "$REPORT"; log "FINDINGS: $f"
  else
    log "clean: $f"
  fi
done
log "DONE ($n reviews, capped at $HARDEN_MAX)"
