import { bollingerBands, rsi, stochastic, atr, sma } from '@trading/indicators';
import type { Strategy, StrategyInput, StrategyOutput } from '../strategy.interface';
import { calcRiskReward, noSignal } from '../strategy.interface';

// =============================================================================
// MEAN REVERSION STRATEGY
// ONLY active in RANGING / LOW_VOLATILITY regimes.
// Uses BB extremes + RSI oversold/overbought + Stochastic for entry timing.
// =============================================================================

export class MeanReversionStrategy implements Strategy {
  readonly name         = 'mean_reversion';
  readonly displayName  = 'Mean Reversion';
  readonly description  = 'Range-bound mean reversion — RANGING regime only';
  readonly suitableRegimes = ['RANGING', 'LOW_VOLATILITY'] as const;

  evaluate(input: StrategyInput): StrategyOutput {
    const { candles, regime } = input;

    if (!this.suitableRegimes.includes(regime as never)) {
      return noSignal(`Mean reversion only active in ranging/low-vol markets — current: ${regime}`);
    }
    if (candles.length < 55) return noSignal('Need 55+ candles');

    const closes = candles.map((c) => c.close);
    const highs  = candles.map((c) => c.high);
    const lows   = candles.map((c) => c.low);
    const price  = closes.at(-1)!;

    const bb     = bollingerBands(closes, 20, 2);
    const rsiVal = rsi(closes, 14);
    const stoch  = stochastic(highs, lows, closes, 14, 3);
    const atrVal = atr(highs, lows, closes, 14);
    const sma20  = sma(closes, 20);

    if ([bb.upper, rsiVal, stoch.k, atrVal, sma20].some(isNaN)) {
      return noSignal('Indicator calculation failed');
    }

    const reasons: string[] = [];
    let score = 0;

    // ── Detect extreme: price at lower/upper band ─────────────────────────────
    const nearLower = bb.pct < 0.15;   // price near or below lower band
    const nearUpper = bb.pct > 0.85;   // price near or above upper band

    if (!nearLower && !nearUpper) {
      return noSignal('Price not at BB extreme — wait for reversion setup');
    }

    const isBull = nearLower; // buy at lower band (expect mean reversion up)

    // 1. BB extreme (30 pts)
    if (isBull) {
      score += 30;
      reasons.push(`Price at lower BB (pct=${(bb.pct * 100).toFixed(0)}%)`);
    } else {
      score += 30;
      reasons.push(`Price at upper BB (pct=${(bb.pct * 100).toFixed(0)}%)`);
    }

    // 2. RSI extreme (25 pts)
    if (isBull && rsiVal < 35) {
      score += 25;
      reasons.push(`RSI oversold (${rsiVal.toFixed(1)})`);
    } else if (!isBull && rsiVal > 65) {
      score += 25;
      reasons.push(`RSI overbought (${rsiVal.toFixed(1)})`);
    } else if (isBull && rsiVal < 45) {
      score += 12;
      reasons.push(`RSI low (${rsiVal.toFixed(1)})`);
    } else if (!isBull && rsiVal > 55) {
      score += 12;
      reasons.push(`RSI high (${rsiVal.toFixed(1)})`);
    }

    // 3. Stochastic (25 pts)
    if (isBull && stoch.k < 25 && stoch.k > stoch.d) {
      score += 25;
      reasons.push(`Stochastic oversold and turning up (K=${stoch.k.toFixed(1)})`);
    } else if (!isBull && stoch.k > 75 && stoch.k < stoch.d) {
      score += 25;
      reasons.push(`Stochastic overbought and turning down (K=${stoch.k.toFixed(1)})`);
    } else if (isBull && stoch.k < 35) {
      score += 12;
      reasons.push(`Stochastic oversold (K=${stoch.k.toFixed(1)})`);
    } else if (!isBull && stoch.k > 65) {
      score += 12;
      reasons.push(`Stochastic overbought (K=${stoch.k.toFixed(1)})`);
    }

    // 4. BB width narrow — confirms ranging (20 pts)
    if (bb.width < 0.02) {
      score += 20;
      reasons.push(`BB width tight (${(bb.width * 100).toFixed(1)}%) — range confirmed`);
    } else if (bb.width < 0.04) {
      score += 10;
      reasons.push('BB width moderate');
    }

    score = Math.max(0, Math.min(100, score));

    // ── Levels: mean reversion targets the middle band ────────────────────────
    const direction  = isBull ? 'LONG' : 'SHORT';
    const stopDist   = atrVal * 1.0;

    // Stop: beyond the band extreme
    const stopLoss   = isBull
      ? bb.lower - stopDist
      : bb.upper + stopDist;

    // Target: middle band (SMA20)
    const takeProfit = sma20;
    const rr         = calcRiskReward(price, stopLoss, takeProfit);

    return {
      score,
      confidence: score / 100,
      direction,
      entryZone:  { min: price * 0.9995, max: price * 1.0005 },
      stopLoss:   Math.round(stopLoss * 100) / 100,
      takeProfit: Math.round(takeProfit * 100) / 100,
      riskReward: rr,
      reasons,
      isValid: score >= 45 && rr >= 1.2,
    };
  }
}
