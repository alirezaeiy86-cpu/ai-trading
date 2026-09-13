import { StrategyEngine } from '../strategy-engine';
import { EmaTrendStrategy }           from '../strategies/ema-trend.strategy';
import { RsiMomentumStrategy }        from '../strategies/rsi-momentum.strategy';
import { MeanReversionStrategy }      from '../strategies/mean-reversion.strategy';
import { VolatilityBreakoutStrategy } from '../strategies/volatility-breakout.strategy';
import type { Candle, Timeframe } from '@trading/types';

// ── Candle factories ──────────────────────────────────────────────────────────

function makeTrendingCandles(n: number, startPrice = 100, stepPct = 0.003): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;
  for (let i = 0; i < n; i++) {
    price = price * (1 + stepPct + (Math.random() - 0.4) * 0.001);
    const open  = price * (1 - 0.001);
    const close = price;
    const high  = Math.max(open, close) * (1 + Math.random() * 0.002);
    const low   = Math.min(open, close) * (1 - Math.random() * 0.002);
    candles.push(makeCandle(i, open, high, low, close));
  }
  return candles;
}

function makeRangingCandles(n: number, midPrice = 100, rangePct = 0.01): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const close = midPrice + (Math.random() - 0.5) * 2 * midPrice * rangePct;
    const open  = midPrice + (Math.random() - 0.5) * 2 * midPrice * rangePct;
    const high  = Math.max(open, close) * (1 + Math.random() * 0.001);
    const low   = Math.min(open, close) * (1 - Math.random() * 0.001);
    candles.push(makeCandle(i, open, high, low, close));
  }
  return candles;
}

function makeCandle(i: number, open: number, high: number, low: number, close: number): Candle {
  const openTime  = new Date(Date.now() - (300 - i) * 3_600_000);
  const closeTime = new Date(openTime.getTime() + 3_600_000 - 1);
  return {
    symbol: 'BTCUSDT', timeframe: '1h' as Timeframe,
    openTime, closeTime, open, high, low, close,
    volume: 100 + Math.random() * 50, isClosed: true,
  };
}

// ── StrategyEngine ────────────────────────────────────────────────────────────

describe('StrategyEngine', () => {
  const engine = new StrategyEngine({ minScore: 40, minRiskReward: 1.5 });

  it('lists registered strategies', () => {
    const list = engine.getStrategies();
    expect(list.length).toBe(5);
    expect(list.map((s) => s.name)).toContain('ema_trend_follow');
    expect(list.map((s) => s.name)).toContain('mean_reversion');
  });

  it('returns a result even with insufficient data', () => {
    const candles = makeTrendingCandles(10);
    const result = engine.evaluate('BTCUSDT', '1h', candles);
    expect(result.regime).toBe('UNCERTAIN');
    expect(result.bestSignal).toBeNull();
  });

  it('evaluates trending market without throwing', () => {
    const candles = makeTrendingCandles(250);
    const result  = engine.evaluate('BTCUSDT', '1h', candles);
    expect(result.symbol).toBe('BTCUSDT');
    expect(result.timeframe).toBe('1h');
    expect(typeof result.regime).toBe('string');
    expect(result.evaluated).toBeGreaterThanOrEqual(0);
  });

  it('result structure is complete', () => {
    const candles = makeTrendingCandles(250);
    const result  = engine.evaluate('BTCUSDT', '1h', candles);
    expect(result).toHaveProperty('regime');
    expect(result).toHaveProperty('regimeConf');
    expect(result).toHaveProperty('signals');
    expect(result).toHaveProperty('bestSignal');
    expect(result).toHaveProperty('evaluated');
    expect(result).toHaveProperty('passed');
    expect(result).toHaveProperty('rejected');
    expect(Array.isArray(result.signals)).toBe(true);
    expect(Array.isArray(result.reasons)).toBe(true);
  });

  it('all signals meet minScore and minRiskReward', () => {
    const candles = makeTrendingCandles(250);
    const result  = engine.evaluate('BTCUSDT', '1h', candles);
    for (const sig of result.signals) {
      expect(sig.score).toBeGreaterThanOrEqual(40);
      expect(sig.riskReward).toBeGreaterThanOrEqual(1.5);
    }
  });

  it('bestSignal is the highest scorer', () => {
    const candles = makeTrendingCandles(250);
    const result  = engine.evaluate('BTCUSDT', '1h', candles);
    if (result.bestSignal && result.signals.length > 1) {
      const maxScore = Math.max(...result.signals.map((s) => s.score));
      expect(result.bestSignal.score).toBeCloseTo(maxScore, 0);
    }
  });
});

// ── Individual strategies ─────────────────────────────────────────────────────

describe('EmaTrendStrategy', () => {
  const strategy = new EmaTrendStrategy();

  it('returns isValid=false with insufficient data', () => {
    const result = strategy.evaluate({
      symbol: 'BTCUSDT', timeframe: '1h',
      candles: makeTrendingCandles(50),
      regime: 'TRENDING_UP',
    });
    expect(result.isValid).toBe(false);
  });

  it('rejects wrong regime', () => {
    const result = strategy.evaluate({
      symbol: 'BTCUSDT', timeframe: '1h',
      candles: makeTrendingCandles(250),
      regime: 'RANGING',
    });
    expect(result.isValid).toBe(false);
    expect(result.direction).toBe('NEUTRAL');
  });

  it('stop loss and take profit are on correct sides of entry', () => {
    const candles = makeTrendingCandles(250);
    const result  = strategy.evaluate({
      symbol: 'BTCUSDT', timeframe: '1h', candles, regime: 'TRENDING_UP',
    });
    if (result.isValid && result.direction === 'LONG') {
      const entry = (result.entryZone.min + result.entryZone.max) / 2;
      expect(result.stopLoss).toBeLessThan(entry);
      expect(result.takeProfit).toBeGreaterThan(entry);
    }
  });
});

describe('MeanReversionStrategy', () => {
  const strategy = new MeanReversionStrategy();

  it('rejects trending market', () => {
    const result = strategy.evaluate({
      symbol: 'BTCUSDT', timeframe: '1h',
      candles: makeTrendingCandles(250),
      regime: 'TRENDING_UP',
    });
    expect(result.isValid).toBe(false);
  });

  it('accepts RANGING regime', () => {
    const result = strategy.evaluate({
      symbol: 'BTCUSDT', timeframe: '1h',
      candles: makeRangingCandles(150),
      regime: 'RANGING',
    });
    // May or may not produce a valid signal depending on BB position
    expect(result.direction).toBeDefined();
    expect(typeof result.score).toBe('number');
  });
});

describe('RsiMomentumStrategy', () => {
  const strategy = new RsiMomentumStrategy();

  it('returns isValid=false with insufficient data', () => {
    const result = strategy.evaluate({
      symbol: 'BTCUSDT', timeframe: '1h',
      candles: makeTrendingCandles(20),
      regime: 'TRENDING_UP',
    });
    expect(result.isValid).toBe(false);
  });

  it('score is 0–100', () => {
    const candles = makeTrendingCandles(150);
    const result  = strategy.evaluate({
      symbol: 'BTCUSDT', timeframe: '1h', candles, regime: 'TRENDING_UP',
    });
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(100);
  });
});

describe('VolatilityBreakoutStrategy', () => {
  const strategy = new VolatilityBreakoutStrategy();

  it('rejects non-breakout regime', () => {
    const result = strategy.evaluate({
      symbol: 'BTCUSDT', timeframe: '1h',
      candles: makeRangingCandles(150),
      regime: 'RANGING',
    });
    expect(result.isValid).toBe(false);
  });
});
