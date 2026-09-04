import type { TradingSettings } from '@prisma/client';
import { prisma } from '../client';
import type { RiskSettings } from '@trading/types';

// =============================================================================
// SETTINGS REPOSITORY
// Single-row pattern — there is exactly one TradingSettings record ("singleton").
// =============================================================================

export type SettingsUpdate = Partial<Omit<TradingSettings, 'id' | 'createdAt' | 'updatedAt'>>;

/**
 * Get the current trading settings.
 * Creates a record with safe defaults if none exists yet.
 */
export async function getSettings(): Promise<TradingSettings> {
  const existing = await prisma.tradingSettings.findUnique({
    where: { id: 'singleton' },
  });

  if (existing) return existing;

  // First boot — create with defaults from Prisma schema
  return prisma.tradingSettings.create({
    data: { id: 'singleton' },
  });
}

/**
 * Update trading settings (partial update, safe merge).
 */
export async function updateSettings(data: SettingsUpdate): Promise<TradingSettings> {
  return prisma.tradingSettings.update({
    where: { id: 'singleton' },
    data,
  });
}

/**
 * Convert DB settings to the RiskSettings shape used by the Risk Engine.
 */
export function toRiskSettings(s: TradingSettings): RiskSettings {
  return {
    riskPerTradePercent: s.riskPerTradePercent,
    minRiskReward: s.minRiskReward,
    maxDailyLossPercent: s.maxDailyLossPercent,
    maxWeeklyLossPercent: s.maxWeeklyLossPercent,
    maxDrawdownPercent: s.maxDrawdownPercent,
    maxTradesPerDay: s.maxTradesPerDay,
    maxOpenPositions: s.maxOpenPositions,
    maxLeverage: s.maxLeverage,
    minStrategyScore: s.minStrategyScore,
    minAIConfidence: s.minAiConfidence,
    allowedSymbols: s.allowedSymbols,
    longEnabled: s.longEnabled,
    shortEnabled: s.shortEnabled,
    stopLossMode: s.stopLossMode as RiskSettings['stopLossMode'],
    takeProfitMode: s.takeProfitMode as RiskSettings['takeProfitMode'],
    trailingStopEnabled: s.trailingStopEnabled,
    breakEvenEnabled: s.breakEvenEnabled,
    tradingHoursStart: s.tradingHoursStart,
    tradingHoursEnd: s.tradingHoursEnd,
    cooldownAfterTradeMs: s.cooldownAfterTradeMs,
    cooldownAfterLossMs: s.cooldownAfterLossMs,
    aiEnabled: s.aiEnabled,
    aiUnavailableMode: s.aiUnavailableMode as RiskSettings['aiUnavailableMode'],
  };
}
