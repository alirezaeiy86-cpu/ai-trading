import type {
  RiskSettings,
  Position,
  StrategySignal,
  AIAnalysisResult,
} from '@trading/types';

// =============================================================================
// RISK ENGINE TYPES
// =============================================================================

export interface AccountState {
  balance:          number;
  equity:           number;
  availableBalance: number;
  highWaterMark:    number;
  currency:         string;
  isPaper:          boolean;
}

export interface TradingState {
  openPositions:       Position[];
  tradesToday:         number;
  realisedPnlToday:    number;
  unrealisedPnlToday:  number;
  realisedPnlWeek:     number;
  lastTradeAt:         Date | null;
  lastLossAt:          Date | null;
  consecutiveLosses:   number;
  emergencyStopActive: boolean;
  dailyLossBreached:   boolean;
  drawdownBreached:    boolean;
}

export interface TradeProposal {
  symbol:      string;
  direction:   'LONG' | 'SHORT';
  entryPrice:  number;
  stopLoss:    number;
  takeProfit:  number;
  /** strategy score 0–100 */
  strategyScore: number;
  /** AI confidence 0–1, null if AI disabled/unavailable */
  aiConfidence:  number | null;
  signal:        StrategySignal;
  aiResult:      AIAnalysisResult | null;
}

export type RejectionCode =
  | 'EMERGENCY_STOP'
  | 'LIVE_TRADING_DISABLED'
  | 'DAILY_LOSS_LIMIT'
  | 'WEEKLY_LOSS_LIMIT'
  | 'MAX_DRAWDOWN'
  | 'MAX_TRADES_TODAY'
  | 'MAX_OPEN_POSITIONS'
  | 'COOLDOWN_AFTER_TRADE'
  | 'COOLDOWN_AFTER_LOSS'
  | 'CONSECUTIVE_LOSSES'
  | 'DIRECTION_DISABLED'
  | 'SYMBOL_NOT_ALLOWED'
  | 'OUTSIDE_TRADING_HOURS'
  | 'POSITION_ALREADY_OPEN'
  | 'STRATEGY_SCORE_TOO_LOW'
  | 'AI_CONFIDENCE_TOO_LOW'
  | 'RISK_REWARD_TOO_LOW'
  | 'INVALID_STOP_LOSS'
  | 'INVALID_TAKE_PROFIT'
  | 'STOP_TOO_CLOSE'
  | 'POSITION_SIZE_TOO_SMALL'
  | 'INSUFFICIENT_BALANCE'
  | 'LEVERAGE_EXCEEDED'
  | 'PROFIT_TARGET_REACHED'
  | 'STALE_MARKET_DATA';

export interface RiskCheckResult {
  passed:    boolean;
  code?:     RejectionCode;
  reason?:   string;
}

export interface RiskValidationOutput {
  approved:           boolean;
  rejectionReasons:   Array<{ code: RejectionCode; reason: string }>;

  /** Only set when approved === true */
  positionSize?:      number;
  riskAmount?:        number;
  riskPercent?:       number;
  adjustedStopLoss?:  number;
  adjustedTakeProfit?: number;
  riskReward?:        number;
  fees?:              number;
}

export interface PositionSizeResult {
  size:          number;   // units to buy/sell
  riskAmount:    number;   // dollars at risk
  riskPercent:   number;   // % of account
  stopDistance:  number;   // price distance to stop
  fees:          number;   // estimated fees
  valid:         boolean;
  reason?:       string;
}
