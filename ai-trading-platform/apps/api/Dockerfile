# =============================================================================
# API SERVER DOCKERFILE
# Multi-stage build: builder → production
# =============================================================================

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy workspace manifests
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY apps/api/package.json ./apps/api/

# Install all dependencies
RUN pnpm install --frozen-lockfile

# Copy source
COPY packages/types/ ./packages/types/
COPY packages/config/ ./packages/config/
COPY packages/logger/ ./packages/logger/
COPY apps/api/ ./apps/api/
COPY tsconfig.json ./

# Build packages first, then API
RUN pnpm --filter @trading/types build
RUN pnpm --filter @trading/config build
RUN pnpm --filter @trading/logger build
RUN pnpm --filter @trading/api build

# ── Stage 2: Production ───────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

# Copy workspace manifests for production install
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY apps/api/package.json ./apps/api/

# Production deps only
RUN pnpm install --frozen-lockfile --prod

# Copy built artifacts
COPY --from=builder /app/packages/types/dist ./packages/types/dist
COPY --from=builder /app/packages/config/dist ./packages/config/dist
COPY --from=builder /app/packages/logger/dist ./packages/logger/dist
COPY --from=builder /app/apps/api/dist ./apps/api/dist

# Security: run as non-root
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001
USER nodejs

EXPOSE 3001

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3001/health || exit 1

CMD ["node", "apps/api/dist/index.js"]
