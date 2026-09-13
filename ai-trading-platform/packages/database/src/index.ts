// =============================================================================
// @trading/database — Public API
// All consumers import from this single entry point.
// =============================================================================

// Prisma client
export {
  prisma,
  connectDatabase,
  disconnectDatabase,
  isDatabaseHealthy,
} from './client';

// Repositories
export * as SettingsRepo from './repositories/settings.repository';
export * as PositionRepo from './repositories/position.repository';
export * as OrderRepo from './repositories/order.repository';
export * as CandleRepo from './repositories/candle.repository';
export * as SystemEventRepo from './repositories/system-event.repository';
export * as HeartbeatRepo from './repositories/heartbeat.repository';
export * as DecisionLogRepo from './repositories/decision-log.repository';
export * as StatisticsRepo from './repositories/statistics.repository';
export * as PaperAccountRepo from './repositories/paper-account.repository';

// Re-export Prisma types that consumers may need
export type {
  TradingSettings,
  Position,
  Order,
  MarketCandle,
  SystemEvent,
  WorkerHeartbeat,
  TradeDecisionLog,
  DailyStatistic,
  PaperAccount,
  BacktestRun,
  Strategy,
  StrategySignal,
  AiPrediction,
  RiskEvent,
} from '@prisma/client';
