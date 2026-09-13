import {
  sma, ema, rsi, macd, atr, adx,
  bollingerBands, stochastic, highest, lowest,
  isVolumeSpike, emaSlope,
} from '../indicators';

// Known price series for reference testing
const prices = [
  44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.15,
  43.61, 44.33, 44.83, 45.10, 45.15, 45.98, 45.77, 45.50,
  46.57, 47.81, 47.20, 46.57, 47.81, 47.20, 46.57, 47.81,
  47.20, 46.57, 47.81, 47.20, 46.57, 47.81,
];

describe('SMA', () => {
  it('returns NaN with insufficient data', () => {
    expect(sma([1, 2], 5)).toBeNaN();
  });

  it('computes correctly', () => {
    expect(sma([1, 2, 3, 4, 5], 5)).toBeCloseTo(3.0);
    expect(sma([10, 20, 30], 2)).toBeCloseTo(25.0);
  });

  it('does not mutate input', () => {
    const arr = [1, 2, 3, 4, 5];
    const copy = [...arr];
    sma(arr, 3);
    expect(arr).toEqual(copy);
  });
});

describe('EMA', () => {
  it('returns NaN with insufficient data', () => {
    expect(ema([1, 2], 5)).toBeNaN();
  });

  it('computes a reasonable EMA', () => {
    const val = ema(prices, 5);
    expect(val).toBeGreaterThan(0);
    expect(val).not.toBeNaN();
  });

  it('emaArray length matches input', () => {
    const arr = emaArray_wrapper(prices, 5);
    expect(arr.length).toBe(prices.length);
  });

  it('first period-1 values are NaN', () => {
    const { emaArray } = require('../indicators') as typeof import('../indicators');
    const arr = emaArray(prices, 5);
    for (let i = 0; i < 4; i++) expect(arr[i]).toBeNaN();
    expect(arr[4]).not.toBeNaN();
  });
});

function emaArray_wrapper(values: number[], period: number): number[] {
  const { emaArray } = require('../indicators') as typeof import('../indicators');
  return emaArray(values, period);
}

describe('RSI', () => {
  it('returns NaN with insufficient data', () => {
    expect(rsi([1, 2, 3], 14)).toBeNaN();
  });

  it('stays between 0 and 100', () => {
    const val = rsi(prices, 14);
    expect(val).toBeGreaterThanOrEqual(0);
    expect(val).toBeLessThanOrEqual(100);
  });

  it('returns 100 when all changes are gains', () => {
    const rising = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(rsi(rising, 14)).toBeCloseTo(100);
  });

  it('returns near 0 when all changes are losses', () => {
    const falling = Array.from({ length: 20 }, (_, i) => 20 - i);
    expect(rsi(falling, 14)).toBeLessThan(10);
  });
});

describe('MACD', () => {
  it('returns NaN with insufficient data', () => {
    const result = macd([1, 2, 3], 12, 26, 9);
    expect(result.macd).toBeNaN();
    expect(result.signal).toBeNaN();
    expect(result.hist).toBeNaN();
  });

  it('computes without errors on sufficient data', () => {
    const longSeries = Array.from({ length: 50 }, (_, i) => 100 + Math.sin(i * 0.3) * 5);
    const result = macd(longSeries, 12, 26, 9);
    expect(result.macd).not.toBeNaN();
    expect(result.signal).not.toBeNaN();
    expect(result.hist).toBeCloseTo(result.macd - result.signal);
  });
});

describe('ATR', () => {
  const highs  = prices.map((p) => p * 1.01);
  const lows   = prices.map((p) => p * 0.99);

  it('returns NaN with insufficient data', () => {
    expect(atr([1], [1], [1], 14)).toBeNaN();
  });

  it('computes a positive ATR', () => {
    const val = atr(highs, lows, prices, 14);
    expect(val).toBeGreaterThan(0);
    expect(val).not.toBeNaN();
  });

  it('ATR increases with wider ranges', () => {
    const narrowHighs = prices.map((p) => p * 1.001);
    const narrowLows  = prices.map((p) => p * 0.999);
    const wide   = atr(highs,        lows,        prices, 14);
    const narrow = atr(narrowHighs,  narrowLows,  prices, 14);
    expect(wide).toBeGreaterThan(narrow);
  });
});

