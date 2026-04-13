# ============================================================
# CAD Train — SvelteKit + Threlte + Anthropic Claude RAG
# ============================================================
# Multi-stage build:
#   1. Build with bun (fast installs + builds)
#   2. Runtime with Node.js slim
# ============================================================

# ---- Build stage ----
# Match local bun version (1.3+) for lockfile compatibility
FROM oven/bun:1.3 AS builder

WORKDIR /app

# Copy only manifest first for better caching
COPY package.json bun.lock ./

# Install dependencies (production + dev needed for build)
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Generate SvelteKit's .svelte-kit dir (types, virtual modules)
RUN bunx svelte-kit sync

# Build the SvelteKit app (produces ./build directory via adapter-node)
RUN bun run build

# Remove dev dependencies for smaller runtime
RUN bun install --frozen-lockfile --production

# ---- Runtime stage ----
FROM node:22-slim AS runtime

WORKDIR /app

# Copy built app + production node_modules
COPY --from=builder /app/build ./build
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json

# Copy training data (cache + library)
COPY --from=builder /app/training_data/cache.jsonl ./training_data/cache.jsonl
COPY --from=builder /app/src/lib/components/library.ts ./src/lib/components/library.ts

# Entrypoint
COPY docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh

ENV NODE_ENV=production
ENV CACHE_VOLUME=/data
ENV HOST=0.0.0.0
ENV PORT=3333
EXPOSE 3333

CMD ["./docker-entrypoint.sh"]
