import type { DailyStatistic } from '@prisma/client';
import { prisma } from '../client';

// =============================================================================
// DAILY STATISTICS REPOSITORY
// =============================================================================

export type UpsertDailyStatsData = {
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
  isPaper: boolean;
};

export async function upsertDailyStatistics(
  data: UpsertDailyStatsData,
): Promise<DailyStatistic> {
  return prisma.dailyStatistic.upsert({
    where: { date: data.date },
    create: data,
    update: data,
  });
}

export async function getDailyStatistics(
  days = 30,
  isPaper: boolean,
): Promise<DailyStatistic[]> {
  return prisma.dailyStatistic.findMany({
    where: { isPaper },
    orderBy: { date: 'desc' },
    take: days,
  });
}

export async function getTodayStatistics(
  isPaper: boolean,
): Promise<DailyStatistic | null> {
  const today = new Date().toISOString().slice(0, 10);
  return prisma.dailyStatistic.findFirst({
    where: { date: today, isPaper },
  });
}

/**
 * Get overall totals — all-time aggregate stats.
 */
export async function getAllTimeStats(isPaper: boolean): Promise<{
  totalTrades: number;
  totalPnl: number;
  winningTrades: number;
  losingTrades: number;
  totalFees: number;
}> {
  const result = await prisma.dailyStatistic.aggregate({
    _sum: {
      totalTrades: true,
      pnl: true,
      winningTrades: true,
      losingTrades: true,
      totalFees: true,
    },
    where: { isPaper },
  });

  return {
    totalTrades: result._sum.totalTrades ?? 0,
    totalPnl: result._sum.pnl ?? 0,
    winningTrades: result._sum.winningTrades ?? 0,
    losingTrades: result._sum.losingTrades ?? 0,
    totalFees: result._sum.totalFees ?? 0,
  };
}
