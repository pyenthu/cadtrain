#!/usr/bin/env bash
#
# last-shots.sh — surface the last N macOS screenshots to Claude Code.
#
# USAGE (from the repo root):
#   ! bash scripts/last-shots.sh 3      # inside Claude Code: '!' runs it, stdout enters the chat
#   bash scripts/last-shots.sh 3        # plain terminal
#
# It finds the newest N image files in your screenshot folder (default
# ~/Desktop, or wherever `com.apple.screencapture location` points), prints
# their ABSOLUTE paths newest-first (one per line), and also copies them into
# a stable, gitignored ./.shots/ dir with index-prefixed names so the paths
# stay predictable across runs. Hand any of the printed paths to Claude's Read
# tool and it will render the image.
#
set -euo pipefail

N="${1:-3}"
case "$N" in
  ''|*[!0-9]*) echo "Usage: bash scripts/last-shots.sh [N]  (N = how many screenshots, default 3)" >&2; exit 2 ;;
esac

TAB="$(printf '\t')"

# --- Locate the screenshot directory --------------------------------------
# Respect a custom screenshot location if the user set one; else ~/Desktop.
SHOT_DIR="$(defaults read com.apple.screencapture location 2>/dev/null || true)"
if [ -n "$SHOT_DIR" ]; then
  case "$SHOT_DIR" in
    "~"|"~/"*) SHOT_DIR="${HOME}${SHOT_DIR#\~}" ;;   # expand a leading ~
  esac
fi
[ -n "$SHOT_DIR" ] && [ -d "$SHOT_DIR" ] || SHOT_DIR="$HOME/Desktop"

if [ ! -d "$SHOT_DIR" ]; then
  echo "No screenshot directory found (looked in: $SHOT_DIR)."
  exit 0
fi

# --- Collect candidate images as null-delimited "mtime<TAB>path" records ---
# Null-delimited throughout so filenames with spaces are safe. We write to a
# temp file rather than a shell variable because command substitution strips
# NUL bytes.
TMP="$(mktemp "${TMPDIR:-/tmp}/last-shots.XXXXXX")"
trap 'rm -f "$TMP"' EXIT

collect() {  # args: one or more find -iname patterns; writes records to $TMP
  local pat=() first=1 p
  for p in "$@"; do
    if [ $first -eq 1 ]; then first=0; else pat+=( -o ); fi
    pat+=( -iname "$p" )
  done
  # -maxdepth 1: only the Desktop itself, not nested folders.
  find "$SHOT_DIR" -maxdepth 1 -type f \( "${pat[@]}" \) -print0 2>/dev/null \
    | while IFS= read -r -d '' f; do
        printf '%s%s%s\0' "$(stat -f %m "$f" 2>/dev/null || echo 0)" "$TAB" "$f"
      done
}

# Screenshot-named files take priority; fall back to any common image type.
collect 'Screenshot *.png' 'Screen Shot *.png' 'CleanShot *.png' > "$TMP"
if [ ! -s "$TMP" ]; then
  collect '*.png' '*.jpg' '*.jpeg' '*.heic' > "$TMP"
fi

if [ ! -s "$TMP" ]; then
  echo "No screenshots or images found in: $SHOT_DIR"
  exit 0
fi

# --- Refresh the stable ./.shots/ copy dir --------------------------------
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SHOTS_DIR="$REPO_ROOT/.shots"
rm -rf "$SHOTS_DIR"
mkdir -p "$SHOTS_DIR"

echo "Screenshot source: $SHOT_DIR"
echo ""
echo "Last $N screenshot(s), newest first — ORIGINAL paths:"

# Sort by mtime descending, take the first N, copy + print. Done in one
# null-safe pipeline (no NUL-in-variable). Print original paths inline and
# stash the copied paths in a temp file to echo afterwards.
COPIED_LIST="$(mktemp "${TMPDIR:-/tmp}/last-shots-copied.XXXXXX")"
trap 'rm -f "$TMP" "$COPIED_LIST"' EXIT

sort -z -t "$TAB" -k1,1 -rn "$TMP" \
  | { i=0
      while IFS= read -r -d '' rec; do
        i=$((i + 1))
        [ "$i" -gt "$N" ] && break
        f="${rec#*$TAB}"       # strip "mtime<TAB>" -> absolute path
        echo "  $f"
        base="$(basename "$f")"
        dest="$SHOTS_DIR/${i}-${base}"
        cp -p "$f" "$dest"
        printf '%s\n' "$dest" >> "$COPIED_LIST"
      done; }

echo ""
echo "Stable copies in ./.shots/ (predictable paths — hand these to Read):"
while IFS= read -r c; do
  [ -n "$c" ] && echo "  $c"
done < "$COPIED_LIST"
