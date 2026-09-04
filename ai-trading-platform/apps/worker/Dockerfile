# =============================================================================
# TRADING WORKER DOCKERFILE
# Multi-stage build: builder → production
# The worker must always be on an always-on compute instance.
# It must NOT run on Vercel or any serverless/function platform.
# =============================================================================

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile

COPY packages/types/ ./packages/types/
COPY packages/config/ ./packages/config/
COPY packages/logger/ ./packages/logger/
COPY apps/worker/ ./apps/worker/
COPY tsconfig.json ./

RUN pnpm --filter @trading/types build
RUN pnpm --filter @trading/config build
RUN pnpm --filter @trading/logger build
RUN pnpm --filter @trading/worker build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY apps/worker/package.json ./apps/worker/

RUN pnpm install --frozen-lockfile --prod

COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/config/dist ./packages/config/dist
COPY --from=builder /app/packages/logger/dist ./packages/logger/dist
COPY --from=builder /app/apps/worker/dist ./apps/worker/dist

# Non-root user
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

# Workers have no HTTP port — liveness is checked via heartbeat in PostgreSQL
# The cloud platform should restart on process exit (restart: unless-stopped)

CMD ["node", "apps/worker/dist/index.js"]
