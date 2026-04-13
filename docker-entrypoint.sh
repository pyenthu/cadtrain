#!/bin/sh
# CAD Train entrypoint — handle cache volume mount then start server.

set -e

# If CACHE_VOLUME is mounted, symlink cache.jsonl so user additions persist
if [ -n "$CACHE_VOLUME" ] && [ -d "$CACHE_VOLUME" ]; then
  if [ ! -f "$CACHE_VOLUME/cache.jsonl" ]; then
    echo "[entrypoint] First run: seeding volume with baked cache"
    cp training_data/cache.jsonl "$CACHE_VOLUME/cache.jsonl"
  fi
  rm -f training_data/cache.jsonl
  ln -s "$CACHE_VOLUME/cache.jsonl" training_data/cache.jsonl
  echo "[entrypoint] Cache linked to $CACHE_VOLUME/cache.jsonl"
fi

echo "[entrypoint] Starting SvelteKit server on $HOST:$PORT"
exec node build
