#!/usr/bin/env bash
# scripts/overnight/limit-guard.sh — shared circuit-breaker for the `claude --print` loops (#49).
#
# WHY: on 2026-08-02 the session limit hit 6 minutes after launch. A rate-limited `claude --print`
# returns its refusal PROSE instantly (exit 0, non-empty), so loops B + D read it as a normal
# response and spun at ~2-3s/attempt for hours: 4,017 SKIPs in corpus.log ("JSON Parse error:
# Unexpected identifier \"You\"") and 4,062 of 4,070 harden findings that are just the limit text.
# Nothing detected that the model had stopped answering.
#
# Source this, then gate every `claude --print` result:
#
#     . "$(dirname "$0")/limit-guard.sh"
#     out=$(... | claude --print 2>/dev/null)
#     if guard_blocked "$out"; then guard_backoff "$out" || break; continue; fi
#     guard_ok            # reset the consecutive-failure counter on a real response
#
# The caller supplies `log()`; bash resolves it at call time, so definition order doesn't matter.
# Tunables: GUARD_MAX_FAILS (consecutive blocks before abort) · GUARD_MAX_SLEEP (sleep cap, s).

GUARD_FAILS=0
GUARD_MAX_FAILS="${GUARD_MAX_FAILS:-5}"
GUARD_MAX_SLEEP="${GUARD_MAX_SLEEP:-3600}"

# Seconds until a "resets 9:30pm" / "resets 2:10am" string in the refusal (+60s cushion).
# Prints nothing and returns 1 when there's no parseable time.
_guard_secs_until_reset() {
  python3 - "$1" <<'PY' 2>/dev/null
import re, sys, datetime
m = re.search(r'resets\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)', sys.argv[1], re.I)
if not m:
    raise SystemExit(1)
h = int(m.group(1)) % 12
if m.group(3).lower() == 'pm':
    h += 12
now = datetime.datetime.now()
t = now.replace(hour=h, minute=int(m.group(2) or 0), second=0, microsecond=0)
if t <= now:
    t += datetime.timedelta(days=1)
print(int((t - now).total_seconds()) + 60)
PY
}

# True (0) when the output is a limit/refusal/transport failure rather than real work.
guard_blocked() {
  local o="$1"
  [ -z "${o//[[:space:]]/}" ] && return 0
  printf '%s' "$o" | grep -qiE \
    "hit your (session|weekly|usage|5-hour) limit|usage limit reached|rate limit|too many requests|\
^API Error|Unable to connect to API|ENOTFOUND|Invalid API key|Credit balance is too low|\
OAuth token has expired|Please run /login" && return 0
  return 1
}

# Call after a real response — clears the consecutive-failure count.
guard_ok() { GUARD_FAILS=0; }

# Sleep out a block. Returns 0 to continue looping, 1 when the caller should ABORT.
guard_backoff() {
  local out="$1" secs=""
  GUARD_FAILS=$((GUARD_FAILS + 1))

  if [ "$GUARD_FAILS" -ge "$GUARD_MAX_FAILS" ]; then
    log "ABORT: $GUARD_FAILS consecutive blocked responses — the model is not answering. Last: $(printf '%s' "$out" | head -c 120)"
    return 1
  fi

  if secs=$(_guard_secs_until_reset "$out") && [ -n "$secs" ]; then
    [ "$secs" -gt "$GUARD_MAX_SLEEP" ] && secs="$GUARD_MAX_SLEEP"
    log "BLOCKED (#$GUARD_FAILS): limit hit — sleeping ${secs}s toward the stated reset"
  else
    # No reset time (transport error, expired auth): 1,2,4,8,16 min, capped.
    secs=$(( 60 * (1 << (GUARD_FAILS - 1)) ))
    [ "$secs" -gt "$GUARD_MAX_SLEEP" ] && secs="$GUARD_MAX_SLEEP"
    log "BLOCKED (#$GUARD_FAILS): $(printf '%s' "$out" | head -c 80) — backing off ${secs}s"
  fi

  sleep "$secs"
  return 0
}
