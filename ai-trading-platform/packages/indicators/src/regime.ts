import type { Candle, MarketRegime } from '@trading/types';
import { ema, adx, atr, bollingerBands, rsi } from './indicators';

// =============================================================================
// MARKET REGIME DETECTOR
// Classifies the current market condition so the Strategy Engine can activate
// only the strategies appropriate for that regime.
//
// Regimes:
//   TRENDING_UP      EMA aligned bullish, ADX > 25
//   TRENDING_DOWN    EMA aligned bearish, ADX > 25
//   RANGING          ADX < 20, price inside tight BB
//   HIGH_VOLATILITY  ATR/price ratio high, ADX < 25
//   LOW_VOLATILITY   ATR/price ratio very low, BB width tight
//   BREAKOUT         Price breaks BB, volume spike
//   UNCERTAIN        Not enough data or contradictory signals
// =============================================================================

export interface RegimeResult {
  regime: MarketRegime;
  confidence: number; // 0–1
  signals: {
    adx:          number;
    ema20Slope:   number;
    ema50Slope:   number;
    ema200Slope:  number;
    rsi:          number;
    bbWidth:      number;
    atrPct:       number;
    emaAligned:   boolean;
    trendStrong:  boolean;
    ranging:      boolean;
    highVol:      boolean;
    lowVol:       boolean;
  };
}

export function detectMarketRegime(candles: Candle[]): RegimeResult {
  const uncertain: RegimeResult = {
    regime: 'UNCERTAIN',
    confidence: 0,
    signals: {
      adx: NaN, ema20Slope: NaN, ema50Slope: NaN, ema200Slope: NaN,
      rsi: NaN, bbWidth: NaN, atrPct: NaN,
      emaAligned: false, trendStrong: false, ranging: false,
      highVol: false, lowVol: false,
    },
  };

  if (candles.length < 220) return uncertain; // Need 200 EMA + buffer

  const closes = candles.map((c) => c.close);
  const highs  = candles.map((c) => c.high);
  const lows   = candles.map((c) => c.low);

  // ── Indicators ──────────────────────────────────────────────────────────────
  const ema20  = ema(closes, 20);
  const ema50  = ema(closes, 50);
  const ema200 = ema(closes, 200);

  if (isNaN(ema20) || isNaN(ema50) || isNaN(ema200)) return uncertain;

  const adxResult = adx(highs, lows, closes, 14);
  const rsiVal    = rsi(closes, 14);
  const bb        = bollingerBands(closes, 20, 2);
  const atrVal    = atr(highs, lows, closes, 14);
  const price     = closes.at(-1)!;

  // ── Derived signals ─────────────────────────────────────────────────────────
  // ATR as % of price (volatility normalised)
  const atrPct = atrVal / price;

  // EMA slope (positive = rising over last 3 bars)
  const closes20 = closes.slice(-25);
  const ema20Series = closes20.map((_, i) => ema(closes20.slice(0, i + 1), 20));
  const ema20Now  = ema20Series.at(-1)  ?? NaN;
  const ema20Ago  = ema20Series.at(-4)  ?? NaN;
  const ema20Slope = isNaN(ema20Now) || isNaN(ema20Ago) ? 0 : ema20Now - ema20Ago;

  const ema50Slope  = ema50  > ema(closes.slice(0, -3), 50)  ? 1 : -1;
  const ema200Slope = ema200 > ema(closes.slice(0, -5), 200) ? 1 : -1;

  // EMA alignment: 20 > 50 > 200 (bull) or 20 < 50 < 200 (bear)
  const bullAligned = ema20 > ema50 && ema50 > ema200;
  const bearAligned = ema20 < ema50 && ema50 < ema200;
  const emaAligned  = bullAligned || bearAligned;

  const trendStrong = adxResult.adx > 25;
  const ranging     = adxResult.adx < 20;
  const highVol     = atrPct > 0.025;       // ATR > 2.5% of price
  const lowVol      = atrPct < 0.008;       // ATR < 0.8% of price

  // BB breakout: price outside BB
  const aboveBB = price > bb.upper;
  const belowBB = price < bb.lower;

  const signals = {
    adx: adxResult.adx,
    ema20Slope,
    ema50Slope,
    ema200Slope,
    rsi: rsiVal,
    bbWidth: bb.width,
    atrPct,
    emaAligned,
    trendStrong,
    ranging,
    highVol,
    lowVol,
  };

  // ── Classification ──────────────────────────────────────────────────────────

  // 1. Breakout — price violates BB bands with strong ADX
  if ((aboveBB || belowBB) && adxResult.adx > 20) {
    return { regime: 'BREAKOUT', confidence: 0.75, signals };
  }

  // 2. Strong trend
  if (trendStrong && emaAligned) {
    if (bullAligned && adxResult.plusDI > adxResult.minusDI) {
      return { regime: 'TRENDING_UP',   confidence: 0.85, signals };
    }
    if (bearAligned && adxResult.minusDI > adxResult.plusDI) {
      return { regime: 'TRENDING_DOWN', confidence: 0.85, signals };
    }
  }

  // 3. Moderate trend (EMA aligned but ADX not screaming)
  if (emaAligned && adxResult.adx > 20) {
    return {
      regime: bullAligned ? 'TRENDING_UP' : 'TRENDING_DOWN',
      confidence: 0.60,
      signals,
    };
  }

  // 4. High volatility, no clear trend
  if (highVol && !trendStrong) {
    return { regime: 'HIGH_VOLATILITY', confidence: 0.70, signals };
  }

  // 5. Ranging / low ADX
  if (ranging && !highVol) {
    if (lowVol) return { regime: 'LOW_VOLATILITY', confidence: 0.70, signals };
    return { regime: 'RANGING', confidence: 0.65, signals };
  }

  return { regime: 'UNCERTAIN', confidence: 0.30, signals };
}
