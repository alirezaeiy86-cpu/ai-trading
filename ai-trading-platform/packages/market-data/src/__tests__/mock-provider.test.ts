/**
 * Market Data Provider Tests
 * Tests MockProvider behaviour without any network calls.
 * Run: pnpm --filter @trading/market-data test
 */

import { MockProvider } from '../providers/mock.provider';
import type { Timeframe } from '@trading/types';

// Minimal pino-compatible logger stub
const logger = {
  info:  () => undefined,
  warn:  () => undefined,
  error: () => undefined,
  debug: () => undefined,
} as never;

describe('MockProvider', () => {
  let provider: MockProvider;

  beforeEach(async () => {
    provider = new MockProvider(logger);
    await provider.connect();
  });

  afterEach(async () => {
    await provider.disconnect();
  });

  // ── Basic connectivity ─────────────────────────────────────────────────────

  it('reports healthy after connect', () => {
    expect(provider.isHealthy()).toBe(true);
  });

  it('reports unhealthy after disconnect', async () => {
    await provider.disconnect();
    expect(provider.isHealthy()).toBe(false);
  });

  // ── Ticker ─────────────────────────────────────────────────────────────────

  it('returns a ticker for BTCUSDT', async () => {
    const ticker = await provider.getTicker('BTCUSDT');
    expect(ticker.symbol).toBe('BTCUSDT');
    expect(ticker.price).toBeGreaterThan(0);
    expect(ticker.bid).toBeGreaterThan(0);
    expect(ticker.ask).toBeGreaterThan(ticker.bid);
    expect(ticker.spread).toBeGreaterThanOrEqual(0);
    expect(ticker.timestamp).toBeInstanceOf(Date);
  });

  it('returns a ticker for ETHUSDT', async () => {
    const ticker = await provider.getTicker('ETHUSDT');
    expect(ticker.symbol).toBe('ETHUSDT');
    expect(ticker.price).toBeGreaterThan(0);
  });

  it('throws for unknown symbol', async () => {
    await expect(provider.getTicker('FAKEUSDT')).rejects.toThrow();
  });

  // ── Current price ──────────────────────────────────────────────────────────

  it('returns a positive current price', async () => {
    const price = await provider.getCurrentPrice('BTCUSDT');
    expect(price).toBeGreaterThan(0);
  });

  // ── Candles ────────────────────────────────────────────────────────────────

  it('returns the requested number of candles', async () => {
    const candles = await provider.getCandles('BTCUSDT', '1h', 50);
    expect(candles).toHaveLength(50);
  });

  it('candles have correct structure', async () => {
    const [candle] = await provider.getCandles('BTCUSDT', '1h', 1);
    expect(candle).toBeDefined();
    expect(candle!.symbol).toBe('BTCUSDT');
    expect(candle!.timeframe).toBe('1h');
    expect(candle!.open).toBeGreaterThan(0);
    expect(candle!.high).toBeGreaterThanOrEqual(candle!.open);
    expect(candle!.low).toBeLessThanOrEqual(candle!.open);
    expect(candle!.close).toBeGreaterThan(0);
    expect(candle!.volume).toBeGreaterThan(0);
    expect(candle!.openTime).toBeInstanceOf(Date);
    expect(candle!.closeTime).toBeInstanceOf(Date);
    expect(candle!.isClosed).toBe(true);
  });

  it('candles are in ascending order (oldest first)', async () => {
    const candles = await provider.getCandles('BTCUSDT', '1h', 10);
    for (let i = 1; i < candles.length; i++) {
      expect(candles[i]!.openTime.getTime()).toBeGreaterThan(candles[i-1]!.openTime.getTime());
    }
  });

  it('high >= open, close and low <= open, close', async () => {
    const candles = await provider.getCandles('BTCUSDT', '1h', 20);
    for (const c of candles) {
      expect(c.high).toBeGreaterThanOrEqual(c.open);
      expect(c.high).toBeGreaterThanOrEqual(c.close);
      expect(c.low).toBeLessThanOrEqual(c.open);
      expect(c.low).toBeLessThanOrEqual(c.close);
    }
  });

  const timeframes: Timeframe[] = ['1m', '5m', '15m', '1h', '4h', '1d'];
  it.each(timeframes)('supports timeframe %s', async (tf) => {
    const candles = await provider.getCandles('BTCUSDT', tf, 5);
    expect(candles).toHaveLength(5);
    expect(candles[0]!.timeframe).toBe(tf);
  });

  // ── Symbol info ────────────────────────────────────────────────────────────

  it('returns symbol info', async () => {
    const info = await provider.getSymbolInfo('BTCUSDT');
    expect(info.symbol).toBe('BTCUSDT');
    expect(info.baseAsset).toBe('BTC');
    expect(info.quoteAsset).toBe('USDT');
    expect(info.minOrderSize).toBeGreaterThanOrEqual(0);
    expect(info.tickSize).toBeGreaterThan(0);
    expect(info.stepSize).toBeGreaterThan(0);
    expect(info.minNotional).toBeGreaterThan(0);
  });

  // ── Live subscription ──────────────────────────────────────────────────────

  it('emits candles via subscription and unsubscribe works', async () => {
    const received: unknown[] = [];
    const errors:   Error[]   = [];

    const unsub = provider.subscribeToCandles(
      'BTCUSDT',
      '1m',
      (c) => received.push(c),
      (e) => errors.push(e),
    );

    // Wait for at least one candle (mock emits every 5s, so use fake timers)
    await new Promise<void>((resolve) => setTimeout(resolve, 6_000));

    expect(received.length).toBeGreaterThan(0);
    expect(errors).toHaveLength(0);

    unsub(); // must not throw

    const countBefore = received.length;
    await new Promise<void>((resolve) => setTimeout(resolve, 6_000));
    // No new candles after unsubscribe
    expect(received.length).toBe(countBefore);
  }, 20_000);
});
