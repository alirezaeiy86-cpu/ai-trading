// =============================================================================
// AI TRADING PLATFORM — SHARED TYPES
// Single source of truth for all domain types across the monorepo.
// =============================================================================

// -----------------------------------------------------------------------------
// MARKET DATA
// -----------------------------------------------------------------------------

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1d';

export interface Candle {
  symbol: string;
  timeframe: Timeframe;
  openTime: Date;
  closeTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
}

export interface Ticker {
  symbol: string;
  price: number;
  bid: number;
  ask: number;
  spread: number;
  volume24h: number;
  change24h: number;
  changePercent24h: number;
  timestamp: Date;
}

export interface OrderBook {
  symbol: string;
  bids: Array<[price: number, qty: number]>;
  asks: Array<[price: number, qty: number]>;
  timestamp: Date;
}

// -----------------------------------------------------------------------------
// MARKET REGIME
// -----------------------------------------------------------------------------

export type MarketRegime =
  | 'TRENDING_UP'
  | 'TRENDING_DOWN'
  | 'RANGING'
  | 'HIGH_VOLATILITY'
  | 'LOW_VOLATILITY'
  | 'BREAKOUT'
  | 'UNCERTAIN';

// -----------------------------------------------------------------------------
// STRATEGY SIGNALS
// -----------------------------------------------------------------------------

export type SignalDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

export interface StrategySignal {
  id: string;
  symbol: string;
  timeframe: Timeframe;
  direction: SignalDirection;
  /** 0–100 composite score */
  score: number;
  /** 0–1 confidence */
  confidence: number;
  entryZone: { min: number; max: number };
  suggestedStopLoss: number;
  suggestedTakeProfit: number;
  riskReward: number;
  marketRegime: MarketRegime;
  reasons: string[];
  strategyName: string;
  timestamp: Date;
}

// -----------------------------------------------------------------------------
// AI ENGINE
// -----------------------------------------------------------------------------

export type AIDecision = 'BUY' | 'SELL' | 'HOLD' | 'NO_TRADE';

export interface AIAnalysisRequest {
  symbol: string;
  currentPrice: number;
  marketRegime: MarketRegime;
  strategySignals: StrategySignal[];
  recentCandles: Candle[];
  openPositions: Position[];
  riskSettings: RiskSettings;
}

export interface AIAnalysisResult {
  decision: AIDecision;
  confidence: number;
  marketRegime: MarketRegime;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  reasons: string[];
  modelUsed: string;
  latencyMs: number;
  timestamp: Date;
}

export type AIUnavailableMode = 'NO_TRADE' | 'RULE_BASED';

export interface AIUsageStats {
  requestsToday: number;
  requestsThisMinute: number;
  errorsToday: number;
  rateLimitHitsToday: number;
  avgLatencyMs: number;
  lastRequestAt: Date | null;
}

// -----------------------------------------------------------------------------
// RISK ENGINE
// -----------------------------------------------------------------------------

export type RiskDecision = 'APPROVED' | 'REJECTED';

export interface RiskValidationResult {
  decision: RiskDecision;
  rejectionReasons: string[];
  approvedPositionSize: number;
  approvedStopLoss: number;
  approvedTakeProfit: number;
  riskAmount: number;
  riskPercent: number;
}

export interface RiskSettings {
  // Position sizing
  riskPerTradePercent: number;
  minRiskReward: number;

  // Loss limits
  maxDailyLossPercent: number;
  maxWeeklyLossPercent: number;
  maxDrawdownPercent: number;

  // Trade limits
  maxTradesPerDay: number;
  maxOpenPositions: number;
  maxLeverage: number;

  // Filters
  minStrategyScore: number;
  minAIConfidence: number;

  // Symbol and direction
  allowedSymbols: string[];
  longEnabled: boolean;
  shortEnabled: boolean;

  // Stop loss / take profit
  stopLossMode: 'fixed' | 'atr' | 'structure';
  takeProfitMode: 'fixed' | 'rr_ratio' | 'structure';
  trailingStopEnabled: boolean;
  breakEvenEnabled: boolean;

  // Timing
  tradingHoursStart: string; // HH:MM UTC
  tradingHoursEnd: string; // HH:MM UTC
  cooldownAfterTradeMs: number;
  cooldownAfterLossMs: number;

  // AI
  aiEnabled: boolean;
  aiUnavailableMode: AIUnavailableMode;
}

// -----------------------------------------------------------------------------
// ORDERS & POSITIONS
// -----------------------------------------------------------------------------

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
export type OrderStatus =
  | 'PENDING'
  | 'OPEN'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'CANCELLED'
  | 'REJECTED'
  | 'EXPIRED';

export interface Order {
  id: string;
  clientOrderId: string;
  exchangeOrderId?: string;
  symbol: string;
  side: OrderSide;
  type: OrderType;
  status: OrderStatus;
  quantity: number;
  price?: number;
  stopPrice?: number;
  filledQuantity: number;
  avgFillPrice?: number;
  fees: number;
  feeCurrency: string;
  createdAt: Date;
  updatedAt: Date;
  filledAt?: Date;
}

export type PositionSide = 'LONG' | 'SHORT';
export type PositionStatus = 'OPEN' | 'CLOSED';

export interface Position {
  id: string;
  symbol: string;
  side: PositionSide;
  status: PositionStatus;
  entryPrice: number;
  quantity: number;
  stopLoss: number;
  takeProfit: number;
  currentPrice: number;
  unrealizedPnl: number;
  unrealizedPnlPercent: number;
  realizedPnl: number;
  fees: number;
  openedAt: Date;
  closedAt?: Date;
  closeReason?: CloseReason;
}

