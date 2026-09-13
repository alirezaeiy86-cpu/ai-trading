import { atr, bollingerBands, ema, rsi, isVolumeSpike, highest, lowest } from '@trading/indicators';
import type { Strategy, StrategyInput, StrategyOutput } from '../strategy.interface';
import { calcRiskReward, noSignal } from '../strategy.interface';

// =============================================================================
// VOLATILITY BREAKOUT STRATEGY
// BB breakout + ATR expansion + volume spike confirmation.
// Active regimes: BREAKOUT, HIGH_VOLATILITY
// =============================================================================

export class VolatilityBreakoutStrategy implements Strategy {
  readonly name         = 'volatility_breakout';
  readonly displayName  = 'Volatility Breakout';
  readonly description  = 'Bollinger Band breakout with ATR and volume confirmation';
  readonly suitableRegimes = ['BREAKOUT', 'HIGH_VOLATILITY'] as const;

  evaluate(input: StrategyInput): StrategyOutput {
    const { candles, regime } = input;

    if (!this.suitableRegimes.includes(regime as never)) {
      return noSignal(`Regime ${regime} not suitable for breakout strategy`);
    }
    if (candles.length < 55) return noSignal('Need 55+ candles');

    const closes  = candles.map((c) => c.close);
    const highs   = candles.map((c) => c.high);
    const lows    = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);
    const price   = closes.at(-1)!;

    const bb       = bollingerBands(closes, 20, 2);
    const atrVal   = atr(highs, lows, closes, 14);
    const atrPrev  = atr(highs.slice(0, -5), lows.slice(0, -5), closes.slice(0, -5), 14);
    const ema20    = ema(closes, 20);
    const rsiVal   = rsi(closes, 14);
    const volSpike = isVolumeSpike(volumes, 20, 1.5);
    const high20   = highest(highs, 20);
    const low20    = lowest(lows, 20);

    if ([bb.upper, atrVal, ema20, rsiVal].some(isNaN)) {
      return noSignal('Indicator calculation failed');
    }

    const reasons: string[] = [];
    let score = 0;

    // ── Breakout direction ────────────────────────────────────────────────────
    const bullBreak = price > bb.upper && price > high20 * 0.999;
    const bearBreak = price < bb.lower && price < low20  * 1.001;

    if (!bullBreak && !bearBreak) {
      return noSignal('No BB breakout detected');
    }

    const isBull = bullBreak;

    // 1. BB breakout (30 pts)
    score += 30;
    reasons.push(isBull
      ? `Price broke above upper BB (${bb.upper.toFixed(2)})`
      : `Price broke below lower BB (${bb.lower.toFixed(2)})`);

    // 2. ATR expansion (25 pts)
    if (!isNaN(atrPrev) && atrVal > atrPrev * 1.1) {
      score += 25;
      reasons.push('ATR expanding — volatility increasing');
    } else {
      score += 10;
      reasons.push('Moderate ATR');
    }

    // 3. BB width (20 pts) — wider band = more meaningful breakout
    if (bb.width > 0.03) {
      score += 20;
      reasons.push(`BB width significant (${(bb.width * 100).toFixed(1)}%)`);
    } else if (bb.width > 0.015) {
      score += 10;
      reasons.push('BB width moderate');
    }

    // 4. Volume (15 pts)
    if (volSpike) {
      score += 15;
      reasons.push('Volume spike confirms breakout');
    }

    // 5. RSI filter — momentum should support direction (10 pts)
    if (isBull && rsiVal > 55 && rsiVal < 80) {
      score += 10;
      reasons.push(`RSI momentum bullish (${rsiVal.toFixed(1)})`);
    } else if (!isBull && rsiVal < 45 && rsiVal > 20) {
      score += 10;
      reasons.push(`RSI momentum bearish (${rsiVal.toFixed(1)})`);
    }

    score = Math.max(0, Math.min(100, score));

    // ── Levels — wider stops for breakouts ───────────────────────────────────
    const stopDist   = atrVal * 1.8;
    const direction  = isBull ? 'LONG' : 'SHORT';
    const stopLoss   = isBull ? price - stopDist : price + stopDist;
    const takeProfit = isBull ? price + stopDist * 2.0 : price - stopDist * 2.0;
    const rr         = calcRiskReward(price, stopLoss, takeProfit);

    return {
      score,
      confidence: score / 100,
      direction,
      entryZone:  { min: price * 0.9998, max: price * 1.0002 },
      stopLoss:   Math.round(stopLoss * 100) / 100,
      takeProfit: Math.round(takeProfit * 100) / 100,
      riskReward: rr,
      reasons,
      isValid: score >= 45 && rr >= 1.5 && volSpike,
    };
  }
}
