// =============================================================================
// TECHNICAL INDICATORS
// Pure functions — no side effects, no external dependencies.
// All inputs: number[] in ascending order (oldest → newest).
// All outputs: number | number[] — NaN signals insufficient data.
//
// Design rules:
//   • Never mutate input arrays
//   • Return NaN when insufficient data (not 0, not null)
//   • Tested with known reference values
// =============================================================================

// ── Simple Moving Average ─────────────────────────────────────────────────────

export function sma(values: number[], period: number): number {
  if (values.length < period) return NaN;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

/** Returns the full SMA series (NaN for positions without enough data) */
export function smaArray(values: number[], period: number): number[] {
  return values.map((_, i) => {
    if (i + 1 < period) return NaN;
    return sma(values.slice(0, i + 1), period);
  });
}

// ── Exponential Moving Average ────────────────────────────────────────────────

export function ema(values: number[], period: number): number {
  const series = emaArray(values, period);
  return series.at(-1) ?? NaN;
}

export function emaArray(values: number[], period: number): number[] {
  if (values.length < period) return values.map(() => NaN);

  const k = 2 / (period + 1);
  const result: number[] = new Array(values.length).fill(NaN) as number[];

  // Seed: SMA of first `period` values
  let prevEma = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = prevEma;

  for (let i = period; i < values.length; i++) {
    prevEma = (values[i]! - prevEma) * k + prevEma;
    result[i] = prevEma;
  }
  return result;
}

// ── RSI — Relative Strength Index ─────────────────────────────────────────────

export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return NaN;

  const changes = closes.slice(1).map((c, i) => c - closes[i]!);
  const gains   = changes.map((c) => (c > 0 ? c : 0));
  const losses  = changes.map((c) => (c < 0 ? Math.abs(c) : 0));

  // Initial averages (SMA seed)
  let avgGain = gains.slice(0, period).reduce((a, b) => a + b, 0) / period;
  let avgLoss = losses.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Wilder smoothing for remaining periods
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export function rsiArray(closes: number[], period = 14): number[] {
  return closes.map((_, i) => {
    if (i + 1 <= period) return NaN;
    return rsi(closes.slice(0, i + 1), period);
  });
}

// ── MACD ──────────────────────────────────────────────────────────────────────

export interface MACDResult {
  macd:   number;
  signal: number;
  hist:   number;
}

export function macd(
  closes: number[],
  fastPeriod  = 12,
  slowPeriod  = 26,
  signalPeriod = 9,
): MACDResult {
  if (closes.length < slowPeriod + signalPeriod - 1) {
    return { macd: NaN, signal: NaN, hist: NaN };
  }

  const fastEma  = emaArray(closes, fastPeriod);
  const slowEma  = emaArray(closes, slowPeriod);
  const macdLine = fastEma.map((f, i) => f - slowEma[i]!);

  // Signal = EMA of MACD line (only valid where MACD is valid)
  const validMacd = macdLine.filter((v) => !isNaN(v));
  const signalEma = emaArray(validMacd, signalPeriod);

  const lastMacd   = macdLine.at(-1) ?? NaN;
  const lastSignal = signalEma.at(-1) ?? NaN;
  const lastHist   = isNaN(lastMacd) || isNaN(lastSignal)
    ? NaN
    : lastMacd - lastSignal;

  return { macd: lastMacd, signal: lastSignal, hist: lastHist };
}

// ── ATR — Average True Range ──────────────────────────────────────────────────

export function atr(
  highs:  number[],
  lows:   number[],
  closes: number[],
  period = 14,
): number {
  if (highs.length < period + 1) return NaN;

  const trueRanges: number[] = [];
  for (let i = 1; i < highs.length; i++) {
    const hl  = highs[i]! - lows[i]!;
    const hpc = Math.abs(highs[i]! - closes[i - 1]!);
    const lpc = Math.abs(lows[i]! - closes[i - 1]!);
    trueRanges.push(Math.max(hl, hpc, lpc));
  }

  // Wilder smoothing
  let atrVal = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atrVal = (atrVal * (period - 1) + trueRanges[i]!) / period;
  }
  return atrVal;
}

export function atrArray(
  highs:  number[],
  lows:   number[],
  closes: number[],
  period = 14,
): number[] {
  return closes.map((_, i) => {
    if (i < period) return NaN;
    return atr(highs.slice(0, i + 1), lows.slice(0, i + 1), closes.slice(0, i + 1), period);
  });
}

// ── ADX — Average Directional Index ──────────────────────────────────────────

export interface ADXResult {
  adx:  number;
  plusDI:  number;
  minusDI: number;
}

