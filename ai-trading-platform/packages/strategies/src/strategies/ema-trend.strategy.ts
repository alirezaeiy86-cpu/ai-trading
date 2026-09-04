import { ema, adx, atr, rsi, isVolumeSpike } from '@trading/indicators';
import type { Strategy, StrategyInput, StrategyOutput } from '../strategy.interface';
import { calcRiskReward, noSignal } from '../strategy.interface';

// =============================================================================
// EMA TREND FOLLOWING STRATEGY
// Multi-EMA alignment + ADX trend strength + volume confirmation.
// Active regimes: TRENDING_UP, TRENDING_DOWN
// =============================================================================

export class EmaTrendStrategy implements Strategy {
  readonly name         = 'ema_trend_follow';
  readonly displayName  = 'EMA Trend Following';
  readonly description  = 'Multi-timeframe EMA crossover with ADX confirmation';
  readonly suitableRegimes = ['TRENDING_UP', 'TRENDING_DOWN'] as const;

  evaluate(input: StrategyInput): StrategyOutput {
    const { candles, symbol: _s, timeframe: _tf, regime } = input;

    if (!this.suitableRegimes.includes(regime as never)) {
      return noSignal(`Regime ${regime} not suitable for EMA trend strategy`);
    }
    if (candles.length < 210) {
      return noSignal('Insufficient candle data (need 210+)');
    }

    const closes  = candles.map((c) => c.close);
    const highs   = candles.map((c) => c.high);
    const lows    = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);
    const price   = closes.at(-1)!;

    // ── Indicators ──────────────────────────────────────────────────────────
    const ema20  = ema(closes, 20);
    const ema50  = ema(closes, 50);
    const ema200 = ema(closes, 200);
    const adxRes = adx(highs, lows, closes, 14);
    const atrVal = atr(highs, lows, closes, 14);
    const rsiVal = rsi(closes, 14);
    const volSpike = isVolumeSpike(volumes, 20, 1.2);

    // ── Guards ───────────────────────────────────────────────────────────────
    if ([ema20, ema50, ema200, adxRes.adx, atrVal, rsiVal].some(isNaN)) {
      return noSignal('Indicator calculation failed');
    }

    const reasons: string[] = [];
    let score = 0;

    // ── Bull conditions ──────────────────────────────────────────────────────
    const bullAligned = ema20 > ema50 && ema50 > ema200;
    const bearAligned = ema20 < ema50 && ema50 < ema200;

    if (!bullAligned && !bearAligned) {
      return noSignal('EMAs not aligned — no clear trend');
    }

    const isBull = bullAligned && regime === 'TRENDING_UP';
    const isBear = bearAligned && regime === 'TRENDING_DOWN';

    if (!isBull && !isBear) {
      return noSignal('Regime and EMA direction mismatch');
    }

    // Score components (max 100)

    // 1. EMA alignment (25 pts)
    score += 25;
    reasons.push('EMAs aligned with trend direction');

    // 2. ADX strength (25 pts)
    if (adxRes.adx > 30) {
      score += 25;
      reasons.push(`ADX strong (${adxRes.adx.toFixed(1)})`);
    } else if (adxRes.adx > 20) {
      score += 15;
      reasons.push(`ADX moderate (${adxRes.adx.toFixed(1)})`);
    } else {
      return noSignal(`ADX too weak (${adxRes.adx.toFixed(1)} < 20)`);
    }

    // 3. DI confirmation (20 pts)
    if (isBull && adxRes.plusDI > adxRes.minusDI) {
      score += 20;
      reasons.push(`+DI > -DI (${adxRes.plusDI.toFixed(1)} > ${adxRes.minusDI.toFixed(1)})`);
    } else if (isBear && adxRes.minusDI > adxRes.plusDI) {
      score += 20;
      reasons.push(`-DI > +DI (${adxRes.minusDI.toFixed(1)} > ${adxRes.plusDI.toFixed(1)})`);
    }

    // 4. RSI filter (15 pts) — not overbought for longs, not oversold for shorts
    if (isBull && rsiVal > 50 && rsiVal < 70) {
      score += 15;
      reasons.push(`RSI bullish zone (${rsiVal.toFixed(1)})`);
    } else if (isBear && rsiVal < 50 && rsiVal > 30) {
      score += 15;
      reasons.push(`RSI bearish zone (${rsiVal.toFixed(1)})`);
    } else if (isBull && rsiVal >= 70) {
      score -= 10;
      reasons.push(`RSI overbought (${rsiVal.toFixed(1)})`);
    } else if (isBear && rsiVal <= 30) {
      score -= 10;
      reasons.push(`RSI oversold (${rsiVal.toFixed(1)})`);
    }

    // 5. Volume confirmation (15 pts)
    if (volSpike) {
      score += 15;
      reasons.push('Volume above average');
    }

    score = Math.max(0, Math.min(100, score));

    // ── Levels ───────────────────────────────────────────────────────────────
    const stopDist   = atrVal * 1.5;
    const direction  = isBull ? 'LONG' : 'SHORT';
    const stopLoss   = isBull ? price - stopDist : price + stopDist;
    const takeProfit = isBull ? price + stopDist * 2.5 : price - stopDist * 2.5;
    const rr         = calcRiskReward(price, stopLoss, takeProfit);
    const confidence = score / 100;

    return {
      score,
      confidence,
      direction,
      entryZone:  { min: price * 0.9995, max: price * 1.0005 },
      stopLoss:   Math.round(stopLoss * 100) / 100,
      takeProfit: Math.round(takeProfit * 100) / 100,
      riskReward: rr,
      reasons,
      isValid: score >= 40 && rr >= 1.5,
    };
  }
}
