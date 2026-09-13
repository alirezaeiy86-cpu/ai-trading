import type { Timeframe, MarketRegime, RiskSettings } from '@trading/types';

// =============================================================================
// BACKTESTING TYPES
// =============================================================================

export interface BacktestConfig {
  strategyName:   string;
  symbol:         string;
  timeframe:      Timeframe;
  startDate:      Date;
  endDate:        Date;
  initialBalance: number;
  riskSettings:   RiskSettings;
  /** Warn if same candle data used for both optimisation and validation */
  outOfSampleStartDate?: Date;
}

export interface BacktestTrade {
  id:          number;
  entryDate:   Date;
  exitDate:    Date;
  symbol:      string;
  side:        'LONG' | 'SHORT';
  entryPrice:  number;
  exitPrice:   number;
  quantity:    number;
  pnl:         number;    // net (after fees)
  pnlR:        number;    // multiples of initial risk (R)
  fees:        number;
  closeReason: 'TAKE_PROFIT' | 'STOP_LOSS' | 'SIGNAL_EXIT' | 'END_OF_DATA';
  strategyScore:  number;
  marketRegime:   MarketRegime;
}

export interface EquityPoint {
  date:    Date;
  equity:  number;
  drawdown: number;  // current drawdown from peak (0–1)
}

export interface BacktestResult {
  config:      BacktestConfig;
  status:      'COMPLETED' | 'FAILED';
  error?:      string;
  startedAt:   Date;
  completedAt: Date;

  // ── Performance ───────────────────────────────────────────────────────────
  totalTrades:    number;
  winningTrades:  number;
  losingTrades:   number;
  winRate:        number;     // 0–1
  netPnl:         number;
  netPnlPercent:  number;
  profitFactor:   number;
  avgR:           number;     // average trade in R multiples
  maxDrawdown:    number;     // absolute $
  maxDrawdownPct: number;     // 0–1
  largestWin:     number;
  largestLoss:    number;
  avgWin:         number;
  avgLoss:        number;
  avgTrade:       number;
  totalFees:      number;

  // ── Risk-adjusted ─────────────────────────────────────────────────────────
  /** Sharpe-like ratio: netPnl / stdDev(trade pnls) */
  sharpeRatio:    number;
  /** Calmar ratio: annualised return / maxDrawdownPct */
  calmarRatio:    number;
  /** Expectancy per trade in $ */
  expectancy:     number;

  // ── Raw data ──────────────────────────────────────────────────────────────
  trades:      BacktestTrade[];
  equityCurve: EquityPoint[];
}

export interface RunningPosition {
  entryDate:    Date;
  entryPrice:   number;
  side:         'LONG' | 'SHORT';
  quantity:     number;
  stopLoss:     number;
  takeProfit:   number;
  riskAmount:   number;
  strategyScore: number;
  regime:       MarketRegime;
  fees:         number;
}
