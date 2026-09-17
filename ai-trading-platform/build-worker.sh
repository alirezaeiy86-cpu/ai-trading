set -e

echo "==> Installing dependencies..."
npm install --ignore-scripts --include=dev

echo "==> Building types..."
npx tsc -p packages/types

echo "==> Building config..."
npx tsc -p packages/config

echo "==> Building logger..."
npx tsc -p packages/logger

echo "==> Generating Prisma client..."
npx prisma generate --schema=packages/database/prisma/schema.prisma

echo "==> Building database..."
npx tsc -p packages/database

echo "==> Building indicators..."
npx tsc -p packages/indicators

echo "==> Building risk-engine..."
npx tsc -p packages/risk-engine

echo "==> Building strategies..."
npx tsc -p packages/strategies

echo "==> Building market-data..."
npx tsc -p packages/market-data

echo "==> Building execution..."
npx tsc -p packages/execution

echo "==> Building ai-engine..."
npx tsc -p packages/ai-engine

echo "==> Building worker..."
npx tsc -p apps/worker

echo "==> Done!"
