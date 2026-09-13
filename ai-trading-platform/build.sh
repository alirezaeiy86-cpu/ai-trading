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

echo "==> Building API..."
npx tsc -p apps/api

echo "==> Done!"