describe('ADX', () => {
  const highs  = prices.map((p) => p * 1.01);
  const lows   = prices.map((p) => p * 0.99);

  it('returns NaN with insufficient data', () => {
    const result = adx([1, 2], [1, 2], [1, 2], 14);
    expect(result.adx).toBeNaN();
  });

  it('returns ADX in 0–100 range', () => {
    const result = adx(highs, lows, prices, 14);
    if (!isNaN(result.adx)) {
      expect(result.adx).toBeGreaterThanOrEqual(0);
      expect(result.adx).toBeLessThanOrEqual(100);
    }
  });
});

describe('Bollinger Bands', () => {
  it('returns NaN with insufficient data', () => {
    const result = bollingerBands([1, 2, 3], 20);
    expect(result.upper).toBeNaN();
  });

  it('upper > middle > lower', () => {
    const result = bollingerBands(prices, 20);
    expect(result.upper).toBeGreaterThan(result.middle);
    expect(result.middle).toBeGreaterThan(result.lower);
  });

  it('pct is 0–1 when price is within bands', () => {
    const result = bollingerBands(prices, 20);
    // price is within bands for our test series
    expect(result.pct).toBeGreaterThanOrEqual(0);
    expect(result.pct).toBeLessThanOrEqual(1);
  });

  it('width > 0 for a series with variance', () => {
    const result = bollingerBands(prices, 20);
    expect(result.width).toBeGreaterThan(0);
  });
});

describe('Stochastic', () => {
  const highs  = prices.map((p) => p * 1.01);
  const lows   = prices.map((p) => p * 0.99);

  it('returns NaN with insufficient data', () => {
    const result = stochastic([1, 2], [1, 2], [1, 2]);
    expect(result.k).toBeNaN();
  });

  it('K and D are in 0–100 range', () => {
    const result = stochastic(highs, lows, prices);
    expect(result.k).toBeGreaterThanOrEqual(0);
    expect(result.k).toBeLessThanOrEqual(100);
    expect(result.d).toBeGreaterThanOrEqual(0);
    expect(result.d).toBeLessThanOrEqual(100);
  });
});

describe('Utility functions', () => {
  it('highest returns max of last N values', () => {
    expect(highest([1, 9, 3, 7, 5], 3)).toBe(7);
    expect(highest([1, 2], 5)).toBeNaN();
  });

  it('lowest returns min of last N values', () => {
    expect(lowest([5, 1, 8, 2, 4], 3)).toBe(2);
    expect(lowest([1, 2], 5)).toBeNaN();
  });

  it('isVolumeSpike returns true when volume is above average * factor', () => {
    const vols = [100, 100, 100, 100, 100, 100, 100, 100,
                  100, 100, 100, 100, 100, 100, 100, 100,
                  100, 100, 100, 100, 300]; // spike
    expect(isVolumeSpike(vols, 20, 1.5)).toBe(true);
  });

  it('isVolumeSpike returns false for normal volume', () => {
    const vols = new Array(21).fill(100) as number[];
    expect(isVolumeSpike(vols, 20, 1.5)).toBe(false);
  });

  it('emaSlope returns 1 for rising, -1 for falling', () => {
    const rising  = Array.from({ length: 30 }, (_, i) => 100 + i);
    const falling = Array.from({ length: 30 }, (_, i) => 200 - i);
    expect(emaSlope(rising,  10, 3)).toBe(1);
    expect(emaSlope(falling, 10, 3)).toBe(-1);
  });
});
