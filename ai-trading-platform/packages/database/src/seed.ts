/**
 * DATABASE SEED
 * Run with: pnpm --filter @trading/database db:seed
 *
 * Creates default settings, paper account, and initial strategy records.
 * Safe to run multiple times (uses upsert).
 */

import { prisma, connectDatabase, disconnectDatabase } from './client';

async function seed(): Promise<void> {
  console.log('🌱 Seeding database...');

  // --- Trading settings (singleton) ---
  await prisma.tradingSettings.upsert({
    where: { id: 'singleton' },
    create: { id: 'singleton' },
    update: {},
  });
  console.log('  ✓ Trading settings');

  // --- Paper account ---
  const initialBalance = parseFloat(process.env['PAPER_INITIAL_BALANCE'] ?? '10000');
  await prisma.paperAccount.upsert({
    where: { id: 'paper-main' },
    create: {
      id: 'paper-main',
      initialBalance,
      currentBalance: initialBalance,
      equity: initialBalance,
      highWaterMark: initialBalance,
      currency: 'USDT',
    },
    update: {},
  });
  console.log(`  ✓ Paper account ($${initialBalance.toLocaleString()})`);

  // --- Strategy definitions ---
  const strategies = [
    {
      name: 'ema_trend_follow',
      displayName: 'EMA Trend Following',
      description:
        'Multi-timeframe EMA crossover with ADX trend strength confirmation. ' +
        'Active in TRENDING regime.',
    },
    {
      name: 'rsi_momentum',
      displayName: 'RSI Momentum',
      description:
        'RSI divergence and momentum with MACD confirmation. ' +
        'Active in TRENDING and BREAKOUT regimes.',
    },
    {
      name: 'volatility_breakout',
      displayName: 'Volatility Breakout',
      description:
        'ATR-based breakout detection with volume confirmation. ' +
        'Active in BREAKOUT and HIGH_VOLATILITY regimes.',
    },
    {
      name: 'market_structure',
      displayName: 'Market Structure',
      description:
        'Higher highs / higher lows analysis with support and resistance retests. ' +
        'Active in TRENDING regime.',
    },
    {
      name: 'mean_reversion',
      displayName: 'Mean Reversion',
      description:
        'Range-bound mean reversion using Bollinger Bands and RSI extremes. ' +
        'Active in RANGING and LOW_VOLATILITY regimes ONLY.',
    },
  ];

  for (const s of strategies) {
    await prisma.strategy.upsert({
      where: { name: s.name },
      create: { ...s, isActive: true },
      update: { displayName: s.displayName, description: s.description },
    });
  }
  console.log(`  ✓ ${strategies.length} strategy definitions`);

  // --- Default symbols ---
  const symbols = [
    { symbol: 'BTCUSDT', baseAsset: 'BTC', quoteAsset: 'USDT' },
    { symbol: 'ETHUSDT', baseAsset: 'ETH', quoteAsset: 'USDT' },
  ];
  for (const sym of symbols) {
    await prisma.symbol.upsert({
      where: { symbol: sym.symbol },
      create: { ...sym, exchange: 'binance', isActive: true },
      update: { isActive: true },
    });
  }
  console.log(`  ✓ ${symbols.length} default symbols (BTCUSDT, ETHUSDT)`);

  // --- Initial system event ---
  await prisma.systemEvent.create({
    data: {
      type: 'WORKER_STARTED',
      level: 'info',
      message: 'Database seeded successfully — platform ready for Phase 3 setup.',
      data: { seededAt: new Date().toISOString() },
    },
  });
  console.log('  ✓ Initial system event');

  console.log('\n✅ Seed complete.');
  console.log('\nNext steps:');
  console.log('  1. Start the API:    pnpm --filter @trading/api dev');
  console.log('  2. Start the worker: pnpm --filter @trading/worker dev');
  console.log('  3. Start the web:    pnpm --filter @trading/web dev');
  console.log('  4. Visit http://localhost:3000');
}

void connectDatabase()
  .then(() => seed())
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => disconnectDatabase());
