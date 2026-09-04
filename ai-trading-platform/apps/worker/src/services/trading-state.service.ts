import type { Logger } from 'pino';
import {
  PaperAccountRepo,
  PositionRepo,
  StatisticsRepo,
  SystemEventRepo,
} from '@trading/database';
import type { AccountState, TradingState } from '@trading/risk-engine';
import type { Position } from '@trading/types';

// =============================================================================
// TRADING STATE SERVICE
// Assembles the current AccountState and TradingState from the database.
// Called by the worker before each risk validation.
// =============================================================================

export class TradingStateService {
  constructor(
    private readonly isPaper: boolean,
    private readonly logger: Logger,
  ) {}

  async getAccountState(): Promise<AccountState> {
    const account = await PaperAccountRepo.getPaperAccount();
    return {
      balance:          account.currentBalance,
      equity:           account.equity,
      availableBalance: account.currentBalance, // Phase 7: subtract margin in use
      highWaterMark:    account.highWaterMark,
      currency:         account.currency,
      isPaper:          this.isPaper,
    };
  }

  async getTradingState(): Promise<TradingState> {
    const [
      openPositions,
      tradesToday,
      realisedPnlToday,
      weekPnl,
      lastPositions,
    ] = await Promise.all([
      PositionRepo.getOpenPositions(this.isPaper),
      PositionRepo.countTradesToday(this.isPaper),
      PositionRepo.getTodayRealisedPnl(this.isPaper),
      PositionRepo.getWeekRealisedPnl(this.isPaper),
      PositionRepo.getLastClosedPositions(this.isPaper, 5),
    ]);

    // Calculate unrealised PnL from open positions
    const unrealisedPnlToday = openPositions.reduce(
      (sum, p) => sum + p.unrealisedPnl, 0,
    );

    // Find last trade and last loss timestamps
    const allRecent = await PositionRepo.getLastClosedPositions(this.isPaper, 20);
    const lastTradeAt = allRecent[0]?.closedAt ?? null;
    const lastLoss    = allRecent.find((p) => p.realisedPnl < 0);
    const lastLossAt  = lastLoss?.closedAt ?? null;

    // Count consecutive losses
    let consecutiveLosses = 0;
    for (const p of lastPositions) {
      if (p.realisedPnl < 0) consecutiveLosses++;
      else break;
    }

    // Check if limits already breached (for quick canTrade check)
    const account          = await this.getAccountState();
    const totalDayPnl      = realisedPnlToday + unrealisedPnlToday;
    const dayLossPct       = totalDayPnl < 0 ? Math.abs(totalDayPnl) / account.balance : 0;
    const drawdownPct      = account.highWaterMark > 0
      ? (account.highWaterMark - account.equity) / account.highWaterMark
      : 0;

    // Cast DB positions to the shared Position type
    const positions = openPositions as unknown as Position[];

    return {
      openPositions:       positions,
      tradesToday,
      realisedPnlToday,
      unrealisedPnlToday,
      realisedPnlWeek:     weekPnl,
      lastTradeAt,
      lastLossAt,
      consecutiveLosses,
      emergencyStopActive: false, // Phase 10: read from Redis pub/sub
      dailyLossBreached:   dayLossPct >= 0.03,  // will be overridden by Risk Engine
      drawdownBreached:    drawdownPct >= 0.10,
    };
  }

  /**
   * Update paper account equity after price changes in open positions.
   */
  async syncEquity(): Promise<void> {
    const openPositions = await PositionRepo.getOpenPositions(this.isPaper);
    const unrealised    = openPositions.reduce((s, p) => s + p.unrealisedPnl, 0);
    const account       = await PaperAccountRepo.getPaperAccount();
    await PaperAccountRepo.updatePaperAccount({
      equity: account.currentBalance + unrealised,
    });
  }
}
