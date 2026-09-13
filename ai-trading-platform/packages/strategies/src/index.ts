export { StrategyEngine }           from './strategy-engine';
export type { StrategyEngineConfig, EngineResult } from './strategy-engine';

export type { Strategy, StrategyInput, StrategyOutput } from './strategy.interface';
export { calcRiskReward, noSignal } from './strategy.interface';

export { EmaTrendStrategy }           from './strategies/ema-trend.strategy';
export { RsiMomentumStrategy }        from './strategies/rsi-momentum.strategy';
export { VolatilityBreakoutStrategy } from './strategies/volatility-breakout.strategy';
export { MarketStructureStrategy }    from './strategies/market-structure.strategy';
export { MeanReversionStrategy }      from './strategies/mean-reversion.strategy';