export function adx(
  highs:  number[],
  lows:   number[],
  closes: number[],
  period = 14,
): ADXResult {
  const empty = { adx: NaN, plusDI: NaN, minusDI: NaN };
  if (highs.length < period * 2) return empty;

  const trueRanges: number[] = [];
  const plusDMs:    number[] = [];
  const minusDMs:   number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove   = highs[i]!   - highs[i - 1]!;
    const downMove = lows[i - 1]! - lows[i]!;
    plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const hl  = highs[i]! - lows[i]!;
    const hpc = Math.abs(highs[i]! - closes[i - 1]!);
    const lpc = Math.abs(lows[i]! - closes[i - 1]!);
    trueRanges.push(Math.max(hl, hpc, lpc));
  }

  // Wilder smoothing
  const smooth = (arr: number[]): number[] => {
    const out: number[] = [];
    let val = arr.slice(0, period).reduce((a, b) => a + b, 0);
    out.push(val);
    for (let i = period; i < arr.length; i++) {
      val = val - val / period + arr[i]!;
      out.push(val);
    }
    return out;
  };

  const smTR     = smooth(trueRanges);
  const smPlus   = smooth(plusDMs);
  const smMinus  = smooth(minusDMs);

  const plusDIArr  = smPlus.map( (v, i) => (smTR[i]! > 0 ? (v / smTR[i]!) * 100 : 0));
  const minusDIArr = smMinus.map((v, i) => (smTR[i]! > 0 ? (v / smTR[i]!) * 100 : 0));
  const dxArr = plusDIArr.map((p, i) => {
    const sum = p + minusDIArr[i]!;
    return sum === 0 ? 0 : (Math.abs(p - minusDIArr[i]!) / sum) * 100;
  });

  // ADX = SMA of DX
  const adxVal = dxArr.slice(-period).reduce((a, b) => a + b, 0) / period;

  return {
    adx:     adxVal,
    plusDI:  plusDIArr.at(-1)  ?? NaN,
    minusDI: minusDIArr.at(-1) ?? NaN,
  };
}

// ── Bollinger Bands ───────────────────────────────────────────────────────────

export interface BollingerResult {
  upper:  number;
  middle: number;
  lower:  number;
  width:  number; // (upper - lower) / middle — useful for squeeze detection
  pct:    number; // (close - lower) / (upper - lower) — 0=at lower, 1=at upper
}

export function bollingerBands(
  closes: number[],
  period = 20,
  stdDev = 2,
): BollingerResult {
  const empty = { upper: NaN, middle: NaN, lower: NaN, width: NaN, pct: NaN };
  if (closes.length < period) return empty;

  const slice  = closes.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;
  const variance = slice.reduce((a, b) => a + (b - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);

  const upper = middle + stdDev * sd;
  const lower = middle - stdDev * sd;
  const last  = closes.at(-1)!;

  return {
    upper,
    middle,
    lower,
    width: (upper - lower) / middle,
    pct:   upper === lower ? 0.5 : (last - lower) / (upper - lower),
  };
}

// ── Stochastic Oscillator ─────────────────────────────────────────────────────

export interface StochasticResult {
  k: number;
  d: number;
}

export function stochastic(
  highs:  number[],
  lows:   number[],
  closes: number[],
  kPeriod = 14,
  dPeriod =  3,
): StochasticResult {
  if (closes.length < kPeriod + dPeriod - 1) return { k: NaN, d: NaN };

  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const highSlice = highs.slice(i - kPeriod + 1, i + 1);
    const lowSlice  = lows.slice( i - kPeriod + 1, i + 1);
    const highest   = Math.max(...highSlice);
    const lowest    = Math.min(...lowSlice);
    const range     = highest - lowest;
    kValues.push(range === 0 ? 50 : ((closes[i]! - lowest) / range) * 100);
  }

  const k = kValues.at(-1) ?? NaN;
  const d = kValues.length >= dPeriod
    ? kValues.slice(-dPeriod).reduce((a, b) => a + b, 0) / dPeriod
    : NaN;

  return { k, d };
}

// ── Pivot Points (Classic) ────────────────────────────────────────────────────

export interface PivotResult {
  pivot: number;
  r1: number; r2: number; r3: number;
  s1: number; s2: number; s3: number;
}

export function pivotPoints(
  prevHigh:  number,
  prevLow:   number,
  prevClose: number,
): PivotResult {
  const pivot = (prevHigh + prevLow + prevClose) / 3;
  return {
    pivot,
    r1: 2 * pivot - prevLow,
    r2: pivot + (prevHigh - prevLow),
    r3: prevHigh + 2 * (pivot - prevLow),
    s1: 2 * pivot - prevHigh,
    s2: pivot - (prevHigh - prevLow),
    s3: prevLow  - 2 * (prevHigh - pivot),
  };
}

// ── Highest / Lowest (swing detection) ────────────────────────────────────────

export function highest(values: number[], period: number): number {
  if (values.length < period) return NaN;
  return Math.max(...values.slice(-period));
}

export function lowest(values: number[], period: number): number {
  if (values.length < period) return NaN;
  return Math.min(...values.slice(-period));
}

// ── Volume SMA ────────────────────────────────────────────────────────────────

/** Returns true if current volume is above its N-period average by a factor */
export function isVolumeSpike(volumes: number[], period = 20, factor = 1.5): boolean {
  if (volumes.length < period + 1) return false;
  const avgVol = sma(volumes.slice(0, -1), period);
  return volumes.at(-1)! > avgVol * factor;
}

// ── Trend helpers ─────────────────────────────────────────────────────────────

/** Returns 1 (up), -1 (down), 0 (flat) based on EMA slope over N bars */
export function emaSlope(closes: number[], period: number, lookback = 3): number {
  const series = emaArray(closes, period);
  const current = series.at(-1);
  const past    = series.at(-1 - lookback);
  if (current === undefined || past === undefined || isNaN(current) || isNaN(past)) return 0;
  const pct = (current - past) / past;
  if (pct > 0.001)  return  1;
  if (pct < -0.001) return -1;
  return 0;
}
