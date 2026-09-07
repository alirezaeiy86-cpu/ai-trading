set -e 
echo "Installing dependencies..."
npm install
 
echo "Building types..."
cd packages/types && npx tsc && cd ../..


echo "Building config..."
cd packages/confiig && npx tsc && cd ../..


echo "Building logger..."
cd packages/logger && npx tsc && cd ../..


echo "Building database..."
cd packages/database && npx tsc && cd ../..


echo "Building API..."
cd apps/api && npx tsc && cd ../..

echo "Build complete!"
