import type { Candle, MarketRegime, StrategySignal, Timeframe } from '@trading/types';
import { detectMarketRegime } from '@trading/indicators';
import type { Strategy, StrategyOutput } from './strategy.interface';
import { EmaTrendStrategy }         from './strategies/ema-trend.strategy';
import { RsiMomentumStrategy }      from './strategies/rsi-momentum.strategy';
import { VolatilityBreakoutStrategy } from './strategies/volatility-breakout.strategy';
import { MarketStructureStrategy }  from './strategies/market-structure.strategy';
import { MeanReversionStrategy }    from './strategies/mean-reversion.strategy';
import { randomUUID }               from 'crypto';

// =============================================================================
// STRATEGY ENGINE
// Runs the Market Regime Detector, activates suitable strategies,
// aggregates scores, and emits StrategySignal[] for downstream processing.
//
// Rules:
//   - Only strategies suitable for the detected regime are evaluated
//   - A signal is emitted only if score >= minScore
//   - The best signal per symbol/timeframe is selected
//   - Never directly executes trades
// =============================================================================

export interface StrategyEngineConfig {
  minScore:      number;   // 0–100, signals below this are discarded
  minRiskReward: number;   // minimum R:R ratio
}

export interface EngineResult {
  symbol:      string;
  timeframe:   Timeframe;
  regime:      MarketRegime;
  regimeConf:  number;
  signals:     StrategySignal[];
  bestSignal:  StrategySignal | null;
  evaluated:   number;
  passed:      number;
  rejected:    number;
  reasons:     string[];
}

export class StrategyEngine {
  private readonly strategies: Strategy[];

  constructor(private readonly config: StrategyEngineConfig) {
    this.strategies = [
      new EmaTrendStrategy(),
      new RsiMomentumStrategy(),
      new VolatilityBreakoutStrategy(),
      new MarketStructureStrategy(),
      new MeanReversionStrategy(),
    ];
  }

  /**
   * Evaluate all applicable strategies for a symbol/timeframe.
   * Returns an EngineResult with all signals and the best one.
   */
  evaluate(
    symbol:    string,
    timeframe: Timeframe,
    candles:   Candle[],
  ): EngineResult {
    // 1. Detect market regime
    const regimeResult = detectMarketRegime(candles);
    const { regime, confidence: regimeConf } = regimeResult;

    const signals: StrategySignal[] = [];
    let evaluated = 0;
    let rejected  = 0;
    const reasons: string[] = [];

    // 2. Evaluate each strategy
    for (const strategy of this.strategies) {
      // Skip strategies not suitable for this regime
      if (!strategy.suitableRegimes.includes(regime as never)) {
        continue;
      }

      evaluated++;

      let output: StrategyOutput;
      try {
        output = strategy.evaluate({ symbol, timeframe, candles, regime });
      } catch (err) {
        reasons.push(`${strategy.name}: evaluation error — ${String(err)}`);
        rejected++;
        continue;
      }

      if (!output.isValid) {
        rejected++;
        reasons.push(`${strategy.name}: ${output.reasons[0] ?? 'invalid'}`);
        continue;
      }

      if (output.score < this.config.minScore) {
        rejected++;
        reasons.push(`${strategy.name}: score ${output.score} < minimum ${this.config.minScore}`);
        continue;
      }

      if (output.riskReward < this.config.minRiskReward) {
        rejected++;
        reasons.push(`${strategy.name}: R:R ${output.riskReward} < minimum ${this.config.minRiskReward}`);
        continue;
      }

      // 3. Build StrategySignal
      const signal: StrategySignal = {
        id:           randomUUID(),
        symbol,
        timeframe,
        direction:    output.direction,
        score:        output.score,
        confidence:   output.confidence,
        entryZone:    output.entryZone,
        suggestedStopLoss:   output.stopLoss,
        suggestedTakeProfit: output.takeProfit,
        riskReward:   output.riskReward,
        marketRegime: regime,
        reasons:      output.reasons,
        strategyName: strategy.name,
        timestamp:    new Date(),
      };

      signals.push(signal);
    }

    // 4. Select best signal (highest score, same direction preference)
    const bestSignal = this.selectBest(signals);

    return {
      symbol,
      timeframe,
      regime,
      regimeConf,
      signals,
      bestSignal,
      evaluated,
      passed:  signals.length,
      rejected,
      reasons,
    };
  }

  /**
   * Evaluate across multiple timeframes and return consolidated results.
   * Higher timeframes have priority in conflict resolution.
   */
  evaluateMultiTimeframe(
    symbol:     string,
    timeframes: Timeframe[],
    candleMap:  Map<Timeframe, Candle[]>,
  ): EngineResult | null {
    const results: EngineResult[] = [];

    for (const tf of timeframes) {
      const candles = candleMap.get(tf);
      if (!candles || candles.length < 50) continue;
      results.push(this.evaluate(symbol, tf, candles));
    }

    if (results.length === 0) return null;

    // Find the highest timeframe with a valid signal
    for (const tf of [...timeframes].reverse()) {
      const result = results.find((r) => r.timeframe === tf && r.bestSignal !== null);
      if (result) return result;
    }

    // No valid signal on any timeframe
    return results.at(-1) ?? null;
  }

  private selectBest(signals: StrategySignal[]): StrategySignal | null {
    if (signals.length === 0) return null;
    if (signals.length === 1) return signals[0]!;

    // Prefer signals with the same direction (no conflicting signals)
    const longSignals  = signals.filter((s) => s.direction === 'LONG');
    const shortSignals = signals.filter((s) => s.direction === 'SHORT');

    // Mixed signals → reduce confidence, pick highest scorer
    if (longSignals.length > 0 && shortSignals.length > 0) {
      // Conflicting signals — return highest scorer but with reduced confidence
      const best = signals.reduce((a, b) => (a.score > b.score ? a : b));
      return { ...best, confidence: best.confidence * 0.6, reasons: [...best.reasons, 'Warning: conflicting signals from other strategies'] };
    }

    const pool = longSignals.length > 0 ? longSignals : shortSignals;
    return pool.reduce((a, b) => (a.score > b.score ? a : b));
  }

  /** Return the list of registered strategies */
  getStrategies(): Array<{ name: string; displayName: string; suitableRegimes: readonly string[] }> {
    return this.strategies.map((s) => ({
      name:            s.name,
      displayName:     s.displayName,
      suitableRegimes: s.suitableRegimes,
    }));
  }
}
