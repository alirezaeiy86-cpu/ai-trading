import type { Candle, MarketRegime, SignalDirection, Timeframe } from '@trading/types';

// =============================================================================
// STRATEGY INTERFACE
// Every strategy is a pure function — it receives candle data and returns
// a structured signal. No side effects. No external calls.
// =============================================================================

export interface StrategyInput {
  symbol:      string;
  timeframe:   Timeframe;
  candles:     Candle[];       // ascending order (oldest first)
  regime:      MarketRegime;
}

export interface StrategyOutput {
  /** 0–100 composite quality score */
  score:      number;
  /** 0–1 probability estimate */
  confidence: number;
  direction:  SignalDirection;
  entryZone:  { min: number; max: number };
  stopLoss:   number;
  takeProfit: number;
  riskReward: number;
  reasons:    string[];
  /** true = this strategy has a valid signal for the current conditions */
  isValid:    boolean;
}

export interface Strategy {
  readonly name:        string;
  readonly displayName: string;
  readonly description: string;
  /** Which regimes this strategy is designed for */
  readonly suitableRegimes: MarketRegime[];

  /**
   * Evaluate the strategy on the given input.
   * Must never throw — return isValid=false on any error.
   * Must be deterministic for the same input.
   */
  evaluate(input: StrategyInput): StrategyOutput;
}

// ── Helpers shared across strategies ─────────────────────────────────────────

/** Calculate R:R ratio, clamped to avoid division by zero */
export function calcRiskReward(
  entry:    number,
  stop:     number,
  target:   number,
): number {
  const risk   = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (risk === 0) return 0;
  return Math.round((reward / risk) * 10) / 10;
}

/** Default no-signal output */
export function noSignal(reason: string): StrategyOutput {
  return {
    score: 0, confidence: 0,
    direction: 'NEUTRAL',
    entryZone: { min: 0, max: 0 },
    stopLoss: 0, takeProfit: 0, riskReward: 0,
    reasons: [reason],
    isValid: false,
  };
}
