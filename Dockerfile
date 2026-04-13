# ============================================================
# CAD Train — SvelteKit + Threlte + Anthropic Claude RAG
# ============================================================
# Multi-stage build:
#   1. Build with bun (fast installs + builds)
#   2. Runtime with Node.js slim
# ============================================================

# ---- Build stage ----
# Use Node 22 (Vite 8 requires ≥ 20.19 / 22.12) for the build,
# install deps with bun for speed.
FROM node:22-slim AS builder

WORKDIR /app

# Install bun (just for fast `bun install`)
RUN apt-get update && apt-get install -y curl unzip && rm -rf /var/lib/apt/lists/* \
    && curl -fsSL https://bun.sh/install | bash \
    && ln -s /root/.bun/bin/bun /usr/local/bin/bun

# Copy manifest first for better caching
COPY package.json bun.lock ./

# Install all deps (frozen lockfile)
RUN bun install --frozen-lockfile

# Copy source
COPY . .

# Build the SvelteKit app via Node (Vite + SvelteKit run on Node, not bun runtime)
RUN node --version && npx vite --version && npx vite build

# Strip dev deps for smaller runtime
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
