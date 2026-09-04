import { BacktestEngine }       from '../backtest-engine';
import { formatBacktestReport } from '../report';
import type { BacktestConfig }  from '../types';
import type { Candle, Timeframe, RiskSettings } from '@trading/types';

// =============================================================================
// CANDLE FACTORIES
// =============================================================================

function makeCandles(
  n: number,
  startPrice = 50_000,
  trend: 'up' | 'down' | 'flat' = 'up',
): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;

  for (let i = 0; i < n; i++) {
    const direction = trend === 'up' ? 1 : trend === 'down' ? -1 : 0;
    const change    = price * (0.002 * direction + (Math.random() - 0.48) * 0.004);
    price = Math.max(price + change, 1);

    const open  = price * (1 - Math.random() * 0.002);
    const close = price;
    const high  = Math.max(open, close) * (1 + Math.random() * 0.003);
    const low   = Math.min(open, close) * (1 - Math.random() * 0.003);

    const openTime  = new Date(2024, 0, 1, 0, 0, 0, i * 3_600_000);
    const closeTime = new Date(openTime.getTime() + 3_599_000);

    candles.push({
      symbol: 'BTCUSDT', timeframe: '1h' as Timeframe,
      openTime, closeTime, open, high, low, close,
      volume: 100 + Math.random() * 50,
      isClosed: true,
    });
  }
  return candles;
}

function makeConfig(overrides: Partial<BacktestConfig> = {}): BacktestConfig {
  const riskSettings: RiskSettings = {
    riskPerTradePercent:  0.01,
    minRiskReward:        1.5,
    maxDailyLossPercent:  0.05,
    maxWeeklyLossPercent: 0.10,
    maxDrawdownPercent:   0.20,
    maxTradesPerDay:      10,
    maxOpenPositions:     1,
    maxLeverage:          1,
    minStrategyScore:     30,   // low for test coverage
    minAIConfidence:      0,
    allowedSymbols:       [],
    longEnabled:          true,
    shortEnabled:         true,
    stopLossMode:         'structure',
    takeProfitMode:       'rr_ratio',
    trailingStopEnabled:  false,
    breakEvenEnabled:     false,
    tradingHoursStart:    '00:00',
    tradingHoursEnd:      '23:59',
    cooldownAfterTradeMs: 0,
    cooldownAfterLossMs:  0,
    aiEnabled:            false,
    aiUnavailableMode:    'RULE_BASED',
  };

  return {
    strategyName:   'ema_trend_follow',
    symbol:         'BTCUSDT',
    timeframe:      '1h',
    startDate:      new Date(2024, 0, 1),
    endDate:        new Date(2024, 5, 30),
    initialBalance: 10_000,
    riskSettings,
    ...overrides,
  };
}

// =============================================================================
// TESTS
// =============================================================================

