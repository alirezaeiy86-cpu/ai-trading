import { rsi, macd, ema, atr, isVolumeSpike } from '@trading/indicators';
import type { Strategy, StrategyInput, StrategyOutput } from '../strategy.interface';
import { calcRiskReward, noSignal } from '../strategy.interface';

// =============================================================================
// RSI MOMENTUM STRATEGY
// RSI trend + MACD histogram confirmation + EMA trend filter.
// Active regimes: TRENDING_UP, TRENDING_DOWN, BREAKOUT
// =============================================================================

export class RsiMomentumStrategy implements Strategy {
  readonly name         = 'rsi_momentum';
  readonly displayName  = 'RSI Momentum';
  readonly description  = 'RSI momentum with MACD confirmation';
  readonly suitableRegimes = ['TRENDING_UP', 'TRENDING_DOWN', 'BREAKOUT'] as const;

  evaluate(input: StrategyInput): StrategyOutput {
    const { candles, regime } = input;

    if (!this.suitableRegimes.includes(regime as never)) {
      return noSignal(`Regime ${regime} not suitable for RSI momentum`);
    }
    if (candles.length < 60) return noSignal('Need 60+ candles');

    const closes  = candles.map((c) => c.close);
    const highs   = candles.map((c) => c.high);
    const lows    = candles.map((c) => c.low);
    const volumes = candles.map((c) => c.volume);
    const price   = closes.at(-1)!;

    const rsiVal   = rsi(closes, 14);
    const rsiPrev  = rsi(closes.slice(0, -3), 14);
    const macdRes  = macd(closes, 12, 26, 9);
    const ema50    = ema(closes, 50);
    const atrVal   = atr(highs, lows, closes, 14);
    const volSpike = isVolumeSpike(volumes, 20, 1.1);

    if ([rsiVal, rsiPrev, macdRes.macd, macdRes.hist, ema50, atrVal].some(isNaN)) {
      return noSignal('Indicator calculation failed');
    }

    const reasons: string[] = [];
    let score = 0;

    // ── Direction from RSI + price vs EMA50 ──────────────────────────────────
    const bullBias = rsiVal > 50 && price > ema50;
    const bearBias = rsiVal < 50 && price < ema50;

    if (!bullBias && !bearBias) return noSignal('No clear RSI + EMA direction');

    const isBull = bullBias;

    // 1. RSI trend (30 pts)
    const rsiRising = rsiVal > rsiPrev;
    if (isBull && rsiVal > 55 && rsiRising) {
      score += 30;
      reasons.push(`RSI bullish and rising (${rsiVal.toFixed(1)})`);
    } else if (!isBull && rsiVal < 45 && !rsiRising) {
      score += 30;
      reasons.push(`RSI bearish and falling (${rsiVal.toFixed(1)})`);
    } else if (isBull && rsiVal > 50) {
      score += 15;
      reasons.push(`RSI above 50 (${rsiVal.toFixed(1)})`);
    } else if (!isBull && rsiVal < 50) {
      score += 15;
      reasons.push(`RSI below 50 (${rsiVal.toFixed(1)})`);
    }

    // Overbought/oversold penalty
    if (isBull && rsiVal > 72) { score -= 15; reasons.push('RSI overbought warning'); }
    if (!isBull && rsiVal < 28) { score -= 15; reasons.push('RSI oversold warning'); }

    // 2. MACD confirmation (30 pts)
    if (isBull && macdRes.macd > macdRes.signal && macdRes.hist > 0) {
      score += 30;
      reasons.push('MACD bullish crossover');
    } else if (!isBull && macdRes.macd < macdRes.signal && macdRes.hist < 0) {
      score += 30;
      reasons.push('MACD bearish crossover');
    } else if (isBull && macdRes.hist > 0) {
      score += 15;
      reasons.push('MACD histogram positive');
    } else if (!isBull && macdRes.hist < 0) {
      score += 15;
      reasons.push('MACD histogram negative');
    }

    // 3. EMA trend filter (20 pts)
    if (isBull && price > ema50) {
      score += 20;
      reasons.push('Price above EMA50');
    } else if (!isBull && price < ema50) {
      score += 20;
      reasons.push('Price below EMA50');
    }

    // 4. Volume (20 pts)
    if (volSpike) {
      score += 20;
      reasons.push('Volume confirmation');
    }

    score = Math.max(0, Math.min(100, score));

    // ── Levels ────────────────────────────────────────────────────────────────
    const stopDist   = atrVal * 1.2;
    const direction  = isBull ? 'LONG' : 'SHORT';
    const stopLoss   = isBull ? price - stopDist : price + stopDist;
    const takeProfit = isBull ? price + stopDist * 2.2 : price - stopDist * 2.2;
    const rr         = calcRiskReward(price, stopLoss, takeProfit);

    return {
      score,
      confidence: score / 100,
      direction,
      entryZone:  { min: price * 0.999, max: price * 1.001 },
      stopLoss:   Math.round(stopLoss * 100) / 100,
      takeProfit: Math.round(takeProfit * 100) / 100,
      riskReward: rr,
      reasons,
      isValid: score >= 40 && rr >= 1.5,
    };
  }
}
