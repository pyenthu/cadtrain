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
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

RUN bun install --production

ENV NODE_ENV=production
ENV CACHE_VOLUME=/data
ENV HOST=0.0.0.0
EXPOSE 3000

CMD ["./docker-entrypoint.sh"]
