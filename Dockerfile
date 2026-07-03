FROM oven/bun:1 AS builder

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1

WORKDIR /app
COPY --from=builder /app/build ./build
# server.js wraps build/index.js to add app-wide COOP/COEP on static assets too
# (the client-bake Web Worker must inherit cross-origin isolation). See server.js.
COPY --from=builder /app/server.js ./
COPY --from=builder /app/package.json ./
COPY --from=builder /app/training_data/cache.jsonl ./training_data/cache.jsonl
COPY --from=builder /app/training_data/authored_cache.jsonl ./training_data/authored_cache.jsonl
# NOTE: the old `COPY src/lib/cad/components` was removed 2026-05-27 — the
# components product (and that directory) was deleted, so the COPY failed and
# broke the Docker image assembly (Vite build succeeded, final stage failed).
# stdlib primitives (src/lib/cad/stdlib/) need NO runtime COPY: their source is
# inlined into the build output via import.meta.glob('?raw').
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

RUN bun install --production

ENV NODE_ENV=production
ENV CACHE_VOLUME=/data
ENV APP_DATA_DIR=/app_data
ENV HOST=0.0.0.0
# adapter-node caps request bodies at 512K by default — too small for
# /api/volume PUT uploads (PDFs, WEBMs, figure renders). Raise it so the
# volume CRUD can take real files. Override per-service on Railway if a
# tighter cap is wanted. NOTE: a Railway service variable of the same
# name takes precedence over this line.
ENV BODY_SIZE_LIMIT=64M
EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
