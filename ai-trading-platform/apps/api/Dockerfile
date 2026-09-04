# =============================================================================
# API SERVER DOCKERFILE
# Multi-stage build: builder → production
# =============================================================================

# ── Stage 1: Builder ──────────────────────────────────────────────────────────
FROM node:20-alpine 

WORKDIR /app



# Copy workspace manifests
COPY package.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/config/package.json ./packages/config/
COPY packages/logger/package.json ./packages/logger/
COPY packages/database/package.json ./packages/database/
COPY apps/api/package.json ./apps/api/

# Install all dependencies
RUN pnpm install --workspace --if-present

# Copy source
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY tsconfig.json ./

# Build packages first, then API
RUN npm run build --workspace=packages/types
RUN npm run build --workspace=packages/config
RUN npm run build --workspace=packages/logger
RUN npm run build --workspace=packages/database
RUN npm run build --workspace=apps/api
EXPOSE 3001

CMD ["node", "apps/api/dist/index.js"]

