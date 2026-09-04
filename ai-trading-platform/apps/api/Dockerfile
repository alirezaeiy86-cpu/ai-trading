FROM node:20-alpine

WORKDIR /app
COPY . .
RUN npm install
RUN npx tsc -p packages/types/tsconfig.json || true
RUN npx tsc -p packages/config/tsconfig.json || true
RUN npx tsc -p packages/logger/tsconfig.json || true
RUN npx tsc -p packages/database/tsconfig.json || true
RUN npx tsc -p apps/api/tsconfig.json || true
EXPOSE 3001
CMD ["node", "apps/api/dist/index.js"]

