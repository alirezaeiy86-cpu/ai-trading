# =============================================================================
# TRADING WORKER DOCKERFILE
# Multi-stage build: builder → production
# The worker must always be on an always-on compute instance.
# It must NOT run on Vercel or any serverless/function platform.
# =============================================================================

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY . .

RUN npm install --ignore-scripts --include=dev

RUN npx tsc -p packages/types


RUN npx tsc -p packages/config

RUN npx tsc -p packages/logger

RUN npx prisma generate --schema=packages/prisma/schema.prisma
RUN npx tsc -p packages/database


RUN npx tsc -p packages/indicators

RUN npx tsc -p packages/risk-engine

RUN npx tsc -p packages/strategies

RUN npx tsc -p packages/market-data

RUN npx tsc -p packages/execution

RUN npx tsc -p packages/ai-engine


RUN npx tsc -p apps/worker

FROM node:20-alpine AS production

WORKDIR /app
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/worker/dist ./apps/worker/dist
COPY --from=build /app/apps/package.json ./apps/worker/package.json

CMD ["node", "apps/worker/dist/index.js"]
