set -e 
echo "==> Installing dependencies..."
npm install --ignore-scripts
 
echo "==> Building types..."
cd packages/types && npx tsc --noEmit false && cd ../..


echo "==> Building config..."
cd packages/confiig && npx tsc --noEmit false && cd ../..


echo "==> Building logger..."
cd packages/logger && npx tsc --noEmit false && cd ../..


echo "==> Building database..."
cd packages/database && npx tsc --noEmit false && cd ../..


echo "==> Building API..."
cd apps/api && npx tsc --noEmit false && cd ../..

echo "==> Done!"
