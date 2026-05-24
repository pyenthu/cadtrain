#!/bin/sh
# CAD Train entrypoint — set up the persistent volume then start the server.
#
# Single-volume model (2026-05-13): everything persistent lives under
# $APP_DATA_DIR (default /app_data on Railway). The Dockerfile-baked image
# ships seed copies of training_data/{cache,authored_cache}.jsonl; on
# first run we copy them into the volume if not already present, then
# symlink the in-image paths to the volume so the running code sees the
# canonical files.
#
# Legacy $CACHE_VOLUME (/data) is honored too for now so an existing
# Railway deploy with the old volume keeps working until the user
# migrates. New deploys should attach a volume at /app_data and leave
# $CACHE_VOLUME unset.

set -e

# ─── New canonical path: $APP_DATA_DIR ────────────────────────────────────────
if [ -n "$APP_DATA_DIR" ] && [ -d "$APP_DATA_DIR" ]; then
  # Make sure every well-known subdir exists so the API handlers don't
  # ENOENT before they've ever written anything.
  # 4-dir volume layout (2026-05-24): archive / components / ai / primitives.
  # The RAG caches + KB live under ai/. The app still reads cache.jsonl from
  # the in-image working path `training_data/` (cwd), which we symlink to the
  # volume's `ai/training_data/`.
  mkdir -p "$APP_DATA_DIR/ai/training_data" "$APP_DATA_DIR/components" "$APP_DATA_DIR/ai/kb-sources"

  # Seed the training caches from the baked image on first run (volume
  # is empty). Subsequent runs find files already there and skip.
  for name in cache.jsonl authored_cache.jsonl; do
    if [ ! -f "$APP_DATA_DIR/ai/training_data/$name" ] && [ -f "training_data/$name" ]; then
      echo "[entrypoint] First run: seeding $name into $APP_DATA_DIR/ai/training_data/"
      cp "training_data/$name" "$APP_DATA_DIR/ai/training_data/$name"
    fi
    rm -f "training_data/$name"
    ln -s "$APP_DATA_DIR/ai/training_data/$name" "training_data/$name"
  done
  echo "[entrypoint] Volume linked: $APP_DATA_DIR (ai/training_data, components, ai/kb-sources)"

# ─── Legacy: $CACHE_VOLUME (kept for backward compat) ──────────────────────────
elif [ -n "$CACHE_VOLUME" ] && [ -d "$CACHE_VOLUME" ]; then
  for name in cache.jsonl authored_cache.jsonl; do
    if [ ! -f "$CACHE_VOLUME/$name" ] && [ -f "training_data/$name" ]; then
      echo "[entrypoint] First run: seeding volume with baked $name"
      cp "training_data/$name" "$CACHE_VOLUME/$name"
    fi
    rm -f "training_data/$name"
    ln -s "$CACHE_VOLUME/$name" "training_data/$name"
  done
  echo "[entrypoint] (legacy) Caches linked to $CACHE_VOLUME — consider migrating to APP_DATA_DIR"
fi

echo "[entrypoint] Starting SvelteKit server on $HOST:$PORT"
exec node build
