FROM oven/bun:1 AS builder

WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile
COPY . .
RUN bun run build

FROM oven/bun:1

WORKDIR /app
COPY --from=builder /app/build ./build
COPY --from=builder /app/package.json ./
COPY --from=builder /app/training_data/cache.jsonl ./training_data/cache.jsonl
COPY --from=builder /app/training_data/authored_cache.jsonl ./training_data/authored_cache.jsonl
# Components source ships into the runtime so /api/components/list can
# readdir() it at request time. The bundled .svelte-kit output has the
# geom functions baked in via import.meta.glob, but the list endpoint
# also surfaces raw .ts source text (for the in-app editor) and the
# sidecar .md docs (AI Refine context) — both of which need the actual
# files on disk. Without this COPY the endpoint 500s in prod.
COPY --from=builder /app/src/lib/cad/components ./src/lib/cad/components
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

RUN bun install --production

ENV NODE_ENV=production
ENV CACHE_VOLUME=/data
ENV APP_DATA_DIR=/app_data
ENV HOST=0.0.0.0
EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
