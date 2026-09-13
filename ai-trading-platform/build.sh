set -e

echo "==> Installing dependencies..."
npm install --ignore-scripts

echo "==> Building types..."
cd packages/types && npx tsc --noEmit flase && cd ../..

echo "==> Building config..."
cd packages/config && npx tsc --noEmit flase && cd ../..

echo "==> Building logger..."
cd packages/logger && npx tsc --noEmit flase && cd ../..

echo "==> Building database..."
cd packages/database && npx tsc --noEmit flase && cd ../..

echo "==> Building API..."
cd apps/api && npx tsc --noEmit flase && cd ../..

echo "==> Done!"
