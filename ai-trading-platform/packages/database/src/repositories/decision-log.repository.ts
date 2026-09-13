import type { TradeDecisionLog } from '@prisma/client';
import { prisma } from '../client';
import type { TradeDecisionLog as DecisionLogType } from '@trading/types';

// =============================================================================
// TRADE DECISION LOG REPOSITORY
// Every signal evaluation is recorded — approved OR rejected.
// This is the core transparency mechanism.
// =============================================================================

export type CreateDecisionLogData = Omit<DecisionLogType, 'id' | 'timestamp'> & {
  positionId?: string;
  signalId?: string;
};

export async function createDecisionLog(
  data: CreateDecisionLogData,
): Promise<TradeDecisionLog> {
  return prisma.tradeDecisionLog.create({
    data: {
      symbol: data.symbol,
      outcome: data.outcome,

      strategyScore: data.strategyScore,
      requiredStrategyScore: data.requiredStrategyScore,
      strategyReasons: data.strategyReasons,
      signalId: data.signalId,

      aiDecision: data.aiDecision ?? null,
      aiConfidence: data.aiConfidence ?? null,
      requiredAiConfidence: data.requiredAIConfidence,
      aiReasons: data.aiReasons,

      riskDecision: data.riskDecision ?? null,
      riskRejectionReasons: data.riskRejectionReasons,

      riskReward: data.riskReward ?? null,
      requiredRiskReward: data.requiredRiskReward,
      marketRegime: data.marketRegime,
      finalReason: data.finalReason,

      positionId: data.positionId,
    },
  });
}

export async function getRecentDecisionLogs(
  limit = 50,
  symbol?: string,
): Promise<TradeDecisionLog[]> {
  return prisma.tradeDecisionLog.findMany({
    where: symbol ? { symbol } : {},
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}

export async function getDecisionLogsByOutcome(
  outcome: 'APPROVED' | 'REJECTED' | 'NO_TRADE_AI_UNAVAILABLE',
  limit = 50,
): Promise<TradeDecisionLog[]> {
  return prisma.tradeDecisionLog.findMany({
    where: { outcome },
    orderBy: { createdAt: 'desc' },
    take: limit,
  });
}