export type CloseReason =
  | 'TAKE_PROFIT'
  | 'STOP_LOSS'
  | 'MANUAL'
  | 'EMERGENCY_STOP'
  | 'RISK_LIMIT'
  | 'SIGNAL_REVERSAL';

// -----------------------------------------------------------------------------
// ACCOUNT
// -----------------------------------------------------------------------------

export interface AccountSnapshot {
  balance: number;
  availableBalance: number;
  equity: number;
  usedMargin: number;
  openPositionsCount: number;
  unrealizedPnl: number;
  currency: string;
  isPaperTrading: boolean;
  timestamp: Date;
}

// -----------------------------------------------------------------------------
// DAILY STATISTICS
// -----------------------------------------------------------------------------

export interface DailyStatistics {
  date: string; // YYYY-MM-DD UTC
  startingBalance: number;
  endingBalance: number;
  pnl: number;
  pnlPercent: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  totalFees: number;
  aiRequestsUsed: number;
}

// -----------------------------------------------------------------------------
// WORKER STATUS
// -----------------------------------------------------------------------------

export type WorkerStatus = 'RUNNING' | 'PAUSED' | 'STOPPED' | 'ERROR' | 'EMERGENCY_STOP';
export type TradingMode = 'PAPER' | 'LIVE';

export interface WorkerHeartbeat {
  workerId: string;
  workerVersion: string;
  status: WorkerStatus;
  tradingMode: TradingMode;
  currentJob: string | null;
  uptimeSeconds: number;
  lastSeenAt: Date;
  memoryUsageMb: number;
  queuedJobs: number;
}

// -----------------------------------------------------------------------------
// SYSTEM EVENTS & LOGS
// -----------------------------------------------------------------------------

export type SystemEventType =
  | 'WORKER_STARTED'
  | 'WORKER_STOPPED'
  | 'WORKER_PAUSED'
  | 'WORKER_RESUMED'
  | 'EMERGENCY_STOP'
  | 'MARKET_DATA_ERROR'
  | 'STRATEGY_SIGNAL'
  | 'AI_REQUEST'
  | 'AI_RESPONSE'
  | 'AI_RATE_LIMIT'
  | 'RISK_REJECTION'
  | 'ORDER_CREATED'
  | 'ORDER_FILLED'
  | 'POSITION_OPENED'
  | 'POSITION_CLOSED'
  | 'STOP_LOSS_HIT'
  | 'TAKE_PROFIT_HIT'
  | 'CONFIG_CHANGED'
  | 'DAILY_STATS'
  | 'HEALTH_CHECK';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface SystemEvent {
  id: string;
  type: SystemEventType;
  level: LogLevel;
  message: string;
  data?: Record<string, unknown>;
  timestamp: Date;
}

// -----------------------------------------------------------------------------
// DECISION AUDIT LOG
// Every signal evaluation is recorded for full transparency
// -----------------------------------------------------------------------------

export type TradeDecisionOutcome = 'APPROVED' | 'REJECTED' | 'NO_TRADE_AI_UNAVAILABLE';

export interface TradeDecisionLog {
  id: string;
  symbol: string;
  timestamp: Date;
  outcome: TradeDecisionOutcome;

  strategyScore: number;
  requiredStrategyScore: number;
  strategyReasons: string[];

  aiDecision: AIDecision | null;
  aiConfidence: number | null;
  requiredAIConfidence: number;
  aiReasons: string[];

  riskDecision: RiskDecision | null;
  riskRejectionReasons: string[];

  riskReward: number | null;
  requiredRiskReward: number;

  marketRegime: MarketRegime;

  finalReason: string;
}

// -----------------------------------------------------------------------------
// BACKTEST
// -----------------------------------------------------------------------------

export interface BacktestConfig {
  strategyName: string;
  symbol: string;
  timeframe: Timeframe;
  startDate: Date;
  endDate: Date;
  initialBalance: number;
  riskSettings: RiskSettings;
  useAI: boolean;
}

export interface BacktestResult {
  id: string;
  config: BacktestConfig;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'FAILED';
  startedAt: Date;
  completedAt?: Date;
  error?: string;

  // Performance
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netPnl: number;
  netPnlPercent: number;
  profitFactor: number;
  avgR: number;
  maxDrawdown: number;
  maxDrawdownPercent: number;
  largestWin: number;
  largestLoss: number;
  avgTrade: number;
  totalFees: number;

  // Trade list
  trades: BacktestTrade[];
  equityCurve: Array<{ date: Date; equity: number }>;
}

export interface BacktestTrade {
  entryDate: Date;
  exitDate: Date;
  symbol: string;
  side: PositionSide;
  entryPrice: number;
  exitPrice: number;
  quantity: number;
  pnl: number;
  pnlR: number;
  fees: number;
  closeReason: CloseReason;
}

// -----------------------------------------------------------------------------
// API REQUEST/RESPONSE TYPES
// -----------------------------------------------------------------------------

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
  timestamp: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface BotControlRequest {
  action: 'start' | 'pause' | 'resume' | 'emergency-stop';
  reason?: string;
}

export interface HealthCheckResponse {
  status: 'ok' | 'degraded' | 'down';
  version: string;
  uptime: number;
  timestamp: string;
  services: {
    database: 'ok' | 'error';
    redis: 'ok' | 'error';
    marketData: 'ok' | 'error';
    worker: 'ok' | 'stale' | 'offline';
  };
}
