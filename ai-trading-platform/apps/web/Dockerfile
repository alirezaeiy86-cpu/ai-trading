# =============================================================================
# NEXT.JS DASHBOARD DOCKERFILE
# For local production testing only.
# For actual production, deploy to Vercel (zero-config, free tier).
# =============================================================================

FROM node:20-alpine AS builder

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@9 --activate

COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/types/package.json ./packages/types/
COPY apps/web/package.json ./apps/web/

RUN pnpm install --frozen-lockfile

COPY packages/types/ ./packages/types/
COPY apps/web/ ./apps/web/
COPY tsconfig.json ./

# Build types first
RUN pnpm --filter @trading/types build

# Build Next.js app
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter @trading/web build

FROM node:20-alpine AS production

WORKDIR /app

RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001

COPY --from=builder --chown=nodejs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nodejs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=nodejs:nodejs /app/apps/web/public ./apps/web/public

USER nodejs

EXPOSE 3000
ENV PORT=3000
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME="0.0.0.0"

CMD ["node", "apps/web/server.js"]
