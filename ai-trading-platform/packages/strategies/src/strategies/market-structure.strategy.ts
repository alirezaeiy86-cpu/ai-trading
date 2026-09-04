import { ema, atr, rsi, highest, lowest } from '@trading/indicators';
import type { Strategy, StrategyInput, StrategyOutput } from '../strategy.interface';
import { calcRiskReward, noSignal } from '../strategy.interface';

// =============================================================================
// MARKET STRUCTURE STRATEGY
// Identifies swing structure (HH/HL for uptrend, LH/LL for downtrend)
// and looks for retests of broken structure levels.
// Active regimes: TRENDING_UP, TRENDING_DOWN
// =============================================================================

export class MarketStructureStrategy implements Strategy {
  readonly name         = 'market_structure';
  readonly displayName  = 'Market Structure';
  readonly description  = 'Swing structure analysis with support/resistance retests';
  readonly suitableRegimes = ['TRENDING_UP', 'TRENDING_DOWN'] as const;

  evaluate(input: StrategyInput): StrategyOutput {
    const { candles, regime } = input;

    if (!this.suitableRegimes.includes(regime as never)) {
      return noSignal(`Regime ${regime} not suitable for market structure`);
    }
    if (candles.length < 60) return noSignal('Need 60+ candles');

    const closes = candles.map((c) => c.close);
    const highs  = candles.map((c) => c.high);
    const lows   = candles.map((c) => c.low);
    const price  = closes.at(-1)!;

    const ema20  = ema(closes, 20);
    const ema50  = ema(closes, 50);
    const atrVal = atr(highs, lows, closes, 14);
    const rsiVal = rsi(closes, 14);

    if ([ema20, ema50, atrVal, rsiVal].some(isNaN)) {
      return noSignal('Indicator calculation failed');
    }

    // ── Swing detection (last 20 bars) ───────────────────────────────────────
    const lookback = Math.min(40, candles.length - 5);
    const recentH  = candles.slice(-lookback).map((c) => c.high);
    const recentL  = candles.slice(-lookback).map((c) => c.low);

    const swingHighs = this.findSwingHighs(recentH, 5);
    const swingLows  = this.findSwingLows(recentL, 5);

    if (swingHighs.length < 2 || swingLows.length < 2) {
      return noSignal('Insufficient swing points detected');
    }

    // ── Structure classification ──────────────────────────────────────────────
    const lastHigh     = swingHighs.at(-1)!;
    const prevHigh     = swingHighs.at(-2)!;
    const lastLow      = swingLows.at(-1)!;
    const prevLow      = swingLows.at(-2)!;

    const higherHighs  = lastHigh > prevHigh;
    const higherLows   = lastLow  > prevLow;
    const lowerHighs   = lastHigh < prevHigh;
    const lowerLows    = lastLow  < prevLow;

    const bullStructure = higherHighs && higherLows;
    const bearStructure = lowerHighs  && lowerLows;

    const isBull = regime === 'TRENDING_UP'   && bullStructure;
    const isBear = regime === 'TRENDING_DOWN' && bearStructure;

    if (!isBull && !isBear) {
      return noSignal('Market structure does not match regime direction');
    }

    const reasons: string[] = [];
    let score = 0;

    // 1. Structure confirmation (35 pts)
    if (isBull) {
      score += 35;
      reasons.push('Higher highs and higher lows confirmed');
    } else {
      score += 35;
      reasons.push('Lower highs and lower lows confirmed');
    }

    // 2. EMA alignment (25 pts)
    const emasBull = ema20 > ema50 && price > ema20;
    const emasBear = ema20 < ema50 && price < ema20;

    if (isBull && emasBull) {
      score += 25;
      reasons.push('Price above EMA20 > EMA50');
    } else if (isBear && emasBear) {
      score += 25;
      reasons.push('Price below EMA20 < EMA50');
    } else {
      score += 10;
      reasons.push('Partial EMA alignment');
    }

    // 3. Retest proximity — price near last swing low (bull) or high (bear) (25 pts)
    const retestZone = atrVal * 0.5;
    if (isBull && Math.abs(price - lastLow) < retestZone) {
      score += 25;
      reasons.push(`Price retesting support near ${lastLow.toFixed(2)}`);
    } else if (isBear && Math.abs(price - lastHigh) < retestZone) {
      score += 25;
      reasons.push(`Price retesting resistance near ${lastHigh.toFixed(2)}`);
    } else {
      score += 5;
      reasons.push('Not at optimal retest zone');
    }

    // 4. RSI alignment (15 pts)
    if (isBull && rsiVal > 45 && rsiVal < 65) {
      score += 15;
      reasons.push(`RSI in bullish continuation zone (${rsiVal.toFixed(1)})`);
    } else if (isBear && rsiVal < 55 && rsiVal > 35) {
      score += 15;
      reasons.push(`RSI in bearish continuation zone (${rsiVal.toFixed(1)})`);
    }

    score = Math.max(0, Math.min(100, score));

    // ── Levels ────────────────────────────────────────────────────────────────
    const stopDist   = atrVal * 1.3;
    const direction  = isBull ? 'LONG' : 'SHORT';

    // Stop: below the last swing low (bull) / above last swing high (bear)
    const structStop = isBull
      ? Math.min(lastLow - atrVal * 0.3, price - stopDist)
      : Math.max(lastHigh + atrVal * 0.3, price + stopDist);

    const risk       = Math.abs(price - structStop);
    const takeProfit = isBull
      ? price + risk * 2.5
      : price - risk * 2.5;

    const rr = calcRiskReward(price, structStop, takeProfit);

    return {
      score,
      confidence: score / 100,
      direction,
      entryZone:  { min: price * 0.9995, max: price * 1.0005 },
      stopLoss:   Math.round(structStop * 100) / 100,
      takeProfit: Math.round(takeProfit * 100) / 100,
      riskReward: rr,
      reasons,
      isValid: score >= 40 && rr >= 1.5,
    };
  }

  private findSwingHighs(highs: number[], leftRight = 5): number[] {
    const swings: number[] = [];
    for (let i = leftRight; i < highs.length - leftRight; i++) {
      const window = highs.slice(i - leftRight, i + leftRight + 1);
      if (highs[i] === Math.max(...window)) {
        swings.push(highs[i]!);
      }
    }
    return swings;
  }

  private findSwingLows(lows: number[], leftRight = 5): number[] {
    const swings: number[] = [];
    for (let i = leftRight; i < lows.length - leftRight; i++) {
      const window = lows.slice(i - leftRight, i + leftRight + 1);
      if (lows[i] === Math.min(...window)) {
        swings.push(lows[i]!);
      }
    }
    return swings;
  }
}
