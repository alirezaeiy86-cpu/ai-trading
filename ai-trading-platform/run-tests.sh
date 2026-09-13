#!/usr/bin/env bash
# run-tests.sh — run all package tests and report results

set -e

PASS=0
FAIL=0
PACKAGES=(
  "indicators"
  "risk-engine"
  "strategies"
  "ai-engine"
  "execution"
  "backtesting"
  "market-data"
)

echo ""
echo "═══════════════════════════════════════════════"
echo "  AI Trading Platform — Test Suite"
echo "═══════════════════════════════════════════════"
echo ""

for pkg in "${PACKAGES[@]}"; do
  printf "  %-20s" "@trading/$pkg"
  if npm test --workspace="packages/$pkg" --silent 2>/dev/null; then
    echo "✓ PASS"
    ((PASS++))
  else
    echo "✗ FAIL"
    ((FAIL++))
  fi
done

echo ""
echo "───────────────────────────────────────────────"
echo "  Results: $PASS passed, $FAIL failed"
echo "═══════════════════════════════════════════════"
echo ""

if [ "$FAIL" -gt 0 ]; then
  echo "Run with verbose output:"
  echo "  npm test --workspace=packages/<name>"
  exit 1
fi
