import { PositionRepo, PaperAccountRepo, StatisticsRepo } from '@trading/database';

// =============================================================================
// DAILY STATISTICS CALCULATOR
// Called by the daily-statistics BullMQ job at 00:00 UTC.
// Aggregates all closed positions for the day and persists to daily_statistics.
// =============================================================================

export async function calculateDailyStatistics(isPaper: boolean): Promise<void> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const dateStr = today.toISOString().slice(0, 10);

  // All positions closed today
  const { positions } = await PositionRepo.getClosedPositions(isPaper, 1000, 0);
  const todayPositions = positions.filter(
    (p) => p.closedAt && p.closedAt >= today,
  );

  const account = await PaperAccountRepo.getPaperAccount();

  const totalTrades    = todayPositions.length;
  const winningTrades  = todayPositions.filter((p) => p.realisedPnl > 0).length;
  const losingTrades   = todayPositions.filter((p) => p.realisedPnl < 0).length;
  const winRate        = totalTrades > 0 ? winningTrades / totalTrades : 0;

  const pnl       = todayPositions.reduce((s, p) => s + p.realisedPnl, 0);
  const totalFees = todayPositions.reduce((s, p) => s + p.fees, 0);

  const wins  = todayPositions.filter((p) => p.realisedPnl > 0).map((p) => p.realisedPnl);
  const losses = todayPositions.filter((p) => p.realisedPnl < 0).map((p) => p.realisedPnl);

  const avgWin  = wins.length  > 0 ? wins.reduce( (a, b) => a + b, 0) / wins.length  : 0;
  const avgLoss = losses.length > 0 ? losses.reduce((a, b) => a + b, 0) / losses.length : 0;

  const grossProfit = wins.reduce(  (a, b) => a + b, 0);
  const grossLoss   = Math.abs(losses.reduce((a, b) => a + b, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

  // Max intraday drawdown
  let maxDrawdown = 0;
  let peak = account.highWaterMark;
  for (const p of todayPositions) {
    if (p.realisedPnl < 0) {
      const dd = Math.abs(p.realisedPnl) / peak;
      maxDrawdown = Math.max(maxDrawdown, dd);
    } else {
      peak = Math.max(peak, peak + p.realisedPnl);
    }
  }

  const startingBalance = account.currentBalance - pnl;
  const pnlPercent      = startingBalance > 0 ? pnl / startingBalance : 0;

  await StatisticsRepo.upsertDailyStatistics({
    date: dateStr,
    startingBalance,
    endingBalance: account.currentBalance,
    pnl,
    pnlPercent,
    totalTrades,
    winningTrades,
    losingTrades,
    winRate,
    avgWin,
    avgLoss,
    profitFactor,
    maxDrawdown,
    totalFees,
    aiRequestsUsed: 0, // Phase 9 will populate this
    isPaper,
  });
}
