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
    CADTRAIN_VOLUME_TOKEN="$(grep -E '^CADTRAIN_VOLUME_TOKEN=' "$REPO_ROOT/.env.local" | head -1 | cut -d= -f2- | tr -d "\"'" || true)"
  fi
  # Token is OPTIONAL: prod /api/volume GET (list + download) is open; the token
  # only gates cross-origin WRITES. Send it if present, otherwise proceed.
  CADTRAIN_VOLUME_TOKEN="${CADTRAIN_VOLUME_TOKEN:-}"
  [ -z "$CADTRAIN_VOLUME_TOKEN" ] && echo "▸ note: no CADTRAIN_VOLUME_TOKEN set — using open GET access to the volume"
  STAGE="$REPO_ROOT/.volume-sync-staging"
  trap 'rm -rf "$STAGE"' EXIT
  rm -rf "$STAGE"; mkdir -p "$STAGE"
  echo "▸ source: prod   $BASE_URL/api/volume"
  echo "▸ pulling volume → staging (recursive, depth-1 per call)…"
  # Token is passed via env (not argv) so it never lands in `ps` output.
  CADTRAIN_VOLUME_TOKEN="$CADTRAIN_VOLUME_TOKEN" python3 -u - "$BASE_URL" "$STAGE" <<'PY'
import http.client, json, os, sys, time, urllib.parse
from urllib.parse import urlparse
base, stage = sys.argv[1], sys.argv[2]
token = os.environ.get("CADTRAIN_VOLUME_TOKEN", "")
hdrs = {"X-Volume-Token": token} if token else {}
host = urlparse(base).hostname
# ONE persistent HTTPS connection — DNS is resolved ONCE, not per file. A flaky
# local/ISP resolver chokes on hundreds of rapid per-file getaddrinfo calls
# (fails for ANY host — incl. paramcad.app while it CNAMEs to railway); reusing
# the connection means a single successful lookup carries the whole pull.
_conn = {"c": None}
def _get_conn():
    if _conn["c"] is None:
        _conn["c"] = http.client.HTTPSConnection(host, timeout=120)
    return _conn["c"]
def fetch(rel, tries=6):
    path = "/api/volume?path=" + urllib.parse.quote(rel)
    for i in range(tries):
        try:
            c = _get_conn()
            c.request("GET", path, headers=hdrs)
            r = c.getresponse()
            data = r.read()  # read fully so the connection can be reused
            if r.status != 200:
                raise Exception("HTTP %d" % r.status)
            return data
        except Exception as e:
            try: _conn["c"].close()
            except Exception: pass
            _conn["c"] = None  # force one fresh connect (single DNS lookup) on retry
            if i == tries - 1:
                raise
            sys.stderr.write("  retry %d/%d %s (%s)\n" % (i + 1, tries - 1, rel or "/", type(e).__name__))
            time.sleep(2 * (i + 1))
def walk(rel):
    node = json.loads(fetch(rel))
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
            data = fetch(c["id"])
            with open(dest, "wb") as f:
                f.write(data)
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