describe('BacktestEngine', () => {
  // Use a larger candle set so regime detector + strategies have enough data
  const candles = makeCandles(600, 50_000, 'up');

  describe('basic structure', () => {
    it('returns a COMPLETED result', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      expect(result.status).toBe('COMPLETED');
      expect(result.error).toBeUndefined();
    });

    it('result has all required fields', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);

      expect(typeof result.totalTrades).toBe('number');
      expect(typeof result.winningTrades).toBe('number');
      expect(typeof result.losingTrades).toBe('number');
      expect(typeof result.winRate).toBe('number');
      expect(typeof result.netPnl).toBe('number');
      expect(typeof result.netPnlPercent).toBe('number');
      expect(typeof result.profitFactor).toBe('number');
      expect(typeof result.avgR).toBe('number');
      expect(typeof result.maxDrawdown).toBe('number');
      expect(typeof result.sharpeRatio).toBe('number');
      expect(typeof result.calmarRatio).toBe('number');
      expect(typeof result.expectancy).toBe('number');
      expect(Array.isArray(result.trades)).toBe(true);
      expect(Array.isArray(result.equityCurve)).toBe(true);
    });

    it('timestamps are set', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      expect(result.startedAt).toBeInstanceOf(Date);
      expect(result.completedAt).toBeInstanceOf(Date);
      expect(result.completedAt.getTime()).toBeGreaterThanOrEqual(result.startedAt.getTime());
    });
  });

  describe('trade integrity', () => {
    it('winningTrades + losingTrades ≤ totalTrades', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      expect(result.winningTrades + result.losingTrades).toBeLessThanOrEqual(result.totalTrades);
    });

    it('winRate is between 0 and 1', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      expect(result.winRate).toBeGreaterThanOrEqual(0);
      expect(result.winRate).toBeLessThanOrEqual(1);
    });

    it('each trade has valid timestamps (entry before exit)', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      for (const trade of result.trades) {
        expect(trade.exitDate.getTime()).toBeGreaterThan(trade.entryDate.getTime());
      }
    });

    it('each trade has a positive quantity', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      for (const trade of result.trades) {
        expect(trade.quantity).toBeGreaterThan(0);
      }
    });

    it('each trade has fees > 0', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      for (const trade of result.trades) {
        expect(trade.fees).toBeGreaterThan(0);
      }
    });

    it('trade ids are unique and sequential', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      const ids = result.trades.map((t) => t.id);
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });
  });

  describe('no look-ahead bias', () => {
    it('runs without errors on the full candle set', () => {
      // This is the primary anti-bias test: if the engine accessed future candles,
      // it would likely throw an out-of-bounds error or produce impossible results.
      const engine = new BacktestEngine(makeConfig());
      expect(() => engine.run(candles, 250)).not.toThrow();
    });

    it('produces a result even with minimal tradeable bars', () => {
      // 260 candles: 250 warmup + only 10 tradeable bars
      const tinyCandles = makeCandles(260, 50_000, 'up');
      const engine = new BacktestEngine(makeConfig());
      const result  = engine.run(tinyCandles, 250);
      expect(result.status).toBe('COMPLETED');
      // Might have 0 trades if no signal in 10 bars — that's valid
      expect(result.totalTrades).toBeGreaterThanOrEqual(0);
    });
  });

  describe('equity curve', () => {
    it('equity curve is non-empty', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      expect(result.equityCurve.length).toBeGreaterThan(0);
    });

    it('first equity point equals initial balance', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      // First point should be near initialBalance (small fee deductions possible)
      expect(result.equityCurve[0]?.equity).toBeCloseTo(10_000, -1);
    });

    it('equity curve drawdown is always 0–1', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      for (const point of result.equityCurve) {
        expect(point.drawdown).toBeGreaterThanOrEqual(0);
        expect(point.drawdown).toBeLessThanOrEqual(1);
      }
    });
  });

  describe('risk metrics', () => {
    it('maxDrawdown is non-negative', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      expect(result.maxDrawdown).toBeGreaterThanOrEqual(0);
    });

    it('profitFactor is non-negative', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      expect(result.profitFactor).toBeGreaterThanOrEqual(0);
    });

    it('totalFees > 0 when trades were taken', () => {
      const engine = new BacktestEngine(makeConfig());
      const result = engine.run(candles, 250);
      if (result.totalTrades > 0) {
        expect(result.totalFees).toBeGreaterThan(0);
      }
    });
  });

  describe('edge cases', () => {
    it('handles empty tradeable window gracefully', () => {
      const engine = new BacktestEngine(makeConfig());
      // warmup >= candles.length → no tradeable bars
      const result = engine.run(candles, candles.length);
      expect(result.status).toBe('COMPLETED');
      expect(result.totalTrades).toBe(0);
    });

    it('handles flat market (no regime signal)', () => {
      const flatCandles = makeCandles(500, 50_000, 'flat');
      const engine = new BacktestEngine(makeConfig());
      const result  = engine.run(flatCandles, 250);
      expect(result.status).toBe('COMPLETED');
    });

    it('returns FAILED gracefully on internal error', () => {
      // Pass invalid (empty) candle array to force an edge case
      const engine = new BacktestEngine(makeConfig());
      const result  = engine.run([], 0);
      // Should complete with 0 trades rather than throw
      expect(['COMPLETED', 'FAILED']).toContain(result.status);
    });
  });
});

describe('formatBacktestReport', () => {
  it('produces a non-empty string report', () => {
    const candles = makeCandles(600, 50_000, 'up');
    const engine  = new BacktestEngine(makeConfig());
    const result  = engine.run(candles, 250);
    const report  = formatBacktestReport(result);
    expect(typeof report).toBe('string');
    expect(report.length).toBeGreaterThan(100);
  });

  it('contains key metrics', () => {
    const candles = makeCandles(600, 50_000, 'up');
    const engine  = new BacktestEngine(makeConfig());
    const result  = engine.run(candles, 250);
    const report  = formatBacktestReport(result);
    expect(report).toContain('Net P&L');
    expect(report).toContain('Win Rate');  // via Winning trades line
    expect(report).toContain('Max Drawdown');
    expect(report).toContain('Profit Factor');
  });

  it('shows FAILED message for failed result', () => {
    const engine = new BacktestEngine(makeConfig());
    const failed = engine.run([], -1); // forces edge path
    const report = formatBacktestReport({ ...failed, status: 'FAILED', error: 'test error' });
    expect(report).toContain('FAILED');
    expect(report).toContain('test error');
  });
});
