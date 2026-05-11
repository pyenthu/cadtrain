#!/bin/sh
# CAD Train entrypoint — handle cache volume mount then start server.

set -e

# If CACHE_VOLUME is mounted, symlink both caches so user additions persist
# across deploys. Each cache is seeded from the baked image on first run.
if [ -n "$CACHE_VOLUME" ] && [ -d "$CACHE_VOLUME" ]; then
  for name in cache.jsonl authored_cache.jsonl; do
    if [ ! -f "$CACHE_VOLUME/$name" ] && [ -f "training_data/$name" ]; then
      echo "[entrypoint] First run: seeding volume with baked $name"
      cp "training_data/$name" "$CACHE_VOLUME/$name"
    fi
    rm -f "training_data/$name"
    ln -s "$CACHE_VOLUME/$name" "training_data/$name"
  done
  echo "[entrypoint] Caches linked to $CACHE_VOLUME/{cache,authored_cache}.jsonl"
fi

echo "[entrypoint] Starting SvelteKit server on $HOST:$PORT"
exec node build
