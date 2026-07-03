#!/usr/bin/env bash
# dev:worktree — start a Vite dev server for a git WORKTREE with a DETERMINISTIC
# port hashed from the branch name (same worktree → same port; different
# worktrees → different ports → no collisions, and the port is trackable).
# Also makes a bare worktree serveable: symlinks node_modules + copies
# .env.local from the MAIN checkout. Avoids the random-port stalls (CLAUDE.md #26).
set -euo pipefail
MAIN=$(git worktree list --porcelain | sed -n '1s/^worktree //p')
BRANCH=$(git rev-parse --abbrev-ref HEAD)
# Deterministic base port in 3400–3799 from the branch name.
BASE=$((3400 + $(printf '%s' "$BRANCH" | cksum | cut -d' ' -f1) % 400))
PORT=$BASE
while lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; do PORT=$((PORT+1)); done
[ -e node_modules ] || ln -s "$MAIN/node_modules" node_modules
[ -f .env.local ] || { [ -f "$MAIN/.env.local" ] && cp "$MAIN/.env.local" .env.local; }
echo "[dev:worktree] branch=$BRANCH port=$PORT (base=$BASE, main=$MAIN)"
printf '%s\t%s\n' "$BRANCH" "$PORT" >> "$MAIN/.claude/worktree-ports.log" 2>/dev/null || true
exec node_modules/.bin/vite dev --port "$PORT" --strictPort
