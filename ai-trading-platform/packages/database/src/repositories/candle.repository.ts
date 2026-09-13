import type { MarketCandle } from '@prisma/client';
import { prisma } from '../client';
import type { Candle, Timeframe } from '@trading/types';

// =============================================================================
// CANDLE REPOSITORY
// =============================================================================

/**
 * Upsert a batch of candles.
 * Uses createMany with skipDuplicates for efficiency.
 */
export async function upsertCandles(candles: Candle[]): Promise<number> {
  if (candles.length === 0) return 0;

  const result = await prisma.marketCandle.createMany({
    data: candles.map((c) => ({
      symbol: c.symbol,
      timeframe: c.timeframe,
      openTime: c.openTime,
      closeTime: c.closeTime,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      isClosed: c.isClosed,
    })),
    skipDuplicates: true,
  });

  return result.count;
}

/**
 * Get the most recent N candles for a symbol and timeframe.
 * Returns in ascending order (oldest first) — ready for indicator calculation.
 */
export async function getRecentCandles(
  symbol: string,
  timeframe: Timeframe,
  limit = 200,
): Promise<MarketCandle[]> {
  // Fetch newest N, then reverse to get ascending order
  const candles = await prisma.marketCandle.findMany({
    where: { symbol, timeframe, isClosed: true },
    orderBy: { openTime: 'desc' },
    take: limit,
  });
  return candles.reverse();
}

/**
 * Get candles for a date range (used in backtesting).
 */
export async function getCandlesInRange(
  symbol: string,
  timeframe: Timeframe,
  from: Date,
  to: Date,
): Promise<MarketCandle[]> {
  return prisma.marketCandle.findMany({
    where: {
      symbol,
      timeframe,
      openTime: { gte: from, lte: to },
      isClosed: true,
    },
    orderBy: { openTime: 'asc' },
  });
}

/**
 * Get the timestamp of the most recent candle (to detect stale data).
 */
export async function getLatestCandleTime(
  symbol: string,
  timeframe: Timeframe,
): Promise<Date | null> {
  const candle = await prisma.marketCandle.findFirst({
    where: { symbol, timeframe, isClosed: true },
    orderBy: { openTime: 'desc' },
    select: { openTime: true },
  });
  return candle?.openTime ?? null;
}

/**
 * Ensure the symbol record exists (upsert).
 */
export async function ensureSymbol(
  symbol: string,
  baseAsset: string,
  quoteAsset: string,
  exchange: string,
): Promise<void> {
  await prisma.symbol.upsert({
    where: { symbol },
    create: { symbol, baseAsset, quoteAsset, exchange },
    update: { isActive: true },
  });
}

/**
 * Convert a DB MarketCandle to the shared Candle type.
 */
export function toCandle(c: MarketCandle): Candle {
  return {
    symbol: c.symbol,
    timeframe: c.timeframe as Timeframe,
    openTime: c.openTime,
    closeTime: c.closeTime,
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    isClosed: c.isClosed,
  };
}
