#!/usr/bin/env bash
# volume2onedrive — back up the cadtrain volume to OneDrive (APPS/cadtrain) via rclone.
#
# `rclone sync` is a ONE-WAY mirror: OneDrive is made to match the source exactly,
# so files removed from the volume are removed from OneDrive too. BUT with the
# default --backup-dir, any file that would be overwritten or deleted is first
# MOVED into a timestamped  APPS/cadtrain-prev/<ts>  folder — so the previous
# state is preserved (your "backup the old volume, then replace" ask), never lost.
# rclone auto-creates  APPS/cadtrain  if it doesn't exist yet.
# Always preview with --dry-run first.
#
# Sources:
#   --prod (default) — walks the Railway volume over /api/volume into a staging
#                      dir, then rclone's it up. Needs CADTRAIN_VOLUME_TOKEN
#                      (auto-read from .env.local if not exported) and optionally
#                      CADTRAIN_VOLUME_REMOTE_URL (default the live URL).
#   --local          — rclone ./.dev-volume straight up.
#
# Usage:
#   scripts/volume2onedrive.sh [--prod|--local] [--dry-run] [--no-backup] [--dest remote:path]
#
# Env:
#   ONEDRIVE_DEST               rclone target   (default onedrive:APPS/cadtrain)
#   CADTRAIN_VOLUME_REMOTE_URL  prod base URL   (default https://cadtrain.up.railway.app)
#   CADTRAIN_VOLUME_TOKEN       X-Volume-Token  (required for --prod)

set -euo pipefail

SOURCE="prod"
DRY=""
BACKUP=1
DEST="${ONEDRIVE_DEST:-onedrive:APPS/cadtrain}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

while [ $# -gt 0 ]; do
  case "$1" in
    --prod)      SOURCE="prod" ;;
    --local)     SOURCE="local" ;;
    --dry-run)   DRY="--dry-run" ;;
    --no-backup) BACKUP=0 ;;
    --dest)      DEST="$2"; shift ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

command -v rclone >/dev/null || { echo "✗ rclone not installed (brew install rclone)" >&2; exit 1; }
REMOTE="${DEST%%:*}"
rclone listremotes | grep -q "^${REMOTE}:" || {
  echo "✗ rclone remote '${REMOTE}:' not configured (run: rclone config)" >&2; exit 1; }

# --checksum: compare by content hash (OneDrive QuickXorHash) and skip files that
# already match — no needless re-upload even if a timestamp drifted.
RCLONE_FLAGS=(--progress --create-empty-src-dirs --checksum)
[ -n "$DRY" ] && RCLONE_FLAGS+=("$DRY")
if [ "$BACKUP" = "1" ]; then
  PATHPART="${DEST#*:}"
  BACKUP_DIR="${REMOTE}:${PATHPART}-prev/$(date +%Y%m%d-%H%M%S)"
  RCLONE_FLAGS+=(--backup-dir "$BACKUP_DIR")
  echo "▸ replaced/deleted files → $BACKUP_DIR"
fi

if [ "$SOURCE" = "local" ]; then
  SRC="$REPO_ROOT/.dev-volume"
  [ -d "$SRC" ] || { echo "✗ no local volume at $SRC" >&2; exit 1; }
else
  BASE_URL="${CADTRAIN_VOLUME_REMOTE_URL:-https://cadtrain.up.railway.app}"
  if [ -z "${CADTRAIN_VOLUME_TOKEN:-}" ] && [ -f "$REPO_ROOT/.env.local" ]; then
    CADTRAIN_VOLUME_TOKEN="$(grep -E '^CADTRAIN_VOLUME_TOKEN=' "$REPO_ROOT/.env.local" | head -1 | cut -d= -f2- | tr -d '"'\''')"
  fi
  : "${CADTRAIN_VOLUME_TOKEN:?--prod needs CADTRAIN_VOLUME_TOKEN (export it or put it in .env.local)}"
  STAGE="$REPO_ROOT/.volume-sync-staging"
  trap 'rm -rf "$STAGE"' EXIT
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  echo "▸ source: prod   $BASE_URL/api/volume"
  echo "▸ pulling volume → staging (recursive, depth-1 per call)…"
  # Token is passed via env (not argv) so it never lands in `ps` output.
  CADTRAIN_VOLUME_TOKEN="$CADTRAIN_VOLUME_TOKEN" python3 - "$BASE_URL" "$STAGE" <<'PY'
import json, os, sys, urllib.parse, urllib.request
base, stage = sys.argv[1], sys.argv[2]
token = os.environ["CADTRAIN_VOLUME_TOKEN"]
def get(rel):
    url = base + "/api/volume?path=" + urllib.parse.quote(rel)
    return urllib.request.urlopen(urllib.request.Request(url, headers={"X-Volume-Token": token}))
def walk(rel):
    node = json.load(get(rel))
    if node.get("type") != "dir":
        return
    for c in (node.get("children") or {}).values():
        if c["name"].startswith(".") or c["name"] in ("node_modules", ".git", "volume_backup"):
            continue
        dest = os.path.join(stage, c["id"])
        if c["type"] == "dir":
            os.makedirs(dest, exist_ok=True)
            walk(c["id"])
        else:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            with get(c["id"]) as r, open(dest, "wb") as f:
                f.write(r.read())
            print("  pulled", c["id"])
walk("")
PY
  echo "▸ pulled $(find "$STAGE" -type f | wc -l | tr -d ' ') files to staging"
  SRC="$STAGE"
fi

echo "▸ source: $SRC"
echo "▸ dest:   $DEST"
[ -n "$DRY" ] && echo "▸ DRY RUN — nothing written to OneDrive"
rclone sync "$SRC" "$DEST" "${RCLONE_FLAGS[@]}"
echo "✓ done"
